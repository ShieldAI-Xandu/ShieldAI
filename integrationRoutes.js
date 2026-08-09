// integrationRoutes.js
// ShieldAI security-tool integration backend: connection management and
// webhook ingestion for third-party scanners/EDR/SIEM findings.
//
// BOUNDARY (enforced here): this layer only RECEIVES findings from an
// external tool and lets a human triage (acknowledge) them. There is no
// route that calls out to the third-party tool, and the webhook response
// carries nothing but a receipt count — no directive, no command. This is
// an even stricter one-way boundary than the monitoring agent (which at
// least reads back a poll-interval hint): a webhook integration gets
// nothing back but an ack.
//
// Findings are stored and surfaced as reported — severity/category/etc. are
// never inferred or upgraded. This mirrors the "real data over fabrication"
// rule applied elsewhere (cveService.js, darkwebService.js): if the source
// tool didn't say, we say "info"/unknown, we don't guess.
//
// Mount from server.js:
//   import { registerIntegrationRoutes } from "./integrationRoutes.js";
//   registerIntegrationRoutes(app, { db, requireAuth, gate, callClaudeText, extractJson });
//
// callClaudeText/extractJson are optional, same contract as agentRoutes.js:
// when provided, high/critical findings get auto-drafted into the analyst's
// recommendation queue (Mastermind AI writes the language; a human reviews,
// optionally enriches, and forwards — nothing reaches the client until an
// analyst does that). Without them, findings still land in the queue with
// deterministic wording built straight from the finding.

import { randomUUID, randomBytes, createHash } from "crypto";
import { counters } from "./tierGate.js";

const nowIso = () => new Date().toISOString();
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

const MAX_FINDINGS_PER_INTEGRATION = 2000; // DB hygiene cap, mirrors agentReports' per-agent cap

// ── Mastermind auto-draft: turn high/critical findings into draft
// recommendations. Mirrors agentRoutes.js's buildDraftsFromReport/
// aiEnrichDrafts exactly — drafts land in the analyst queue ("suggested"),
// never directly on a client's dashboard. The AI only drafts language for a
// human to review; it never performs or approves anything. ──
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

function recDedupeKey(integrationId, findingDedupeKey) {
  return `integration::${integrationId}::${findingDedupeKey}`;
}

// Build draft recommendations from this batch's actionable findings.
// `records` are the stored/updated integrationFindings rows for this call.
function buildDraftsFromFindings({ records, integration }) {
  const drafts = [];
  for (const f of records) {
    if ((SEV_RANK[f.severity] ?? 0) < SEV_RANK.medium) continue; // only worth a human's attention
    drafts.push({
      dedupeKey: recDedupeKey(integration.id, f.dedupeKey),
      findingId: f.id,
      title: f.title,
      detail: [
        `${integration.name} (${integration.provider}) reported "${f.title}"${f.host ? ` on ${f.host}` : ""}.`,
        f.message ? `Finding: ${f.message}` : "",
        f.cve ? `(${f.cve}.)` : "",
      ].filter(Boolean).join(" "),
      severity: f.severity,
    });
  }
  return drafts;
}

// Same contract as agentRoutes.js's aiEnrichDrafts: returns a map of
// dedupeKey → { title, detail, severity, priority, rationale }, or null on
// any failure (caller falls back to the deterministic text).
async function aiEnrichFindingDrafts({ drafts, integration, owner, callClaudeText, extractJson }) {
  if (!callClaudeText || !extractJson || drafts.length === 0) return null;

  const findings = drafts.map(d => ({ key: d.dedupeKey, title: d.title, severity: d.severity, detail: d.detail }));
  const system = `You are ShieldAI Mastermind, a senior virtual CISO. You turn raw findings from a third-party security tool (scanner/EDR/SIEM) into clear, prioritized remediation recommendations for a small/medium business.

You ONLY produce written recommendations for a human (the client's admin or their analyst) to act on. You never perform actions yourself. Be specific, practical, and concise; assume a non-expert reader.

Return ONLY valid minified JSON, no markdown fences, exactly:
{"recommendations":[{"key":"<echo the finding key>","title":"<short imperative title>","detail":"<2-4 sentences: what's wrong, why it matters for this business, and the concrete steps a human should take>","severity":"low|medium|high|critical","priority":1-5,"rationale":"<one sentence on urgency>"}]}
Keep one entry per finding key provided. Do not invent findings.`;
  const user = `Source: ${integration.name} (${integration.provider}).\nCompany: ${owner?.companyName || "the client"}.\n\nFindings to turn into recommendations:\n${JSON.stringify(findings)}\n\nReturn the JSON now.`;

  try {
    const text = await callClaudeText({ system, messages: [{ role: "user", content: user }], max_tokens: 1800 });
    const parsed = extractJson(text);
    const out = {};
    for (const r of (parsed?.recommendations || [])) {
      if (!r.key) continue;
      out[r.key] = {
        title: String(r.title || "").slice(0, 300),
        detail: String(r.detail || "").slice(0, 4000),
        severity: ["low","medium","high","critical"].includes(r.severity) ? r.severity : undefined,
        priority: Number.isFinite(r.priority) ? r.priority : undefined,
        rationale: String(r.rationale || "").slice(0, 500),
      };
    }
    return Object.keys(out).length ? out : null;
  } catch (err) {
    console.warn("Mastermind AI finding-draft enrichment failed; using deterministic text:", err.message);
    return null;
  }
}

function ensureCollections(db) {
  db.data.integrations        ||= []; // { id, ownerUserId, name, provider, tokenHash, status, createdAt, createdBy, revokedAt, lastEventAt, eventCount }
  db.data.integrationFindings ||= []; // { id, integrationId, ownerUserId, dedupeKey, externalId, tool, severity, category, title, message, host, cve, raw, ack, occurrences, firstSeenAt, lastSeenAt }
}

// Public view of an integration connection (never leaks the token hash).
function publicIntegration(i, findings) {
  const mine = findings.filter(f => f.integrationId === i.id);
  const open = mine.filter(f => !f.ack);
  const severityCounts = {};
  for (const f of open) severityCounts[f.severity] = (severityCounts[f.severity] || 0) + 1;
  return {
    id: i.id, name: i.name, provider: i.provider, status: i.status,
    createdAt: i.createdAt, revokedAt: i.revokedAt || null,
    lastEventAt: i.lastEventAt || null, eventCount: i.eventCount || 0,
    findingCount: mine.length, openFindingCount: open.length, severityCounts,
  };
}

function dedupeKeyFor(integrationId, f) {
  const basis = f.externalId ? String(f.externalId) : `${f.title || ""}::${f.host || ""}`;
  return sha256(`${integrationId}::${basis}`);
}

export function registerIntegrationRoutes(app, { db, requireAuth, gate, callClaudeText, extractJson }) {
  ensureCollections(db);

  // ── middleware: authenticate an INTEGRATION by its bearer token ──
  function requireIntegration(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Integration token required." });
    const integration = (db.data.integrations || []).find(i => i.tokenHash === sha256(token));
    if (!integration) return res.status(401).json({ error: "Invalid integration token." });
    if (integration.status === "revoked") return res.status(403).json({ error: "Integration has been revoked." });
    if (integration.id !== req.params.id) return res.status(403).json({ error: "Token does not match this integration." });
    req.integration = integration;
    next();
  }

  // ════════════════════════════════════════════════════════════
  //  CLIENT ROUTES (their own connections only)
  // ════════════════════════════════════════════════════════════

  // Create a new connection. Token is issued immediately (unlike the agent's
  // two-phase enroll) since a human copies it straight into the third-party
  // tool's own config screen — there's no unattended-machine handoff to
  // protect against here.
  app.post("/api/integrations", requireAuth,
    gate.capability("integrations"),
    gate.limit("integrations", counters.integrations),
    async (req, res) => {
      try {
        const name = String(req.body?.name || "").slice(0, 200).trim();
        const provider = String(req.body?.provider || "custom").slice(0, 64).trim();
        if (!name) return res.status(400).json({ error: "A connection name is required." });

        const token = newToken();
        const integration = {
          id: randomUUID(),
          ownerUserId: req.userId,
          name, provider,
          tokenHash: sha256(token),
          status: "active",
          createdAt: nowIso(),
          createdBy: req.userId,
          revokedAt: null,
          lastEventAt: null,
          eventCount: 0,
        };
        db.data.integrations.push(integration);
        await db.write();

        // The plaintext token is returned exactly once; only its hash is stored.
        res.json({
          id: integration.id,
          webhookPath: `/api/integrations/webhook/${integration.id}`,
          token,
        });
      } catch (err) {
        console.error("Integration create error:", err.message);
        res.status(500).json({ error: "Could not create the integration." });
      }
    });

  // List my connections, with a severity summary of open findings each.
  app.get("/api/integrations", requireAuth, (req, res) => {
    const mine = (db.data.integrations || []).filter(i => i.ownerUserId === req.userId);
    const findings = (db.data.integrationFindings || []).filter(f => f.ownerUserId === req.userId);
    res.json(mine.map(i => publicIntegration(i, findings)));
  });

  // Full detail for one of my connections: metadata + recent findings.
  app.get("/api/integrations/:id", requireAuth, (req, res) => {
    const integration = (db.data.integrations || []).find(i => i.id === req.params.id && i.ownerUserId === req.userId);
    if (!integration) return res.status(404).json({ error: "Integration not found." });
    const allFindings = (db.data.integrationFindings || []);
    const findings = allFindings
      .filter(f => f.integrationId === integration.id)
      .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
      .slice(0, 100);
    res.json({ integration: publicIntegration(integration, allFindings), findings });
  });

  // Revoke: blocks any further webhook posts (their next call returns 403).
  app.post("/api/integrations/:id/revoke", requireAuth, async (req, res) => {
    const integration = (db.data.integrations || []).find(i => i.id === req.params.id && i.ownerUserId === req.userId);
    if (!integration) return res.status(404).json({ error: "Integration not found." });
    integration.status = "revoked";
    integration.revokedAt = nowIso();
    await db.write();
    res.json({ ok: true, id: integration.id, status: integration.status });
  });

  // Permanently remove a connection and its finding history.
  app.delete("/api/integrations/:id", requireAuth, async (req, res) => {
    const integration = (db.data.integrations || []).find(i => i.id === req.params.id && i.ownerUserId === req.userId);
    if (!integration) return res.status(404).json({ error: "Integration not found." });
    db.data.integrations = (db.data.integrations || []).filter(i => i.id !== integration.id);
    db.data.integrationFindings = (db.data.integrationFindings || []).filter(f => f.integrationId !== integration.id);
    await db.write();
    res.json({ ok: true, id: integration.id });
  });

  // Toggle a finding's acknowledged state. Triage only — acknowledging a
  // finding here never changes anything on the source tool.
  app.post("/api/integrations/:id/findings/:findingId/ack", requireAuth, async (req, res) => {
    const integration = (db.data.integrations || []).find(i => i.id === req.params.id && i.ownerUserId === req.userId);
    if (!integration) return res.status(404).json({ error: "Integration not found." });
    const finding = (db.data.integrationFindings || []).find(f => f.id === req.params.findingId && f.integrationId === integration.id);
    if (!finding) return res.status(404).json({ error: "Finding not found." });
    finding.ack = req.body?.ack !== undefined ? !!req.body.ack : !finding.ack;
    await db.write();
    res.json({ ok: true, id: finding.id, ack: finding.ack });
  });

  // ════════════════════════════════════════════════════════════
  //  TOOL-FACING ROUTE (no human session; integration token only)
  // ════════════════════════════════════════════════════════════

  // Ingest a batch of findings (read-only data from the external tool).
  app.post("/api/integrations/webhook/:id", requireIntegration, async (req, res) => {
    try {
      const body = req.body || {};
      if (!Array.isArray(body.findings)) {
        return res.status(400).json({ error: "Malformed payload (expected findings[])." });
      }

      const integration = req.integration;
      const batch = body.findings.slice(0, 500);
      const existing = db.data.integrationFindings || (db.data.integrationFindings = []);
      let stored = 0, duplicates = 0;
      const batchRecords = []; // the stored/updated row for every finding in this call, for drafting below

      for (const raw of batch) {
        const f = raw && typeof raw === "object" ? raw : {};
        const dedupeKey = dedupeKeyFor(integration.id, f);
        const match = existing.find(e => e.integrationId === integration.id && e.dedupeKey === dedupeKey);
        if (match) {
          match.lastSeenAt = nowIso();
          match.occurrences = (match.occurrences || 1) + 1;
          duplicates++;
          batchRecords.push(match);
          continue;
        }
        const record = {
          id: randomUUID(),
          integrationId: integration.id,
          ownerUserId: integration.ownerUserId,
          dedupeKey,
          externalId: f.externalId != null ? String(f.externalId).slice(0, 200) : null,
          tool: integration.provider,
          severity: String(f.severity || "info").slice(0, 16),
          category: String(f.category || "").slice(0, 64),
          title: String(f.title || "Untitled finding").slice(0, 300),
          message: String(f.message || f.description || "").slice(0, 2000),
          host: f.host ? String(f.host).slice(0, 200) : null,
          cve: f.cve ? String(f.cve).slice(0, 32) : null,
          raw: f.raw ?? null,
          ack: false,
          occurrences: 1,
          firstSeenAt: nowIso(),
          lastSeenAt: nowIso(),
        };
        existing.push(record);
        batchRecords.push(record);
        stored++;
      }

      // Mastermind auto-draft: turn actionable findings (medium+) into draft
      // recommendations sitting in the analyst queue ("suggested"). Deduped
      // so the same finding isn't re-drafted every webhook call. Drafts
      // only — a human reviews & forwards before a client ever sees one.
      db.data.recommendations ||= [];
      const candidateDrafts = buildDraftsFromFindings({ records: batchRecords, integration });
      const newDrafts = candidateDrafts.filter(d => !db.data.recommendations.some(r =>
        r.dedupeKey === d.dedupeKey && !["completed", "declined"].includes(r.status)
      ));
      let enriched = null;
      if (newDrafts.length > 0) {
        const owner = (db.data.users || []).find(u => u.id === integration.ownerUserId);
        enriched = await aiEnrichFindingDrafts({ drafts: newDrafts, integration, owner, callClaudeText, extractJson });
      }
      for (const d of newDrafts) {
        const ai = enriched?.[d.dedupeKey];
        db.data.recommendations.push({
          id: randomUUID(),
          ownerUserId: integration.ownerUserId,
          integrationId: integration.id,
          findingId: d.findingId,
          dedupeKey: d.dedupeKey,
          origin: "ai",           // drafted by the Mastermind AI layer
          aiAuthored: !!ai,       // true if AI wrote the language, false if deterministic fallback
          title: ai?.title || d.title,
          detail: ai?.detail || d.detail,
          severity: ai?.severity || d.severity,
          priority: ai?.priority ?? null,
          rationale: ai?.rationale || "",
          status: "suggested",    // sits in analyst queue; not yet shown to client
          createdAt: nowIso(),
          history: [{ at: nowIso(), actorType: "ai", actorId: null, status: "suggested",
            note: ai ? "Auto-drafted by Mastermind AI from an integration finding." : "Auto-drafted (rule-based) from an integration finding." }],
        });
      }

      // Cap stored findings per integration to keep the JSON db lean (keep
      // the most recently seen MAX_FINDINGS_PER_INTEGRATION).
      const mine = db.data.integrationFindings.filter(f => f.integrationId === integration.id);
      if (mine.length > MAX_FINDINGS_PER_INTEGRATION) {
        const excess = mine.sort((a, b) => new Date(a.lastSeenAt) - new Date(b.lastSeenAt))
                           .slice(0, mine.length - MAX_FINDINGS_PER_INTEGRATION)
                           .map(f => f.id);
        const drop = new Set(excess);
        db.data.integrationFindings = db.data.integrationFindings.filter(f => !drop.has(f.id));
      }

      integration.lastEventAt = nowIso();
      integration.eventCount = (integration.eventCount || 0) + batch.length;
      await db.write();

      // Nothing else is returned — no directive, no command. Just a receipt.
      res.json({ ok: true, received: batch.length, stored, duplicates, draftsCreated: newDrafts.length });
    } catch (err) {
      console.error("Integration webhook error:", err.message);
      res.status(500).json({ error: "Could not store findings." });
    }
  });

  console.log("ShieldAI integration routes registered.");
}
