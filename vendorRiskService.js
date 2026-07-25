// vendorRiskService.js
//
// Vendor & third-party risk MANAGEMENT — the ongoing layer this product was
// missing. Two things already existed and stay exactly as they are:
//   - policyCatalog.js's "vendor-risk" entry generates a one-time POLICY
//     document (the rules a business sets for itself).
//   - securityChecklist.js's vendorInventory/vendorDueDiligence/vendorContracts
//     questions capture a one-time evidence SNAPSHOT at intake.
// Neither tracks a single vendor as a living record with a reassessment date,
// and neither helps a client answer a security questionnaire THEIR OWN
// customer sends them. This file is that ongoing layer: a real registry with
// computed due-dates, plus AI-assisted (but strictly grounded) help drafting
// answers to incoming questionnaires.
//
// Real-data-over-fabrication, applied here: buildGroundingFacts() below hands
// the AI only things that are verifiably true right now (policies that were
// actually generated, the actual computed posture score, the actual vendor
// count). The AI is instructed to flag anything not covered rather than
// invent an answer — see vendorRoutes.js's questionnaire system prompt.

import { randomUUID } from "crypto";

export const VENDOR_CATEGORIES = [
  "Cloud Hosting/Infrastructure",
  "Payroll/HR",
  "IT Support/MSP",
  "Payment Processor",
  "SaaS/Software",
  "Marketing/Advertising",
  "Legal/Accounting",
  "Shipping/Logistics",
  "Other",
];

export const CRITICALITY_LEVELS = ["critical", "high", "medium", "low"];
export const DATA_ACCESS_LEVELS = ["none", "limited", "extensive"];

// Reassessment cadence by criticality, absent an explicit override. A vendor
// holding customer PII or payment data (critical) gets reviewed twice as
// often as a low-criticality vendor (e.g., an office-supplies vendor with no
// data access) — the same logic a real vendor-risk program would apply.
const DEFAULT_INTERVAL_MONTHS = { critical: 6, high: 12, medium: 12, low: 24 };

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_WINDOW_DAYS = 30;

function addMonths(dateIso, months) {
  const d = new Date(dateIso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function clampEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// Recompute nextReassessmentDue from lastAssessedAt (or, if never assessed,
// the contract start date, or failing that, when the record was created).
// Mutates and returns the vendor record.
function recomputeDueDate(v) {
  const interval = v.reassessmentIntervalMonths || DEFAULT_INTERVAL_MONTHS[v.criticality] || 12;
  const baseline = v.lastAssessedAt || v.contractStartDate || v.createdAt;
  v.nextReassessmentDue = baseline ? addMonths(baseline, interval) : null;
  return v;
}

/** "overdue" | "due_soon" | "current" | "not_set" — pure function of a due date. */
export function dueStatus(nextReassessmentDue) {
  if (!nextReassessmentDue) return "not_set";
  const due = new Date(nextReassessmentDue).getTime();
  const now = Date.now();
  if (due < now) return "overdue";
  if (due - now <= DUE_SOON_WINDOW_DAYS * DAY_MS) return "due_soon";
  return "current";
}

// ── CRUD ─────────────────────────────────────────────────────

export function listVendors(db, userId) {
  const all = (db.data.vendors || []).filter(v => v.userId === userId);
  const withReview = all.map(v => ({ ...v, reviewStatus: dueStatus(v.nextReassessmentDue) }));
  const order = { overdue: 0, due_soon: 1, not_set: 2, current: 3 };
  withReview.sort((a, b) => {
    const byStatus = (order[a.reviewStatus] ?? 9) - (order[b.reviewStatus] ?? 9);
    if (byStatus !== 0) return byStatus;
    const ad = a.nextReassessmentDue ? new Date(a.nextReassessmentDue).getTime() : Infinity;
    const bd = b.nextReassessmentDue ? new Date(b.nextReassessmentDue).getTime() : Infinity;
    return ad - bd;
  });
  return withReview;
}

export function getVendor(db, userId, id) {
  return (db.data.vendors || []).find(v => v.id === id && v.userId === userId) || null;
}

export function createVendor(db, userId, input = {}) {
  const name = String(input.name || "").trim();
  if (!name) {
    const e = new Error("Vendor name is required.");
    e.status = 400;
    throw e;
  }

  const now = new Date().toISOString();
  const criticality = clampEnum(input.criticality, CRITICALITY_LEVELS, "medium");
  const v = {
    id: randomUUID(),
    userId,
    name: name.slice(0, 200),
    category: VENDOR_CATEGORIES.includes(input.category) ? input.category : "Other",
    criticality,
    dataAccessLevel: clampEnum(input.dataAccessLevel, DATA_ACCESS_LEVELS, "limited"),
    contactName: String(input.contactName || "").slice(0, 200),
    contactEmail: String(input.contactEmail || "").slice(0, 200),
    contractStartDate: input.contractStartDate || null,
    hasDataAgreement: !!input.hasDataAgreement,      // DPA/BAA or equivalent on file
    securityCertification: String(input.securityCertification || "").slice(0, 200),
    notes: String(input.notes || "").slice(0, 2000),
    status: input.status === "offboarded" ? "offboarded" : "active",
    lastAssessedAt: input.lastAssessedAt || null,
    reassessmentIntervalMonths: Number(input.reassessmentIntervalMonths) > 0
      ? Number(input.reassessmentIntervalMonths) : DEFAULT_INTERVAL_MONTHS[criticality],
    nextReassessmentDue: null,
    createdAt: now,
    updatedAt: now,
    createdByStaff: input.createdByStaff || null,     // provenance if staff added this on behalf of a client
  };
  recomputeDueDate(v);
  db.data.vendors ||= [];
  db.data.vendors.push(v);
  return v;
}

export function updateVendor(db, userId, id, patch = {}) {
  const v = getVendor(db, userId, id);
  if (!v) {
    const e = new Error("Vendor not found.");
    e.status = 404;
    throw e;
  }

  if (patch.name !== undefined) {
    const n = String(patch.name).trim();
    if (n) v.name = n.slice(0, 200);
  }
  if (patch.category !== undefined) v.category = VENDOR_CATEGORIES.includes(patch.category) ? patch.category : v.category;
  if (patch.criticality !== undefined) v.criticality = clampEnum(patch.criticality, CRITICALITY_LEVELS, v.criticality);
  if (patch.dataAccessLevel !== undefined) v.dataAccessLevel = clampEnum(patch.dataAccessLevel, DATA_ACCESS_LEVELS, v.dataAccessLevel);
  if (patch.contactName !== undefined) v.contactName = String(patch.contactName).slice(0, 200);
  if (patch.contactEmail !== undefined) v.contactEmail = String(patch.contactEmail).slice(0, 200);
  if (patch.contractStartDate !== undefined) v.contractStartDate = patch.contractStartDate || null;
  if (patch.hasDataAgreement !== undefined) v.hasDataAgreement = !!patch.hasDataAgreement;
  if (patch.securityCertification !== undefined) v.securityCertification = String(patch.securityCertification).slice(0, 200);
  if (patch.notes !== undefined) v.notes = String(patch.notes).slice(0, 2000);
  if (patch.status !== undefined) v.status = patch.status === "offboarded" ? "offboarded" : "active";
  if (patch.lastAssessedAt !== undefined) v.lastAssessedAt = patch.lastAssessedAt || null;
  if (patch.reassessmentIntervalMonths !== undefined) {
    const n = Number(patch.reassessmentIntervalMonths);
    if (n > 0) v.reassessmentIntervalMonths = n;
  }
  v.updatedAt = new Date().toISOString();
  recomputeDueDate(v);
  return v;
}

// Marks a vendor as freshly reviewed today (or at an explicit assessedAt),
// recomputing the next due date from that point. This is the action a client
// takes after actually re-reviewing a vendor's security posture.
export function markReassessed(db, userId, id, { note, assessedAt } = {}) {
  const v = getVendor(db, userId, id);
  if (!v) {
    const e = new Error("Vendor not found.");
    e.status = 404;
    throw e;
  }
  v.lastAssessedAt = assessedAt || new Date().toISOString();
  if (note) {
    v.notes = (v.notes ? v.notes + "\n\n" : "")
      + `[Reassessed ${new Date(v.lastAssessedAt).toLocaleDateString()}] ${String(note).slice(0, 500)}`;
  }
  v.updatedAt = new Date().toISOString();
  recomputeDueDate(v);
  return v;
}

export function deleteVendor(db, userId, id) {
  const before = (db.data.vendors || []).length;
  db.data.vendors = (db.data.vendors || []).filter(v => !(v.id === id && v.userId === userId));
  return (db.data.vendors || []).length < before;
}

// ── Summaries ────────────────────────────────────────────────

export function vendorSummary(db, userId) {
  const list = listVendors(db, userId).filter(v => v.status === "active");
  const byCriticality = { critical: 0, high: 0, medium: 0, low: 0 };
  let overdue = 0, dueSoon = 0, current = 0, notSet = 0;
  for (const v of list) {
    byCriticality[v.criticality] = (byCriticality[v.criticality] || 0) + 1;
    if (v.reviewStatus === "overdue") overdue++;
    else if (v.reviewStatus === "due_soon") dueSoon++;
    else if (v.reviewStatus === "not_set") notSet++;
    else current++;
  }
  return { total: list.length, overdue, dueSoon, current, notSet, byCriticality };
}

// Cross-client queue for staff (admin/analyst): which clients have vendors
// overdue or coming due for reassessment. Mirrors the shape of domainRoutes.js's
// adminQueue() — a triage list, not a per-client drill-in.
export function portfolioOverdueQueue(db) {
  const byUser = new Map();
  for (const v of (db.data.vendors || [])) {
    if (v.status !== "active") continue;
    const rs = dueStatus(v.nextReassessmentDue);
    if (rs !== "overdue" && rs !== "due_soon") continue;
    if (!byUser.has(v.userId)) byUser.set(v.userId, { overdue: 0, dueSoon: 0, vendors: [] });
    const bucket = byUser.get(v.userId);
    if (rs === "overdue") bucket.overdue++; else bucket.dueSoon++;
    bucket.vendors.push({
      id: v.id, name: v.name, criticality: v.criticality,
      nextReassessmentDue: v.nextReassessmentDue, reviewStatus: rs,
    });
  }
  const users = db.data.users || [];
  return [...byUser.entries()]
    .map(([userId, bucket]) => {
      const u = users.find(x => x.id === userId);
      return {
        userId,
        companyName: u?.companyName || u?.email || "Unknown client",
        email: u?.email || "",
        ...bucket,
      };
    })
    .sort((a, b) => (b.overdue - a.overdue) || (b.dueSoon - a.dueSoon));
}

// ── Questionnaire grounding ──────────────────────────────────

/**
 * Facts about this specific client that are verifiably true right now, for
 * the incoming-questionnaire assistant to ground its drafted answers in.
 * Deliberately conservative: every line here traces to a real record (an
 * actually-generated policy, the actually-computed posture score, the actual
 * vendor count) — nothing is inferred or assumed. The AI is told to treat
 * anything NOT covered here as unknown rather than filling the gap itself.
 */
export function buildGroundingFacts(db, userId) {
  const facts = [];

  const policies = (db.data.policyDocs || []).filter(p => p.userId === userId);
  facts.push(policies.length
    ? `Documented, generated policies on file (${policies.length}): ${policies.map(p => p.policyName).join(", ")}.`
    : "No formal written security policies have been generated for this business yet.");

  const programs = (db.data.programs || []).filter(p => p.userId === userId && p.status === "complete");
  const latestProgram = programs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const ro = latestProgram?.sections?.riskOverview;
  if (ro?.postureScore != null) {
    facts.push(`Current security posture score: ${ro.postureScore}/100 (${ro.postureLevel}), computed via ${ro.breakdown?.methodology || "NIST CSF"}.`);
  }
  const complianceFrameworks = latestProgram?.sections?.compliance?.frameworks;
  if (Array.isArray(complianceFrameworks)) {
    for (const f of complianceFrameworks) {
      if (!f?.name) continue;
      facts.push(`Compliance tracking — ${f.name}: ${f.overallScore != null ? f.overallScore + "% assessed" : (f.applicability || "in progress")}.`);
    }
  }

  const activeVendors = (db.data.vendors || []).filter(v => v.userId === userId && v.status === "active");
  facts.push(activeVendors.length
    ? `Maintains an internal vendor risk registry of ${activeVendors.length} active third-party vendor${activeVendors.length === 1 ? "" : "s"}, each assigned a criticality tier and a reassessment schedule.`
    : "No formal ongoing vendor risk registry is populated yet.");

  const domain = (db.data.clientDomains || []).find(d => d.userId === userId);
  if (domain?.emailSecurityScan?.checks) {
    const c = domain.emailSecurityScan.checks;
    facts.push(`Email authentication for ${domain.domain}: SPF ${c.spf?.status || "unknown"}, DKIM ${c.dkim?.status || "unknown"}, DMARC ${c.dmarc?.status || "unknown"}.`);
  }

  return facts;
}
