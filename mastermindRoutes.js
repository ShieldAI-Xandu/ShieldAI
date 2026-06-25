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

const nowIso = () => new Date().toISOString();

// Build a compact, read-only portfolio snapshot the AI can reason over without
// blowing the token budget. No secrets, no raw report blobs.
function portfolioSnapshot(db) {
  const users = db.data.users || [];
  const agents = db.data.agents || [];
  const reports = db.data.agentReports || [];
  const recs = db.data.recommendations || [];

  const latestByAgent = {};
  for (const r of reports) {
    const cur = latestByAgent[r.agentId];
    if (!cur || new Date(r.receivedAt) > new Date(cur.receivedAt)) latestByAgent[r.agentId] = r;
  }

  const clients = users.map(u => {
    const myAgents = agents.filter(a => a.ownerUserId === u.id && a.status !== "revoked");
    const postures = myAgents.map(a => {
      const rep = latestByAgent[a.id];
      const checks = rep?.report?.checks || [];
      const fails = checks.filter(c => c.status === "fail").length;
      const warns = checks.filter(c => c.status === "warn").length;
      return { hostname: a.hostname, os: a.os, fails, warns,
               posture: fails ? "at_risk" : warns ? "needs_attention" : "healthy" };
    });
    const openRecs = recs.filter(r => r.ownerUserId === u.id &&
      !["completed", "declined"].includes(r.status)).length;
    return {
      id: u.id, company: u.companyName || u.email, tier: u.tier || "free",
      endpoints: myAgents.length, postures, openRecommendations: openRecs,
    };
  });

  return {
    totals: {
      clients: users.length,
      endpoints: agents.filter(a => a.status !== "revoked").length,
      atRiskEndpoints: clients.reduce((s, c) => s + c.postures.filter(p => p.posture === "at_risk").length, 0),
      openRecommendations: recs.filter(r => !["completed","declined"].includes(r.status)).length,
    },
    clients,
  };
}

export function registerMastermindRoutes(app, { db, requireAdmin, callClaudeText, extractJson }) {
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
    const { messages, includeContext = true } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages[] required." });
    }
    // Keep only role/content, cap history length and size.
    const clean = messages.slice(-20).map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 8000),
    }));

    const snapshot = includeContext ? portfolioSnapshot(db) : null;
    const system = `You are ShieldAI Mastermind, the senior virtual-CISO intelligence assisting a ShieldAI ADMIN.

You provide analysis, prioritization, and clear recommendations across the admin's whole client portfolio. You are ADVISORY ONLY: you never perform actions on any system, never claim to have changed anything, and always frame remediation as steps a human (client admin or analyst) would take. Be concise, specific, and practical.

${snapshot ? `Read-only portfolio snapshot (current):\n${JSON.stringify(snapshot)}` : "No portfolio context was attached to this message."}`;

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

  console.log("ShieldAI Mastermind admin routes registered.");
}
