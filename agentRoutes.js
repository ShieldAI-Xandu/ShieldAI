// agentRoutes.js
// ShieldAI monitoring-agent backend: enrollment, report ingestion, fleet views,
// and the recommendation lifecycle.
//
// BOUNDARY (enforced here): the agent and the AI never perform actions. These
// routes only (a) receive read-only posture data from agents and (b) record a
// human-driven recommendation lifecycle. There is NO route that sends a command
// to an endpoint, because no such capability exists by design.
//
// Mount from server.js:
//   import { registerAgentRoutes } from "./agentRoutes.js";
//   registerAgentRoutes(app, { db, requireAuth, requireAdmin, callClaudeText });
//
// callClaudeText is optional: when provided, analysts can AI-enrich an
// auto-drafted recommendation into client-friendly language. Without it, the
// deterministic drafts (built directly from the failing checks) are still used.

import { randomUUID, randomBytes, createHash } from "crypto";
import { getTier, hasCapability, DEFAULT_TIER } from "./tiers.js";

// ── small helpers ─────────────────────────────────────────────
const nowIso = () => new Date().toISOString();
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url"); // URL-safe, ~43 chars

// The latest agent version ShieldAI ships. Surfaced to agents (so they can note
// staleness) and used by the human-gated upgrade flow. Bump when you release a
// new collector/runner.
const AGENT_LATEST_VERSION = "1.0.0";

// Ensure all agent collections exist on the lowdb instance.
function ensureCollections(db) {
  db.data.agents          ||= []; // { id, ownerUserId, hostname, os, tokenHash, status, createdAt, lastSeen, revokedAt }
  db.data.enrollTokens    ||= []; // { tokenHash, ownerUserId, createdAt, expiresAt, usedAt }
  db.data.agentReports    ||= []; // { id, agentId, ownerUserId, receivedAt, report }
  db.data.agentEvents     ||= []; // { id, agentId, ownerUserId, ts, source, severity, type, message, raw, ack }
  db.data.recommendations ||= []; // { id, ownerUserId, agentId?, origin, title, detail, severity, status, history[] }
}

// Map a posture report's worst finding to an overall host status.
function summarizeReport(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const order = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  let worst = "info", fails = 0, warns = 0;
  for (const c of checks) {
    if (c.status === "fail") fails++;
    if (c.status === "warn") warns++;
    const sev = (c.status === "fail" || c.status === "warn") ? (c.severity || "info") : "info";
    if ((order[sev] ?? 0) > (order[worst] ?? 0)) worst = sev;
  }
  const posture = fails > 0 ? "at_risk" : warns > 0 ? "needs_attention" : "healthy";
  return { posture, worstSeverity: worst, failCount: fails, warnCount: warns, checkCount: checks.length };
}

// Public view of an agent (never leaks the token hash).
function publicAgent(a, latest) {
  return {
    id: a.id, hostname: a.hostname, os: a.os, status: a.status,
    createdAt: a.createdAt, lastSeen: a.lastSeen, revokedAt: a.revokedAt || null,
    summary: latest ? summarizeReport(latest.report) : null,
    lastReportAt: latest ? latest.receivedAt : null,
  };
}

// ── Auto-draft: turn failing/warning checks into draft recommendations ──
// The Mastermind AI layer drafts; it never acts. Drafts are "suggested" only
// and sit in the analyst queue until a human reviews and forwards them.
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

// A stable key so the same finding on the same agent isn't re-drafted every
// report cycle. Tied to agent + check id + status.
function recDedupeKey(agentId, checkId, status) {
  return `${agentId}::${checkId}::${status}`;
}

// Build draft recommendations from a report's actionable checks.
function buildDraftsFromReport({ report, agent }) {
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  const drafts = [];
  for (const c of checks) {
    if (c.status !== "fail" && c.status !== "warn") continue;
    // Only draft for things worth a human's attention.
    if ((SEV_RANK[c.severity] ?? 0) < SEV_RANK.medium) continue;

    const action = remediationHint(c.id);
    drafts.push({
      dedupeKey: recDedupeKey(agent.id, c.id, c.status),
      agentId: agent.id,
      checkId: c.id,
      title: action.title || c.title,
      detail: [
        `On ${report?.host?.hostname || agent.hostname} (${agent.os}), the check "${c.title}" is ${c.status.toUpperCase()}.`,
        c.detail ? `Finding: ${c.detail}` : "",
        c.observed ? `Observed: ${c.observed}.` : "",
        action.detail ? `Suggested action: ${action.detail}` : "",
        c.cisControl ? `(CIS Control ${c.cisControl}.)` : "",
      ].filter(Boolean).join(" "),
      severity: c.severity || "medium",
    });
  }
  return drafts;
}

// ── Mastermind AI enrichment ──────────────────────────────────
// Takes the deterministic drafts + host context and asks the AI to rewrite
// them into prioritized, business-aware recommendations. Returns a map of
// dedupeKey → { title, detail, severity, priority, rationale }. On ANY failure
// it returns null and the caller keeps the deterministic text. The AI only
// drafts language for a human to review — it never performs or approves
// anything.
async function aiEnrichDrafts({ drafts, report, agent, owner, callClaudeText, extractJson }) {
  if (!callClaudeText || !extractJson || drafts.length === 0) return null;

  const findings = drafts.map(d => ({
    key: d.dedupeKey, checkId: d.checkId, title: d.title,
    severity: d.severity, detail: d.detail,
  }));

  const context = {
    hostname: report?.host?.hostname || agent.hostname,
    os: agent.os,
    osVersion: report?.host?.osVersion || "",
    company: owner?.companyName || "the client",
    inventory: report?.inventory || {},
  };

  const system = `You are ShieldAI Mastermind, a senior virtual CISO. You turn raw endpoint security findings into clear, prioritized remediation recommendations for a small/medium business.

You ONLY produce written recommendations for a human (the client's admin or their analyst) to act on. You never perform actions yourself. Be specific, practical, and concise; assume a non-expert reader.

Return ONLY valid minified JSON, no markdown fences, exactly:
{"recommendations":[{"key":"<echo the finding key>","title":"<short imperative title>","detail":"<2-4 sentences: what's wrong, why it matters for this business, and the concrete steps a human should take>","severity":"low|medium|high|critical","priority":1-5,"rationale":"<one sentence on urgency>"}]}
Keep one entry per finding key provided. Do not invent findings.`;

  const user = `Host context:\n${JSON.stringify(context)}\n\nFindings to turn into recommendations:\n${JSON.stringify(findings)}\n\nReturn the JSON now.`;

  try {
    const text = await callClaudeText({
      system,
      messages: [{ role: "user", content: user }],
      max_tokens: 1800,
    });
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
    console.warn("Mastermind AI draft enrichment failed; using deterministic text:", err.message);
    return null;
  }
}
// These are SUGGESTIONS for a human to perform — never executed by software.
function remediationHint(checkId) {
  const map = {
    av_realtime:    { title: "Re-enable antivirus real-time protection", detail: "Turn real-time protection back on in the endpoint's security software." },
    av_signatures:  { title: "Update antivirus definitions", detail: "Run a definition update so the AV has current signatures." },
    av_tamper:      { title: "Enable tamper protection", detail: "Enable tamper protection so the AV can't be silently disabled." },
    av_threats:     { title: "Review recent malware detections", detail: "Review the quarantined detections and confirm remediation; investigate the affected user/host." },
    av_present:     { title: "Install endpoint protection", detail: "Install a reputable endpoint protection product on this host." },
    firewall:       { title: "Enable the host firewall", detail: "Turn the firewall on for all network profiles." },
    disk_encryption:{ title: "Enable disk encryption", detail: "Enable full-disk encryption (BitLocker/FileVault/LUKS) to protect data at rest." },
    patches:        { title: "Apply pending updates", detail: "Install the pending OS/software updates and schedule a reboot if required." },
    local_admins:   { title: "Reduce local administrator accounts", detail: "Remove unnecessary local admin rights, keeping the minimum required." },
    admins:         { title: "Reduce privileged accounts", detail: "Trim sudo/admin group membership to the minimum required." },
    screen_lock:    { title: "Enforce automatic screen lock", detail: "Set screens to auto-lock after a short idle period and require a password." },
    ssh:            { title: "Harden SSH configuration", detail: "Disable direct root login and prefer key-based auth over passwords." },
    gatekeeper:     { title: "Enable Gatekeeper", detail: "Re-enable Gatekeeper so only signed/notarized apps run." },
    sip:            { title: "Enable System Integrity Protection", detail: "Re-enable SIP to protect macOS system files." },
    auto_updates:   { title: "Enable automatic security updates", detail: "Configure automatic installation of security updates." },
  };
  return map[checkId] || {};
}

export function registerAgentRoutes(app, { db, requireAuth, requireAdmin, callClaudeText, extractJson, logClientAction, analystClientIds, analystOwnsClient }) {
  ensureCollections(db);

  // ── middleware: authenticate an AGENT by its bearer token ───
  function requireAgent(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Agent token required." });
    const agent = (db.data.agents || []).find(a => a.tokenHash === sha256(token));
    if (!agent) return res.status(401).json({ error: "Invalid agent token." });
    if (agent.status === "revoked") return res.status(403).json({ error: "Agent has been revoked." });
    req.agent = agent;
    next();
  }

  // ── middleware: require an analyst (or admin) human ─────────
  function requireAnalyst(req, res, next) {
    requireAuth(req, res, () => {
      if (!req.isAnalyst && !req.isAdmin) {
        return res.status(403).json({ error: "Analyst access required." });
      }
      next();
    });
  }

  // Which client ids may this analyst/admin see? Admin = all clients; analyst =
  // only assigned. Returns null to mean "no restriction" (admin).
  function visibleClientIds(req) {
    if (req.isAdmin) return null;                       // admins see everything
    if (analystClientIds) return analystClientIds(db, req.userId);
    return [];                                          // assignments unavailable → see nothing
  }
  function canSeeClient(req, clientId) {
    if (req.isAdmin) return true;
    if (analystOwnsClient) return analystOwnsClient(db, req.userId, clientId);
    return false;
  }

  // ════════════════════════════════════════════════════════════
  //  AGENT-FACING ROUTES (no human session; agent token only)
  // ════════════════════════════════════════════════════════════

  // Enroll: exchange a one-time enrollment token for a durable agent token.
  app.post("/api/agent/enroll", async (req, res) => {
    try {
      const { enrollmentToken, hostname, os } = req.body || {};
      if (!enrollmentToken) return res.status(400).json({ error: "enrollmentToken is required." });

      const rec = (db.data.enrollTokens || []).find(t => t.tokenHash === sha256(enrollmentToken));
      if (!rec) return res.status(401).json({ error: "Invalid enrollment token." });
      if (rec.usedAt) return res.status(409).json({ error: "Enrollment token already used." });
      if (new Date(rec.expiresAt) < new Date()) return res.status(410).json({ error: "Enrollment token expired." });

      // Issue durable agent token (store only its hash).
      const agentToken = newToken();
      const agent = {
        id: randomUUID(),
        ownerUserId: rec.ownerUserId,
        hostname: (hostname || "unknown").slice(0, 200),
        os: (os || "unknown").slice(0, 32),
        tokenHash: sha256(agentToken),
        status: "active",
        createdAt: nowIso(),
        lastSeen: null,
        revokedAt: null,
      };
      db.data.agents.push(agent);
      rec.usedAt = nowIso();
      rec.agentId = agent.id;
      await db.write();

      // The plaintext token is returned exactly once; only its hash is stored.
      res.json({ agentId: agent.id, agentToken });
    } catch (err) {
      console.error("Agent enroll error:", err.message);
      res.status(500).json({ error: "Enrollment failed." });
    }
  });

  // Ingest a posture report (read-only data from the endpoint).
  app.post("/api/agent/report", requireAgent, async (req, res) => {
    try {
      const report = req.body || {};
      if (!report || typeof report !== "object" || !Array.isArray(report.checks)) {
        return res.status(400).json({ error: "Malformed report (expected checks[])." });
      }

      const stored = {
        id: randomUUID(),
        agentId: req.agent.id,
        ownerUserId: req.agent.ownerUserId,
        receivedAt: nowIso(),
        report,
      };
      db.data.agentReports.push(stored);

      // Fan out security events for analyst/admin visibility & action.
      const events = Array.isArray(report.events) ? report.events : [];
      for (const e of events.slice(0, 200)) {
        db.data.agentEvents.push({
          id: randomUUID(),
          agentId: req.agent.id,
          ownerUserId: req.agent.ownerUserId,
          ts: e.ts || nowIso(),
          source: String(e.source || "agent").slice(0, 64),
          severity: String(e.severity || "info").slice(0, 16),
          type: String(e.type || "event").slice(0, 64),
          message: String(e.message || "").slice(0, 1000),
          raw: e.raw ?? null,
          ack: false,
        });
      }

      // Update agent liveness + denormalized host metadata.
      req.agent.lastSeen = nowIso();
      if (report.host?.hostname) req.agent.hostname = String(report.host.hostname).slice(0, 200);
      if (report.host?.os) req.agent.os = String(report.host.os).slice(0, 32);

      // Cap stored reports per agent to keep the JSON db lean (keep last 50).
      const mine = db.data.agentReports.filter(r => r.agentId === req.agent.id);
      if (mine.length > 50) {
        const excess = mine.sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt))
                           .slice(0, mine.length - 50)
                           .map(r => r.id);
        const drop = new Set(excess);
        db.data.agentReports = db.data.agentReports.filter(r => !drop.has(r.id));
      }

      // Mastermind auto-draft: turn actionable findings into draft
      // recommendations (status "suggested"). Deduped so the same finding
      // isn't re-drafted each cycle. Drafts only — a human reviews & forwards.
      const drafts = buildDraftsFromReport({ report, agent: req.agent });

      // Filter to drafts that aren't already open, so we only spend an AI call
      // on genuinely new findings.
      const newDrafts = drafts.filter(d => !(db.data.recommendations || []).some(r =>
        r.dedupeKey === d.dedupeKey && !["completed", "declined"].includes(r.status)
      ));

      // Enrich the new ones with the Mastermind AI (best-effort; falls back to
      // the deterministic wording if the AI is unavailable). The AI only writes
      // recommendation language — it never acts.
      let enriched = null;
      if (newDrafts.length > 0) {
        const owner = (db.data.users || []).find(u => u.id === req.agent.ownerUserId);
        enriched = await aiEnrichDrafts({
          drafts: newDrafts, report, agent: req.agent, owner, callClaudeText, extractJson,
        });
      }

      for (const d of newDrafts) {
        const ai = enriched?.[d.dedupeKey];
        const rec = {
          id: randomUUID(),
          ownerUserId: req.agent.ownerUserId,
          agentId: d.agentId,
          dedupeKey: d.dedupeKey,
          checkId: d.checkId,
          origin: "ai",            // drafted by the Mastermind AI layer
          aiAuthored: !!ai,        // true if AI wrote the language, false if deterministic fallback
          title: ai?.title || d.title,
          detail: ai?.detail || d.detail,
          severity: ai?.severity || d.severity,
          priority: ai?.priority ?? null,
          rationale: ai?.rationale || "",
          status: "suggested",     // sits in analyst queue; not yet shown to client
          createdAt: nowIso(),
          history: [{ at: nowIso(), actorType: "ai", actorId: null, status: "suggested",
            note: ai ? "Auto-drafted by Mastermind AI from agent report." : "Auto-drafted (rule-based) from agent report." }],
        };
        db.data.recommendations.push(rec);
      }

      // Compute any pending directive for this agent, then clear one-shot flags.
      // This is the ONLY thing the server tells the agent — data, never a command
      // to execute. The agent decides what to do with it (re-report / adjust poll).
      const directive = {
        // one-shot: re-send a full report on the next cycle (admin requested)
        checkInRequested: !!req.agent.pendingCheckIn,
        // optional server-suggested poll interval (minutes); null = keep current
        pollIntervalMinutes: req.agent.desiredPollMinutes || null,
        // latest agent version available, so the agent/installer can note staleness
        latestAgentVersion: AGENT_LATEST_VERSION,
      };
      if (req.agent.pendingCheckIn) {
        req.agent.pendingCheckIn = false;
        req.agent.lastCheckInServedAt = nowIso();
      }

      await db.write();
      res.json({ ok: true, summary: summarizeReport(report), draftsCreated: newDrafts.length, directive });
    } catch (err) {
      console.error("Agent report error:", err.message);
      res.status(500).json({ error: "Could not store report." });
    }
  });

  // ════════════════════════════════════════════════════════════
  //  CLIENT ADMIN ROUTES (their own fleet only)
  // ════════════════════════════════════════════════════════════

  // Issue a one-time enrollment token for a new endpoint.
  app.post("/api/admin/endpoints/enroll-token", requireAuth, async (req, res) => {
    try {
      // Tier gate: endpoints capability + endpoint count limit (staff exempt).
      if (!req.isAdmin && !req.isAnalyst) {
        const user = (db.data.users || []).find(u => u.id === req.userId);
        const tier = user?.tier && getTier(user.tier).id === user.tier ? user.tier : DEFAULT_TIER;
        if (!hasCapability(tier, "endpoints")) {
          return res.status(402).json({
            error: "Endpoint monitoring isn't included in your current plan.",
            code: "UPGRADE_REQUIRED", capability: "endpoints", currentTier: tier,
          });
        }
        const limit = getTier(tier).limits?.endpoints;
        if (limit != null) {
          const current = (db.data.agents || []).filter(a => a.ownerUserId === req.userId && a.status !== "revoked").length;
          if (current >= limit) {
            return res.status(402).json({
              error: `You've reached your plan's limit of ${limit} endpoints. Upgrade to add more.`,
              code: "LIMIT_REACHED", resource: "endpoints", currentTier: tier, limit, current,
            });
          }
        }
      }
      const token = newToken();
      const ttlMin = 60; // enrollment window
      db.data.enrollTokens.push({
        tokenHash: sha256(token),
        ownerUserId: req.userId,
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + ttlMin * 60000).toISOString(),
        usedAt: null,
      });
      await db.write();
      // Returned once; used by install.ps1 -EnrollmentToken.
      res.json({ enrollmentToken: token, expiresInMinutes: ttlMin });
    } catch (err) {
      console.error("Enroll-token error:", err.message);
      res.status(500).json({ error: "Could not create enrollment token." });
    }
  });

  // List my endpoints (with latest posture summary).
  app.get("/api/admin/endpoints", requireAuth, (req, res) => {
    const mine = (db.data.agents || []).filter(a => a.ownerUserId === req.userId);
    const out = mine.map(a => {
      const latest = (db.data.agentReports || [])
        .filter(r => r.agentId === a.id)
        .sort((x, y) => new Date(y.receivedAt) - new Date(x.receivedAt))[0];
      return publicAgent(a, latest);
    });
    res.json(out);
  });

  // Full detail for one of my endpoints (latest report + recent events).
  app.get("/api/admin/endpoints/:id", requireAuth, (req, res) => {
    const agent = (db.data.agents || []).find(a => a.id === req.params.id && a.ownerUserId === req.userId);
    if (!agent) return res.status(404).json({ error: "Endpoint not found." });
    const reports = (db.data.agentReports || [])
      .filter(r => r.agentId === agent.id)
      .sort((x, y) => new Date(y.receivedAt) - new Date(x.receivedAt));
    const events = (db.data.agentEvents || [])
      .filter(e => e.agentId === agent.id)
      .sort((x, y) => new Date(y.ts) - new Date(x.ts))
      .slice(0, 100);
    res.json({
      agent: publicAgent(agent, reports[0]),
      latestReport: reports[0]?.report || null,
      history: reports.slice(0, 20).map(r => ({ receivedAt: r.receivedAt, summary: summarizeReport(r.report) })),
      events,
    });
  });

  // Revoke one of my endpoints (its next upload returns 403).
  app.post("/api/admin/endpoints/:id/revoke", requireAuth, async (req, res) => {
    const agent = (db.data.agents || []).find(a => a.id === req.params.id && a.ownerUserId === req.userId);
    if (!agent) return res.status(404).json({ error: "Endpoint not found." });
    agent.status = "revoked";
    agent.revokedAt = nowIso();
    await db.write();
    res.json({ ok: true, id: agent.id, status: agent.status });
  });

  // Request an on-demand check-in: flags the agent to send a fresh full report
  // on its NEXT poll. Outbound-only model — this sets a flag the agent reads
  // when it next contacts the server; it does NOT push to the endpoint.
  // Allowed: the client owner, an admin, or an analyst assigned to the owner.
  app.post("/api/agent-checkin/:id", requireAuth, async (req, res) => {
    const agent = (db.data.agents || []).find(a => a.id === req.params.id);
    if (!agent) return res.status(404).json({ error: "Endpoint not found." });

    const isOwner = agent.ownerUserId === req.userId;
    const isAssignedAnalyst = req.isAnalyst && analystOwnsClient && analystOwnsClient(db, req.userId, agent.ownerUserId);
    if (!isOwner && !req.isAdmin && !isAssignedAnalyst) {
      return res.status(403).json({ error: "Not authorized for this endpoint." });
    }
    if (agent.status === "revoked") return res.status(409).json({ error: "Endpoint is revoked." });

    agent.pendingCheckIn = true;
    agent.checkInRequestedAt = nowIso();
    agent.checkInRequestedBy = req.userId;
    if (logClientAction) logClientAction(db, {
      clientUserId: agent.ownerUserId, actorUserId: req.userId,
      actorRole: req.isAdmin ? "admin" : isAssignedAnalyst ? "analyst" : "client_admin",
      action: "endpoint_checkin_requested", detail: `Check-in requested for ${agent.hostname}.`,
    });
    await db.write();
    res.json({ ok: true, id: agent.id, pendingCheckIn: true,
      note: "The endpoint will send a fresh report on its next poll." });
  });

  // ── Agent upgrade (human-gated, guided re-install) ──────────
  // Outbound-only model: the server NEVER pushes code. These routes surface
  // which agents are outdated and produce the exact command a human runs (or
  // sends to the client) to re-install the latest agent. No autonomous action.

  // List endpoints whose agent version is behind AGENT_LATEST_VERSION.
  // Admin sees all; analyst sees assigned; client sees own.
  app.get("/api/endpoints/upgrades", requireAuth, (req, res) => {
    const allowed = req.isAdmin ? null
      : req.isAnalyst && analystClientIds ? analystClientIds(db, req.userId)
      : [req.userId];
    const rows = (db.data.agents || [])
      .filter(a => a.status !== "revoked")
      .filter(a => allowed === null || allowed.includes(a.ownerUserId))
      .map(a => {
        const latestRep = (db.data.agentReports || [])
          .filter(r => r.agentId === a.id)
          .sort((x, y) => new Date(y.receivedAt) - new Date(x.receivedAt))[0];
        const ver = a.agentVersion || latestRep?.report?.agentVersion || "unknown";
        const owner = (db.data.users || []).find(u => u.id === a.ownerUserId);
        return {
          id: a.id, hostname: a.hostname, os: a.os, agentVersion: ver,
          latestVersion: AGENT_LATEST_VERSION,
          outdated: ver !== AGENT_LATEST_VERSION,
          owner: owner ? { id: owner.id, name: owner.companyName || owner.email } : null,
        };
      })
      .filter(r => r.outdated);
    res.json({ latestVersion: AGENT_LATEST_VERSION, outdated: rows });
  });

  // Guided upgrade instructions for one endpoint — the exact command to run.
  // Requires a fresh one-time enrollment token (re-install re-enrolls), so this
  // also issues one, scoped to the endpoint's owner. Human runs the command.
  app.post("/api/endpoints/:id/upgrade-instructions", requireAuth, async (req, res) => {
    const agent = (db.data.agents || []).find(a => a.id === req.params.id);
    if (!agent) return res.status(404).json({ error: "Endpoint not found." });
    const isOwner = agent.ownerUserId === req.userId;
    const isAssignedAnalyst = req.isAnalyst && analystOwnsClient && analystOwnsClient(db, req.userId, agent.ownerUserId);
    if (!isOwner && !req.isAdmin && !isAssignedAnalyst) {
      return res.status(403).json({ error: "Not authorized for this endpoint." });
    }

    // Issue a fresh one-time enrollment token for the re-install (60 min TTL),
    // bound to the endpoint's OWNER so the re-installed agent re-enrolls cleanly.
    const raw = newToken();
    db.data.enrollTokens ||= [];
    db.data.enrollTokens.push({
      id: randomUUID(),
      tokenHash: sha256(raw),
      ownerUserId: agent.ownerUserId,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      usedAt: null,
      purpose: "upgrade",
    });
    await db.write();

    const serverUrl = req.headers["x-server-url"] || `${req.protocol}://${req.headers.host}`;
    const os = agent.os;
    let command;
    if (os === "windows") {
      command = `powershell -ExecutionPolicy Bypass -File .\\install.ps1 \`\n  -ServerUrl "${serverUrl}" \`\n  -EnrollmentToken "${raw}" \`\n  -IntervalMinutes 60`;
    } else {
      // linux/macos share the installer invocation shape
      command = `sudo ./install.sh \\\n  --server-url "${serverUrl}" \\\n  --enrollment-token "${raw}" \\\n  --interval-minutes 60`;
    }

    if (logClientAction) logClientAction(db, {
      clientUserId: agent.ownerUserId, actorUserId: req.userId,
      actorRole: req.isAdmin ? "admin" : isAssignedAnalyst ? "analyst" : "client_admin",
      action: "agent_upgrade_initiated",
      detail: `Upgrade instructions issued for ${agent.hostname} (${agent.agentVersion || "unknown"} → ${AGENT_LATEST_VERSION}).`,
    });
    await db.write();

    res.json({
      hostname: agent.hostname, os,
      fromVersion: agent.agentVersion || "unknown",
      toVersion: AGENT_LATEST_VERSION,
      enrollmentToken: raw,           // shown once
      expiresInMinutes: 60,
      command,
      steps: [
        "Download the latest ShieldAI agent package for this OS.",
        os === "windows"
          ? "Open PowerShell as Administrator in the agent\\windows folder."
          : "Open a terminal in the agent's OS folder (linux/ or macos/).",
        "Run the command below — it re-installs the latest agent and re-enrolls this endpoint.",
        "The endpoint will report on the latest version within ~1 minute.",
      ],
    });
  });

  // All endpoints across all clients, with owner + posture summary.
  app.get("/api/analyst/endpoints", requireAnalyst, (req, res) => {
    const allowed = visibleClientIds(req); // null = all (admin)
    const out = (db.data.agents || [])
      .filter(a => allowed === null || allowed.includes(a.ownerUserId))
      .map(a => {
        const latest = (db.data.agentReports || [])
          .filter(r => r.agentId === a.id)
          .sort((x, y) => new Date(y.receivedAt) - new Date(x.receivedAt))[0];
        const owner = (db.data.users || []).find(u => u.id === a.ownerUserId);
        return {
          ...publicAgent(a, latest),
          owner: owner ? { id: owner.id, email: owner.email, companyName: owner.companyName } : null,
        };
      });
    res.json(out);
  });

  // ════════════════════════════════════════════════════════════
  //  RECOMMENDATION LIFECYCLE (humans act; software only records)
  //  suggested → proposed → permitted | client_performing | declined → completed
  // ════════════════════════════════════════════════════════════

  const REC_STATUSES = ["suggested", "proposed", "permitted", "client_performing", "declined", "completed"];

  function pushHistory(rec, actorType, actorId, status, note) {
    rec.history = rec.history || [];
    rec.history.push({ at: nowIso(), actorType, actorId: actorId || null, status, note: note || "" });
    rec.status = status;
  }

  // Analyst authors a recommendation for a client (optionally tied to an endpoint).
  // NOTE: this records advice only. It does not and cannot perform anything.
  app.post("/api/analyst/recommendations", requireAnalyst, async (req, res) => {
    try {
      const { ownerUserId, agentId, title, detail, severity, origin } = req.body || {};
      if (!ownerUserId || !title) return res.status(400).json({ error: "ownerUserId and title are required." });
      const owner = (db.data.users || []).find(u => u.id === ownerUserId);
      if (!owner) return res.status(404).json({ error: "Client not found." });
      if (!canSeeClient(req, ownerUserId)) {
        return res.status(403).json({ error: "This client is not assigned to you." });
      }

      const rec = {
        id: randomUUID(),
        ownerUserId,
        agentId: agentId || null,
        origin: origin === "ai" ? "ai" : "analyst", // "ai" = drafted by Mastermind AI, forwarded by analyst
        title: String(title).slice(0, 300),
        detail: String(detail || "").slice(0, 4000),
        severity: String(severity || "medium").slice(0, 16),
        status: "suggested",
        createdAt: nowIso(),
        history: [],
      };
      // Analyst forwarding it to the client moves it to "proposed".
      pushHistory(rec, "analyst", req.userId, "suggested", "Authored.");
      pushHistory(rec, "analyst", req.userId, "proposed", "Proposed to client.");
      db.data.recommendations.push(rec);
      await db.write();
      res.json(rec);
    } catch (err) {
      console.error("Create recommendation error:", err.message);
      res.status(500).json({ error: "Could not create recommendation." });
    }
  });

  // Analyst queue: AI-drafted + analyst-authored recommendations not yet
  // forwarded to clients (status "suggested"), newest first, with context.
  app.get("/api/analyst/recommendations", requireAnalyst, (req, res) => {
    const onlySuggested = req.query.status === "suggested";
    const allowed = visibleClientIds(req); // null = all (admin)
    let recs = (db.data.recommendations || []);
    if (allowed !== null) recs = recs.filter(r => allowed.includes(r.ownerUserId));
    if (onlySuggested) recs = recs.filter(r => r.status === "suggested");
    const out = recs
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(r => {
        const owner = (db.data.users || []).find(u => u.id === r.ownerUserId);
        const agent = (db.data.agents || []).find(a => a.id === r.agentId);
        return {
          ...r,
          owner: owner ? { id: owner.id, email: owner.email, companyName: owner.companyName } : null,
          hostname: agent ? agent.hostname : null,
        };
      });
    res.json(out);
  });

  // Analyst forwards a draft to the client (suggested → proposed). Optionally
  // override title/detail/severity first (e.g. after AI-enrich or hand-editing).
  app.post("/api/analyst/recommendations/:id/forward", requireAnalyst, async (req, res) => {
    const rec = (db.data.recommendations || []).find(r => r.id === req.params.id);
    if (!rec) return res.status(404).json({ error: "Recommendation not found." });
    if (rec.status !== "suggested") {
      return res.status(409).json({ error: "Only a suggested draft can be forwarded." });
    }
    const { title, detail, severity } = req.body || {};
    if (title) rec.title = String(title).slice(0, 300);
    if (detail) rec.detail = String(detail).slice(0, 4000);
    if (severity) rec.severity = String(severity).slice(0, 16);
    pushHistory(rec, "analyst", req.userId, "proposed", "Forwarded to client.");
    await db.write();
    res.json(rec);
  });

  // Analyst-triggered AI enrichment: rewrite a draft's detail into clear,
  // client-friendly language. This only edits TEXT on a draft — it performs no
  // action and changes no system. Requires callClaudeText to be wired in.
  app.post("/api/analyst/recommendations/:id/enrich", requireAnalyst, async (req, res) => {
    const rec = (db.data.recommendations || []).find(r => r.id === req.params.id);
    if (!rec) return res.status(404).json({ error: "Recommendation not found." });
    if (typeof callClaudeText !== "function") {
      return res.status(503).json({ error: "AI enrichment is not configured on this server." });
    }
    try {
      const owner = (db.data.users || []).find(u => u.id === rec.ownerUserId);
      const system = "You are a security analyst assistant helping a managed-security provider. " +
        "Rewrite the given security finding into a concise, client-friendly recommendation a small-business owner can understand. " +
        "Explain the risk in plain language and give clear, numbered steps the client (or their IT) can follow. " +
        "Do NOT invent specifics not present in the finding. Return ONLY the rewritten recommendation text, no preamble.";
      const user = [
        `Client: ${owner?.companyName || "the client"}.`,
        `Finding title: ${rec.title}`,
        `Finding detail: ${rec.detail}`,
        `Severity: ${rec.severity}.`,
      ].join("\n");
      const text = await callClaudeText({
        system,
        messages: [{ role: "user", content: user }],
        max_tokens: 600,
      });
      const enriched = String(text || "").trim();
      if (enriched) {
        rec.detail = enriched.slice(0, 4000);
        rec.aiEnriched = true;
        pushHistory(rec, "ai", null, rec.status, "AI-enriched the recommendation text.");
        await db.write();
      }
      res.json(rec);
    } catch (err) {
      console.error("Enrich error:", err.message);
      res.status(500).json({ error: "AI enrichment failed." });
    }
  });

  // A client sees only recommendations that have been forwarded to them.
  // "suggested" drafts live in the analyst queue and must not leak to clients
  // until an analyst forwards them (status becomes "proposed" or later).
  app.get("/api/admin/recommendations", requireAuth, (req, res) => {
    const mine = (db.data.recommendations || [])
      .filter(r => r.ownerUserId === req.userId && r.status !== "suggested")
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(mine);
  });

  // Client decision on a recommendation. The client chooses WHO performs it:
  //   decision: "self"    → client_performing (client will do it themselves)
  //   decision: "permit"  → permitted (analyst may perform it, with this consent)
  //   decision: "decline" → declined
  app.post("/api/admin/recommendations/:id/decision", requireAuth, async (req, res) => {
    const rec = (db.data.recommendations || []).find(r => r.id === req.params.id && r.ownerUserId === req.userId);
    if (!rec) return res.status(404).json({ error: "Recommendation not found." });
    const { decision, note } = req.body || {};
    const map = { self: "client_performing", permit: "permitted", decline: "declined" };
    const status = map[decision];
    if (!status) return res.status(400).json({ error: "decision must be 'self', 'permit', or 'decline'." });
    pushHistory(rec, "client_admin", req.userId, status, note || "");
    if (logClientAction) logClientAction(db, {
      clientUserId: rec.ownerUserId, actorUserId: req.userId, actorRole: "client_admin",
      action: `recommendation_${decision}`, recommendationId: rec.id,
      detail: `"${rec.title}" → ${status}${note ? " · " + note : ""}`,
    });
    await db.write();
    res.json(rec);
  });

  // Mark a recommendation completed. Allowed for the client (self-performed) or,
  // when the client granted permission, the analyst who performed it.
  app.post("/api/recommendations/:id/complete", requireAuth, async (req, res) => {
    const rec = (db.data.recommendations || []).find(r => r.id === req.params.id);
    if (!rec) return res.status(404).json({ error: "Recommendation not found." });

    const isOwner = rec.ownerUserId === req.userId;
    const isPermittedAnalyst = (req.isAnalyst || req.isAdmin) && rec.status === "permitted";
    if (!isOwner && !isPermittedAnalyst) {
      return res.status(403).json({ error: "Only the client, or an analyst the client permitted, may complete this." });
    }
    // Guard: an analyst may only complete what the client explicitly permitted.
    if (!isOwner && rec.status !== "permitted") {
      return res.status(409).json({ error: "Client permission is required before an analyst can complete this." });
    }
    pushHistory(rec, isOwner ? "client_admin" : "analyst", req.userId, "completed", req.body?.note || "");
    if (logClientAction) logClientAction(db, {
      clientUserId: rec.ownerUserId, actorUserId: req.userId,
      actorRole: isOwner ? "client_admin" : "analyst",
      action: "recommendation_completed", recommendationId: rec.id,
      detail: `"${rec.title}" marked complete by ${isOwner ? "client" : "analyst"}.`,
    });
    await db.write();
    res.json(rec);
  });

  console.log("ShieldAI agent routes registered.");
}
