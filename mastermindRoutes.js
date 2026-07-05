// mastermindRoutes.js
// ShieldAI "Mastermind" admin console backend.
//
// Gives admins three capabilities, all ADVISORY (the AI analyzes and advises;
// it never performs actions on any system — humans act, per the platform
// boundary):
//   1. Chat        — converse with Mastermind, which has read-only context on
//                    the portfolio (accounts, posture, recommendations).
//   2. Oversight   — view AI-drafted / active recommendations across ALL clients.
//   3. Analyze     — on demand, run Mastermind against a specific client or
//                    endpoint and get findings + suggested recommendations.
//
// Mount from server.js:
//   import { registerMastermindRoutes } from "./mastermindRoutes.js";
//   registerMastermindRoutes(app, { db, requireAdmin, callClaudeText, extractJson });

import { randomUUID } from "crypto";
import { getTier, hasCapability, mastermindScope, DEFAULT_TIER } from "./tiers.js";

const nowIso = () => new Date().toISOString();

// Build a compact, read-only portfolio snapshot the AI can reason over without
// blowing the token budget. No secrets, no raw report blobs.
// Comprehensive, read-only snapshot of the entire platform. This is
// Mastermind's situational awareness. `depth` controls verbosity:
//   "summary" — counts + per-entity one-liners (cheap, for chat)
//   "full"    — adds per-endpoint checks/events and recommendation detail
// No secrets (password hashes, tokens, Stripe keys) are ever included.
function portfolioSnapshot(db, depth = "summary") {
  const users = db.data.users || [];
  const agents = db.data.agents || [];
  const reports = db.data.agentReports || [];
  const recs = db.data.recommendations || [];
  const assignments = db.data.assignments || [];
  const subs = db.data.subscriptions || [];
  const events = db.data.agentEvents || [];
  const actions = db.data.clientActions || [];
  const full = depth === "full";

  const latestByAgent = {};
  for (const r of reports) {
    const cur = latestByAgent[r.agentId];
    if (!cur || new Date(r.receivedAt) > new Date(cur.receivedAt)) latestByAgent[r.agentId] = r;
  }
  const nameOf = (id) => { const u = users.find(x => x.id === id); return u ? (u.companyName || u.email) : "—"; };
  const isOnline = (ls) => ls && (Date.now() - new Date(ls)) < 3 * 60 * 60 * 1000;

  // ── people ──
  const admins = users.filter(u => u.isAdmin).map(u => ({ id: u.id, name: u.companyName || u.email, email: u.email }));
  const analysts = users.filter(u => u.isAnalyst).map(u => ({
    id: u.id, name: u.companyName || u.email, email: u.email,
    clients: assignments.filter(a => a.analystUserId === u.id).map(a => nameOf(a.clientUserId)),
  }));
  const clientUsers = users.filter(u => !u.isAdmin && !u.isAnalyst);

  // ── endpoints (per client) ──
  function postureOf(a) {
    const rep = latestByAgent[a.id];
    const checks = rep?.report?.checks || [];
    const fails = checks.filter(c => c.status === "fail").length;
    const warns = checks.filter(c => c.status === "warn").length;
    return {
      hostname: a.hostname, os: a.os, agentVersion: a.agentVersion || rep?.report?.agentVersion || "unknown",
      online: isOnline(a.lastSeen), lastReportAt: a.lastReportAt || null,
      posture: fails ? "at_risk" : warns ? "needs_attention" : "healthy",
      fails, warns, checkCount: checks.length,
      ...(full ? {
        checks: checks.map(c => ({ id: c.id, title: c.title, status: c.status, severity: c.severity, observed: c.observed, cisControl: c.cisControl })),
        recentEvents: (rep?.report?.events || []).slice(0, 8).map(e => ({ severity: e.severity, type: e.type, message: e.message })),
        inventory: rep?.report?.inventory || {},
      } : {}),
    };
  }

  const clients = clientUsers.map(u => {
    const myAgents = agents.filter(a => a.ownerUserId === u.id && a.status !== "revoked");
    const sub = subs.find(s => s.userId === u.id) || null;
    const myRecs = recs.filter(r => r.ownerUserId === u.id);
    return {
      id: u.id, company: u.companyName || u.email, email: u.email,
      tier: u.tier || "free", suspended: !!u.suspended,
      assignedAnalysts: assignments.filter(a => a.clientUserId === u.id).map(a => nameOf(a.analystUserId)),
      billing: sub ? { status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, stripeLinked: !!sub.stripeCustomerId } : { status: u.tier === "free" || !u.tier ? "free" : "none" },
      endpointCount: myAgents.length,
      endpoints: myAgents.map(postureOf),
      recommendations: {
        open: myRecs.filter(r => !["completed","declined"].includes(r.status)).length,
        byStatus: myRecs.reduce((m, r) => { m[r.status] = (m[r.status]||0)+1; return m; }, {}),
        ...(full ? { items: myRecs.slice(-12).map(r => ({ title: r.title, severity: r.severity, status: r.status, origin: r.origin })) } : {}),
      },
      ...(full ? { recentActions: actions.filter(a => a.clientUserId === u.id).slice(-10).map(a => ({ action: a.action, detail: a.detail, at: a.at })) } : {}),
    };
  });

  // ── platform-wide rollups ──
  const allEndpoints = clients.flatMap(c => c.endpoints);
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      accounts: users.length, admins: admins.length, analysts: analysts.length, clients: clientUsers.length,
      endpoints: allEndpoints.length,
      onlineEndpoints: allEndpoints.filter(e => e.online).length,
      atRiskEndpoints: allEndpoints.filter(e => e.posture === "at_risk").length,
      needsAttentionEndpoints: allEndpoints.filter(e => e.posture === "needs_attention").length,
      openRecommendations: recs.filter(r => !["completed","declined"].includes(r.status)).length,
      suspendedAccounts: users.filter(u => u.suspended).length,
      payingClients: clients.filter(c => ["active","manual","trialing","past_due"].includes(c.billing.status)).length,
      agentVersions: [...new Set(allEndpoints.map(e => e.agentVersion))],
    },
    admins, analysts, clients,
    recentEvents: events.slice(-20).map(e => ({ client: nameOf(e.ownerUserId), severity: e.severity, type: e.type, message: e.message, at: e.ts || e.at })),
  };
}

export function registerMastermindRoutes(app, { db, requireAdmin, requireAuth, callClaudeText, extractJson }) {
  db.data.recommendations ||= [];

  function aiAvailable(res) {
    if (!callClaudeText) {
      res.status(503).json({ error: "Mastermind AI is not available (AI backend not configured)." });
      return false;
    }
    return true;
  }

  // ── 1. CHAT ─────────────────────────────────────────────────
  // body: { messages: [{role:"user"|"assistant", content}], includeContext?: bool }
  app.post("/api/admin/mastermind/chat", requireAdmin, async (req, res) => {
    if (!aiAvailable(res)) return;
    const { messages, includeContext = true, depth = "summary" } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages[] required." });
    }
    // Keep only role/content, cap history length and size.
    const clean = messages.slice(-20).map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 8000),
    }));

    const useDepth = depth === "full" ? "full" : "summary";
    const snapshot = includeContext ? portfolioSnapshot(db, useDepth) : null;
    const system = `You are ShieldAI Mastermind, the central virtual-CISO intelligence for the entire ShieldAI platform, assisting a ShieldAI ADMIN.

You have read-only situational awareness of the whole platform: every account (admins, analysts, clients), every monitored endpoint and its security posture, analyst↔client assignments, the full recommendation lifecycle, billing/subscription status, security events, and the client action log. Use this to answer ANY question about the state of the platform and to diagnose and prioritize cybersecurity and operational issues across all clients.

You are ADVISORY ONLY. You never perform actions on any system or account, and never claim to have changed anything. Frame every remediation as concrete steps a human takes — the client's admin acts on their own systems, or an assigned analyst acts with the client's permission. When you spot something actionable (e.g. an at-risk endpoint, an outdated agent, an overdue recommendation), say so clearly and explain what a human should do; the admin can then act through the platform's human-gated controls.

Be specific, accurate, and practical. If the snapshot doesn't contain enough detail to answer precisely, say what additional detail would be needed (the admin can request a deeper context view).

${snapshot ? `Read-only platform snapshot (${useDepth}, current):\n${JSON.stringify(snapshot)}` : "No platform context was attached to this message."}`;

    try {
      const text = await callClaudeText({
        system,
        messages: clean,
        max_tokens: 1500,
      });
      res.json({ reply: text });
    } catch (err) {
      console.error("Mastermind chat error:", err.message);
      res.status(500).json({ error: "Mastermind could not respond." });
    }
  });

  // ── Awareness snapshot (what Mastermind currently "sees") ───
  // ?depth=summary|full
  app.get("/api/admin/mastermind/snapshot", requireAdmin, (req, res) => {
    const depth = req.query.depth === "full" ? "full" : "summary";
    res.json(portfolioSnapshot(db, depth));
  });

  // ── 2. OVERSIGHT — all recommendations across clients ───────
  // ?status=suggested|proposed|... optional; default = all not-archived.
  app.get("/api/admin/mastermind/recommendations", requireAdmin, (req, res) => {
    const users = db.data.users || [];
    const nameOf = (id) => { const u = users.find(x => x.id === id); return u ? (u.companyName || u.email) : "—"; };
    let recs = [...(db.data.recommendations || [])];
    if (req.query.status) recs = recs.filter(r => r.status === req.query.status);
    recs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(recs.slice(0, 300).map(r => ({
      id: r.id, ownerUserId: r.ownerUserId, client: nameOf(r.ownerUserId),
      agentId: r.agentId || null, origin: r.origin, aiAuthored: !!r.aiAuthored,
      title: r.title, detail: r.detail, severity: r.severity, status: r.status,
      createdAt: r.createdAt,
    })));
  });

  // ── 3. ANALYZE — on demand for a client or a single endpoint ─
  // body: { userId } OR { agentId }
  app.post("/api/admin/mastermind/analyze", requireAdmin, async (req, res) => {
    if (!aiAvailable(res)) return;
    const { userId, agentId } = req.body || {};
    const agents = db.data.agents || [];
    const reports = db.data.agentReports || [];

    // Resolve the scope: a single agent, or all of a user's agents.
    let scopeAgents = [];
    let owner = null;
    if (agentId) {
      const a = agents.find(x => x.id === agentId);
      if (!a) return res.status(404).json({ error: "Endpoint not found." });
      scopeAgents = [a];
      owner = (db.data.users || []).find(u => u.id === a.ownerUserId);
    } else if (userId) {
      owner = (db.data.users || []).find(u => u.id === userId);
      if (!owner) return res.status(404).json({ error: "Client not found." });
      scopeAgents = agents.filter(a => a.ownerUserId === userId && a.status !== "revoked");
    } else {
      return res.status(400).json({ error: "Provide userId or agentId." });
    }

    // Gather the latest report per agent in scope.
    const latest = (aid) => reports.filter(r => r.agentId === aid)
      .sort((x, y) => new Date(y.receivedAt) - new Date(x.receivedAt))[0];
    const hosts = scopeAgents.map(a => {
      const rep = latest(a.id);
      return {
        hostname: a.hostname, os: a.os,
        checks: (rep?.report?.checks || []).map(c => ({
          id: c.id, title: c.title, status: c.status, severity: c.severity, observed: c.observed,
        })),
        events: (rep?.report?.events || []).slice(0, 10).map(e => ({
          severity: e.severity, type: e.type, message: e.message,
        })),
        inventory: rep?.report?.inventory || {},
      };
    });

    if (hosts.every(h => h.checks.length === 0)) {
      return res.json({ summary: "No report data is available for this scope yet.", findings: [], recommendations: [] });
    }

    const system = `You are ShieldAI Mastermind, a senior virtual CISO. Analyze the endpoint posture below for ${owner?.companyName || "the client"} and produce a prioritized assessment.

ADVISORY ONLY — recommend actions for a human to take; never claim to act.

Return ONLY valid minified JSON, no markdown:
{"summary":"2-3 sentence portfolio-level read","findings":[{"area":"","severity":"low|medium|high|critical","observation":""}],"recommendations":[{"title":"","detail":"2-3 sentences with concrete steps","severity":"low|medium|high|critical","priority":1-5}]}
Limit findings to 6 and recommendations to 5.`;

    // Recent client actions (decisions/completions) give Mastermind behavioral
    // context — e.g. a client repeatedly declining high-severity fixes.
    const recentActions = (db.data.clientActions || [])
      .filter(a => a.clientUserId === owner?.id)
      .sort((x, y) => new Date(y.at) - new Date(x.at))
      .slice(0, 25)
      .map(a => ({ action: a.action, detail: a.detail, at: a.at }));

    const user = `Hosts (${hosts.length}):\n${JSON.stringify(hosts)}\n\nRecent client actions:\n${JSON.stringify(recentActions)}`;

    try {
      const text = await callClaudeText({ system, messages: [{ role: "user", content: user }], max_tokens: 2000 });
      const parsed = extractJson(text) || {};
      res.json({
        scope: agentId ? "endpoint" : "client",
        client: owner ? (owner.companyName || owner.email) : "—",
        ownerUserId: owner?.id || null,
        summary: parsed.summary || "",
        findings: Array.isArray(parsed.findings) ? parsed.findings.slice(0, 6) : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 5) : [],
      });
    } catch (err) {
      console.error("Mastermind analyze error:", err.message);
      res.status(500).json({ error: "Analysis failed." });
    }
  });

  // ── Promote an analyze recommendation into the real pipeline ─
  // Lets the admin turn a Mastermind suggestion into a tracked recommendation
  // (status "suggested" → enters the normal analyst→client lifecycle).
  // body: { ownerUserId, agentId?, title, detail, severity }
  app.post("/api/admin/mastermind/promote", requireAdmin, async (req, res) => {
    const { ownerUserId, agentId, title, detail, severity } = req.body || {};
    if (!ownerUserId || !title) return res.status(400).json({ error: "ownerUserId and title required." });
    const owner = (db.data.users || []).find(u => u.id === ownerUserId);
    if (!owner) return res.status(404).json({ error: "Client not found." });
    const rec = {
      id: randomUUID(),
      ownerUserId, agentId: agentId || null,
      origin: "ai", aiAuthored: true,
      title: String(title).slice(0, 300),
      detail: String(detail || "").slice(0, 4000),
      severity: ["low","medium","high","critical"].includes(severity) ? severity : "medium",
      status: "suggested",
      createdAt: nowIso(),
      history: [{ at: nowIso(), actorType: "admin", actorId: req.userId,
        status: "suggested", note: "Promoted from Mastermind admin analysis." }],
    };
    db.data.recommendations.push(rec);
    await db.write();
    res.json(rec);
  });

  // ════════════════════════════════════════════════════════════
  //  CLIENT-FACING MASTERMIND (Enterprise tier) — STRICTLY SCOPED
  //  to the requesting client's OWN data. No cross-client info,
  //  no platform totals, no other accounts. Advisory only.
  // ════════════════════════════════════════════════════════════

  // Build a snapshot containing ONLY this user's own data, shaped by the tier's
  // Mastermind scope. Lower tiers get a lighter view (e.g. endpoint posture
  // summary but no per-check detail, no events, no recommendation lifecycle).
  function clientSnapshot(db, userId, scope) {
    const s = scope || {};
    const snap = {};

    // ── endpoints ── (summary or detailed, per scope.endpoints)
    if (s.endpoints) {
      const agents = (db.data.agents || []).filter(a => a.ownerUserId === userId && a.status !== "revoked");
      const reports = db.data.agentReports || [];
      const latestByAgent = {};
      for (const r of reports) {
        if (r.ownerUserId !== userId) continue;            // isolation: only own reports
        const cur = latestByAgent[r.agentId];
        if (!cur || new Date(r.receivedAt) > new Date(cur.receivedAt)) latestByAgent[r.agentId] = r;
      }
      const detailed = s.endpoints === "detailed";
      snap.endpoints = agents.map(a => {
        const rep = latestByAgent[a.id];
        const checks = rep?.report?.checks || [];
        const fails = checks.filter(c => c.status === "fail").length;
        const warns = checks.filter(c => c.status === "warn").length;
        const base = {
          hostname: a.hostname, os: a.os,
          agentVersion: a.agentVersion || rep?.report?.agentVersion || "unknown",
          posture: fails ? "at_risk" : warns ? "needs_attention" : "healthy",
          fails, warns, checkCount: checks.length,
        };
        if (detailed) {
          base.checks = checks.map(c => ({ id: c.id, title: c.title, status: c.status, severity: c.severity, observed: c.observed, cisControl: c.cisControl }));
          if (s.events) base.recentEvents = (rep?.report?.events || []).slice(0, 8).map(e => ({ severity: e.severity, type: e.type, message: e.message }));
        }
        return base;
      });
      snap.totals = {
        endpoints: snap.endpoints.length,
        atRisk: snap.endpoints.filter(e => e.posture === "at_risk").length,
      };
    }

    // ── recommendations ── (Pro/Enterprise only)
    if (s.recommendations) {
      snap.recommendations = (db.data.recommendations || [])
        .filter(r => r.ownerUserId === userId && !["suggested"].includes(r.status))
        .map(r => ({ title: r.title, detail: r.detail, severity: r.severity, status: r.status }));
    }

    // ── assessments ──
    if (s.assessments) {
      snap.assessments = (db.data.assessments || [])
        .filter(a => a.userId === userId)
        .map(a => ({ id: a.id, createdAt: a.createdAt, company: a.company?.name || null }));
    }

    // ── programs / policies / training (metadata only) ──
    if (s.programs) {
      snap.programs = (db.data.programs || [])
        .filter(p => p.ownerUserId === userId)
        .map(p => ({ id: p.id, name: p.name || p.title, framework: p.framework, createdAt: p.createdAt }));
    }
    if (s.policies) {
      snap.policies = (db.data.policies || [])
        .filter(p => p.ownerUserId === userId)
        .map(p => ({ id: p.id, title: p.title, category: p.category, createdAt: p.createdAt }));
    }
    if (s.training) {
      snap.trainingPrograms = (db.data.trainingPrograms || [])
        .filter(t => t.ownerUserId === userId)
        .map(t => ({ id: t.id, title: t.title, phases: Array.isArray(t.phases) ? t.phases.length : undefined, createdAt: t.createdAt }));
    }

    return snap;
  }

  // Capability + auth gate for the client Mastermind.
  function requireClientMastermind(req, res, next) {
    requireAuth(req, res, () => {
      // Staff use the admin console, not this one.
      if (req.isAdmin || req.isAnalyst) {
        return res.status(403).json({ error: "Use the admin Mastermind console." });
      }
      const user = (db.data.users || []).find(u => u.id === req.userId);
      const tier = user?.tier && getTier(user.tier).id === user.tier ? user.tier : DEFAULT_TIER;
      if (!hasCapability(tier, "mastermind")) {
        return res.status(402).json({
          error: "Mastermind assistant is available on paid plans. Upgrade to Starter or higher to unlock it.",
          code: "UPGRADE_REQUIRED", capability: "mastermind", currentTier: tier,
        });
      }
      // Attach tier + scope so the handler can shape the snapshot and prompt.
      req.clientTier = tier;
      req.mastermindScope = mastermindScope(tier);
      next();
    });
  }

  app.post("/api/client/mastermind/chat", requireClientMastermind, async (req, res) => {
    if (!aiAvailable(res)) return;
    const scope = req.mastermindScope || {};
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages[] required." });
    }
    const historyTurns = scope.historyTurns || 12;
    const clean = messages.slice(-historyTurns).map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 6000),
    }));

    // ISOLATION: only this client's own data is ever placed in context, and
    // only the parts this client's TIER is scoped to see.
    const snap = clientSnapshot(db, req.userId, scope);

    // Describe, per scope, what Mastermind can and cannot help with at this tier
    // so it declines out-of-scope requests gracefully with an upgrade hint.
    const canList = [
      scope.assessments && "security assessments",
      scope.programs && "security programs",
      scope.policies && "policies",
      scope.training && "training programs",
      scope.endpoints && (scope.endpoints === "detailed" ? "detailed endpoint posture" : "an endpoint posture overview"),
      scope.events && "security events",
      scope.recommendations && "the recommendation lifecycle",
    ].filter(Boolean);
    const higherOnly = [
      !scope.endpoints && "endpoint monitoring detail",
      !scope.events && "security event history",
      !scope.recommendations && "recommendation tracking",
    ].filter(Boolean);

    const scopeNote = `At this client's current plan (${req.clientTier}), you can help with: ${canList.join(", ") || "their own account only"}.` +
      (higherOnly.length
        ? ` The following require a higher plan and are NOT available to this client, so you must not answer about them and should suggest upgrading if asked: ${higherOnly.join(", ")}.`
        : "");

    const system = `You are ShieldAI Mastermind, a virtual-CISO assistant helping ONE client understand and improve THEIR OWN security posture.

You can see only this client's own data — provided below — and only the portions their subscription plan includes. You have NO knowledge of any other client, the platform as a whole, billing, or other accounts, and you must never speculate about them. If asked about anything outside this client's own data, say you can only help with their own security.

${scopeNote}

You are ADVISORY ONLY: explain issues and recommend concrete steps the client can take or ask their ShieldAI analyst about. Never claim to perform actions. Be clear, practical, and encouraging.

This client's data (the only data you have):
${JSON.stringify(snap)}`;

    try {
      const text = await callClaudeText({ system, messages: clean, max_tokens: scope.maxTokens || 1200 });
      res.json({ reply: text, tier: req.clientTier, scopeLevel: scope.level || null });
    } catch (err) {
      console.error("Client Mastermind error:", err.message);
      res.status(500).json({ error: "Mastermind could not respond." });
    }
  });

  console.log("ShieldAI Mastermind admin routes registered.");
}
