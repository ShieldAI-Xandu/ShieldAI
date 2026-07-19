// trainingProgramRoutes.js
// ShieldAI STANDALONE TRAINING PRODUCT.
//
// This is deliberately self-contained and does NOT overlap with the monitoring
// agent, CVE, evidence, or remediation systems. It has its own vertical:
//
//   learners       — lightweight employee records under a client account. They
//                    are NOT ShieldAI logins; they complete training via a
//                    personal tokenized link. (Confirmed design: "lightweight
//                    learners, no full login.")
//   assignments    — a program (or subset of modules) assigned to a learner,
//                    tracking status, per-module progress, score, timestamps.
//   completion     — served + recorded through a PUBLIC token-gated flow so an
//                    employee needs no account.
//   quarterly      — the client admin schedules a quarter's training manually
//                    from the catalog; a scheduled quarter fans out assignments
//                    to all active learners.
//   reports        — completion / compliance summaries per client, exportable.
//
// The monitoring-agent read-only boundary is untouched because training never
// goes near the endpoint agent — it lives entirely in the browser/dashboard and
// the public learner link. There is no push-to-endpoint and no command channel.
//
// Mount from server.js:
//   import { registerTrainingProgramRoutes } from "./trainingProgramRoutes.js";
//   registerTrainingProgramRoutes(app, { db, requireAuth, requireAdmin,
//     logClientAction, analystOwnsClient, analystClientIds });

import { randomUUID, randomBytes } from "crypto";
import { TRAINING_TOPICS } from "./trainingCatalog.js";

const nowIso = () => new Date().toISOString();
const newToken = () => randomBytes(24).toString("base64url"); // ~32 chars, URL-safe

export const LEARNER_STATUSES = ["active", "inactive"];
export const ASSIGNMENT_STATUSES = ["assigned", "in_progress", "completed", "overdue", "waived"];

// ── db bootstrap ──────────────────────────────────────────────
function ensureCollections(db) {
  db.data.learners            ||= []; // { id, clientUserId, name, email, department, token, status, createdAt }
  db.data.trainingAssignments ||= []; // { id, clientUserId, learnerId, source, title, modules[], status, progress, score, dueDate, assignedBy, assignedAt, startedAt, completedAt, moduleState{}, quarterId? }
  db.data.trainingQuarters    ||= []; // { id, clientUserId, label, year, quarter, topicIds[], dueDate, createdBy, createdAt, learnerCount }
}

// ── scope helpers ─────────────────────────────────────────────
// Resolve which client account a staff request is acting on. A client admin
// acts on themselves; an analyst/admin may pass ?clientId= for a client they own.
function resolveClientScope(db, req, { analystOwnsClient }) {
  const me = (db.data.users || []).find(u => u.id === req.userId);
  const isAdmin = !!me?.isAdmin;
  const isAnalyst = !!me?.isAnalyst;
  const requested = req.query.clientId || req.body?.clientId;

  if (isAdmin) return { clientUserId: requested || req.userId, role: "admin", ok: true };
  if (isAnalyst) {
    if (!requested) return { ok: false, error: "clientId is required for analyst access." };
    if (!analystOwnsClient(db, req.userId, requested)) return { ok: false, error: "Not assigned to that client." };
    return { clientUserId: requested, role: "analyst", ok: true };
  }
  // Plain client admin — always scoped to self; ignore any clientId spoof.
  return { clientUserId: req.userId, role: "client_admin", ok: true };
}

// ── catalog → module list ─────────────────────────────────────
function modulesFromTopics(topicIds) {
  return TRAINING_TOPICS
    .filter(t => topicIds.includes(t.id))
    .map(t => ({ topicId: t.id, title: t.title, audience: t.audience, duration: t.duration, source: t.source }));
}

// Recompute an assignment's rolled-up status/progress/score from moduleState.
function rollup(assignment) {
  const mods = assignment.modules || [];
  const state = assignment.moduleState || {};
  const total = mods.length || 1;
  let done = 0, scoreSum = 0, scoreCount = 0;
  for (const m of mods) {
    const st = state[m.topicId];
    if (st?.completed) {
      done++;
      if (typeof st.score === "number") { scoreSum += st.score; scoreCount++; }
    }
  }
  assignment.progress = Math.round((done / total) * 100);
  assignment.score = scoreCount ? Math.round(scoreSum / scoreCount) : null;

  if (assignment.status === "waived") { /* leave as-is */ }
  else if (done === 0) assignment.status = assignment.startedAt ? "in_progress" : "assigned";
  else if (done >= total) assignment.status = "completed";
  else assignment.status = "in_progress";

  // Overdue only if not complete and past due.
  if (assignment.status !== "completed" && assignment.status !== "waived"
      && assignment.dueDate && new Date(assignment.dueDate) < new Date()) {
    assignment.status = "overdue";
  }
  return assignment;
}

// Public (learner-facing) shape — no internal ids beyond what the flow needs.
function learnerFacing(assignment, learner) {
  return {
    assignmentId: assignment.id,
    learnerName: learner?.name || "",
    title: assignment.title,
    status: assignment.status,
    progress: assignment.progress,
    dueDate: assignment.dueDate || null,
    modules: (assignment.modules || []).map(m => {
      const st = assignment.moduleState?.[m.topicId] || {};
      const topic = TRAINING_TOPICS.find(t => t.id === m.topicId);
      return {
        topicId: m.topicId, title: m.title, audience: m.audience, duration: m.duration,
        source: m.source, objectives: topic?.objectives || [],
        completed: !!st.completed, score: st.score ?? null, completedAt: st.completedAt || null,
      };
    }),
  };
}

// ── Mastermind summaries ──────────────────────────────────────
// Read-only rollups the AI console can reason over. No writes, no actions —
// consistent with the read-only snapshot the other modules provide.
export function clientTrainingSummary(db, clientUserId, full = false) {
  const learners = (db.data.learners || []).filter(l => l.clientUserId === clientUserId);
  const assigns = (db.data.trainingAssignments || []).filter(a => a.clientUserId === clientUserId);
  assigns.forEach(rollup);
  const byStatus = {};
  let scoreSum = 0, scoreCount = 0;
  for (const a of assigns) {
    byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    if (typeof a.score === "number") { scoreSum += a.score; scoreCount++; }
  }
  const completed = byStatus.completed || 0;
  return {
    learners: learners.length,
    activeLearners: learners.filter(l => l.status === "active").length,
    assignments: assigns.length,
    completionRate: assigns.length ? Math.round((completed / assigns.length) * 100) : 0,
    avgScore: scoreCount ? Math.round(scoreSum / scoreCount) : null,
    overdue: byStatus.overdue || 0,
    byStatus,
    quartersScheduled: (db.data.trainingQuarters || []).filter(q => q.clientUserId === clientUserId).length,
    ...(full ? {
      overdueLearners: assigns.filter(a => a.status === "overdue").map(a => {
        const l = (db.data.learners || []).find(x => x.id === a.learnerId);
        return { learner: l?.name || "(removed)", title: a.title, dueDate: a.dueDate };
      }).slice(0, 15),
    } : {}),
  };
}

export function trainingSummary(db, depth = "summary") {
  const learners = db.data.learners || [];
  const assigns = db.data.trainingAssignments || [];
  assigns.forEach(rollup);
  const completed = assigns.filter(a => a.status === "completed").length;
  const overdue = assigns.filter(a => a.status === "overdue").length;
  return {
    totalLearners: learners.length,
    totalAssignments: assigns.length,
    completed,
    overdue,
    completionRate: assigns.length ? Math.round((completed / assigns.length) * 100) : 0,
    quartersScheduled: (db.data.trainingQuarters || []).length,
  };
}

// ──────────────────────────────────────────────────────────────
export function registerTrainingProgramRoutes(app, {
  db, requireAuth, requireAdmin, gate, logClientAction, analystOwnsClient, analystClientIds,
}) {
  ensureCollections(db);

  // Client-facing training DELIVERY gate: passes for Growth+ (bundled) or a
  // Starter who bought the $40 add-on; staff (admin/analyst) always bypass.
  // Falls back to a no-op if gate isn't provided (keeps route registration safe).
  const gateDelivery = (gate && gate.trainingDelivery)
    ? gate.trainingDelivery()
    : (req, res, next) => next();

  // === CATALOG (topics available to assign) ===================
  app.get("/api/training-program/catalog", requireAuth, (req, res) => {
    res.json(TRAINING_TOPICS.map(t => ({
      id: t.id, title: t.title, audience: t.audience, duration: t.duration,
      priority: t.priority, source: t.source, objectives: t.objectives,
    })));
  });

  // === LEARNERS ================================================
  app.get("/api/training-program/learners", requireAuth, (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const list = (db.data.learners || [])
      .filter(l => l.clientUserId === scope.clientUserId)
      .map(l => {
        const assigns = (db.data.trainingAssignments || []).filter(a => a.learnerId === l.id);
        const completed = assigns.filter(a => a.status === "completed").length;
        return {
          id: l.id, name: l.name, email: l.email, department: l.department || "",
          status: l.status, createdAt: l.createdAt,
          assignmentCount: assigns.length, completedCount: completed,
          link: `/train/${l.token}`,
        };
      });
    res.json(list);
  });

  app.post("/api/training-program/learners", requireAuth, gateDelivery, async (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const { name, email, department } = req.body || {};
    if (!name?.trim() || !email?.trim()) return res.status(400).json({ error: "name and email are required." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return res.status(400).json({ error: "Enter a valid email." });

    // Dedupe by email within this client.
    const existing = (db.data.learners || []).find(l =>
      l.clientUserId === scope.clientUserId && l.email.toLowerCase() === email.trim().toLowerCase());
    if (existing) return res.status(409).json({ error: "A learner with that email already exists." });

    const learner = {
      id: randomUUID(), clientUserId: scope.clientUserId,
      name: name.trim(), email: email.trim(), department: (department || "").trim(),
      token: newToken(), status: "active", createdAt: nowIso(),
    };
    db.data.learners.push(learner);
    await db.write();
    logClientAction(db, { clientUserId: scope.clientUserId, actorUserId: req.userId,
      actorRole: scope.role, action: "training_learner_added", detail: `Added learner ${learner.name}.` });
    res.json({ ...learner, link: `/train/${learner.token}` });
  });

  app.patch("/api/training-program/learners/:id", requireAuth, gateDelivery, async (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const learner = (db.data.learners || []).find(l => l.id === req.params.id && l.clientUserId === scope.clientUserId);
    if (!learner) return res.status(404).json({ error: "Learner not found." });
    for (const k of ["name", "email", "department"]) if (typeof req.body?.[k] === "string") learner[k] = req.body[k].trim();
    if (req.body?.status && LEARNER_STATUSES.includes(req.body.status)) learner.status = req.body.status;
    await db.write();
    res.json(learner);
  });

  app.delete("/api/training-program/learners/:id", requireAuth, gateDelivery, async (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const before = (db.data.learners || []).length;
    db.data.learners = (db.data.learners || []).filter(l => !(l.id === req.params.id && l.clientUserId === scope.clientUserId));
    if (db.data.learners.length === before) return res.status(404).json({ error: "Learner not found." });
    // Cascade: remove their assignments too.
    db.data.trainingAssignments = (db.data.trainingAssignments || []).filter(a => a.learnerId !== req.params.id);
    await db.write();
    res.json({ ok: true, deleted: req.params.id });
  });

  // === ASSIGNMENTS =============================================
  // List assignments for the scoped client (optionally filter by learnerId/status).
  app.get("/api/training-program/assignments", requireAuth, (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const learnerMap = new Map((db.data.learners || []).map(l => [l.id, l]));
    let list = (db.data.trainingAssignments || []).filter(a => a.clientUserId === scope.clientUserId);
    if (req.query.learnerId) list = list.filter(a => a.learnerId === req.query.learnerId);
    if (req.query.status) list = list.filter(a => a.status === req.query.status);
    // Refresh overdue status on read.
    list.forEach(rollup);
    res.json(list.map(a => ({
      ...a,
      learnerName: learnerMap.get(a.learnerId)?.name || "(removed)",
      learnerEmail: learnerMap.get(a.learnerId)?.email || "",
    })));
  });

  // Create assignment(s): assign a set of catalog topics to one or more learners.
  app.post("/api/training-program/assignments", requireAuth, gateDelivery, async (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const { learnerIds, topicIds, title, dueDate } = req.body || {};
    if (!Array.isArray(learnerIds) || !learnerIds.length) return res.status(400).json({ error: "Select at least one learner." });
    if (!Array.isArray(topicIds) || !topicIds.length) return res.status(400).json({ error: "Select at least one topic." });

    const modules = modulesFromTopics(topicIds);
    if (!modules.length) return res.status(400).json({ error: "No valid topics selected." });

    const created = [];
    for (const learnerId of learnerIds) {
      const learner = (db.data.learners || []).find(l => l.id === learnerId && l.clientUserId === scope.clientUserId);
      if (!learner) continue;
      const a = {
        id: randomUUID(), clientUserId: scope.clientUserId, learnerId,
        source: "manual", title: title?.trim() || `Security Training (${modules.length} module${modules.length !== 1 ? "s" : ""})`,
        modules, moduleState: {}, status: "assigned", progress: 0, score: null,
        dueDate: dueDate || null, assignedBy: req.userId, assignedByRole: scope.role,
        assignedAt: nowIso(), startedAt: null, completedAt: null,
      };
      db.data.trainingAssignments.push(a);
      created.push(a);
    }
    await db.write();
    logClientAction(db, { clientUserId: scope.clientUserId, actorUserId: req.userId, actorRole: scope.role,
      action: "training_assigned", detail: `Assigned ${modules.length} module(s) to ${created.length} learner(s).` });
    res.json({ ok: true, created: created.length, assignments: created });
  });

  // Update an assignment (due date, waive, cancel).
  app.patch("/api/training-program/assignments/:id", requireAuth, gateDelivery, async (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const a = (db.data.trainingAssignments || []).find(x => x.id === req.params.id && x.clientUserId === scope.clientUserId);
    if (!a) return res.status(404).json({ error: "Assignment not found." });
    if (req.body?.dueDate !== undefined) a.dueDate = req.body.dueDate || null;
    if (req.body?.status === "waived") { a.status = "waived"; a.waivedBy = req.userId; a.waivedAt = nowIso(); }
    rollup(a);
    await db.write();
    logClientAction(db, { clientUserId: scope.clientUserId, actorUserId: req.userId, actorRole: scope.role,
      action: "training_assignment_updated", detail: `Updated assignment "${a.title}".` });
    res.json(a);
  });

  app.delete("/api/training-program/assignments/:id", requireAuth, gateDelivery, async (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const before = (db.data.trainingAssignments || []).length;
    db.data.trainingAssignments = (db.data.trainingAssignments || []).filter(
      a => !(a.id === req.params.id && a.clientUserId === scope.clientUserId));
    if (db.data.trainingAssignments.length === before) return res.status(404).json({ error: "Assignment not found." });
    await db.write();
    res.json({ ok: true, deleted: req.params.id });
  });

  // Staff can send a reminder (records an action; email delivery is out of scope here).
  app.post("/api/training-program/assignments/:id/remind", requireAuth, gateDelivery, async (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const a = (db.data.trainingAssignments || []).find(x => x.id === req.params.id && x.clientUserId === scope.clientUserId);
    if (!a) return res.status(404).json({ error: "Assignment not found." });
    const learner = (db.data.learners || []).find(l => l.id === a.learnerId);
    a.lastReminderAt = nowIso();
    await db.write();
    logClientAction(db, { clientUserId: scope.clientUserId, actorUserId: req.userId, actorRole: scope.role,
      action: "training_reminder_sent", detail: `Reminder for "${a.title}" to ${learner?.name || "learner"}.` });
    res.json({ ok: true, learnerLink: learner ? `/train/${learner.token}` : null, remindedAt: a.lastReminderAt });
  });

  // === QUARTERLY SCHEDULING ====================================
  app.get("/api/training-program/quarters", requireAuth, (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    res.json((db.data.trainingQuarters || []).filter(q => q.clientUserId === scope.clientUserId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  });

  // Schedule a quarter: fan out an assignment of the chosen topics to every
  // active learner. Admin-scheduled, manual (confirmed cadence choice).
  app.post("/api/training-program/quarters", requireAuth, gateDelivery, async (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const { year, quarter, topicIds, dueDate, label } = req.body || {};
    if (!Array.isArray(topicIds) || !topicIds.length) return res.status(400).json({ error: "Select at least one topic." });
    if (!year || !quarter) return res.status(400).json({ error: "year and quarter are required." });

    const modules = modulesFromTopics(topicIds);
    const activeLearners = (db.data.learners || []).filter(l => l.clientUserId === scope.clientUserId && l.status === "active");

    const quarterRec = {
      id: randomUUID(), clientUserId: scope.clientUserId,
      label: label?.trim() || `Q${quarter} ${year} Training`,
      year, quarter, topicIds, dueDate: dueDate || null,
      createdBy: req.userId, createdAt: nowIso(), learnerCount: activeLearners.length,
    };
    db.data.trainingQuarters.push(quarterRec);

    for (const learner of activeLearners) {
      db.data.trainingAssignments.push({
        id: randomUUID(), clientUserId: scope.clientUserId, learnerId: learner.id,
        source: "quarterly", quarterId: quarterRec.id, title: quarterRec.label,
        modules, moduleState: {}, status: "assigned", progress: 0, score: null,
        dueDate: quarterRec.dueDate, assignedBy: req.userId, assignedByRole: scope.role,
        assignedAt: nowIso(), startedAt: null, completedAt: null,
      });
    }
    await db.write();
    logClientAction(db, { clientUserId: scope.clientUserId, actorUserId: req.userId, actorRole: scope.role,
      action: "training_quarter_scheduled",
      detail: `Scheduled "${quarterRec.label}" for ${activeLearners.length} learner(s).` });
    res.json({ ok: true, quarter: quarterRec, assigned: activeLearners.length });
  });

  // === REPORTS / OVERVIEW ======================================
  // Rolled-up completion stats for the scoped client — powers dashboards + export.
  app.get("/api/training-program/overview", requireAuth, (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const learners = (db.data.learners || []).filter(l => l.clientUserId === scope.clientUserId);
    const assigns = (db.data.trainingAssignments || []).filter(a => a.clientUserId === scope.clientUserId);
    assigns.forEach(rollup);

    const byStatus = { assigned: 0, in_progress: 0, completed: 0, overdue: 0, waived: 0 };
    let scoreSum = 0, scoreCount = 0;
    for (const a of assigns) {
      byStatus[a.status] = (byStatus[a.status] || 0) + 1;
      if (typeof a.score === "number") { scoreSum += a.score; scoreCount++; }
    }
    const total = assigns.length || 0;
    const completionRate = total ? Math.round((byStatus.completed / total) * 100) : 0;

    res.json({
      learnerCount: learners.length,
      activeLearners: learners.filter(l => l.status === "active").length,
      assignmentCount: total,
      completionRate,
      avgScore: scoreCount ? Math.round(scoreSum / scoreCount) : null,
      byStatus,
      overdue: byStatus.overdue,
      quarters: (db.data.trainingQuarters || []).filter(q => q.clientUserId === scope.clientUserId).length,
    });
  });

  // Detailed per-learner report (for export / compliance evidence).
  app.get("/api/training-program/report", requireAuth, (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const learners = (db.data.learners || []).filter(l => l.clientUserId === scope.clientUserId);
    const assigns = (db.data.trainingAssignments || []).filter(a => a.clientUserId === scope.clientUserId);
    assigns.forEach(rollup);
    const rows = learners.map(l => {
      const la = assigns.filter(a => a.learnerId === l.id);
      const completed = la.filter(a => a.status === "completed");
      const scores = completed.map(a => a.score).filter(s => typeof s === "number");
      return {
        learner: l.name, email: l.email, department: l.department || "",
        assigned: la.length, completed: completed.length,
        completionRate: la.length ? Math.round((completed.length / la.length) * 100) : 0,
        avgScore: scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null,
        overdue: la.filter(a => a.status === "overdue").length,
        lastCompletedAt: completed.map(a => a.completedAt).filter(Boolean).sort().pop() || null,
      };
    });
    res.json({ generatedAt: nowIso(), clientUserId: scope.clientUserId, rows });
  });

  // Admin/mastermind: fleet-wide training snapshot across all clients.
  app.get("/api/admin/training-program/overview", requireAdmin, (req, res) => {
    const learners = db.data.learners || [];
    const assigns = db.data.trainingAssignments || [];
    assigns.forEach(rollup);
    const clients = {};
    for (const a of assigns) {
      clients[a.clientUserId] ||= { clientUserId: a.clientUserId, assigned: 0, completed: 0, overdue: 0 };
      clients[a.clientUserId].assigned++;
      if (a.status === "completed") clients[a.clientUserId].completed++;
      if (a.status === "overdue") clients[a.clientUserId].overdue++;
    }
    const userMap = new Map((db.data.users || []).map(u => [u.id, u]));
    const perClient = Object.values(clients).map(c => ({
      ...c,
      company: userMap.get(c.clientUserId)?.companyName || userMap.get(c.clientUserId)?.email || "(unknown)",
      completionRate: c.assigned ? Math.round((c.completed / c.assigned) * 100) : 0,
    }));
    res.json({
      totalLearners: learners.length,
      totalAssignments: assigns.length,
      completed: assigns.filter(a => a.status === "completed").length,
      overdue: assigns.filter(a => a.status === "overdue").length,
      perClient: perClient.sort((a, b) => b.assigned - a.assigned),
    });
  });

  // === PUBLIC LEARNER FLOW (no auth — token-gated) =============
  // The employee opens /train/:token in a browser. These endpoints back it.
  function learnerByToken(token) {
    return (db.data.learners || []).find(l => l.token === token) || null;
  }

  // Fetch the learner's assignments + profile.
  app.get("/api/train/:token", (req, res) => {
    const learner = learnerByToken(req.params.token);
    if (!learner) return res.status(404).json({ error: "This training link isn't valid." });
    if (learner.status !== "active") return res.status(403).json({ error: "This training account is inactive." });
    const assigns = (db.data.trainingAssignments || []).filter(a => a.learnerId === learner.id);
    assigns.forEach(rollup);
    res.json({
      learner: { name: learner.name, department: learner.department || "" },
      assignments: assigns
        .sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt))
        .map(a => learnerFacing(a, learner)),
    });
  });

  // Mark a module complete (with an optional quiz score 0–100).
  app.post("/api/train/:token/complete", async (req, res) => {
    const learner = learnerByToken(req.params.token);
    if (!learner) return res.status(404).json({ error: "This training link isn't valid." });
    if (learner.status !== "active") return res.status(403).json({ error: "This training account is inactive." });
    const { assignmentId, topicId, score } = req.body || {};
    const a = (db.data.trainingAssignments || []).find(x => x.id === assignmentId && x.learnerId === learner.id);
    if (!a) return res.status(404).json({ error: "Assignment not found." });
    const mod = (a.modules || []).find(m => m.topicId === topicId);
    if (!mod) return res.status(404).json({ error: "Module not found in this assignment." });

    a.moduleState ||= {};
    if (!a.startedAt) a.startedAt = nowIso();
    a.moduleState[topicId] = {
      completed: true,
      score: (typeof score === "number" && score >= 0 && score <= 100) ? Math.round(score) : null,
      completedAt: nowIso(),
    };
    const wasComplete = a.status === "completed";
    rollup(a);
    if (a.status === "completed" && !wasComplete) {
      a.completedAt = nowIso();
      logClientAction(db, { clientUserId: a.clientUserId, actorUserId: null, actorRole: "learner",
        action: "training_completed", detail: `${learner.name} completed "${a.title}".` });
    }
    await db.write();
    res.json({ ok: true, assignment: learnerFacing(a, learner) });
  });
}
