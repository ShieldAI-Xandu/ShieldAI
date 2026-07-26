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
import { dueStatus } from "./vendorRiskService.js";
import { getTier } from "./tiers.js";

const nowIso = () => new Date().toISOString();
const DAY_MS = 24 * 60 * 60 * 1000;

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

// A pending policy acknowledgment has no explicit due date — this maps how
// long it's been pending onto the same overdue/due_soon/current vocabulary
// the rest of the calendar uses, so everything sorts together sensibly.
function agingStatus(assignedAtIso) {
  const days = (Date.now() - new Date(assignedAtIso).getTime()) / DAY_MS;
  if (days > 30) return "overdue";
  if (days > 14) return "due_soon";
  return "current";
}

function countActiveCustomEntries(db, userId) {
  return (db.data.complianceCalendarEntries || []).filter(e => e.userId === userId).length;
}

export function registerComplianceCalendarRoutes(app, { db, requireAuth, gate, analystOwnsClient }) {
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
        id: e.id, sourceType: "custom", title: e.title, category: e.category,
        dueDate: e.dueDate, reviewStatus: e.completedAt ? "current" : dueStatus(e.dueDate),
        detailPath: null, notes: e.notes || "", recurrenceMonths: e.recurrenceMonths || null,
        completedAt: e.completedAt || null,
      });
    }

    // Vendor reassessments — reads vendorRiskService's own data shape
    // directly rather than re-deriving it, so the two stay in lockstep.
    for (const v of (db.data.vendors || [])) {
      if (v.userId !== targetId || v.status !== "active") continue;
      items.push({
        id: v.id, sourceType: "vendor", title: `Reassess vendor: ${v.name}`, category: "vendor",
        dueDate: v.nextReassessmentDue, reviewStatus: dueStatus(v.nextReassessmentDue),
        detailPath: "vendors", notes: `Criticality: ${v.criticality}`, recurrenceMonths: v.reassessmentIntervalMonths || null,
        completedAt: null,
      });
    }

    // Pending policy acknowledgments — no fixed due date, aged into the same vocabulary.
    for (const p of (db.data.policyAcknowledgments || [])) {
      if (p.clientUserId !== targetId || p.acknowledgedAt) continue;
      items.push({
        id: p.id, sourceType: "policy", title: `Policy sign-off pending: ${p.learnerName}`, category: "policy",
        dueDate: null, reviewStatus: agingStatus(p.assignedAt),
        detailPath: "library", notes: p.policyName, recurrenceMonths: null, completedAt: null,
      });
    }

    // Training assignments with a due date, not yet completed.
    for (const a of (db.data.trainingAssignments || [])) {
      if (a.clientUserId !== targetId || a.status === "completed" || a.status === "waived" || !a.dueDate) continue;
      items.push({
        id: a.id, sourceType: "training", title: `Training due: ${a.title}`, category: "training",
        dueDate: a.dueDate, reviewStatus: dueStatus(a.dueDate),
        detailPath: "trainingmgr", notes: `${a.progress || 0}% complete`, recurrenceMonths: null, completedAt: null,
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
    res.json(entry);
  });

  // ── Custom entries: update ───────────────────────────────────
  app.patch("/api/client/calendar/:id", requireAuth, gateCalendar, async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.body?.userId);
    if (!targetId) return;
    const entry = (db.data.complianceCalendarEntries || []).find(e => e.id === req.params.id && e.userId === targetId);
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
    res.json(entry);
  });

  // ── Custom entries: mark this cycle done (recompute next date if recurring) ──
  app.post("/api/client/calendar/:id/complete", requireAuth, gateCalendar, async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.body?.userId);
    if (!targetId) return;
    const entry = (db.data.complianceCalendarEntries || []).find(e => e.id === req.params.id && e.userId === targetId);
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
    res.json(entry);
  });

  // ── Custom entries: delete ───────────────────────────────────
  app.delete("/api/client/calendar/:id", requireAuth, gateCalendar, async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.query.userId);
    if (!targetId) return;
    const before = (db.data.complianceCalendarEntries || []).length;
    db.data.complianceCalendarEntries = (db.data.complianceCalendarEntries || [])
      .filter(e => !(e.id === req.params.id && e.userId === targetId));
    if ((db.data.complianceCalendarEntries || []).length === before) return res.status(404).json({ error: "Not found." });
    await db.write();
    res.json({ ok: true, deleted: req.params.id });
  });

  console.log("ShieldAI compliance-calendar routes registered.");
}
