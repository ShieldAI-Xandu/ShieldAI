// taskRoutes.js
// ShieldAI task / remediation management.
//
// THE CORE IDEA
// -------------
// A task is not a free-floating to-do. Every task targets a specific control in
// the security checklist (`controlId`) and the answer we want to reach
// (`targetLabel`). When the task is completed, we write that answer into the
// assessment's checklist and re-run the deterministic scoring engine. The
// posture score therefore MOVES as work gets done — the closed loop that makes
// the trend chart meaningful.
//
// This preserves ShieldAI's central design property: the score is always
// computed by riskEngine.js from structured answers. Tasks never write a score
// directly, and the AI never invents one.
//
// BONUS: because scoring is deterministic, we can *simulate* a task's effect
// before doing the work (projectedScore) — rank gaps by score improvement.
//
// FINDING-BASED TASKS (no controlId) — the one deliberate exception
// -------------------------------------------------------------------
// A CVE, an exposed subdomain, a breached account, or an overdue vendor
// review doesn't correspond to any checklist control. There's no honest
// answer to "which checklist question does patching CVE-2024-1234 satisfy?" —
// forcing a mapping would let one scan result silently move a checklist
// answer nobody actually re-verified.
//
// So a task may instead carry `findingRef: {sourceType, sourceId, facts}` in
// place of `controlId`. These tasks are real — assignable, trackable,
// completable, deletable — they just never touch the posture score.
// `simulateControlChange()` is never called for them (`projectedGain`/
// `scoreAtCreate` stay null structurally, not by a flag someone could forget
// to set), and completing one skips the checklist write and re-score in
// POST /api/tasks/:id/complete entirely. See that route for the branch.
//
// Mount from server.js:
//   import { registerTaskRoutes } from "./taskRoutes.js";
//   registerTaskRoutes(app, { db, requireAuth, requireAdmin, logClientAction,
//                             analystOwnsClient, analystClientIds });

import { randomUUID } from "crypto";
import { SECURITY_CHECKLIST, SCORING_CHECKLIST } from "./securityChecklist.js";
import { computePostureScore } from "./riskEngine.js";
import { notify } from "./notificationDispatch.js";

const nowIso = () => new Date().toISOString();

export const TASK_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"];
export const TASK_PRIORITIES = ["critical", "high", "medium", "low"];

// What kind of scan/surface a finding-based task came from. Purely
// descriptive — used for icons/labels on the frontend and to distinguish
// finding tasks from each other; never drives scoring.
export const FINDING_SOURCE_TYPES = [
  "cve", "attack-surface", "darkweb", "email-security", "vendor-review",
  "endpoint-vuln",
];

// Default remediation window by priority. Every task gets a due date; the
// client can change it afterwards (PATCH /api/tasks/:id { dueDate }).
export const DEFAULT_DUE_DAYS = { critical: 14, high: 30, medium: 60, low: 90 };

/** ISO timestamp `DEFAULT_DUE_DAYS[priority]` days after `from` (default: now). */
export function defaultDueDate(priority, from = new Date()) {
  const days = DEFAULT_DUE_DAYS[priority] ?? DEFAULT_DUE_DAYS.medium;
  return new Date(new Date(from).getTime() + days * 86400000).toISOString();
}

/**
 * One-time, idempotent backfill: open tasks created before default due dates
 * existed get createdAt + the priority's window. Returns how many changed.
 * Caller is responsible for `await db.write()` when the count is > 0.
 */
export function backfillTaskDueDates(db) {
  db.data.tasks ||= [];
  let n = 0;
  for (const t of db.data.tasks) {
    if (t.dueDate || ["done", "cancelled"].includes(t.status)) continue;
    t.dueDate = defaultDueDate(t.priority, t.createdAt || new Date());
    pushHistory(t, "system", null, "due_date", "default applied");
    n++;
  }
  return n;
}

// ── Control helpers ───────────────────────────────────────────
export function getControl(controlId) {
  return SECURITY_CHECKLIST.find(q => q.id === controlId) || null;
}

/** Score of a given answer label for a control (null if not a valid option). */
function scoreOfLabel(control, label) {
  const opt = control?.options.find(o => o.label === label);
  return opt ? opt.score : null;
}

/** The best (highest-scoring) option for a control. */
function bestOption(control) {
  return [...(control?.options || [])].sort((a, b) => b.score - a.score)[0] || null;
}

// ── Assessment helpers ────────────────────────────────────────
function latestAssessmentFor(db, userId) {
  const list = (db.data.assessments || []).filter(a => a.userId === userId);
  if (!list.length) return null;
  return list.reduce((best, a) =>
    !best || new Date(a.updatedAt || a.createdAt) > new Date(best.updatedAt || best.createdAt) ? a : best, null);
}

function checklistOf(assessment) {
  return assessment?.data?.checklist || assessment?.data?.securityChecklist || {};
}

/** Current posture for a user, or null if they have no assessment. */
export function currentPosture(db, userId) {
  const a = latestAssessmentFor(db, userId);
  if (!a) return null;
  return computePostureScore(a.data);
}

/**
 * Simulate: what would the posture score be if `controlId` were answered
 * `targetLabel`? Returns { current, projected, delta } or null.
 * This is the engine behind "what if I fix this?" — no other vCISO platform
 * ships it, and it's ~free here because scoring is deterministic.
 */
export function simulateControlChange(db, userId, controlId, targetLabel) {
  const assessment = latestAssessmentFor(db, userId);
  if (!assessment) return null;
  const control = getControl(controlId);
  if (!control) return null;
  if (scoreOfLabel(control, targetLabel) === null) return null;

  const before = computePostureScore(assessment.data);
  const simulated = {
    ...assessment.data,
    checklist: { ...checklistOf(assessment), [controlId]: targetLabel },
  };
  const after = computePostureScore(simulated);

  return {
    current: before.postureScore,
    projected: after.postureScore,
    delta: after.postureScore - before.postureScore,
    currentLevel: before.postureLevel,
    projectedLevel: after.postureLevel,
  };
}

// ── Task shape ────────────────────────────────────────────────
function ensure(db) {
  db.data.tasks ||= [];
  return db.data.tasks;
}

// Used by taskTrackerRoutes.js (Jira/Asana/Trello sync) to record/update a
// task's link to an external ticket — exported rather than having that file
// reach into db.data.tasks directly, since this is the one place that owns
// the task shape. Returns the updated task, or null if not found.
export function setTaskExternalRef(db, taskId, ref) {
  const task = ensure(db).find(t => t.id === taskId);
  if (!task) return null;
  task.externalRef = ref; // { provider, connectionId, externalId, externalUrl, syncedAt } or null to unlink
  task.updatedAt = nowIso();
  return task;
}

function publicTask(db, t) {
  const control = getControl(t.controlId);
  return {
    ...t,
    control: control ? {
      id: control.id,
      question: control.question,
      nistFunction: control.nistFunction,
      factor: control.factor,
      options: control.options,
    } : null,
  };
}

export function pushHistory(task, actorType, actorId, action, note) {
  task.history = task.history || [];
  task.history.push({ at: nowIso(), actorType, actorId: actorId || null, action, note: note || "" });
}

/**
 * Read-only task summary for Mastermind's portfolio snapshot.
 * Kept compact: counts + a few notable items, never the full backlog.
 */
export function taskSummary(db, depth = "summary") {
  const tasks = ensure(db);
  const users = db.data.users || [];
  const nameOf = (id) => {
    const u = users.find(x => x.id === id);
    return u ? (u.companyName || u.email) : "—";
  };
  const open = tasks.filter(t => !["done", "cancelled"].includes(t.status));
  const overdue = open.filter(t => t.dueDate && new Date(t.dueDate) < new Date());
  const full = depth === "full";

  return {
    total: tasks.length,
    open: open.length,
    done: tasks.filter(t => t.status === "done").length,
    overdue: overdue.length,
    blocked: open.filter(t => t.status === "blocked").length,
    unassigned: open.filter(t => !t.assigneeUserId).length,
    byPriority: open.reduce((m, t) => { m[t.priority] = (m[t.priority] || 0) + 1; return m; }, {}),
    overdueItems: overdue.slice(0, 10).map(t => ({
      client: nameOf(t.ownerUserId), title: t.title,
      priority: t.priority, dueDate: t.dueDate, status: t.status,
    })),
    ...(full ? {
      items: tasks.slice(-40).map(t => ({
        client: nameOf(t.ownerUserId), title: t.title, status: t.status,
        priority: t.priority, controlId: t.controlId, dueDate: t.dueDate,
        projectedGain: t.projectedGain ?? null,
      })),
    } : {}),
  };
}

// ── Routes ────────────────────────────────────────────────────
export function registerTaskRoutes(app, {
  db, requireAuth, requireAdmin, logClientAction, analystOwnsClient, analystClientIds, gate,
}) {
  ensure(db);

  // Default due dates for tasks that predate them. Only tasks with no date are
  // touched, so it's safe to run on every boot.
  (async () => {
    try {
      if (backfillTaskDueDates(db) > 0) await db.write();
    } catch (e) { console.error("[tasks] due-date backfill failed:", e.message); }
  })();

  const userById =(id) => (db.data.users || []).find(u => u.id === id) || null;

  // Prioritized gaps + remediation tasks are the `remediationTasks` capability
  // (Growth+), matching the Dashboard's Remediation tab. Staff (admin/analyst)
  // bypass via gate.capability's own admin/analyst check. /api/tasks/controls
  // (the checklist question catalogue, used during intake by every tier) and
  // /api/tasks/board (already staff-only, checked inline below) are NOT gated.
  const tasksGate = gate ? gate.capability("remediationTasks") : (req, res, next) => next();

  // Can `actor` act on tasks owned by `ownerUserId`?
  function canAccess(actor, ownerUserId) {
    if (!actor) return false;
    if (actor.isAdmin) return true;
    if (actor.id === ownerUserId) return true;
    if (actor.isAnalyst && analystOwnsClient) return analystOwnsClient(db, actor.id, ownerUserId);
    return false;
  }

  // ── Catalogue of controls (drives the "add task" picker) ──
  app.get("/api/tasks/controls", requireAuth, (req, res) => {
    // Includes evidence-only questions: a client can legitimately open a task
    // against "quarterly access reviews" even though it doesn't move the NIST
    // posture score. `affectsPostureScore` lets the UI set the right
    // expectation rather than implying a gain that will never arrive.
    res.json(SECURITY_CHECKLIST.map(q => ({
      id: q.id, question: q.question, nistFunction: q.nistFunction ?? null,
      factor: q.factor ?? null, options: q.options,
      section: q.section ?? q.nistFunction ?? null,
      affectsPostureScore: q.scoring !== false,
      appliesTo: q.appliesTo ?? null,
    })));
  });

  // ── Gap analysis: every control ranked by score improvement ──
  // This is the "what should I fix first?" engine.
  app.get("/api/tasks/gaps", requireAuth, tasksGate, (req, res) => {
    const targetId = req.query.clientId || req.userId;
    const actor = userById(req.userId);
    if (!canAccess(actor, targetId)) return res.status(403).json({ error: "Not permitted." });

    const assessment = latestAssessmentFor(db, targetId);
    if (!assessment) return res.json({ posture: null, gaps: [], note: "No assessment yet." });

    const posture = computePostureScore(assessment.data);
    const checklist = checklistOf(assessment);

    // SCORING_CHECKLIST only. This endpoint ranks fixes by how much they move
    // the posture score, and evidence-only questions cannot move it by
    // construction — including them would list 22 "improves your score by 0"
    // items and bury the fixes that actually matter. Evidence gaps surface in
    // the per-framework compliance workspace, where they carry real meaning.
    const gaps = SCORING_CHECKLIST.map(control => {
      const currentLabel = checklist[control.id] || null;
      const currentScore = scoreOfLabel(control, currentLabel);
      const best = bestOption(control);
      if (!best) return null;
      // Already optimal → not a gap.
      if (currentScore !== null && currentScore >= best.score) return null;

      const sim = simulateControlChange(db, targetId, control.id, best.label);
      const existing = ensure(db).find(t =>
        t.ownerUserId === targetId && t.controlId === control.id &&
        !["done", "cancelled"].includes(t.status));

      return {
        controlId: control.id,
        question: control.question,
        nistFunction: control.nistFunction,
        currentAnswer: currentLabel,
        currentScore: currentScore ?? 0,
        targetAnswer: best.label,
        targetScore: best.score,
        projectedGain: sim ? sim.delta : 0,
        projectedScore: sim ? sim.projected : posture.postureScore,
        hasOpenTask: !!existing,
        openTaskId: existing?.id || null,
      };
    }).filter(Boolean)
      // Rank by biggest posture improvement per fix.
      .sort((a, b) => b.projectedGain - a.projectedGain);

    res.json({
      posture: { score: posture.postureScore, level: posture.postureLevel,
                 weakestAreas: posture.weakestAreas, mode: posture.scoringMode },
      gaps,
    });
  });

  // ── Live priorities ──
  // Recomputed on every call from the current assessment (same engine and
  // ranking as /api/tasks/gaps) plus the endpoint vulnerabilities the agent
  // currently reports as open. Nothing is cached: when a control is fixed or a
  // vulnerability disappears from the agent's next report it drops off the
  // list, which is what "priorities change as your program improves" means.
  // Deliberately NOT tier-gated (Priorities is shown on every tier); the
  // "Add to Remediation" action is gated by POST /api/tasks as usual.
  app.get("/api/client/priorities", requireAuth, (req, res) => {
    const targetId = req.query.clientId || req.userId;
    const actor = userById(req.userId);
    if (!canAccess(actor, targetId)) return res.status(403).json({ error: "Not permitted." });

    const liveTasks = ensure(db).filter(t =>
      t.ownerUserId === targetId && !["done", "cancelled"].includes(t.status));
    const taskInfo = (t) => t && { id: t.id, createdAt: t.createdAt, status: t.status, dueDate: t.dueDate || null };

    const items = [];

    const assessment = latestAssessmentFor(db, targetId);
    let posture = null;
    if (assessment) {
      const p = computePostureScore(assessment.data);
      posture = { score: p.postureScore, level: p.postureLevel };
      const checklist = checklistOf(assessment);
      for (const control of SCORING_CHECKLIST) {
        const currentLabel = checklist[control.id] || null;
        const currentScore = scoreOfLabel(control, currentLabel);
        const best = bestOption(control);
        if (!best || (currentScore !== null && currentScore >= best.score)) continue;
        const sim = simulateControlChange(db, targetId, control.id, best.label);
        const gain = sim ? sim.delta : 0;
        if (gain <= 0) continue;
        items.push({
          id: `gap:${control.id}`,
          source: "gap",
          title: `Improve: ${control.question}`,
          description: currentLabel
            ? `Currently "${currentLabel}". Moving to "${best.label}" is projected to raise your posture score by ${gain}.`
            : `Not yet answered. Moving to "${best.label}" is projected to raise your posture score by ${gain}.`,
          // Tiering is by real projected posture gain, not a guess.
          priority: gain >= 4 ? "high" : gain >= 2 ? "medium" : "low",
          category: control.nistFunction || "General",
          projectedGain: gain,
          controlId: control.id,
          targetLabel: best.label,
          findingRef: null,
          task: taskInfo(liveTasks.find(t => t.controlId === control.id)),
        });
      }
    }

    for (const v of (db.data.agentVulnerabilities || [])) {
      if (v.ownerUserId !== targetId || v.status !== "open") continue;
      const sourceId = v.dedupeKey || v.id;
      items.push({
        id: `vuln:${v.id}`,
        source: "vulnerability",
        title: v.title,
        description: `${v.detail || ""}${v.host ? ` (host: ${v.host})` : ""}`.trim(),
        priority: TASK_PRIORITIES.includes(v.severity) ? v.severity : "medium",
        category: "Endpoint",
        projectedGain: null,
        controlId: null,
        targetLabel: null,
        findingRef: { sourceType: "endpoint-vuln", sourceId, facts: { kind: v.kind, host: v.host || null, firstSeenAt: v.firstSeenAt } },
        task: taskInfo(liveTasks.find(t => t.findingRef?.sourceType === "endpoint-vuln" && t.findingRef.sourceId === sourceId)),
      });
    }

    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    items.sort((a, b) =>
      order[a.priority] - order[b.priority] ||
      (a.source === b.source ? 0 : a.source === "vulnerability" ? -1 : 1) ||
      (b.projectedGain ?? 0) - (a.projectedGain ?? 0));
    const ranked = items.slice(0, 15).map((it, i) => ({ ...it, rank: i + 1 }));

    res.json({ posture, priorities: ranked, generatedAt: nowIso(),
      note: assessment ? null : "No assessment yet — priorities appear once one is completed." });
  });

  // ── Which findings already have a task? ──
  // Lets Threat Intel / Priorities show "Added to Remediation · <time>" on
  // reopen instead of offering the button again. Includes finished tasks so
  // the state stays truthful ("Completed ..."). Latest task per finding wins.
  app.get("/api/tasks/finding-refs", requireAuth, tasksGate, (req, res) => {
    const targetId = req.query.clientId || req.userId;
    const actor = userById(req.userId);
    if (!canAccess(actor, targetId)) return res.status(403).json({ error: "Not permitted." });

    const map = {};
    for (const t of ensure(db)) {
      if (t.ownerUserId !== targetId || !t.findingRef || t.status === "cancelled") continue;
      const key = `${t.findingRef.sourceType}:${t.findingRef.sourceId}`;
      const prev = map[key];
      const isOpen = t.status !== "done";
      // Prefer an open task over a finished one, then the newest.
      if (prev && (prev._open && !isOpen || (prev._open === isOpen && prev.createdAt >= t.createdAt))) continue;
      map[key] = { taskId: t.id, createdAt: t.createdAt, status: t.status, dueDate: t.dueDate || null,
                   completedAt: t.completedAt || null, _open: isOpen };
    }
    for (const v of Object.values(map)) delete v._open;
    res.json(map);
  });

  // ── Simulate a specific change ──
  app.post("/api/tasks/simulate", requireAuth, tasksGate, (req, res) => {
    const { controlId, targetLabel, clientId } = req.body || {};
    const targetId = clientId || req.userId;
    const actor = userById(req.userId);
    if (!canAccess(actor, targetId)) return res.status(403).json({ error: "Not permitted." });

    const sim = simulateControlChange(db, targetId, controlId, targetLabel);
    if (!sim) return res.status(400).json({ error: "Invalid control, answer, or no assessment." });
    res.json(sim);
  });

  // ── List tasks ──
  app.get("/api/tasks", requireAuth, tasksGate, (req, res) => {
    const actor = userById(req.userId);
    if (!actor) return res.status(404).json({ error: "User not found." });

    let scope;
    if (req.query.clientId) {
      if (!canAccess(actor, req.query.clientId)) return res.status(403).json({ error: "Not permitted." });
      scope = [req.query.clientId];
    } else if (actor.isAdmin) {
      scope = null; // everything
    } else if (actor.isAnalyst && analystClientIds) {
      scope = [...analystClientIds(db, actor.id), actor.id];
    } else {
      scope = [actor.id];
    }

    let list = ensure(db);
    if (scope) list = list.filter(t => scope.includes(t.ownerUserId));
    if (req.query.status) list = list.filter(t => t.status === req.query.status);
    if (req.query.assignee) list = list.filter(t => t.assigneeUserId === req.query.assignee);
    if (req.query.overdue === "true") {
      list = list.filter(t => t.dueDate && new Date(t.dueDate) < new Date() &&
        !["done", "cancelled"].includes(t.status));
    }

    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    list = [...list].sort((a, b) =>
      (order[a.priority] ?? 9) - (order[b.priority] ?? 9) ||
      (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));

    res.json(list.map(t => publicTask(db, t)));
  });

  // ── Create a task ──
  app.post("/api/tasks", requireAuth, tasksGate, async (req, res) => {
    const actor = userById(req.userId);
    const {
      ownerUserId, controlId, targetLabel, findingRef, title, detail,
      priority = "medium", dueDate, assigneeUserId, effort,
    } = req.body || {};

    const owner = ownerUserId || req.userId;
    if (!canAccess(actor, owner)) return res.status(403).json({ error: "Not permitted." });

    if (controlId && findingRef) {
      return res.status(400).json({ error: "Provide controlId or findingRef, not both — a task is scored against a checklist control or tracked as a finding, never both." });
    }

    let control = null, target = null, cleanFindingRef = null;

    if (findingRef) {
      if (!FINDING_SOURCE_TYPES.includes(findingRef.sourceType)) {
        return res.status(400).json({ error: `findingRef.sourceType must be one of: ${FINDING_SOURCE_TYPES.join(", ")}` });
      }
      if (!findingRef.sourceId || typeof findingRef.sourceId !== "string") {
        return res.status(400).json({ error: "findingRef.sourceId is required." });
      }
      cleanFindingRef = {
        sourceType: findingRef.sourceType,
        sourceId: String(findingRef.sourceId).slice(0, 200),
        // Facts are a snapshot for display/context only (e.g. the CVE's
        // description/CVSS at the moment the task was created) — never
        // re-interpreted into a score.
        facts: findingRef.facts && typeof findingRef.facts === "object" ? findingRef.facts : {},
      };
      if (!title) {
        return res.status(400).json({ error: "title is required for a finding-based task." });
      }
      // Idempotent: one live task per finding. A second click (or reopening
      // the modal on a stale page) returns the existing task, not a duplicate.
      const dup = ensure(db).find(t =>
        t.ownerUserId === owner && t.findingRef &&
        t.findingRef.sourceType === cleanFindingRef.sourceType &&
        t.findingRef.sourceId === cleanFindingRef.sourceId &&
        !["done", "cancelled"].includes(t.status));
      if (dup) return res.status(200).json({ ...publicTask(db, dup), deduped: true });
    } else {
      control = getControl(controlId);
      if (!control) return res.status(400).json({ error: "Unknown controlId." });

      target = targetLabel || bestOption(control)?.label;
      if (scoreOfLabel(control, target) === null) {
        return res.status(400).json({ error: "targetLabel is not a valid option for this control." });
      }
    }

    if (!TASK_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `priority must be one of: ${TASK_PRIORITIES.join(", ")}` });
    }
    if (dueDate && Number.isNaN(Date.parse(dueDate))) {
      return res.status(400).json({ error: "dueDate must be an ISO date." });
    }
    if (assigneeUserId && !userById(assigneeUserId)) {
      return res.status(400).json({ error: "assigneeUserId does not exist." });
    }

    // Finding-based tasks never touch the deterministic score — see the
    // "FINDING-BASED TASKS" note at the top of this file. sim stays null,
    // which is what keeps projectedGain/scoreAtCreate honestly null below.
    const sim = cleanFindingRef ? null : simulateControlChange(db, owner, controlId, target);

    const task = {
      id: randomUUID(),
      ownerUserId: owner,
      controlId: cleanFindingRef ? null : controlId,
      targetLabel: cleanFindingRef ? null : target,
      findingRef: cleanFindingRef,
      title: (title || `Improve: ${control?.question}`).slice(0, 160),
      detail: (detail || "").slice(0, 2000),
      nistFunction: control?.nistFunction || null,
      status: "open",
      priority,
      effort: effort || null,
      dueDate: dueDate || defaultDueDate(priority),
      assigneeUserId: assigneeUserId || null,
      createdBy: req.userId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: null,
      // Snapshot of the projected benefit at creation time. Always null for
      // a finding-based task — there is no "projected posture gain" for
      // fixing one CVE, and pretending otherwise would misrepresent what the
      // score actually measures.
      projectedGain: sim ? sim.delta : null,
      scoreAtCreate: sim ? sim.current : null,
      // Set by taskTrackerRoutes.js once this task is synced to an external
      // tracker (Jira/Asana/Trello) — null until then. { provider,
      // connectionId, externalId, externalUrl, externalStatus,
      // externalPriority, syncedAt }. connectionId scopes a re-sync to the
      // same connection it was originally created under, so reconnecting to
      // a different site/workspace/board creates a fresh ticket there
      // instead of pulling status under the wrong connection's credentials.
      // externalStatus/externalPriority are informational only — pulling a
      // status from the tracker never drives this task through the real
      // /complete endpoint (which has posture-scoring side effects); a human
      // still clicks "Mark done" in ShieldAI to actually complete it, same
      // as the Slack/Teams notification buttons never auto-complete a task.
      externalRef: null,
      evidence: [],
      history: [],
    };
    pushHistory(task, actor.isAdmin ? "admin" : actor.isAnalyst ? "analyst" : "client", req.userId, "created",
      sim ? `Projected +${sim.delta} posture.` : "");

    ensure(db).push(task);
    if (logClientAction) {
      try {
        logClientAction(db, { clientUserId: owner, actorUserId: req.userId,
          actorRole: actor.isAdmin ? "admin" : actor.isAnalyst ? "analyst" : "client_admin",
          action: "task_created", detail: task.title });
      } catch { /* non-fatal */ }
    }
    await db.write();
    res.status(201).json(publicTask(db, task));
  });

  // ── Update a task (status, assignee, due date, etc.) ──
  app.patch("/api/tasks/:id", requireAuth, tasksGate, async (req, res) => {
    const actor = userById(req.userId);
    const task = ensure(db).find(t => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found." });
    if (!canAccess(actor, task.ownerUserId)) return res.status(403).json({ error: "Not permitted." });

    const b = req.body || {};
    const actorType = actor.isAdmin ? "admin" : actor.isAnalyst ? "analyst" : "client";

    if (b.status !== undefined) {
      if (!TASK_STATUSES.includes(b.status)) {
        return res.status(400).json({ error: `status must be one of: ${TASK_STATUSES.join(", ")}` });
      }
      // Completion is handled by its own endpoint so the score always moves
      // through one audited path.
      if (b.status === "done" && task.status !== "done") {
        return res.status(400).json({ error: "Use POST /api/tasks/:id/complete to finish a task." });
      }
      if (b.status !== task.status) {
        pushHistory(task, actorType, req.userId, "status", `${task.status} → ${b.status}`);
        task.status = b.status;
      }
    }
    if (b.priority !== undefined) {
      if (!TASK_PRIORITIES.includes(b.priority)) {
        return res.status(400).json({ error: `priority must be one of: ${TASK_PRIORITIES.join(", ")}` });
      }
      task.priority = b.priority;
    }
    if (b.dueDate !== undefined) {
      if (b.dueDate && Number.isNaN(Date.parse(b.dueDate))) {
        return res.status(400).json({ error: "dueDate must be an ISO date." });
      }
      task.dueDate = b.dueDate || null;
      pushHistory(task, actorType, req.userId, "due_date", b.dueDate || "cleared");
    }
    if (b.assigneeUserId !== undefined) {
      if (b.assigneeUserId && !userById(b.assigneeUserId)) {
        return res.status(400).json({ error: "assigneeUserId does not exist." });
      }
      task.assigneeUserId = b.assigneeUserId || null;
      pushHistory(task, actorType, req.userId, "assignee",
        b.assigneeUserId ? (userById(b.assigneeUserId).email) : "unassigned");
    }
    if (b.title !== undefined) task.title = String(b.title).slice(0, 160);
    if (b.detail !== undefined) task.detail = String(b.detail).slice(0, 2000);
    if (b.effort !== undefined) task.effort = b.effort || null;

    task.updatedAt = nowIso();
    await db.write();
    res.json(publicTask(db, task));
  });

  // ── COMPLETE A TASK — the closed loop ──
  // Writes the target answer into the assessment checklist and re-runs the
  // deterministic engine. The posture score moves here, and only here.
  app.post("/api/tasks/:id/complete", requireAuth, tasksGate, async (req, res) => {
    const actor = userById(req.userId);
    const task = ensure(db).find(t => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found." });
    if (!canAccess(actor, task.ownerUserId)) return res.status(403).json({ error: "Not permitted." });
    if (task.status === "done") return res.status(400).json({ error: "Task is already complete." });

    const actorType = actor.isAdmin ? "admin" : actor.isAnalyst ? "analyst" : "client";

    // Finding-based task: mark it done and stop. There is no checklist
    // answer to write back and no score to move — see the "FINDING-BASED
    // TASKS" note at the top of this file. Completing a CVE-remediation task
    // doesn't retroactively prove any checklist answer true; the score stays
    // exactly what the client's own answers say it is.
    if (task.findingRef) {
      task.status = "done";
      task.completedAt = nowIso();
      task.updatedAt = nowIso();
      pushHistory(task, actorType, req.userId, "completed", "Finding remediated (no posture-score effect).");

      if (logClientAction) {
        try {
          logClientAction(db, { clientUserId: task.ownerUserId, actorUserId: req.userId,
            actorRole: actor.isAdmin ? "admin" : actor.isAnalyst ? "analyst" : "client_admin",
            action: "task_completed", detail: task.title });
        } catch { /* non-fatal */ }
      }
      await db.write();

      await notify(db, {
        ownerUserId: task.ownerUserId, event: "task.completed",
        title: `Task completed: ${task.title}`,
        detail: "Finding remediated.",
        severity: "info", actionable: false,
      });

      return res.json({ task: publicTask(db, task), posture: null });
    }

    const assessment = latestAssessmentFor(db, task.ownerUserId);
    if (!assessment) return res.status(400).json({ error: "Client has no assessment to update." });

    const control = getControl(task.controlId);
    if (!control) return res.status(400).json({ error: "Task references an unknown control." });
    if (scoreOfLabel(control, task.targetLabel) === null) {
      return res.status(400).json({ error: "Task target is no longer a valid answer for this control." });
    }

    const before = computePostureScore(assessment.data);

    // Apply the change to the real assessment.
    assessment.data = assessment.data || {};
    assessment.data.checklist = { ...checklistOf(assessment), [task.controlId]: task.targetLabel };
    assessment.updatedAt = nowIso();

    const after = computePostureScore(assessment.data);

    task.status = "done";
    task.completedAt = nowIso();
    task.updatedAt = nowIso();
    task.actualGain = after.postureScore - before.postureScore;
    task.scoreAtComplete = after.postureScore;
    pushHistory(task, actorType, req.userId,
      "completed", `Posture ${before.postureScore} → ${after.postureScore} (${task.actualGain >= 0 ? "+" : ""}${task.actualGain}).`);

    // Record a posture snapshot so the trend chart has real history.
    db.data.postureHistory ||= [];
    db.data.postureHistory.push({
      id: randomUUID(),
      userId: task.ownerUserId,
      at: nowIso(),
      score: after.postureScore,
      level: after.postureLevel,
      reason: `task:${task.id}`,
    });

    if (logClientAction) {
      try {
        logClientAction(db, { clientUserId: task.ownerUserId, actorUserId: req.userId,
          actorRole: actor.isAdmin ? "admin" : actor.isAnalyst ? "analyst" : "client_admin",
          action: "task_completed",
          detail: `${task.title} — posture ${before.postureScore} → ${after.postureScore}` });
      } catch { /* non-fatal */ }
    }
    await db.write();

    // Outbound-only — the task is already done, there's no action left to
    // offer a Slack button for.
    await notify(db, {
      ownerUserId: task.ownerUserId, event: "task.completed",
      title: `Task completed: ${task.title}`,
      detail: `Posture ${before.postureScore} → ${after.postureScore} (${task.actualGain >= 0 ? "+" : ""}${task.actualGain}).`,
      severity: "info", actionable: false,
    });

    res.json({
      task: publicTask(db, task),
      posture: {
        before: before.postureScore, after: after.postureScore,
        delta: after.postureScore - before.postureScore,
        levelBefore: before.postureLevel, levelAfter: after.postureLevel,
      },
    });
  });

  // ── Delete ──
  app.delete("/api/tasks/:id", requireAuth, tasksGate, async (req, res) => {
    const actor = userById(req.userId);
    const list = ensure(db);
    const i = list.findIndex(t => t.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: "Task not found." });
    if (!canAccess(actor, list[i].ownerUserId)) return res.status(403).json({ error: "Not permitted." });
    list.splice(i, 1);
    await db.write();
    res.json({ ok: true });
  });

  // ── Posture history (drives the real trend chart) ──
  app.get("/api/tasks/posture-history", requireAuth, tasksGate, (req, res) => {
    const targetId = req.query.clientId || req.userId;
    const actor = userById(req.userId);
    if (!canAccess(actor, targetId)) return res.status(403).json({ error: "Not permitted." });
    const hist = (db.data.postureHistory || [])
      .filter(h => h.userId === targetId)
      .sort((a, b) => new Date(a.at) - new Date(b.at));
    res.json(hist);
  });

  // ── Cross-portfolio board (admin/analyst) ──
  app.get("/api/tasks/board", requireAuth, (req, res) => {
    const actor = userById(req.userId);
    if (!actor || (!actor.isAdmin && !actor.isAnalyst)) {
      return res.status(403).json({ error: "Staff only." });
    }
    const scope = actor.isAdmin ? null : (analystClientIds ? analystClientIds(db, actor.id) : []);
    let list = ensure(db);
    if (scope) list = list.filter(t => scope.includes(t.ownerUserId));

    const nameOf = (id) => { const u = userById(id); return u ? (u.companyName || u.email) : "—"; };
    const columns = {};
    for (const s of TASK_STATUSES) columns[s] = [];
    for (const t of list) {
      (columns[t.status] ||= []).push({
        ...publicTask(db, t),
        clientName: nameOf(t.ownerUserId),
        assigneeName: t.assigneeUserId ? nameOf(t.assigneeUserId) : null,
        isOverdue: !!(t.dueDate && new Date(t.dueDate) < new Date() &&
                      !["done", "cancelled"].includes(t.status)),
      });
    }
    res.json({ columns, summary: taskSummary(db) });
  });

  console.log("ShieldAI task/remediation routes registered.");
}
