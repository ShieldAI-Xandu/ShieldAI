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
import { getTier, hasCapability, hasTrainingDelivery, featureAccess, DEFAULT_TIER } from "./tiers.js";
import { cachedExposure } from "./cveService.js";
import { cachedDarkweb } from "./darkwebService.js";
import { brandingSummary, resolveBrandingForUser } from "./brandingRoutes.js";
import { taskSummary, simulateControlChange, currentPosture } from "./taskRoutes.js";
import { evidenceSummary } from "./evidenceRoutes.js";
import { complianceSummary } from "./complianceRoutes.js";
import { trainingSummary, clientTrainingSummary } from "./trainingProgramRoutes.js";
// The BRIDGE, not complianceFrameworks.js. Same function signatures, but the
// assessments are now computed by the deep control-mapped modules — so
// check_compliance answers about ISO 27001 from 93 real Annex A controls with
// citations rather than 10 hand-written summaries. Mastermind's answers are
// only ever as good as the facts handed to it; this is that upgrade.
import { evaluateFramework, evaluateAllFrameworks, remediationContext, listFrameworkIds, evaluateWithAgent, getFrameworkDef } from "./complianceBridge.js";
import { corroborate, corroborationSummary } from "./agentEvidence.js";
import { intakeFor, visibleQuestions, intakeStatus, toAssessOpts } from "./frameworkIntake.js";
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
      training: clientTrainingSummary(db, u.id, full),
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
    evidence: evidenceSummary(db, depth),
    compliance: complianceSummary(db, depth),
    training: trainingSummary(db, depth),
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
      name: "check_compliance",
      description: "Check a client's compliance against a framework, control by control, from their real assessment answers — never guessed. Frameworks: nist-csf, cis, hipaa, soc2, iso-27001, pci-dss, nist-800-171, cmmc, nist-800-53, ftc-safeguards, state-privacy, gdpr. Control-mapped frameworks return every real control with its citation (ISO returns all 93 Annex A controls; 800-53 returns 149; PCI returns the sub-requirements in your SAQ scope). Omit frameworkId for a summary across all. Read-only.",
      input_schema: { type: "object", properties: {
        clientIdOrEmail: { type: "string", description: "The client to check." },
        frameworkId: { type: "string", description: "Optional framework id. Omit for a cross-framework summary." },
      }, required: ["clientIdOrEmail"] },
    },
    {
      name: "explain_control",
      description: "Explain one specific control or requirement for a client: what it asks, its citation, the client's current status, which assessment answers drive it, and what answer would satisfy it. Use this when someone asks 'what does A.8.24 mean' or 'why is Req 8 failing'. Returns deterministic facts to narrate — it does not invent remediation. Read-only.",
      input_schema: { type: "object", properties: {
        clientIdOrEmail: { type: "string", description: "The client." },
        frameworkId: { type: "string", description: "Framework id, e.g. iso-27001." },
        requirementId: { type: "string", description: "The control/requirement id, e.g. 'A.8.24', 'Req 8', 'AC-2', '3.1.1'." },
      }, required: ["clientIdOrEmail", "frameworkId", "requirementId"] },
    },
    {
      name: "check_agent_evidence",
      description: "Compare what the read-only monitoring agent OBSERVED on a client's endpoints against what the client SAID in their questionnaire. Returns confirmations (measured evidence an auditor will value) and disputes (the client's answer disagrees with telemetry). Disputes are findings, not errors — they are the gap between what a business believes and what is true. The agent informs; it never overrides an answer. Read-only.",
      input_schema: { type: "object", properties: {
        clientIdOrEmail: { type: "string", description: "The client to check." },
      }, required: ["clientIdOrEmail"] },
    },
    {
      name: "check_framework_scoping",
      description: "Check whether a client has completed a framework's scoping intake, and what the assessment assumed if they skipped it. Scoping materially changes what gets assessed — a merchant with a hosted payment page is responsible for ~7 PCI sub-requirements instead of 61. Use this when a client's framework result looks unexpectedly large or harsh. Read-only.",
      input_schema: { type: "object", properties: {
        clientIdOrEmail: { type: "string", description: "The client." },
        frameworkId: { type: "string", description: "Framework id, e.g. pci-dss, soc2, iso27001, cmmc, hipaa-security, ftc-safeguards." },
      }, required: ["clientIdOrEmail", "frameworkId"] },
    },
    {
      name: "check_evidence",
      description: "Check audit readiness: how much completed work has supporting evidence attached, and which completed tasks are missing proof. Auditors and insurers examine exactly this. Optionally scope to one client. Read-only.",
      input_schema: { type: "object", properties: {
        clientIdOrEmail: { type: "string", description: "Optional client filter." },
      }, required: [] },
    },
    {
      name: "get_branding",
      description: "Read white-label branding across the platform: which analysts/MSPs have their own brand, how many clients each brand covers, and how many clients are still on the default ShieldAI brand. Optionally pass a client id/email to see exactly which brand that client sees. Read-only.",
      input_schema: { type: "object", properties: {
        clientIdOrEmail: { type: "string", description: "Optional. If given, returns the branding this specific client currently sees." },
      }, required: [] },
    },
    {
      name: "get_training",
      description: "Read the standalone security-training program status. With no argument, returns a fleet-wide rollup (total learners, assignments, completion rate, overdue). Pass a client id/email to get that client's training detail: learner count, completion rate, average score, overdue learners, and quarters scheduled. Read-only.",
      input_schema: { type: "object", properties: {
        clientIdOrEmail: { type: "string", description: "Optional. If given, returns that client's training detail." },
      }, required: [] },
    },
  ];

  // The most recent report from each host. An agent reports repeatedly; using
  // every historical report would count one laptop five times and make a single
  // machine look like a fleet.
  function latestReportPerHost(ownerUserId) {
    const byHost = new Map();
    for (const r of (db.data.agentReports || [])) {
      if (r.ownerUserId !== ownerUserId) continue;
      const rep = r.report || r;
      const host = rep?.host?.hostname;
      if (!host) continue;
      const prev = byHost.get(host);
      if (!prev || new Date(r.receivedAt || 0) > new Date(prev.receivedAt || 0)) {
        byHost.set(host, { receivedAt: r.receivedAt, rep });
      }
    }
    return [...byHost.values()].map(v => v.rep);
  }

  // Stored checklists are { id: "selected label" }. Frameworks read
  // { id: { label, score } }. Resolve via the checklist definition rather than
  // trusting a stored score — the option scores are the source of truth.
  function toEvidenceShape(checklist = {}) {
    const out = {};
    for (const q of SECURITY_CHECKLIST) {
      const raw = checklist[q.id];
      const label = typeof raw === "string" ? raw : raw?.label;
      if (!label) continue;
      const opt = q.options.find(o => o.label === label);
      if (opt) out[q.id] = { label: opt.label, score: opt.score };
    }
    return out;
  }

  // A client's saved scoping answers → the opts their framework assessment
  // should use. Without this, Mastermind would report an unscoped PCI result
  // (61 sub-requirements) for a merchant the product already knows is SAQ A (7).
  function frameworkOptsFor(assessment, frameworkId) {
    if (!frameworkId) return {};
    const key = String(frameworkId).replace("iso-27001", "iso27001").replace(/^hipaa$/, "hipaa-security");
    const answers = assessment?.data?.frameworkIntake?.[key];
    if (!answers) return {};
    try { return toAssessOpts(key, answers); } catch { return {}; }
  }

  // Resolve a client by id or email → the user record (or null).
  function resolveClient(idOrEmail) {    const key = String(idOrEmail || "").trim().toLowerCase();
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
      case "check_compliance": {
        const u = resolveClient(input.clientIdOrEmail);
        if (!u) return { error: "Client not found." };
        const list = (db.data.assessments || []).filter(a => a.userId === u.id);
        if (!list.length) return { error: "Client has no assessment — compliance cannot be determined." };
        const a = list.reduce((b,x)=> !b || new Date(x.updatedAt||x.createdAt) > new Date(b.updatedAt||b.createdAt) ? x : b, null);
        const checklist = a.data?.checklist || a.data?.securityChecklist || {};
        if (!input.frameworkId) {
          return { client: u.companyName || u.email, frameworks: evaluateAllFrameworks(checklist),
                   note: "Derived from assessment answers, not estimated." };
        }
        const opts = frameworkOptsFor(a, input.frameworkId);
        const rep = evaluateFramework(input.frameworkId, checklist, opts);
        if (!rep) return { error: `Unknown framework. Available: ${listFrameworkIds().join(", ")}` };
        return {
          client: u.companyName || u.email,
          framework: rep.framework.name,
          summary: rep.summary,
          requirements: rep.requirements.map(r => ({
            id: r.id, name: r.name, section: r.section, status: r.status,
            failingControls: r.failingControls,
          })),
        };
      }
      case "explain_control": {
        const u = resolveClient(input.clientIdOrEmail);
        if (!u) return { error: "Client not found." };
        const list = (db.data.assessments || []).filter(a => a.userId === u.id);
        if (!list.length) return { error: "Client has no assessment — this control cannot be evaluated." };
        const a = list.reduce((b,x)=> !b || new Date(x.updatedAt||x.createdAt) > new Date(b.updatedAt||b.createdAt) ? x : b, null);
        const checklist = a.data?.checklist || a.data?.securityChecklist || {};
        const opts = frameworkOptsFor(a, input.frameworkId);
        const ctx = remediationContext(input.frameworkId, input.requirementId, checklist, opts);
        if (!ctx) {
          const rep = evaluateFramework(input.frameworkId, checklist, opts);
          if (!rep) return { error: `Unknown framework. Available: ${listFrameworkIds().join(", ")}` };
          if (rep.notControlMapped) return { error: `${rep.framework.name} is not control-mapped, so individual controls can't be explained. ${rep.why}` };
          return {
            error: `Requirement '${input.requirementId}' not found in ${rep.framework.name}.`,
            hint: `Valid ids include: ${rep.requirements.slice(0, 8).map(r => r.id).join(", ")}${rep.requirements.length > 8 ? ", …" : ""}`,
            excludedFromScope: (rep.excluded || []).some(e => e.id === input.requirementId)
              ? `'${input.requirementId}' IS in this framework but was scoped OUT for this client. Reason: ${(rep.excluded.find(e => e.id === input.requirementId) || {}).reason}`
              : undefined,
          };
        }
        return {
          client: u.companyName || u.email,
          ...ctx,
          note: "Status and the answers driving it are computed from the client's assessment. Explain what the control asks and what would satisfy it — do not invent a status.",
        };
      }

      case "check_agent_evidence": {
        const u = resolveClient(input.clientIdOrEmail);
        if (!u) return { error: "Client not found." };
        const list = (db.data.assessments || []).filter(a => a.userId === u.id);
        const a = list.length ? list.reduce((b,x)=> !b || new Date(x.updatedAt||x.createdAt) > new Date(b.updatedAt||b.createdAt) ? x : b, null) : null;
        const checklist = a?.data?.checklist || a?.data?.securityChecklist || {};
        const reports = latestReportPerHost(u.id);
        if (!reports.length) {
          return {
            client: u.companyName || u.email,
            reportingHosts: 0,
            note: "No agent reports for this client. Every control answer is self-reported — which is normal, and is what most compliance tooling relies on entirely. Installing the read-only agent would let us corroborate endpoint-observable controls with measured evidence.",
          };
        }
        const evidence = toEvidenceShape(checklist);
        const all = corroborate(reports, evidence);
        return {
          client: u.companyName || u.email,
          summary: corroborationSummary(reports, evidence),
          confirmed: all.filter(c => c.status === "confirmed").map(c => ({
            control: c.question, observes: c.observes, hosts: c.agent.hosts, note: c.note,
          })),
          disputed: all.filter(c => c.status === "disputed").map(c => ({
            control: c.question, clientAnswer: c.clientAnswer,
            agentFound: `${c.agent.pass} pass / ${c.agent.fail} fail / ${c.agent.warn} warn across ${c.agent.hosts} host(s)`,
            note: c.note, limits: c.limits,
          })),
          boundary: "The agent informs; the questionnaire decides. Endpoint telemetry is never promoted to an org-wide control answer, and disputes are surfaced for a human to reconcile — not auto-resolved. Present disputes as findings worth investigating, not as the client being wrong.",
        };
      }

      case "check_framework_scoping": {
        const u = resolveClient(input.clientIdOrEmail);
        if (!u) return { error: "Client not found." };
        const rid = input.frameworkId;
        const intake = intakeFor(rid) || intakeFor(String(rid).replace("iso-27001", "iso27001").replace(/^hipaa$/, "hipaa-security"));
        if (!intake) {
          const def = getFrameworkDef(rid);
          if (!def) return { error: `Unknown framework. Available: ${listFrameworkIds().join(", ")}` };
          return { client: u.companyName || u.email, framework: def.name, hasIntake: false,
                   note: "This framework needs no scoping questionnaire — it assesses the same controls for everyone." };
        }
        const list = (db.data.assessments || []).filter(a => a.userId === u.id);
        const a = list.length ? list.reduce((b,x)=> !b || new Date(x.updatedAt||x.createdAt) > new Date(b.updatedAt||b.createdAt) ? x : b, null) : null;
        const answers = a?.data?.frameworkIntake?.[intake.frameworkId] || {};
        const st = intakeStatus(intake.frameworkId, answers);
        return {
          client: u.companyName || u.email,
          framework: intake.title,
          why: intake.why,
          hasIntake: true,
          status: st,
          answered: answers,
          unanswered: visibleQuestions(intake.frameworkId, answers)
            .filter(q => answers[q.id] === undefined)
            .map(q => ({ id: q.id, question: q.question, help: q.help || null })),
          suggestionNote: intake.suggestionNote || null,
          note: st.complete
            ? "Scoping is complete — this client's assessment reflects their real scope."
            : `Scoping is incomplete, so the assessment used defaults: ${st.defaultIfSkipped} Completing it may substantially change what applies.`,
        };
      }

      case "check_evidence": {
        if (input.clientIdOrEmail) {
          const u = resolveClient(input.clientIdOrEmail);
          if (!u) return { error: "Client not found." };
          const items = (db.data.evidence || []).filter(e => e.ownerUserId === u.id);
          const done = (db.data.tasks || []).filter(t => t.ownerUserId === u.id && t.status === "done");
          const missing = done.filter(t => !items.some(e => e.kind === "task" && e.refId === t.id));
          return {
            client: u.companyName || u.email,
            totalEvidence: items.length,
            completedTasks: done.length,
            withEvidence: done.length - missing.length,
            missingEvidence: missing.length,
            coveragePct: done.length ? Math.round(((done.length - missing.length) / done.length) * 100) : 100,
            tasksMissingProof: missing.slice(0, 15).map(t => ({ title: t.title, completedAt: t.completedAt })),
          };
        }
        return evidenceSummary(db, "summary");
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
      case "get_training": {
        if (input.clientIdOrEmail) {
          const u = resolveClient(input.clientIdOrEmail);
          if (!u) return { error: "Client not found." };
          return { client: u.companyName || u.email, ...clientTrainingSummary(db, u.id, true) };
        }
        return trainingSummary(db, "full");
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

  // Build a snapshot containing ONLY this user's own data, and ONLY the data
  // sections their tier includes. Sections above their tier are omitted from the
  // data entirely (so Mastermind physically cannot leak feature data they lack)
  // and surfaced instead via `featureAccess.missing` so it can explain upgrades.
  function clientSnapshot(db, userId) {
    const user = (db.data.users || []).find(u => u.id === userId);
    const tier = user?.tier && getTier(user.tier).id === user.tier ? user.tier : DEFAULT_TIER;
    const sub = (db.data.subscriptions || []).find(s => s.userId === userId);
    const userAddons = [
      ...(Array.isArray(user?.addons) ? user.addons : []),
      ...(Array.isArray(sub?.addons) ? sub.addons : []),
    ];
    const has = (cap) => hasCapability(tier, cap);
    const access = featureAccess(tier, userAddons);
    const tierObj = getTier(tier);

    const snap = {
      you: {
        tier,
        tierName: tierObj.name,
        // What this client can and cannot use — Mastermind uses this to answer
        // feature questions and to nudge upgrades. Never contains other tiers' data.
        featuresIncluded: access.has,
        featuresNotIncluded: access.missing,
      },
      assessments: (db.data.assessments || [])
        .filter(a => a.userId === userId)
        .map(a => ({ id: a.id, createdAt: a.createdAt, company: a.company?.name || null })),
    };

    // Recommendations that have reached this client (not internal drafts). These
    // exist for any tier that has a program.
    snap.recommendations = (db.data.recommendations || [])
      .filter(r => r.ownerUserId === userId && !["suggested"].includes(r.status))
      .map(r => ({ title: r.title, detail: r.detail, severity: r.severity, status: r.status }));

    // ── Endpoint monitoring (Starter+) ──────────────────────────
    if (has("endpoints")) {
      const agents = (db.data.agents || []).filter(a => a.ownerUserId === userId && a.status !== "revoked");
      const reports = db.data.agentReports || [];
      const latestByAgent = {};
      for (const r of reports) {
        if (r.ownerUserId !== userId) continue;
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
      snap.endpoints = endpoints;
      snap.totals = { endpoints: endpoints.length, atRisk: endpoints.filter(e => e.posture === "at_risk").length };
    }

    // ── Threat intelligence: CVE + dark-web (Growth+) ───────────
    if (has("threatIntel")) {
      const exp = cachedExposure(db, userId);
      const dw = cachedDarkweb(db, userId);
      snap.cveExposure = exp
        ? { counts: exp.counts, top: exp.top, software: exp.software, refreshedAt: exp.refreshedAt, degraded: exp.degraded }
        : { counts: {}, note: "No CVE exposure computed yet." };
      snap.darkWebExposure = dw
        ? { statusLevel: dw.statusLevel, monitored: dw.monitored, domain: dw.domain,
            breachedAccounts: dw.breachedAccounts ?? null, distinctBreaches: dw.distinctBreaches ?? null,
            breaches: dw.breaches || [], reason: dw.reason || null, refreshedAt: dw.refreshedAt }
        : { statusLevel: "Not checked", note: "No breach exposure computed yet." };
    }

    // ── Compliance / framework control status (any tier with a program) ──
    // controlStatus is keyed `${userId}:${frameworkId}:${controlId}`.
    {
      const cs = db.data.controlStatus || {};
      const byFramework = {};
      for (const key of Object.keys(cs)) {
        if (!key.startsWith(userId + ":")) continue;
        const [, frameworkId] = key.split(":");
        (byFramework[frameworkId] ||= { met: 0, partial: 0, unmet: 0, unknown: 0, total: 0 });
        const st = (cs[key]?.status || "unknown").toLowerCase();
        byFramework[frameworkId].total++;
        if (st in byFramework[frameworkId]) byFramework[frameworkId][st]++;
        else byFramework[frameworkId].unknown++;
      }
      if (Object.keys(byFramework).length) snap.complianceByFramework = byFramework;
    }

    // ── Remediation tasks (any tier with a program) ─────────────
    {
      const tasks = (db.data.tasks || []).filter(t => t.ownerUserId === userId);
      if (tasks.length) {
        const open = tasks.filter(t => !["done", "cancelled"].includes(t.status));
        snap.tasks = {
          total: tasks.length,
          open: open.length,
          overdue: open.filter(t => t.dueDate && new Date(t.dueDate) < new Date()).length,
          done: tasks.filter(t => t.status === "done").length,
          topOpen: open.slice(0, 8).map(t => ({ title: t.title, priority: t.priority, status: t.status, dueDate: t.dueDate, controlId: t.controlId })),
        };
      }
    }

    // ── Training PLAN status (Starter+) ─────────────────────────
    if (has("trainingPlan")) {
      const plans = (db.data.trainingPrograms || []).filter(t => t.userId === userId);
      snap.trainingPlan = { generated: plans.length, latest: plans.length ? (plans[plans.length - 1].createdAt || null) : null };
    }

    // ── Training DELIVERY status (Growth+ or Starter w/ add-on) ─
    if (hasTrainingDelivery(tier, userAddons)) {
      const learners = (db.data.learners || []).filter(l => l.clientUserId === userId);
      const assigns = (db.data.trainingAssignments || []).filter(a => a.clientUserId === userId);
      snap.trainingDelivery = {
        learners: learners.length,
        assignments: assigns.length,
        completed: assigns.filter(a => a.status === "completed").length,
        quartersScheduled: (db.data.trainingQuarters || []).filter(q => q.clientUserId === userId).length,
      };
    }

    // ── Analyst support (Guided+) ───────────────────────────────
    if (has("analystSupport")) {
      const assignedAnalysts = (db.data.assignments || [])
        .filter(a => a.clientUserId === userId)
        .map(a => {
          const an = (db.data.users || []).find(u => u.id === a.analystUserId);
          return an ? (an.companyName || an.email) : null;
        })
        .filter(Boolean);
      snap.analystSupport = { level: tierObj.limits?.analystSupport || "none", assignedAnalysts };
    }

    return snap;
  }

  // Capability + auth gate for the client Mastermind. Starter and up can chat;
  // Free is upgrade-gated (a 402 the UI turns into an upgrade prompt).
  function requireClientMastermind(req, res, next) {
    requireAuth(req, res, () => {
      // Staff use the admin console, not this one.
      if (req.isAdmin || req.isAnalyst) {
        return res.status(403).json({ error: "Use the admin Mastermind console." });
      }
      const user = (db.data.users || []).find(u => u.id === req.userId);
      const tier = user?.tier && getTier(user.tier).id === user.tier ? user.tier : DEFAULT_TIER;
      if (!hasCapability(tier, "mastermindChat")) {
        return res.status(402).json({
          error: "Mastermind is available on the Starter plan and above. Upgrade to Starter ($159/mo) to chat with your virtual-CISO assistant.",
          code: "UPGRADE_REQUIRED", capability: "mastermindChat", currentTier: tier, requiresTier: "starter",
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

    // ISOLATION: only this client's own data is ever placed in context, and only
    // for the features their tier includes (see clientSnapshot).
    const snap = clientSnapshot(db, req.userId);
    const system = `You are ShieldAI Mastermind, a virtual-CISO assistant helping ONE client understand and improve THEIR OWN security posture.

ISOLATION — non-negotiable:
- You can see ONLY this client's own data, provided below. You have NO knowledge of any other client, the platform as a whole, or other accounts, and must never speculate about them. If asked about anything outside this client's own security program, say you can only help with their own.

TIER SCOPING — this is critical:
- This client is on the "${snap.you.tierName}" plan. The snapshot's "you.featuresIncluded" lists the features they HAVE; "you.featuresNotIncluded" lists features they do NOT have yet, each with the tier (and price) that unlocks it.
- You may ONLY use and discuss data for features the client HAS. Data for features they lack is deliberately NOT in your context — never invent it, never estimate it, never imply you can see it.
- If the client asks about a feature they do NOT have (it appears in featuresNotIncluded), do this: (1) clearly tell them that feature isn't included in their current ${snap.you.tierName} plan, (2) briefly describe what the feature does and the value it would give them, and (3) tell them exactly how to get it — the plan name and price from featuresNotIncluded (e.g. "upgrading to Growth ($349/mo)"), or the add-on if one is listed. Be encouraging and specific, never pushy. Do NOT reveal or fabricate any data from that feature — you're describing the capability, not showing results.
- Example: a Starter client asks about dark-web breach monitoring → "Breach monitoring isn't part of your Starter plan yet. It scans known data breaches for your company's exposed credentials and alerts you. It's included when you upgrade to Growth ($349/mo) — I'd be glad to explain what it covers."

ADVISORY ONLY:
- You never perform actions on any system or account and never claim to have changed anything. Explain issues and recommend concrete steps the client can take themselves or ask their ShieldAI analyst about. For coverage gaps in features they DO have (e.g. "Not monitored", "Not checked", no endpoints reporting), treat them as gaps to close, not a clean bill of health.

Be clear, practical, and encouraging. Use the client's real data below to answer thoroughly.

This client's data and feature access (the only data you have):
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
