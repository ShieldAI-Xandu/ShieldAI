// complianceCalendarRoutes.js
// Compliance calendar — gap #5 from the 2026-07-25 audit ("no unified view of
// what's coming due"). Two things feed it:
//
//   1. AUTO-SURFACED items pulled live from data that already exists
//      elsewhere in the product — nothing is duplicated or re-entered:
//        - vendor reassessment due dates (vendorRiskService.js)
//        - pending policy acknowledgments (policyAcknowledgmentRoutes.js)
//        - training assignment due dates (trainingProgramRoutes.js)
//      Each of those features is gated at its own source (vendorRegistry,
//      employeeRoster, trainingDelivery respectively) — this file doesn't
//      re-check those capabilities, it just reads whatever's already there,
//      so the calendar naturally reflects what a client actually has access
//      to without needing to know about tiers itself.
//   2. CUSTOM entries the client types in for things ShieldAI has no way to
//      know automatically — insurance renewal, business license, a signed
//      audit date, a contract renewal. This is the catch-all layer.
//
// Real-data-over-fabrication, applied here: every auto-surfaced item traces
// to a real record with a real date. Nothing here estimates or invents a due
// date that isn't already computed by its owning feature.
//
// Mount from server.js:
//   import { registerComplianceCalendarRoutes } from "./complianceCalendarRoutes.js";
//   registerComplianceCalendarRoutes(app, { db, requireAuth, gate, analystOwnsClient });

import { randomUUID } from "crypto";
import { dueStatus, updateVendor } from "./vendorRiskService.js";
import { getTier } from "./tiers.js";
import { applyAssignmentEdit } from "./trainingProgramRoutes.js";
import { pushHistory } from "./taskRoutes.js";

const nowIso = () => new Date().toISOString();
const DAY_MS = 24 * 60 * 60 * 1000;

// Every item the unified view returns is keyed "sourceType:rawId" so a later
// PATCH/DELETE knows which table to touch without a second lookup. A bare id
// with no prefix is treated as "custom" for back-compat.
function parseCompositeId(raw) {
  const s = String(raw || "");
  const i = s.indexOf(":");
  if (i < 0) return { sourceType: "custom", rawId: s };
  return { sourceType: s.slice(0, i), rawId: s.slice(i + 1) };
}

export const CALENDAR_CATEGORIES = ["insurance", "license", "audit", "contract", "regulatory", "other"];

function ensureCollections(db) {
  db.data.complianceCalendarEntries ||= [];
  // { id, userId, title, category, dueDate, recurrenceMonths, notes,
  //   completedAt, createdAt, updatedAt, createdByStaff }
}

// Same resolveTarget contract as domainRoutes.js/vendorRoutes.js — duplicated
// locally per this codebase's established convention (each feature route
// file owns its own copy).
function resolveTarget(req, res, db, analystOwnsClient, id) {
  if (!id || id === req.userId) return req.userId;
  if (!req.isAdmin && !req.isAnalyst) {
    res.status(403).json({ error: "Not permitted." });
    return null;
  }
  if (req.isAnalyst && !req.isAdmin && analystOwnsClient && !analystOwnsClient(db, req.userId, id)) {
    res.status(403).json({ error: "This client is not assigned to you." });
    return null;
  }
  return id;
}

function clampEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function addMonths(dateIso, months) {
  const d = new Date(dateIso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

// Counts toward the plan's calendar-entry cap — same "completing something
// frees its slot" spirit as vendorRoutes.js's countActiveVendors. Without
// excluding completed one-off entries, a client who's simply used the
// feature for a while (each completed, non-recurring reminder stays in the
// collection forever) permanently loses the ability to add new ones even
// though nothing is actually still pending.
function countActiveCustomEntries(db, userId) {
  return (db.data.complianceCalendarEntries || []).filter(e => e.userId === userId && !e.completedAt).length;
}

export function registerComplianceCalendarRoutes(app, { db, requireAuth, gate, analystOwnsClient, logClientAction }) {
  ensureCollections(db);

  const gateCalendar = (gate && gate.capability) ? gate.capability("complianceCalendar") : (req, res, next) => next();
  const gateCalendarLimit = (gate && gate.limit) ? gate.limit("calendarEntries", countActiveCustomEntries) : (req, res, next) => next();

  // ── The unified view ─────────────────────────────────────────
  app.get("/api/client/calendar", requireAuth, gateCalendar, (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.query.userId);
    if (!targetId) return;

    const items = [];

    // Custom entries
    for (const e of (db.data.complianceCalendarEntries || [])) {
      if (e.userId !== targetId) continue;
      items.push({
        id: `custom:${e.id}`, sourceType: "custom", title: e.title, category: e.category,
        dueDate: e.dueDate, reviewStatus: e.completedAt ? "current" : dueStatus(e.dueDate),
        detailPath: null, notes: e.notes || "", recurrenceMonths: e.recurrenceMonths || null,
        completedAt: e.completedAt || null, editable: true, removable: true,
      });
    }

    // Vendor reassessments — reads vendorRiskService's own data shape
    // directly rather than re-deriving it, so the two stay in lockstep.
    for (const v of (db.data.vendors || [])) {
      if (v.userId !== targetId || v.status !== "active") continue;
      items.push({
        id: `vendor:${v.id}`, sourceType: "vendor", title: `Reassess vendor: ${v.name}`, category: "vendor",
        dueDate: v.nextReassessmentDue, reviewStatus: dueStatus(v.nextReassessmentDue),
        detailPath: "vendors", notes: `Criticality: ${v.criticality}`, recurrenceMonths: v.reassessmentIntervalMonths || null,
        completedAt: null, editable: true, removable: false,
      });
    }

    // Pending policy acknowledgments — real due date since Phase 1 added one.
    for (const p of (db.data.policyAcknowledgments || [])) {
      if (p.clientUserId !== targetId || p.acknowledgedAt) continue;
      items.push({
        id: `policy:${p.id}`, sourceType: "policy", title: `Policy sign-off pending: ${p.learnerName}`, category: "policy",
        dueDate: p.dueDate || null, reviewStatus: dueStatus(p.dueDate),
        detailPath: "library", notes: p.policyName, recurrenceMonths: null, completedAt: null,
        editable: true, removable: true,
      });
    }

    // Training assignments with a due date, not yet completed.
    for (const a of (db.data.trainingAssignments || [])) {
      if (a.clientUserId !== targetId || a.status === "completed" || a.status === "waived" || !a.dueDate) continue;
      items.push({
        id: `training:${a.id}`, sourceType: "training", title: `Training due: ${a.title}`, category: "training",
        dueDate: a.dueDate, reviewStatus: dueStatus(a.dueDate),
        detailPath: "trainingmgr", notes: `${a.progress || 0}% complete`, recurrenceMonths: null, completedAt: null,
        editable: true, removable: true,
      });
    }

    // Open tasks with a due date — the one source that wasn't surfaced here at all.
    for (const t of (db.data.tasks || [])) {
      if (t.ownerUserId !== targetId || t.status === "done" || t.status === "cancelled" || !t.dueDate) continue;
      items.push({
        id: `task:${t.id}`, sourceType: "task", title: `Task due: ${t.title}`, category: "task",
        dueDate: t.dueDate, reviewStatus: dueStatus(t.dueDate),
        detailPath: "remediation", notes: t.priority ? `Priority: ${t.priority}` : "", recurrenceMonths: null,
        completedAt: null, editable: true, removable: false,
      });
    }

    const order = { overdue: 0, due_soon: 1, not_set: 2, current: 3 };
    items.sort((a, b) => {
      const byStatus = (order[a.reviewStatus] ?? 9) - (order[b.reviewStatus] ?? 9);
      if (byStatus !== 0) return byStatus;
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return ad - bd;
    });

    const summary = { overdue: 0, dueSoon: 0, current: 0, total: items.length };
    for (const it of items) {
      if (it.reviewStatus === "overdue") summary.overdue++;
      else if (it.reviewStatus === "due_soon") summary.dueSoon++;
      else summary.current++;
    }

    res.json({ items, summary, limits: { calendarEntries: gate?.tierOf ? getTier(gate.tierOf(targetId)).limits?.calendarEntries ?? null : null } });
  });

  // ── Custom entries: create ───────────────────────────────────
  app.post("/api/client/calendar", requireAuth, gateCalendar, gateCalendarLimit, async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.body?.userId);
    if (!targetId) return;
    const title = String(req.body?.title || "").trim();
    const dueDate = req.body?.dueDate;
    if (!title) return res.status(400).json({ error: "A title is required." });
    if (!dueDate || isNaN(new Date(dueDate).getTime())) return res.status(400).json({ error: "A valid due date is required." });

    const recurrenceMonths = Number(req.body?.recurrenceMonths) > 0 ? Number(req.body.recurrenceMonths) : null;
    const entry = {
      id: randomUUID(), userId: targetId,
      title: title.slice(0, 200),
      category: clampEnum(req.body?.category, CALENDAR_CATEGORIES, "other"),
      dueDate: new Date(dueDate).toISOString(),
      recurrenceMonths,
      notes: String(req.body?.notes || "").slice(0, 1000),
      completedAt: null,
      createdAt: nowIso(), updatedAt: nowIso(),
      createdByStaff: targetId !== req.userId ? req.userId : null,
    };
    db.data.complianceCalendarEntries.push(entry);
    await db.write();
    res.json({ ...entry, id: `custom:${entry.id}` });
  });

  // ── Reschedule ────────────────────────────────────────────────
  // Every source type is editable from the calendar, but each writes back to
  // its OWN real record — the calendar is never a second source of truth for
  // a date that already lives somewhere else.
  app.patch("/api/client/calendar/:id", requireAuth, gateCalendar, async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.body?.userId);
    if (!targetId) return;
    const { sourceType, rawId } = parseCompositeId(req.params.id);
    const actorRole = req.isAdmin ? "admin" : req.isAnalyst ? "analyst" : "client_admin";

    if (sourceType === "training") {
      const a = (db.data.trainingAssignments || []).find(x => x.id === rawId && x.clientUserId === targetId);
      if (!a) return res.status(404).json({ error: "Not found." });
      if (req.body?.dueDate !== undefined && req.body.dueDate && isNaN(new Date(req.body.dueDate).getTime())) {
        return res.status(400).json({ error: "dueDate must be a valid date." });
      }
      applyAssignmentEdit(db, {
        assignment: a, body: { dueDate: req.body?.dueDate }, actorUserId: req.userId, actorRole, logClientAction,
      });
      await db.write();
      return res.json({ id: req.params.id, sourceType, dueDate: a.dueDate });
    }

    if (sourceType === "policy") {
      const row = (db.data.policyAcknowledgments || []).find(x => x.id === rawId && x.clientUserId === targetId);
      if (!row) return res.status(404).json({ error: "Not found." });
      if (req.body?.dueDate !== undefined) {
        if (req.body.dueDate && isNaN(new Date(req.body.dueDate).getTime())) {
          return res.status(400).json({ error: "dueDate must be a valid date." });
        }
        row.dueDate = req.body.dueDate || null;
      }
      await db.write();
      return res.json({ id: req.params.id, sourceType, dueDate: row.dueDate });
    }

    if (sourceType === "vendor") {
      const v = (db.data.vendors || []).find(x => x.id === rawId && x.userId === targetId);
      if (!v) return res.status(404).json({ error: "Not found." });
      if (!req.body?.dueDate || isNaN(new Date(req.body.dueDate).getTime())) {
        return res.status(400).json({ error: "A valid due date is required." });
      }
      // nextReassessmentDue is always derived from lastAssessedAt +
      // reassessmentIntervalMonths (vendorRiskService.js) — never settable
      // directly. Translate the requested date into an interval from the
      // last assessment so there's still exactly one source of truth.
      const baseline = v.lastAssessedAt || v.contractStartDate || v.createdAt || nowIso();
      const months = Math.max(1, Math.round((new Date(req.body.dueDate) - new Date(baseline)) / (30.44 * DAY_MS)));
      updateVendor(db, targetId, rawId, { reassessmentIntervalMonths: months });
      await db.write();
      const updated = (db.data.vendors || []).find(x => x.id === rawId);
      return res.json({ id: req.params.id, sourceType, dueDate: updated.nextReassessmentDue });
    }

    if (sourceType === "task") {
      const t = (db.data.tasks || []).find(x => x.id === rawId && x.ownerUserId === targetId);
      if (!t) return res.status(404).json({ error: "Not found." });
      if (req.body?.dueDate !== undefined) {
        if (req.body.dueDate && Number.isNaN(Date.parse(req.body.dueDate))) {
          return res.status(400).json({ error: "dueDate must be an ISO date." });
        }
        t.dueDate = req.body.dueDate || null;
        t.updatedAt = nowIso();
        // Same history entry taskRoutes.js's own PATCH /api/tasks/:id writes
        // for a dueDate change — a reschedule from the calendar shouldn't be
        // invisible in the task's own audit trail.
        const taskActorType = req.isAdmin ? "admin" : req.isAnalyst ? "analyst" : "client";
        pushHistory(t, taskActorType, req.userId, "due_date", req.body.dueDate || "cleared");
      }
      await db.write();
      return res.json({ id: req.params.id, sourceType, dueDate: t.dueDate });
    }

    // Custom entries — the original behavior, every field editable.
    const entry = (db.data.complianceCalendarEntries || []).find(e => e.id === rawId && e.userId === targetId);
    if (!entry) return res.status(404).json({ error: "Not found." });

    if (req.body?.title !== undefined) {
      const t = String(req.body.title).trim();
      if (t) entry.title = t.slice(0, 200);
    }
    if (req.body?.category !== undefined) entry.category = clampEnum(req.body.category, CALENDAR_CATEGORIES, entry.category);
    if (req.body?.dueDate !== undefined && !isNaN(new Date(req.body.dueDate).getTime())) entry.dueDate = new Date(req.body.dueDate).toISOString();
    if (req.body?.recurrenceMonths !== undefined) {
      const n = Number(req.body.recurrenceMonths);
      entry.recurrenceMonths = n > 0 ? n : null;
    }
    if (req.body?.notes !== undefined) entry.notes = String(req.body.notes).slice(0, 1000);
    entry.updatedAt = nowIso();
    await db.write();
    res.json({ ...entry, id: `custom:${entry.id}` });
  });

  // ── Custom entries: mark this cycle done (recompute next date if recurring) ──
  // Only custom reminders are "completed" through the calendar — every other
  // source type has its own real completion action (acknowledge a policy,
  // finish training, close a task, reassess a vendor) that the calendar
  // reads from, not writes to.
  app.post("/api/client/calendar/:id/complete", requireAuth, gateCalendar, async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.body?.userId);
    if (!targetId) return;
    const { sourceType, rawId } = parseCompositeId(req.params.id);
    if (sourceType !== "custom") {
      return res.status(400).json({ error: "Only custom reminders can be marked done from the calendar." });
    }
    const entry = (db.data.complianceCalendarEntries || []).find(e => e.id === rawId && e.userId === targetId);
    if (!entry) return res.status(404).json({ error: "Not found." });

    entry.completedAt = nowIso();
    if (entry.recurrenceMonths) {
      // Recurring: roll the due date forward and clear completedAt so it
      // reappears as an upcoming item on its next cycle, same pattern as
      // vendor reassessment.
      entry.dueDate = addMonths(entry.dueDate, entry.recurrenceMonths);
      entry.completedAt = null;
    }
    entry.updatedAt = nowIso();
    await db.write();
    res.json({ ...entry, id: `custom:${entry.id}` });
  });

  // ── Remove from calendar ──────────────────────────────────────
  // Each source's own "remove" is the action that actually makes sense for
  // it: unassign a pending policy, waive a training assignment. A vendor
  // reassessment or a task isn't something the calendar itself should be
  // able to delete — those live in, and are removed from, their own areas.
  app.delete("/api/client/calendar/:id", requireAuth, gateCalendar, async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.query.userId);
    if (!targetId) return;
    const { sourceType, rawId } = parseCompositeId(req.params.id);
    const actorRole = req.isAdmin ? "admin" : req.isAnalyst ? "analyst" : "client_admin";

    if (sourceType === "policy") {
      const before = (db.data.policyAcknowledgments || []).length;
      db.data.policyAcknowledgments = (db.data.policyAcknowledgments || [])
        .filter(r => !(r.id === rawId && r.clientUserId === targetId));
      if ((db.data.policyAcknowledgments || []).length === before) return res.status(404).json({ error: "Not found." });
      await db.write();
      return res.json({ ok: true, deleted: req.params.id });
    }

    if (sourceType === "training") {
      const a = (db.data.trainingAssignments || []).find(x => x.id === rawId && x.clientUserId === targetId);
      if (!a) return res.status(404).json({ error: "Not found." });
      applyAssignmentEdit(db, { assignment: a, body: { status: "waived" }, actorUserId: req.userId, actorRole, logClientAction });
      await db.write();
      return res.json({ ok: true, deleted: req.params.id, waived: true });
    }

    if (sourceType === "vendor" || sourceType === "task") {
      return res.status(400).json({
        error: sourceType === "vendor" ? "Remove this from Vendor Risk, not the calendar." : "Remove this from Remediation, not the calendar.",
      });
    }

    const before = (db.data.complianceCalendarEntries || []).length;
    db.data.complianceCalendarEntries = (db.data.complianceCalendarEntries || [])
      .filter(e => !(e.id === rawId && e.userId === targetId));
    if ((db.data.complianceCalendarEntries || []).length === before) return res.status(404).json({ error: "Not found." });
    await db.write();
    res.json({ ok: true, deleted: req.params.id });
  });

  console.log("ShieldAI compliance-calendar routes registered.");
}
