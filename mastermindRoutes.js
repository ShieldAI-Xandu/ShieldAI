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
import { getTier, hasCapability, DEFAULT_TIER } from "./tiers.js";
import { cachedExposure } from "./cveService.js";
import { cachedDarkweb } from "./darkwebService.js";
import { brandingSummary, resolveBrandingForUser } from "./brandingRoutes.js";
import { taskSummary, simulateControlChange, currentPosture } from "./taskRoutes.js";
import { SECURITY_CHECKLIST } from "./securityChecklist.js";

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
    const exp = cachedExposure(db, u.id);
    const dw = cachedDarkweb(db, u.id);
    return {
      id: u.id, company: u.companyName || u.email, email: u.email,
      tier: u.tier || "free", suspended: !!u.suspended,
      assignedAnalysts: assignments.filter(a => a.clientUserId === u.id).map(a => nameOf(a.analystUserId)),
      billing: sub ? { status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, stripeLinked: !!sub.stripeCustomerId } : { status: u.tier === "free" || !u.tier ? "free" : "none" },
      endpointCount: myAgents.length,
      endpoints: myAgents.map(postureOf),
      cveExposure: exp ? {
        counts: exp.counts, refreshedAt: exp.refreshedAt, degraded: exp.degraded,
        ...(full ? { software: exp.software, top: exp.top }
                 : { topCves: (exp.top || []).slice(0, 3).map(c => ({ id: c.id, severity: c.severity, score: c.score, software: c.software })) }),
      } : { counts: {}, note: "No CVE exposure computed yet (needs software inventory)." },
      darkWebExposure: dw ? {
        statusLevel: dw.statusLevel, monitored: dw.monitored, domain: dw.domain,
        breachedAccounts: dw.breachedAccounts ?? null, distinctBreaches: dw.distinctBreaches ?? null,
        ...(full ? { breaches: dw.breaches || [] } : {}),
        ...(dw.reason ? { reason: dw.reason } : {}),
        refreshedAt: dw.refreshedAt,
      } : { statusLevel: "Not checked", note: "No breach exposure computed yet." },
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
    branding: brandingSummary(db),
    tasks: taskSummary(db, depth),
    recentEvents: events.slice(-20).map(e => ({ client: nameOf(e.ownerUserId), severity: e.severity, type: e.type, message: e.message, at: e.ts || e.at })),
  };
}

export function registerMastermindRoutes(app, { db, requireAdmin, requireAuth, callClaudeText, callClaudeWithTools, extractJson }) {
  db.data.recommendations ||= [];

  function aiAvailable(res) {
    if (!callClaudeText) {
      res.status(503).json({ error: "Mastermind AI is not available (AI backend not configured)." });
      return false;
    }
    return true;
  }

  // Module-scope name resolver for tool results (snapshot has its own local one).
  function nameOf(id) {
    const u = (db.data.users || []).find(x => x.id === id);
    return u ? (u.companyName || u.email) : "—";
  }

  // ── READ-ONLY MASTERMIND TOOLS ──────────────────────────────
  // Every tool here ONLY READS db.data. None writes, and none performs any
  // action on any system or account. This lets Mastermind fetch precise detail
  // on demand (instead of stuffing the whole platform into every prompt) while
  // strictly preserving the "advisory only / humans act" boundary.
  const MASTERMIND_TOOLS = [
    {
      name: "list_clients",
      description: "List all client accounts with company name, tier, endpoint count, open-recommendation count, and CVE/dark-web summary. Use to get the lay of the land before drilling in.",
      input_schema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "get_client_detail",
      description: "Get full detail for one client by id or email: endpoints with posture, recommendations with status, CVE exposure (top CVEs), dark-web/breach exposure, and recent actions.",
      input_schema: { type: "object", properties: {
        clientIdOrEmail: { type: "string", description: "The client's user id or email address." },
      }, required: ["clientIdOrEmail"] },
    },
    {
      name: "list_recommendations",
      description: "List recommendations across the platform, optionally filtered by status (suggested, proposed, permitted, client_performing, declined, completed) and/or a client id/email.",
      input_schema: { type: "object", properties: {
        status: { type: "string", description: "Optional status filter." },
        clientIdOrEmail: { type: "string", description: "Optional client filter." },
      }, required: [] },
    },
    {
      name: "get_cve_exposure",
      description: "Get the cached CVE vulnerability exposure for a client (matched from the live NVD against their reported software).",
      input_schema: { type: "object", properties: {
        clientIdOrEmail: { type: "string" },
      }, required: ["clientIdOrEmail"] },
    },
    {
      name: "get_darkweb_exposure",
      description: "Get the cached dark-web/breach exposure (Have I Been Pwned) for a client's domain.",
      input_schema: { type: "object", properties: {
        clientIdOrEmail: { type: "string" },
      }, required: ["clientIdOrEmail"] },
    },
    {
      name: "recent_events",
      description: "Get the most recent security events across the platform (optionally for one client), newest first.",
      input_schema: { type: "object", properties: {
        clientIdOrEmail: { type: "string", description: "Optional client filter." },
        limit: { type: "number", description: "Max events (default 20, cap 50)." },
      }, required: [] },
    },
    {
      name: "list_tasks",
      description: "List remediation tasks across the portfolio: counts by status/priority, overdue items, unassigned work. Optionally filter to one client. Each task targets a security control and carries a projected posture gain. Read-only.",
      input_schema: { type: "object", properties: {
        clientIdOrEmail: { type: "string", description: "Optional client filter." },
        status: { type: "string", description: "Optional: open, in_progress, blocked, done, cancelled." },
        overdueOnly: { type: "boolean", description: "Optional: only tasks past their due date." },
      }, required: [] },
    },
    {
      name: "analyze_gaps",
      description: "For one client, rank every unresolved security control by how much the posture score would improve if it were fixed. This is the definitive 'what should they do first?' tool — the gains are computed by the deterministic scoring engine, not estimated. Read-only.",
      input_schema: { type: "object", properties: {
        clientIdOrEmail: { type: "string", description: "The client to analyze." },
      }, required: ["clientIdOrEmail"] },
    },
    {
      name: "simulate_fix",
      description: "Simulate answering a specific control differently and return the projected posture score and delta, without changing anything. Use to answer 'what if they did X?'. Read-only.",
      input_schema: { type: "object", properties: {
        clientIdOrEmail: { type: "string", description: "The client." },
        controlId: { type: "string", description: "Control id, e.g. mfa, backups, monitoring." },
        targetLabel: { type: "string", description: "The answer option to simulate." },
      }, required: ["clientIdOrEmail", "controlId", "targetLabel"] },
    },
    {
      name: "get_branding",
      description: "Read white-label branding across the platform: which analysts/MSPs have their own brand, how many clients each brand covers, and how many clients are still on the default ShieldAI brand. Optionally pass a client id/email to see exactly which brand that client sees. Read-only.",
      input_schema: { type: "object", properties: {
        clientIdOrEmail: { type: "string", description: "Optional. If given, returns the branding this specific client currently sees." },
      }, required: [] },
    },
  ];

  // Resolve a client by id or email → the user record (or null).
  function resolveClient(idOrEmail) {
    const key = String(idOrEmail || "").trim().toLowerCase();
    return (db.data.users || []).find(u =>
      !u.isAdmin && !u.isAnalyst && (u.id === idOrEmail || (u.email || "").toLowerCase() === key)
    ) || null;
  }

  // Execute a read-only tool. NEVER writes to the database.
  async function runMastermindTool(name, input) {
    switch (name) {
      case "list_clients": {
        const snap = portfolioSnapshot(db, "summary");
        return { clients: snap.clients, totals: snap.totals };
      }
      case "get_client_detail": {
        const u = resolveClient(input.clientIdOrEmail);
        if (!u) return { error: "Client not found." };
        const snap = portfolioSnapshot(db, "full");
        const detail = snap.clients.find(c => c.id === u.id);
        return detail || { error: "Client found but no snapshot detail available." };
      }
      case "list_tasks": {
        let list = (db.data.tasks || []);
        if (input.clientIdOrEmail) {
          const u = resolveClient(input.clientIdOrEmail);
          if (!u) return { error: "Client not found." };
          list = list.filter(t => t.ownerUserId === u.id);
        }
        if (input.status) list = list.filter(t => t.status === input.status);
        if (input.overdueOnly) {
          list = list.filter(t => t.dueDate && new Date(t.dueDate) < new Date() &&
            !["done","cancelled"].includes(t.status));
        }
        return {
          summary: taskSummary(db),
          tasks: list.slice(0, 50).map(t => ({
            client: nameOf(t.ownerUserId), title: t.title, status: t.status,
            priority: t.priority, controlId: t.controlId, dueDate: t.dueDate,
            assignee: t.assigneeUserId ? nameOf(t.assigneeUserId) : null,
            projectedGain: t.projectedGain ?? null, actualGain: t.actualGain ?? null,
          })),
        };
      }
      case "analyze_gaps": {
        const u = resolveClient(input.clientIdOrEmail);
        if (!u) return { error: "Client not found." };
        const posture = currentPosture(db, u.id);
        if (!posture) return { error: "Client has no assessment yet." };
        const gaps = [];
        for (const q of SECURITY_CHECKLIST) {
          const best = [...q.options].sort((a,b)=>b.score-a.score)[0];
          const sim = simulateControlChange(db, u.id, q.id, best.label);
          if (sim && sim.delta > 0) {
            gaps.push({ controlId: q.id, question: q.question, nistFunction: q.nistFunction,
              targetAnswer: best.label, projectedGain: sim.delta, projectedScore: sim.projected });
          }
        }
        gaps.sort((a,b)=>b.projectedGain-a.projectedGain);
        return {
          client: u.companyName || u.email,
          currentScore: posture.postureScore, currentLevel: posture.postureLevel,
          weakestAreas: posture.weakestAreas,
          rankedGaps: gaps,
          note: "Gains computed deterministically by riskEngine.js — not estimates.",
        };
      }
      case "simulate_fix": {
        const u = resolveClient(input.clientIdOrEmail);
        if (!u) return { error: "Client not found." };
        const sim = simulateControlChange(db, u.id, input.controlId, input.targetLabel);
        if (!sim) return { error: "Invalid control/answer, or client has no assessment." };
        return { client: u.companyName || u.email, ...sim };
      }
      case "get_branding": {
        if (input.clientIdOrEmail) {
          const u = resolveClient(input.clientIdOrEmail);
          if (!u) return { error: "Client not found." };
          const b = resolveBrandingForUser(db, u);
          return {
            client: u.companyName || u.email,
            sees: {
              productName: b.productName, companyName: b.companyName,
              primaryColor: b.primaryColor, hasLogo: !!b.logoUrl,
              isDefaultBrand: !!b.isDefault,
            },
          };
        }
        return brandingSummary(db);
      }
      case "list_recommendations": {
        let recs = (db.data.recommendations || []);
        if (input.clientIdOrEmail) {
          const u = resolveClient(input.clientIdOrEmail);
          if (!u) return { error: "Client not found." };
          recs = recs.filter(r => r.ownerUserId === u.id);
        }
        if (input.status) recs = recs.filter(r => r.status === input.status);
        return { count: recs.length, recommendations: recs.slice(-50).map(r => ({
          id: r.id, title: r.title, severity: r.severity, status: r.status,
          origin: r.origin, client: nameOf(r.ownerUserId),
        })) };
      }
      case "get_cve_exposure": {
        const u = resolveClient(input.clientIdOrEmail);
        if (!u) return { error: "Client not found." };
        const exp = cachedExposure(db, u.id);
        return exp || { note: "No CVE exposure computed yet for this client." };
      }
      case "get_darkweb_exposure": {
        const u = resolveClient(input.clientIdOrEmail);
        if (!u) return { error: "Client not found." };
        const dw = cachedDarkweb(db, u.id);
        return dw || { note: "No dark-web exposure computed yet for this client." };
      }
      case "recent_events": {
        let events = (db.data.agentEvents || []);
        if (input.clientIdOrEmail) {
          const u = resolveClient(input.clientIdOrEmail);
          if (!u) return { error: "Client not found." };
          events = events.filter(e => e.ownerUserId === u.id);
        }
        const limit = Math.min(input.limit || 20, 50);
        return { events: events.slice(-limit).reverse().map(e => ({
          client: nameOf(e.ownerUserId), severity: e.severity, type: e.type,
          message: e.message, at: e.ts || e.at,
        })) };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
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

You have read-only situational awareness of the whole platform: every account (admins, analysts, clients), every monitored endpoint and its security posture, analyst↔client assignments, the full recommendation lifecycle, billing/subscription status, security events, and the client action log. Each client also carries a cveExposure object — known CVE vulnerabilities (with CVSS severity and score) matched from the live NIST National Vulnerability Database against the software that client's agents and assessment report — and a darkWebExposure object — real breach/credential exposure for the client's domain from Have I Been Pwned (statusLevel, breached account count, and the named breaches). Use this to answer ANY question about the state of the platform and to diagnose and prioritize cybersecurity and operational issues across all clients. When relevant, reference specific CVE IDs and their severity, and named breaches. Remember CVE matches depend on reported software, and dark-web monitoring depends on a verified domain — a "Not monitored", "Not active", or "Not checked" status is a data/coverage gap, NOT a clean bill of health.

You are ADVISORY ONLY. You never perform actions on any system or account, and never claim to have changed anything. Frame every remediation as concrete steps a human takes — the client's admin acts on their own systems, or an assigned analyst acts with the client's permission. When you spot something actionable (e.g. an at-risk endpoint, an outdated agent, an overdue recommendation), say so clearly and explain what a human should do; the admin can then act through the platform's human-gated controls.

Be specific, accurate, and practical. You can call read-only tools to fetch precise detail on demand — list_clients, get_client_detail, list_recommendations, get_cve_exposure, get_darkweb_exposure, and recent_events. Prefer starting from the attached summary snapshot, and call a tool when you need specifics you don't already have (e.g. one client's full endpoint list or CVE detail). These tools only READ data; they never change anything.

${snapshot ? `Read-only platform snapshot (${useDepth}, current):\n${JSON.stringify(snapshot)}` : "No platform context was attached to this message."}`;

    try {
      let text;
      if (callClaudeWithTools) {
        text = await callClaudeWithTools({
          system,
          messages: clean,
          tools: MASTERMIND_TOOLS,
          runTool: runMastermindTool,
          max_tokens: 1500,
        });
      } else {
        text = await callClaudeText({ system, messages: clean, max_tokens: 1500 });
      }
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

  // Build a snapshot containing ONLY this user's own data.
  function clientSnapshot(db, userId) {
    const agents = (db.data.agents || []).filter(a => a.ownerUserId === userId && a.status !== "revoked");
    const reports = db.data.agentReports || [];
    const latestByAgent = {};
    for (const r of reports) {
      if (r.ownerUserId !== userId) continue;            // isolation: only own reports
      const cur = latestByAgent[r.agentId];
      if (!cur || new Date(r.receivedAt) > new Date(cur.receivedAt)) latestByAgent[r.agentId] = r;
    }
    const endpoints = agents.map(a => {
      const rep = latestByAgent[a.id];
      const checks = rep?.report?.checks || [];
      const fails = checks.filter(c => c.status === "fail").length;
      const warns = checks.filter(c => c.status === "warn").length;
      return {
        hostname: a.hostname, os: a.os, agentVersion: a.agentVersion || rep?.report?.agentVersion || "unknown",
        posture: fails ? "at_risk" : warns ? "needs_attention" : "healthy",
        checks: checks.map(c => ({ id: c.id, title: c.title, status: c.status, severity: c.severity, observed: c.observed, cisControl: c.cisControl })),
        recentEvents: (rep?.report?.events || []).slice(0, 8).map(e => ({ severity: e.severity, type: e.type, message: e.message })),
      };
    });
    // Only recommendations that have reached this client (not internal drafts).
    const recs = (db.data.recommendations || [])
      .filter(r => r.ownerUserId === userId && !["suggested"].includes(r.status))
      .map(r => ({ title: r.title, detail: r.detail, severity: r.severity, status: r.status }));
    const assessments = (db.data.assessments || [])
      .filter(a => a.userId === userId)
      .map(a => ({ id: a.id, createdAt: a.createdAt, company: a.company?.name || null }));
    const exp = cachedExposure(db, userId);
    const dw = cachedDarkweb(db, userId);
    return { endpoints, recommendations: recs, assessments,
             cveExposure: exp ? { counts: exp.counts, top: exp.top, software: exp.software, refreshedAt: exp.refreshedAt, degraded: exp.degraded }
                              : { counts: {}, note: "No CVE exposure computed yet." },
             darkWebExposure: dw ? { statusLevel: dw.statusLevel, monitored: dw.monitored, domain: dw.domain,
                                     breachedAccounts: dw.breachedAccounts ?? null, distinctBreaches: dw.distinctBreaches ?? null,
                                     breaches: dw.breaches || [], reason: dw.reason || null, refreshedAt: dw.refreshedAt }
                                 : { statusLevel: "Not checked", note: "No breach exposure computed yet." },
             totals: { endpoints: endpoints.length, atRisk: endpoints.filter(e => e.posture === "at_risk").length } };
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
          error: "Mastermind assistant is available on the Enterprise plan.",
          code: "UPGRADE_REQUIRED", capability: "mastermind", currentTier: tier,
        });
      }
      next();
    });
  }

  app.post("/api/client/mastermind/chat", requireClientMastermind, async (req, res) => {
    if (!aiAvailable(res)) return;
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages[] required." });
    }
    const clean = messages.slice(-16).map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 6000),
    }));

    // ISOLATION: only this client's own data is ever placed in context.
    const snap = clientSnapshot(db, req.userId);
    const system = `You are ShieldAI Mastermind, a virtual-CISO assistant helping ONE client understand and improve THEIR OWN security posture.

You can see only this client's own endpoints, posture checks, security events, recommendations, and assessments — provided below. You have NO knowledge of any other client, the platform as a whole, billing, or other accounts, and you must never speculate about them. If asked about anything outside this client's own data, say you can only help with their own security posture.

You are ADVISORY ONLY: explain issues and recommend concrete steps the client can take or ask their ShieldAI analyst about. Never claim to perform actions. Be clear, practical, and encouraging.

This client's data (the only data you have):
${JSON.stringify(snap)}`;

    try {
      const text = await callClaudeText({ system, messages: clean, max_tokens: 1200 });
      res.json({ reply: text });
    } catch (err) {
      console.error("Client Mastermind error:", err.message);
      res.status(500).json({ error: "Mastermind could not respond." });
    }
  });

  console.log("ShieldAI Mastermind admin routes registered.");
}
