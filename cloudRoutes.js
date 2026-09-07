// cloudRoutes.js
// Cloud-infrastructure security-posture integrations: AWS and Azure, both
// via a pasted, read-only credential (see cloudAdapters.js's header for why
// neither gets an OAuth flow like directoryRoutes.js's M365/Google).
// Pulls IAM/storage/network/audit-logging facts on demand ("Sync now" — no
// scheduled polling in this pass) and turns them into draft recommendations,
// exactly like directoryRoutes.js and integrationRoutes.js do for their own
// sources.
//
// BOUNDARY: AWS's credential is scoped to AWS's own managed `SecurityAudit`
// policy; Azure's service principal is scoped to the built-in `Reader`
// role. Both are read-only by the cloud provider's own design — this file
// never calls a write/management API on either provider. Same underlying
// rule directoryRoutes.js documents: ShieldAI can observe a client's cloud
// environment, never change it.
//
// riskEngine.js note: none of this feeds the posture SCORE, same as
// directoryRoutes.js's facts — it's a closed, 13-factor system by design.
// Cloud facts land as draft recommendations in the same analyst queue every
// other ingestion source feeds — a corroborating fact source, not a
// parallel score.
//
// Mount from server.js:
//   import { registerCloudRoutes } from "./cloudRoutes.js";
//   registerCloudRoutes(app, { db, requireAuth, gate, callClaudeText, extractJson });
// Same signature shape as directoryRoutes.js/integrationRoutes.js.

import { randomUUID, createHash } from "crypto";
import { counters } from "./tierGate.js";
import { encryptSecret, decryptSecret } from "./credentialCrypto.js";
import { CLOUD_PROVIDERS } from "./cloudAdapters.js";

const nowIso = () => new Date().toISOString();
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const PROVIDER_LABELS = { aws: "AWS", azure: "Azure" };

function ensureCollections(db) {
  db.data.cloudConnections ||= [];
}

// Public view of a connection — never leaks the encrypted secret.
function publicConnection(c) {
  return {
    id: c.id, provider: c.provider, kind: c.kind, label: c.label,
    accountLabel: c.accountLabel, status: c.status,
    connectedAt: c.connectedAt, lastSyncAt: c.lastSyncAt || null,
    lastSyncSummary: c.lastSyncSummary || null,
    revokedAt: c.revokedAt || null,
  };
}

function dedupeKeyFor(connectionId, f) {
  return sha256(`${connectionId}::${f.externalId || f.title}`);
}
function recDedupeKey(connectionId, findingDedupeKey) {
  return `cloud::${connectionId}::${findingDedupeKey}`;
}

// Own copy of the build-drafts/AI-enrich pattern (mirrors
// directoryRoutes.js's and integrationRoutes.js's — this codebase's
// established convention is each ingestion source carries its own copy
// rather than sharing one).
function buildDraftsFromPosture({ findings, connection }) {
  const drafts = [];
  for (const f of findings) {
    if ((SEV_RANK[f.severity] ?? 0) < SEV_RANK.medium) continue;
    const dedupeKey = dedupeKeyFor(connection.id, f);
    drafts.push({
      dedupeKey: recDedupeKey(connection.id, dedupeKey),
      title: f.title,
      detail: [
        `${PROVIDER_LABELS[connection.provider] || connection.provider} (${connection.label}) reported: "${f.title}".`,
        f.message ? f.message : "",
      ].filter(Boolean).join(" "),
      severity: f.severity,
    });
  }
  return drafts;
}

async function aiEnrichPostureDrafts({ drafts, connection, owner, callClaudeText, extractJson }) {
  if (!callClaudeText || !extractJson || drafts.length === 0) return null;

  const items = drafts.map(d => ({ key: d.dedupeKey, title: d.title, severity: d.severity, detail: d.detail }));
  const system = `You are ShieldAI Mastermind, a senior virtual CISO. You turn raw cloud-infrastructure security-posture facts (from AWS or Azure) into clear, prioritized remediation recommendations for a small/medium business.

You ONLY produce written recommendations for a human (the client's admin or their analyst) to act on. You never perform actions yourself. Be specific, practical, and concise; assume a non-expert reader.

Return ONLY valid minified JSON, no markdown fences, exactly:
{"recommendations":[{"key":"<echo the finding key>","title":"<short imperative title>","detail":"<2-4 sentences: what's wrong, why it matters for this business, and the concrete steps a human should take>","severity":"low|medium|high|critical","priority":1-5,"rationale":"<one sentence on urgency>"}]}
Keep one entry per finding key provided. Do not invent findings.`;
  const user = `Source: ${PROVIDER_LABELS[connection.provider] || connection.provider} (${connection.label}).\nCompany: ${owner?.companyName || "the client"}.\n\nFindings to turn into recommendations:\n${JSON.stringify(items)}\n\nReturn the JSON now.`;

  try {
    const text = await callClaudeText({ system, messages: [{ role: "user", content: user }], max_tokens: 1800 });
    const parsed = extractJson(text);
    const out = {};
    for (const r of (parsed?.recommendations || [])) {
      if (!r.key) continue;
      out[r.key] = {
        title: String(r.title || "").slice(0, 300),
        detail: String(r.detail || "").slice(0, 4000),
        severity: ["low", "medium", "high", "critical"].includes(r.severity) ? r.severity : undefined,
        priority: Number.isFinite(r.priority) ? r.priority : undefined,
        rationale: String(r.rationale || "").slice(0, 500),
      };
    }
    return Object.keys(out).length ? out : null;
  } catch (err) {
    console.warn("Mastermind AI cloud-draft enrichment failed; using deterministic text:", err.message);
    return null;
  }
}

// Extracts exactly the credential fields cloudAdapters.js's fetchPosture()
// expects for a given provider, from the raw request body.
function credentialFromBody(provider, body) {
  if (provider === "aws") {
    return {
      accessKeyId: String(body?.accessKeyId || "").trim(),
      secretAccessKey: String(body?.secretAccessKey || "").trim(),
      region: String(body?.region || "").trim() || undefined,
    };
  }
  if (provider === "azure") {
    return {
      tenantId: String(body?.tenantId || "").trim(),
      clientId: String(body?.clientId || "").trim(),
      clientSecret: String(body?.clientSecret || "").trim(),
      subscriptionId: String(body?.subscriptionId || "").trim(),
    };
  }
  return null;
}

function missingCredentialFields(provider, cred) {
  if (provider === "aws") return !cred.accessKeyId || !cred.secretAccessKey;
  if (provider === "azure") return !cred.tenantId || !cred.clientId || !cred.clientSecret || !cred.subscriptionId;
  return true;
}

// A short, human-readable account label shown in the UI without exposing
// the credential itself — e.g. "us-east-1" for AWS, the subscription id for
// Azure. Best-effort; never throws.
function accountLabelFor(provider, cred) {
  if (provider === "aws") return cred.region || "us-east-1";
  if (provider === "azure") return cred.subscriptionId;
  return "";
}

export function registerCloudRoutes(app, { db, requireAuth, gate, callClaudeText, extractJson }) {
  ensureCollections(db);

  // ════════════════════════════════════════════════════════════
  //  CLIENT ROUTES (their own connections only)
  // ════════════════════════════════════════════════════════════

  app.get("/api/cloud", requireAuth, (req, res) => {
    const mine = (db.data.cloudConnections || []).filter(c => c.ownerUserId === req.userId);
    res.json(mine.map(publicConnection));
  });

  app.get("/api/cloud/:id", requireAuth, (req, res) => {
    const c = (db.data.cloudConnections || []).find(x => x.id === req.params.id && x.ownerUserId === req.userId);
    if (!c) return res.status(404).json({ error: "Cloud connection not found." });
    res.json(publicConnection(c));
  });

  // ── Connect: pasted read-only credential, validated before storing ──
  app.post("/api/cloud/connect/:provider", requireAuth,
    gate.capability("integrations"),
    gate.limit("integrations", counters.integrations),
    async (req, res) => {
      const provider = req.params.provider;
      const adapter = CLOUD_PROVIDERS[provider];
      if (!adapter) return res.status(400).json({ error: "Unknown cloud provider." });

      const label = String(req.body?.label || PROVIDER_LABELS[provider]).slice(0, 200).trim();
      const credential = credentialFromBody(provider, req.body);
      if (!credential || missingCredentialFields(provider, credential)) {
        return res.status(400).json({ error: `Missing required ${PROVIDER_LABELS[provider]} credential fields.` });
      }

      // Validate with one live read call before ever storing anything —
      // same discipline directoryRoutes.js's Okta connect uses.
      try {
        await adapter.fetchPosture(credential);
      } catch (err) {
        return res.status(400).json({ error: `Could not validate this ${PROVIDER_LABELS[provider]} credential — check the values and that it has read access.`, detail: err.message });
      }

      try {
        const connection = {
          id: randomUUID(),
          ownerUserId: req.userId,
          provider,
          kind: "token",
          label,
          accountLabel: accountLabelFor(provider, credential),
          status: "active",
          encryptedSecret: encryptSecret(JSON.stringify(credential)),
          connectedAt: nowIso(),
          connectedBy: req.userId,
          lastSyncAt: null,
          lastSyncSummary: null,
          revokedAt: null,
        };
        db.data.cloudConnections.push(connection);
        await db.write();
        res.json({ ok: true, id: connection.id, provider: connection.provider });
      } catch (err) {
        // encryptSecret() throws synchronously if CREDENTIAL_ENCRYPTION_KEY
        // is missing/malformed — same catch directoryRoutes.js's OAuth
        // finish route uses, so one client's connect attempt with the key
        // unset can't become an unhandled rejection that crashes the app.
        console.error("Cloud connect error:", err.message);
        res.status(500).json({ error: "Could not complete this connection. Try again, or contact support if this keeps happening." });
      }
    });

  // ── Sync: pull posture facts on demand, draft recommendations ──
  app.post("/api/cloud/:id/sync", requireAuth, async (req, res) => {
    const connection = (db.data.cloudConnections || []).find(c => c.id === req.params.id && c.ownerUserId === req.userId);
    if (!connection) return res.status(404).json({ error: "Cloud connection not found." });
    if (connection.status === "revoked") return res.status(403).json({ error: "This connection has been revoked." });

    const adapter = CLOUD_PROVIDERS[connection.provider];
    if (!adapter) return res.status(400).json({ error: "Unknown provider for this connection." });

    try {
      const credential = JSON.parse(decryptSecret(connection.encryptedSecret));
      const facts = await adapter.fetchPosture(credential);
      const findings = adapter.mapPostureToFindings(facts);

      const severityCounts = {};
      for (const f of findings) severityCounts[f.severity] = (severityCounts[f.severity] || 0) + 1;

      db.data.recommendations ||= [];
      const candidateDrafts = buildDraftsFromPosture({ findings, connection });
      const newDrafts = candidateDrafts.filter(d => !db.data.recommendations.some(r =>
        r.dedupeKey === d.dedupeKey && !["completed", "declined"].includes(r.status)
      ));
      let enriched = null;
      if (newDrafts.length > 0) {
        const owner = (db.data.users || []).find(u => u.id === connection.ownerUserId);
        enriched = await aiEnrichPostureDrafts({ drafts: newDrafts, connection, owner, callClaudeText, extractJson });
      }
      for (const d of newDrafts) {
        const ai = enriched?.[d.dedupeKey];
        db.data.recommendations.push({
          id: randomUUID(),
          ownerUserId: connection.ownerUserId,
          cloudConnectionId: connection.id,
          dedupeKey: d.dedupeKey,
          origin: "ai",
          aiAuthored: !!ai,
          title: ai?.title || d.title,
          detail: ai?.detail || d.detail,
          severity: ai?.severity || d.severity,
          priority: ai?.priority ?? null,
          rationale: ai?.rationale || "",
          status: "suggested",
          createdAt: nowIso(),
          history: [{ at: nowIso(), actorType: "ai", actorId: null, status: "suggested",
            note: ai ? "Auto-drafted by Mastermind AI from a cloud sync." : "Auto-drafted (rule-based) from a cloud sync." }],
        });
      }

      connection.status = "active";
      connection.lastSyncAt = nowIso();
      connection.lastSyncSummary = { syncedAt: nowIso(), findingCount: findings.length, severityCounts, findings };
      await db.write();

      res.json({ ok: true, findingCount: findings.length, severityCounts, draftsCreated: newDrafts.length });
    } catch (err) {
      connection.status = "error";
      await db.write();
      console.error("Cloud sync error:", err.message);
      res.status(500).json({ error: `Could not sync this ${PROVIDER_LABELS[connection.provider] || "cloud"} connection — check that the credential is still valid.`, detail: err.message });
    }
  });

  app.post("/api/cloud/:id/revoke", requireAuth, async (req, res) => {
    const connection = (db.data.cloudConnections || []).find(c => c.id === req.params.id && c.ownerUserId === req.userId);
    if (!connection) return res.status(404).json({ error: "Cloud connection not found." });
    // Neither provider offers a client-callable revoke for a bare
    // access-key/service-principal credential — the org admin rotates or
    // deletes the key/secret directly in AWS/Azure. This just stops
    // ShieldAI from using the stored copy.
    connection.status = "revoked";
    connection.revokedAt = nowIso();
    await db.write();
    res.json({ ok: true, id: connection.id, status: connection.status });
  });

  app.delete("/api/cloud/:id", requireAuth, async (req, res) => {
    const connection = (db.data.cloudConnections || []).find(c => c.id === req.params.id && c.ownerUserId === req.userId);
    if (!connection) return res.status(404).json({ error: "Cloud connection not found." });
    db.data.cloudConnections = (db.data.cloudConnections || []).filter(c => c.id !== connection.id);
    await db.write();
    res.json({ ok: true, id: connection.id });
  });

  console.log("ShieldAI cloud integration routes registered.");
}
