// complianceRoutes.js
// ShieldAI compliance walkthrough + REAL portfolio data.
//
// TWO JOBS
// --------
// 1. /api/compliance/*  — control-by-control framework walkthrough for client,
//    analyst, and admin, with deterministic remediation facts that Mastermind
//    narrates (it never invents the status or the required answer).
//
// 2. /api/portfolio     — REAL analyst portfolio data. The frontend previously
//    rendered a hardcoded SAMPLE_CLIENTS array to every analyst, showing
//    fabricated companies, MRR, and alerts. This endpoint returns each
//    analyst's actual assigned clients, computed from real assessments,
//    agents, and events. Nothing here is invented: if a client has no
//    assessment, posture comes back null and the UI says so.
//
// Mount from server.js:
//   import { registerComplianceRoutes } from "./complianceRoutes.js";
//   registerComplianceRoutes(app, { db, requireAuth, callClaudeText,
//                                   analystOwnsClient, analystClientIds });

import {
  FRAMEWORKS, listFrameworkIds, getFrameworkDef, evaluateFramework,
  evaluateAllFrameworks, remediationContext, STATUS,
} from "./complianceFrameworks.js";
import { computePostureScore } from "./riskEngine.js";

const nowIso = () => new Date().toISOString();

function latestAssessmentFor(db, userId) {
  const list = (db.data.assessments || []).filter(a => a.userId === userId);
  if (!list.length) return null;
  return list.reduce((best, a) =>
    !best || new Date(a.updatedAt || a.createdAt) > new Date(best.updatedAt || best.createdAt) ? a : best, null);
}

function checklistOf(assessment) {
  return assessment?.data?.checklist || assessment?.data?.securityChecklist || {};
}

/**
 * Compliance summary for Mastermind's snapshot.
 * Read-only, compact: how each client stands against each framework.
 */
export function complianceSummary(db, depth = "summary") {
  const users = (db.data.users || []).filter(u => !u.isAdmin && !u.isAnalyst);
  const rows = [];
  for (const u of users) {
    const a = latestAssessmentFor(db, u.id);
    if (!a) continue;
    const checklist = checklistOf(a);
    const frameworks = evaluateAllFrameworks(checklist);
    rows.push({
      client: u.companyName || u.email,
      clientId: u.id,
      frameworks: frameworks.map(f => ({
        short: f.short, compliancePct: f.compliancePct,
        readinessPct: f.readinessPct, gaps: f.gap, unknown: f.unknown,
      })),
    });
  }
  return {
    clientsAssessed: rows.length,
    clientsWithoutAssessment: users.length - rows.length,
    frameworksAvailable: listFrameworkIds().length,
    ...(depth === "full" ? { byClient: rows } : {
      byClient: rows.slice(0, 10),
    }),
  };
}

export function registerComplianceRoutes(app, {
  db, requireAuth, callClaudeText, analystOwnsClient, analystClientIds,
}) {
  const userById = (id) => (db.data.users || []).find(u => u.id === id) || null;

  function canAccess(actor, ownerUserId) {
    if (!actor) return false;
    if (actor.isAdmin) return true;
    if (actor.id === ownerUserId) return true;
    if (actor.isAnalyst && analystOwnsClient) return analystOwnsClient(db, actor.id, ownerUserId);
    return false;
  }

  // ── Framework catalogue ──
  app.get("/api/compliance/frameworks", requireAuth, (req, res) => {
    res.json(Object.values(FRAMEWORKS).map(f => ({
      id: f.id, name: f.name, short: f.short,
      description: f.description, requirementCount: f.requirements.length,
    })));
  });

  // ── Multi-framework overview for one client ──
  app.get("/api/compliance/overview", requireAuth, (req, res) => {
    const targetId = req.query.clientId || req.userId;
    const actor = userById(req.userId);
    if (!canAccess(actor, targetId)) return res.status(403).json({ error: "Not permitted." });

    const a = latestAssessmentFor(db, targetId);
    if (!a) {
      return res.json({
        hasAssessment: false, posture: null, frameworks: [],
        note: "No assessment on file. Compliance can't be determined without answers.",
      });
    }
    const checklist = checklistOf(a);
    const posture = computePostureScore(a.data);
    res.json({
      hasAssessment: true,
      assessedAt: a.updatedAt || a.createdAt,
      posture: { score: posture.postureScore, level: posture.postureLevel },
      frameworks: evaluateAllFrameworks(checklist),
    });
  });

  // ── Control-by-control walkthrough for one framework ──
  app.get("/api/compliance/framework/:id", requireAuth, (req, res) => {
    const targetId = req.query.clientId || req.userId;
    const actor = userById(req.userId);
    if (!canAccess(actor, targetId)) return res.status(403).json({ error: "Not permitted." });

    const def = getFrameworkDef(req.params.id);
    if (!def) return res.status(404).json({ error: "Unknown framework." });

    const a = latestAssessmentFor(db, targetId);
    if (!a) {
      return res.json({
        hasAssessment: false,
        framework: { id: def.id, name: def.name, short: def.short },
        note: "No assessment on file.",
      });
    }
    const report = evaluateFramework(req.params.id, checklistOf(a));
    const client = userById(targetId);
    res.json({
      hasAssessment: true,
      client: { id: targetId, name: client?.companyName || client?.email },
      assessedAt: a.updatedAt || a.createdAt,
      ...report,
    });
  });

  // ── Mastermind remediation for one requirement ──
  // The FACTS are computed deterministically; Mastermind only writes the
  // steps. If the AI is unavailable, we still return the facts.
  app.post("/api/compliance/remediate", requireAuth, async (req, res) => {
    const { frameworkId, requirementId, clientId } = req.body || {};
    const targetId = clientId || req.userId;
    const actor = userById(req.userId);
    if (!canAccess(actor, targetId)) return res.status(403).json({ error: "Not permitted." });

    const a = latestAssessmentFor(db, targetId);
    if (!a) return res.status(400).json({ error: "Client has no assessment." });

    const ctx = remediationContext(frameworkId, requirementId, checklistOf(a));
    if (!ctx) return res.status(400).json({ error: "Unknown framework or requirement." });

    if (ctx.status === STATUS.COMPLIANT) {
      return res.json({
        ...ctx,
        guidance: "This requirement is already satisfied. Attach evidence to prove it at audit.",
        aiGenerated: false,
      });
    }

    const company = a.data?.company || {};
    const failing = ctx.controls.filter(c => !c.meets);

    const prompt = `You are ShieldAI Mastermind advising a virtual CISO.

CLIENT: ${company.name || "the client"}${company.industry ? ` · ${company.industry}` : ""}${company.employees ? ` · ${company.employees} employees` : ""}

FRAMEWORK: ${ctx.framework}
REQUIREMENT: ${ctx.requirement.id} — ${ctx.requirement.name}
"${ctx.requirement.text}"

CURRENT STATUS: ${ctx.status.toUpperCase()}

WHAT IS FAILING (these are facts from the client's assessment — do not dispute or restate them as uncertain):
${failing.map(c => `- ${c.question}\n  Currently: "${c.currentAnswer || "unanswered"}"\n  Needs to be: "${c.requiredAnswer}"`).join("\n")}

Write remediation steps to close this gap. Requirements for your answer:
- 3 to 5 concrete, ordered steps a small business can actually execute.
- Name specific, common tooling where useful (e.g. Microsoft 365, Google Workspace, Duo).
- Include a realistic effort estimate and who should own it.
- End with one line: what evidence to keep to prove this at audit.
- Do NOT invent facts about the client beyond what is given.
- Plain text. No preamble. No markdown headers.`;

    let guidance = null;
    let aiGenerated = false;
    try {
      if (callClaudeText) {
        guidance = await callClaudeText({
          system: "You are ShieldAI Mastermind, a precise virtual-CISO advisor. You state only what the provided facts support. You never invent details about a client.",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 700,
        });
        aiGenerated = true;
      }
    } catch (e) {
      guidance = null;
    }

    if (!guidance) {
      // Deterministic fallback — still useful, still honest.
      guidance = "Steps to close this gap:\n" +
        failing.map((c, i) =>
          `${i + 1}. ${c.question}\n   Move from "${c.currentAnswer || "unanswered"}" to "${c.requiredAnswer}".`
        ).join("\n") +
        "\n\nKeep configuration exports or screenshots as evidence for audit.";
    }

    res.json({ ...ctx, guidance, aiGenerated });
  });

  // ── Update a single control answer (the walkthrough's "fix it" action) ──
  // Re-runs the deterministic engine so posture and compliance both move.
  app.post("/api/compliance/answer", requireAuth, async (req, res) => {
    const { controlId, answer, clientId } = req.body || {};
    const targetId = clientId || req.userId;
    const actor = userById(req.userId);
    if (!canAccess(actor, targetId)) return res.status(403).json({ error: "Not permitted." });

    const a = latestAssessmentFor(db, targetId);
    if (!a) return res.status(400).json({ error: "Client has no assessment." });

    const { SECURITY_CHECKLIST } = await import("./securityChecklist.js");
    const q = SECURITY_CHECKLIST.find(x => x.id === controlId);
    if (!q) return res.status(400).json({ error: "Unknown controlId." });
    if (!q.options.some(o => o.label === answer)) {
      return res.status(400).json({ error: "Not a valid answer for this control." });
    }

    const before = computePostureScore(a.data);
    a.data = a.data || {};
    a.data.checklist = { ...checklistOf(a), [controlId]: answer };
    a.updatedAt = nowIso();
    const after = computePostureScore(a.data);

    db.data.postureHistory ||= [];
    db.data.postureHistory.push({
      id: `ph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: targetId, at: nowIso(),
      score: after.postureScore, level: after.postureLevel,
      reason: `control:${controlId}`,
    });

    await db.write();
    res.json({
      controlId, answer,
      posture: {
        before: before.postureScore, after: after.postureScore,
        delta: after.postureScore - before.postureScore,
        levelBefore: before.postureLevel, levelAfter: after.postureLevel,
      },
      frameworks: evaluateAllFrameworks(checklistOf(a)),
    });
  });

  // ── REAL PORTFOLIO (replaces the hardcoded SAMPLE_CLIENTS) ──
  app.get("/api/portfolio", requireAuth, (req, res) => {
    const actor = userById(req.userId);
    if (!actor || (!actor.isAdmin && !actor.isAnalyst)) {
      return res.status(403).json({ error: "Staff only." });
    }

    const ids = actor.isAdmin
      ? (db.data.users || []).filter(u => !u.isAdmin && !u.isAnalyst).map(u => u.id)
      : (analystClientIds ? analystClientIds(db, actor.id) : []);

    const agents = db.data.agents || [];
    const events = db.data.agentEvents || [];
    const tasks = db.data.tasks || [];
    const history = db.data.postureHistory || [];

    const clients = ids.map(cid => {
      const u = userById(cid);
      if (!u) return null;

      const a = latestAssessmentFor(db, cid);
      const checklist = a ? checklistOf(a) : null;
      const posture = a ? computePostureScore(a.data) : null;

      const myAgents = agents.filter(x => x.ownerUserId === cid && x.status !== "revoked");
      const online = myAgents.filter(x => {
        if (!x.lastSeen) return false;
        return (Date.now() - new Date(x.lastSeen).getTime()) < 15 * 60 * 1000;
      }).length;

      const myEvents = events
        .filter(e => e.ownerUserId === cid && !e.ack)
        .sort((x, y) => new Date(y.ts || y.at) - new Date(x.ts || x.at));

      const myTasks = tasks.filter(t => t.ownerUserId === cid);
      const openTasks = myTasks.filter(t => !["done", "cancelled"].includes(t.status));

      const trend = history
        .filter(h => h.userId === cid)
        .sort((x, y) => new Date(x.at) - new Date(y.at))
        .map(h => h.score);

      return {
        id: cid,
        name: u.companyName || u.email,
        email: u.email,
        industry: a?.data?.company?.industry || null,
        employees: a?.data?.company?.employees || null,
        tier: u.tier || "free",
        // Null means "we don't know" — the UI must say so, not fake a number.
        hasAssessment: !!a,
        posture: posture ? posture.postureScore : null,
        level: posture ? posture.postureLevel : null,
        weakest: posture ? posture.weakestAreas : [],
        assessedAt: a ? (a.updatedAt || a.createdAt) : null,
        history: trend,
        agent: {
          enrolled: myAgents.length,
          online,
          lastSeen: myAgents.reduce((latest, x) =>
            !latest || (x.lastSeen && new Date(x.lastSeen) > new Date(latest)) ? x.lastSeen : latest, null),
        },
        alerts: myEvents.slice(0, 5).map(e => ({
          sev: e.severity, title: e.message, type: e.type, time: e.ts || e.at,
        })),
        alertCounts: {
          high: myEvents.filter(e => e.severity === "high" || e.severity === "critical").length,
          medium: myEvents.filter(e => e.severity === "medium").length,
          low: myEvents.filter(e => e.severity === "low").length,
        },
        tasks: {
          open: openTasks.length,
          overdue: openTasks.filter(t => t.dueDate && new Date(t.dueDate) < new Date()).length,
          done: myTasks.filter(t => t.status === "done").length,
        },
        compliance: checklist ? evaluateAllFrameworks(checklist).map(f => ({
          short: f.short, compliancePct: f.compliancePct, readinessPct: f.readinessPct,
        })) : [],
      };
    }).filter(Boolean);

    const assessed = clients.filter(c => c.hasAssessment);
    res.json({
      clients,
      summary: {
        total: clients.length,
        assessed: assessed.length,
        unassessed: clients.length - assessed.length,
        // Averages only over clients we actually have data for.
        avgPosture: assessed.length
          ? Math.round(assessed.reduce((s, c) => s + c.posture, 0) / assessed.length)
          : null,
        agentsEnrolled: clients.reduce((s, c) => s + c.agent.enrolled, 0),
        agentsOnline: clients.reduce((s, c) => s + c.agent.online, 0),
        highAlerts: clients.reduce((s, c) => s + c.alertCounts.high, 0),
        openTasks: clients.reduce((s, c) => s + c.tasks.open, 0),
        overdueTasks: clients.reduce((s, c) => s + c.tasks.overdue, 0),
      },
    });
  });

  console.log("ShieldAI compliance + portfolio routes registered.");
}
