// securityVendorRoutes.js
// Security-vendor (AV/EDR) detection connections: a client pastes a READ-ONLY
// credential for their own CrowdStrike/SentinelOne/... console and ShieldAI
// vCISO pulls the detections that product has already recorded, so they show
// up even though the endpoint agent cannot read them locally (see
// securityVendorAdapters.js for the read-only enforcement and the vendors).
//
// Shape follows cloudRoutes.js: validate one live read before storing, encrypt
// the credential (credentialCrypto.js), never return it, scope every route to
// the owner. Difference: detections are polled on a schedule (every 15 min)
// as well as on demand, and are turned into (a) `vendorDetections` records,
// (b) open `agentVulnerabilities` (source:"vendor") on the matching endpoint,
// and (c) draft recommendations for a human to review.
//
// BOUNDARIES (CLAUDE.md): read-only credentials/calls only; AI never triggers
// an action; nothing is seeded or simulated; a FAILED or partial poll never
// resolves or clears anything (absence of evidence is not a fix) and never
// turns an endpoint's av_threats into "clean" — see ingestVendorDetections().
// Analyst isolation: connections are per owner; analysts see a client's
// vendor-sourced findings only through the existing per-client vulnerability
// routes, which already enforce assignment.
//
// Mount from server.js:
//   registerSecurityVendorRoutes(app, { db, requireAuth, gate, callClaudeText, extractJson });

import { randomUUID, createHash } from "crypto";
import { counters } from "./tierGate.js";
import { hasCapability } from "./tiers.js";
import { encryptSecret, decryptSecret } from "./credentialCrypto.js";
import { SECURITY_VENDORS, vendorLabelOf, credentialFromBody, missingCredentialFields, validateCredential } from "./securityVendorAdapters.js";

const nowIso = () => new Date().toISOString();
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const POLL_INTERVAL_MS = 15 * 60 * 1000;
const MAX_BACKOFF_MULT = 8;
const ERROR_AFTER_FAILURES = 3;
const LOOKBACK_MS = 30 * 86400000;

// "WIN-01.corp.local" and "win-01" are the same machine.
export const normHost = (h) => String(h || "").trim().toLowerCase().split(".")[0];

const cols = (db) => {
  db.data.securityVendorConnections ||= [];
  db.data.vendorDetections ||= [];   // { id, connectionId, ownerUserId, vendor, dedupeKey, externalId, host, agentId, title, severity, detectedAt, status: active|remediated|unknown|resolved, action, path, firstSeenAt, lastSeenAt, resolvedAt }
  db.data.agentVulnerabilities ||= [];
  db.data.recommendations ||= [];
  return db.data;
};

// Public view — never leaks the encrypted credential.
export function publicVendorConnection(c, detections = []) {
  const mine = detections.filter(d => d.connectionId === c.id);
  const open = mine.filter(d => d.status === "active");
  return {
    id: c.id, vendor: c.vendor, vendorLabel: vendorLabelOf(c.vendor),
    label: c.label, accountLabel: c.accountLabel, status: c.status,
    connectedAt: c.connectedAt, lastSyncAt: c.lastSyncAt || null,
    lastSyncOkAt: c.lastSyncOkAt || null, lastError: c.lastError || null,
    detectionCount: mine.length, activeCount: open.length,
    reviewCount: mine.filter(d => d.status === "unknown").length,   // vendor gave no open/closed state
    revokedAt: c.revokedAt || null,
  };
}

// Is this connection currently a trustworthy source? (Used for the
// endpoint-facing "detections monitored via <vendor>" note.) A stale or
// erroring connection is NOT — the endpoint's av_threats stays "unknown".
export function connectionIsHealthy(c, now = Date.now()) {
  if (!c || c.status !== "active" || !c.lastSyncOkAt) return false;
  return now - Date.parse(c.lastSyncOkAt) <= POLL_INTERVAL_MS * 3;
}

export function avDetectionSourceFor(db, agent, now = Date.now()) {
  const conn = (db.data.securityVendorConnections || []).find(c => c.ownerUserId === agent.ownerUserId && connectionIsHealthy(c, now));
  return conn ? { vendor: conn.vendor, vendorLabel: vendorLabelOf(conn.vendor), lastSyncOkAt: conn.lastSyncOkAt } : null;
}

// ── the shared sink ───────────────────────────────────────────────────
// Call ONLY with detections from a fully successful fetch. `fullPoll` = the
// fetch covered the whole lookback window (so a still-in-window detection that
// is now missing was deleted in the console and can be resolved). Anything
// older than the window is left alone: aging out is not remediation.
export function ingestVendorDetections(db, { connection, detections, fullPoll = true, sinceIso }) {
  const d = cols(db);
  const now = nowIso();
  const label = vendorLabelOf(connection.vendor);
  const agents = d.agents || [];
  const findAgent = (host) => host ? agents.find(a => a.ownerUserId === connection.ownerUserId && a.status !== "revoked" && normHost(a.hostname) === normHost(host)) : null;
  const seen = new Set();
  const created = [];
  const windowStart = Date.parse(sinceIso || new Date(Date.now() - LOOKBACK_MS).toISOString());

  for (const det of detections) {
    if (!det?.externalId) continue;
    const dedupeKey = `${connection.id}::${det.externalId}`;
    seen.add(dedupeKey);
    const agent = findAgent(det.host);
    let rec = d.vendorDetections.find(x => x.dedupeKey === dedupeKey);
    const vendorStatus = det.status === "remediated" ? "remediated" : det.status === "active" ? "active" : "unknown";
    if (!rec) {
      rec = {
        id: randomUUID(), connectionId: connection.id, ownerUserId: connection.ownerUserId, vendor: connection.vendor,
        dedupeKey, externalId: String(det.externalId), firstSeenAt: now, resolvedAt: null,
      };
      d.vendorDetections.push(rec);
      created.push(rec);
    }
    Object.assign(rec, {
      host: det.host || null, agentId: agent?.id || null, title: det.title, severity: det.severity,
      detectedAt: det.detectedAt || null, status: vendorStatus, action: det.action || null, path: det.path || null,
      lastSeenAt: now, resolvedAt: vendorStatus === "remediated" ? (rec.resolvedAt || now) : null,
    });
  }

  if (fullPoll) {
    for (const rec of d.vendorDetections) {
      if (rec.connectionId !== connection.id || rec.status !== "active" || seen.has(rec.dedupeKey)) continue;
      if (Number.isFinite(Date.parse(rec.detectedAt)) && Date.parse(rec.detectedAt) >= windowStart) {
        rec.status = "resolved"; rec.resolvedAt = now;    // gone from the console inside the window
      }
    }
  }

  // Mirror onto the matching endpoint as vulnerabilities (source:"vendor" so
  // syncAgentFindings never auto-resolves them on an agent's clean report).
  for (const rec of d.vendorDetections) {
    if (rec.connectionId !== connection.id) continue;
    const key = `vendor:${connection.id}:${rec.externalId}`;
    const existing = d.agentVulnerabilities.find(v => v.dedupeKey === key);
    const agent = findAgent(rec.host);
    rec.agentId = agent?.id || null;
    if (rec.status === "active" && agent) {
      const fields = {
        severity: ["critical", "high", "medium", "low"].includes(rec.severity) ? rec.severity : "low",
        title: `${label}: ${rec.title}`.slice(0, 200),
        detail: [`${label} reports this detection as still open.`, rec.action ? `Vendor status: ${rec.action}.` : "", rec.path ? `Path: ${rec.path}` : ""].filter(Boolean).join(" ").slice(0, 1000),
        host: agent.hostname, meta: { vendor: connection.vendor, externalId: rec.externalId, action: rec.action || null }, lastSeenAt: now,
      };
      if (existing) { if (existing.status === "resolved") { existing.status = "open"; existing.resolvedAt = null; } Object.assign(existing, fields); }
      else d.agentVulnerabilities.push({ id: randomUUID(), agentId: agent.id, ownerUserId: connection.ownerUserId, dedupeKey: key, kind: "av-detection", source: "vendor", ...fields, firstSeenAt: now, status: "open", resolvedAt: null });
    } else if (existing && existing.status === "open" && (rec.status === "remediated" || rec.status === "resolved")) {
      existing.status = "resolved"; existing.resolvedAt = now;
    }
  }
  return { created };
}

// ── recommendation drafts (own copy of the cloudRoutes.js pattern) ────
function buildDrafts({ created, connection }) {
  const label = vendorLabelOf(connection.vendor);
  // "unknown" = the vendor gave no open/closed state (e.g. ESET): still worth a
  // human look at high+ severity, worded so it asserts nothing about its state.
  return created.filter(r => (r.status === "active" && (SEV_RANK[r.severity] ?? 0) >= SEV_RANK.medium)
      || (r.status === "unknown" && (SEV_RANK[r.severity] ?? 0) >= SEV_RANK.high)).map(r => ({
    dedupeKey: `vendor::${connection.id}::${r.externalId}`,
    title: `Review ${label} detection: ${r.title}`.slice(0, 300),
    detail: r.status === "active"
      ? `${label} (${connection.label}) recorded an open detection "${r.title}"${r.host ? ` on ${r.host}` : ""}. Confirm it is contained and remediated in ${label}'s console.`
      : `${label} (${connection.label}) recorded a detection "${r.title}"${r.host ? ` on ${r.host}` : ""}. ${label} did not tell us whether it was remediated, so check its status in ${label}'s console.`,
    severity: r.severity,
  }));
}

async function aiEnrich({ drafts, connection, owner, callClaudeText, extractJson }) {
  if (!callClaudeText || !extractJson || drafts.length === 0) return null;
  const items = drafts.map(d => ({ key: d.dedupeKey, title: d.title, severity: d.severity, detail: d.detail }));
  const system = `You are ShieldAI vCISO Mastermind, a senior virtual CISO. You turn malware/threat detections reported by a client's own antivirus/EDR into clear, prioritized remediation recommendations for a small/medium business.

You ONLY write recommendations for a human (the client's admin or their analyst) to act on. You never perform actions. Be specific, practical and concise; assume a non-expert reader.

Return ONLY valid minified JSON, no markdown fences, exactly:
{"recommendations":[{"key":"<echo the finding key>","title":"<short imperative title>","detail":"<2-4 sentences: what it is, why it matters for this business, the concrete steps a human should take>","severity":"low|medium|high|critical","priority":1-5,"rationale":"<one sentence on urgency>"}]}
Keep one entry per key. Do not invent detections.`;
  const user = `Source: ${vendorLabelOf(connection.vendor)}.\nCompany: ${owner?.companyName || "the client"}.\n\nDetections:\n${JSON.stringify(items)}\n\nReturn the JSON now.`;
  try {
    const text = await callClaudeText({ system, messages: [{ role: "user", content: user }], max_tokens: 1800 });
    const parsed = extractJson(text);
    const out = {};
    for (const r of (parsed?.recommendations || [])) {
      if (!r.key) continue;
      out[r.key] = {
        title: String(r.title || "").slice(0, 300), detail: String(r.detail || "").slice(0, 4000),
        severity: ["low", "medium", "high", "critical"].includes(r.severity) ? r.severity : undefined,
        priority: Number.isFinite(r.priority) ? r.priority : undefined, rationale: String(r.rationale || "").slice(0, 500),
      };
    }
    return Object.keys(out).length ? out : null;
  } catch (err) {
    console.warn("Mastermind AI vendor-draft enrichment failed; using deterministic text:", err.message);
    return null;
  }
}

async function draftRecommendations(db, { created, connection, callClaudeText, extractJson }) {
  const d = cols(db);
  const candidates = buildDrafts({ created, connection });
  const fresh = candidates.filter(c => !d.recommendations.some(r => r.dedupeKey === c.dedupeKey && !["completed", "declined"].includes(r.status)));
  if (!fresh.length) return 0;
  const owner = (d.users || []).find(u => u.id === connection.ownerUserId);
  const enriched = await aiEnrich({ drafts: fresh, connection, owner, callClaudeText, extractJson });
  for (const c of fresh) {
    const ai = enriched?.[c.dedupeKey];
    d.recommendations.push({
      id: randomUUID(), ownerUserId: connection.ownerUserId, securityVendorConnectionId: connection.id,
      dedupeKey: c.dedupeKey, origin: "ai", aiAuthored: !!ai,
      title: ai?.title || c.title, detail: ai?.detail || c.detail, severity: ai?.severity || c.severity,
      priority: ai?.priority ?? null, rationale: ai?.rationale || "", status: "suggested", createdAt: nowIso(),
      history: [{ at: nowIso(), actorType: "ai", actorId: null, status: "suggested",
        note: ai ? "Auto-drafted by Mastermind AI from a security-vendor sync." : "Auto-drafted (rule-based) from a security-vendor sync." }],
    });
  }
  return fresh.length;
}

// One connection, one poll. Never throws; failure changes only the
// connection's own status fields (never detections/vulnerabilities).
export async function syncConnection(db, connection, { callClaudeText, extractJson, fetchImpl } = {}) {
  const vendor = SECURITY_VENDORS[connection.vendor];
  if (!vendor) return { ok: false, error: "Unknown vendor." };
  const sinceIso = new Date(Date.now() - LOOKBACK_MS).toISOString();
  try {
    const credential = JSON.parse(decryptSecret(connection.encryptedSecret));
    const detections = await vendor.fetchDetections(credential, { sinceIso, fetchImpl });
    const { created } = ingestVendorDetections(db, { connection, detections, fullPoll: true, sinceIso });
    const drafts = await draftRecommendations(db, { created, connection, callClaudeText, extractJson });
    connection.status = "active"; connection.consecutiveFailures = 0; connection.lastError = null;
    connection.lastSyncAt = connection.lastSyncOkAt = nowIso();
    connection.nextPollAt = new Date(Date.now() + POLL_INTERVAL_MS).toISOString();
    await db.write();
    return { ok: true, detectionCount: detections.length, newDetections: created.length, draftsCreated: drafts };
  } catch (err) {
    connection.consecutiveFailures = (connection.consecutiveFailures || 0) + 1;
    if (connection.consecutiveFailures >= ERROR_AFTER_FAILURES) connection.status = "error";
    connection.lastSyncAt = nowIso();
    connection.lastError = String(err.message || "Sync failed").slice(0, 300);
    connection.nextPollAt = new Date(Date.now() + POLL_INTERVAL_MS * Math.min(2 ** connection.consecutiveFailures, MAX_BACKOFF_MULT)).toISOString();
    try { await db.write(); } catch { /* keep the poller alive */ }
    return { ok: false, error: connection.lastError };
  }
}

let pollerTimer = null;
let polling = false;
export function startSecurityVendorPoller(db, opts = {}) {
  if (pollerTimer) return pollerTimer;
  const { gate, intervalMs = 60 * 1000, ...syncOpts } = opts;
  pollerTimer = setInterval(async () => {
    if (polling) return;                   // overlap guard
    polling = true;
    try {
      for (const c of [...cols(db).securityVendorConnections]) {
        if (c.status === "revoked") continue;
        if (c.nextPollAt && Date.parse(c.nextPollAt) > Date.now()) continue;
        // A client who downgraded below Growth stops being polled (data stays).
        if (gate) { const tier = gate.tierOf(c.ownerUserId); if (!hasCapability(tier, "integrations")) continue; }
        await syncConnection(db, c, syncOpts);
      }
    } catch (err) { console.warn("Security-vendor poller error:", err.message); }
    finally { polling = false; }
  }, intervalMs);
  pollerTimer.unref?.();
  return pollerTimer;
}
export function stopSecurityVendorPoller() { if (pollerTimer) clearInterval(pollerTimer); pollerTimer = null; }

export function registerSecurityVendorRoutes(app, { db, requireAuth, gate, callClaudeText, extractJson, poll = true }) {
  const conns = () => cols(db).securityVendorConnections;
  const mine = (req) => conns().filter(c => c.ownerUserId === req.userId);
  const find = (req) => conns().find(c => c.id === req.params.id && c.ownerUserId === req.userId);

  // Catalog for the UI's "connect" modal (labels, fields, setup notes). No secrets.
  app.get("/api/security-vendors/catalog", requireAuth, (req, res) => {
    res.json(Object.entries(SECURITY_VENDORS).map(([id, v]) => ({
      id, label: v.label, setupNote: v.setupNote,
      fields: v.fields.map(f => ({ key: f.key, label: f.label, secret: !!f.secret, options: f.options || null })),
    })));
  });

  app.get("/api/security-vendors", requireAuth, (req, res) => {
    res.json(mine(req).map(c => publicVendorConnection(c, cols(db).vendorDetections)));
  });

  app.get("/api/security-vendors/:id", requireAuth, (req, res) => {
    const c = find(req);
    if (!c) return res.status(404).json({ error: "Security vendor connection not found." });
    const detections = cols(db).vendorDetections.filter(x => x.connectionId === c.id)
      .sort((a, b) => Date.parse(b.detectedAt || 0) - Date.parse(a.detectedAt || 0)).slice(0, 100)
      .map(x => ({ id: x.id, host: x.host, title: x.title, severity: x.severity, status: x.status, detectedAt: x.detectedAt, action: x.action, matchedEndpoint: !!x.agentId }));
    res.json({ ...publicVendorConnection(c, cols(db).vendorDetections), detections });
  });

  app.post("/api/security-vendors/connect/:vendor", requireAuth,
    gate.capability("integrations"),
    gate.limit("integrations", counters.integrations),
    async (req, res) => {
      const vendorId = req.params.vendor;
      const vendor = SECURITY_VENDORS[vendorId];
      if (!vendor) return res.status(400).json({ error: "Unknown security vendor." });
      const label = String(req.body?.label || vendor.label).slice(0, 200).trim();
      const credential = credentialFromBody(vendorId, req.body);
      const missing = missingCredentialFields(vendorId, credential);
      if (missing.length) return res.status(400).json({ error: `Missing required ${vendor.label} field(s): ${missing.join(", ")}.` });
      try {
        await validateCredential(vendorId, credential);
      } catch (err) {
        return res.status(400).json({ error: `Could not validate this ${vendor.label} credential; check the values and that it has read-only access.`, detail: String(err.message).slice(0, 300) });
      }
      try {
        const connection = {
          id: randomUUID(), ownerUserId: req.userId, vendor: vendorId, label,
          accountLabel: "", status: "active", encryptedSecret: encryptSecret(JSON.stringify(credential)),
          connectedAt: nowIso(), connectedBy: req.userId, lastSyncAt: null, lastSyncOkAt: null, lastError: null,
          consecutiveFailures: 0, nextPollAt: null, revokedAt: null,
        };
        connection.accountLabel = String(vendor.accountLabel?.(credential) || "").slice(0, 200);
        conns().push(connection);
        await db.write();
        // First poll right away so the client sees data (the poller keeps it fresh).
        const result = await syncConnection(db, connection, { callClaudeText, extractJson });
        res.json({ ok: true, id: connection.id, vendor: vendorId, firstSync: result });
      } catch (err) {
        // encryptSecret throws if CREDENTIAL_ENCRYPTION_KEY is missing/malformed.
        console.error("Security vendor connect error:", err.message);
        res.status(500).json({ error: "Could not complete this connection. Try again, or contact support if this keeps happening." });
      }
    });

  app.post("/api/security-vendors/:id/sync", requireAuth, async (req, res) => {
    const c = find(req);
    if (!c) return res.status(404).json({ error: "Security vendor connection not found." });
    if (c.status === "revoked") return res.status(403).json({ error: "This connection has been revoked." });
    const result = await syncConnection(db, c, { callClaudeText, extractJson });
    if (!result.ok) return res.status(502).json({ error: `Could not sync ${SECURITY_VENDORS[c.vendor]?.label || "this vendor"}; check that the credential is still valid.`, detail: result.error });
    res.json(result);
  });

  app.post("/api/security-vendors/:id/revoke", requireAuth, async (req, res) => {
    const c = find(req);
    if (!c) return res.status(404).json({ error: "Security vendor connection not found." });
    // Stops OUR use of the stored copy; the client rotates/deletes the API
    // client in the vendor console itself.
    c.status = "revoked"; c.revokedAt = nowIso(); c.encryptedSecret = null;
    await db.write();
    res.json({ ok: true, id: c.id, status: c.status });
  });

  app.delete("/api/security-vendors/:id", requireAuth, async (req, res) => {
    const c = find(req);
    if (!c) return res.status(404).json({ error: "Security vendor connection not found." });
    const d = cols(db);
    d.securityVendorConnections = d.securityVendorConnections.filter(x => x.id !== c.id);
    // Its mirrored endpoint vulnerabilities go with it (no orphaned "open" items nobody can resolve).
    d.agentVulnerabilities = d.agentVulnerabilities.filter(v => !(v.source === "vendor" && String(v.dedupeKey).startsWith(`vendor:${c.id}:`)));
    d.vendorDetections = d.vendorDetections.filter(x => x.connectionId !== c.id);
    await db.write();
    res.json({ ok: true, id: c.id });
  });

  if (poll) startSecurityVendorPoller(db, { gate, callClaudeText, extractJson });
  console.log("ShieldAI vCISO security-vendor integration routes registered.");
}
