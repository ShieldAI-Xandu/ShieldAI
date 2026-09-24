// frameworkEntitlements.js
// Paid compliance-framework slots — the $49.99/mo add-on that lets a client
// go past their tier's included framework count.
//
// WHY THIS MODULE EXISTS AT ALL
// -----------------------------
// Every tier includes a number of ADDITIONAL frameworks beyond the NIST CSF /
// CIS foundation lens (tiers.js limits.complianceFrameworks: Free 0, Starter
// 2, Growth 5, Guided 10, Managed unlimited). Before this module there were
// two problems with how that cap worked:
//
//   1. It was never enforced on WRITE. A client could PATCH an assessment
//      with twenty frameworks selected and it saved without complaint.
//   2. On READ it was enforced by `.slice(0, limit)` over the selection list,
//      so the framework that got blocked was whichever one happened to land
//      past the cut. Nobody chose it and nothing explained it.
//
// Now the cap is still the cap, but going past it is a deliberate purchase of
// a named framework rather than an accident of array order.
//
// WHY NOT THE `addons` ARRAY
// --------------------------
// The obvious-looking design is to push "framework:gdpr" into the user's
// `addons` string array next to "training_delivery", since tierGate.addonsOf()
// already unions user.addons and subscription.addons. That design is a trap.
// billingRoutes.js's Stripe webhook re-derives the whole array from Stripe's
// active subscriptions and overwrites it:
//
//     user.addons = [...resolvedAddons];
//
// Anything in there that Stripe doesn't know about is destroyed on the next
// webhook — silently, and only in production where webhooks actually fire.
// A bare string also can't express "purchased, currently applied to nothing",
// which is a state we specifically need (see below). So entitlements live in
// their own collection and `addons` is left exactly as it was.
//
// TWO AXES, DELIBERATELY NOT COLLAPSED
// ------------------------------------
//   status      — is this slot being BILLED?   pending_billing | active | comped | cancelled
//   frameworkId — is this slot being USED?     "gdpr" | null
//
// They look like one field and aren't. "Drop the framework but keep the
// add-on, and let them re-apply it somewhere else for free" is precisely
// `status` unchanged + `frameworkId` nulled + `frameworkId` re-set. Folding
// them into a single enum makes that state unrepresentable, and makes
// "cancelled but still applied" ambiguous instead of impossible.
//
// ACCESS IS GRANTED AT pending_billing
// ------------------------------------
// Stripe is intentionally deferred (billingRoutes.js returns 503 by design),
// so a purchase today records an entitlement and flags it for manual
// invoicing. We grant access immediately rather than withholding it until
// payment clears — the client asked for it and we know we're owed. That's a
// money decision, not an accident, so it's a named exported constant rather
// than a string comparison buried in a branch.
//
// PURE FUNCTIONS OVER db.data
// ---------------------------
// Nothing here imports Express or lowdb, and nothing calls db.write(). The
// repo has no route test harness, so any logic that lives in a route is
// effectively untested; keeping the rules here is what makes
// frameworkEntitlements.test.mjs possible. Callers mutate and persist.

import { randomUUID } from "crypto";
import { complianceFrameworkLimit, getAddon } from "./tiers.js";

/** The add-on id in tiers.js ADDONS that prices one framework slot. */
export const FRAMEWORK_ADDON_ID = "compliance_framework";

// The scoring foundation. These are chosen at intake as the posture lens, not
// picked from the compliance-framework list, and they never count against the
// additional-framework limit or become chargeable.
export const FOUNDATION_FRAMEWORK_IDS = new Set(["nist-csf", "cis"]);

// Statuses that actually grant access to a framework. `cancelled` is the only
// one that doesn't — including pending_billing here is the "we invoice, we
// don't withhold" decision made explicit.
export const ENTITLING_STATUSES = new Set(["pending_billing", "active", "comped"]);

export const ENTITLEMENT_STATUSES = ["pending_billing", "active", "comped", "cancelled"];
export const INVOICE_STATES = ["not_invoiced", "invoiced", "paid", "void"];

const nowIso = () => new Date().toISOString();

// ── Selection normalising ─────────────────────────────────────
// `assessment.data.selectedFrameworks` has two historical shapes: an array of
// { id, name } objects (what the pickers write today) and an array of plain
// name strings (older records, and what customFrameworks.js still expects).
// Read both rather than assuming the current one — a client whose record
// predates the object shape must not read as "nothing selected", which would
// hand them the legacy show-everything path and quietly bypass the cap.
export function normaliseSelection(selectedFrameworks) {
  if (!Array.isArray(selectedFrameworks)) return null;
  return selectedFrameworks.map(f => (
    typeof f === "string"
      ? { id: f, name: f }
      : { id: f?.id ?? f?.name ?? "", name: f?.name ?? f?.id ?? "" }
  )).filter(f => f.id);
}

export const isFoundation = id => FOUNDATION_FRAMEWORK_IDS.has(id);

// ── Entitlement reads ─────────────────────────────────────────

export function entitlementsFor(db, userId) {
  return (db.data.frameworkEntitlements || []).filter(e => e.userId === userId);
}

export function findEntitlement(db, id) {
  return (db.data.frameworkEntitlements || []).find(e => e.id === id) || null;
}

/** Framework ids this client has a live, applied, paid slot for. */
export function paidFrameworkIds(db, userId) {
  return entitlementsFor(db, userId)
    .filter(e => ENTITLING_STATUSES.has(e.status) && e.frameworkId)
    .map(e => e.frameworkId);
}

/** A live slot that isn't applied to anything — reusable at no extra charge. */
export function findUnassignedEntitlement(db, userId) {
  return entitlementsFor(db, userId)
    .find(e => ENTITLING_STATUSES.has(e.status) && !e.frameworkId) || null;
}

export function entitlementCounts(db, userId) {
  const live = entitlementsFor(db, userId).filter(e => ENTITLING_STATUSES.has(e.status));
  const assigned = live.filter(e => e.frameworkId).length;
  return { assigned, unassigned: live.length - assigned, total: live.length };
}

export function entitlementForFramework(db, userId, frameworkId) {
  return entitlementsFor(db, userId)
    .find(e => ENTITLING_STATUSES.has(e.status) && e.frameworkId === frameworkId) || null;
}

// ── Grandfathering ────────────────────────────────────────────
// Because the write path was never enforced, some clients already hold more
// frameworks than their tier allows. They must not be retroactively billed
// and must not have frameworks yanked out from under them.

export function grandfatheredIdsFor(db, userId) {
  const rec = (db.data.frameworkGrandfather || []).find(g => g.userId === userId);
  return Array.isArray(rec?.frameworkIds) ? rec.frameworkIds : [];
}

/**
 * One-shot, idempotent capture of what everyone had selected at the moment
 * enforcement shipped. Call at boot; the guard makes re-running a no-op.
 *
 * Snapshotted rather than computed lazily at read time on purpose:
 * selectedFrameworks is mutable, so a rule like "anything on a pre-cutoff
 * assessment is free" would let a legacy client keep adding frameworks and
 * have every one of them grandfathered forever. Freezing the list turns a
 * standing loophole into a closed one-time amnesty. It also keeps the read
 * path free of writes.
 *
 * Returns the number of clients captured.
 */
export function snapshotGrandfatheredFrameworks(db) {
  if (db.data.frameworkGrandfatherCapturedAt) return 0;

  db.data.frameworkGrandfather ||= [];
  const at = nowIso();
  let captured = 0;

  const latestByUser = new Map();
  for (const a of (db.data.assessments || [])) {
    const prev = latestByUser.get(a.userId);
    const when = new Date(a.updatedAt || a.createdAt || 0);
    if (!prev || when > new Date(prev.updatedAt || prev.createdAt || 0)) latestByUser.set(a.userId, a);
  }

  for (const [userId, a] of latestByUser) {
    const selection = normaliseSelection(a?.data?.selectedFrameworks);
    if (!selection) continue;                       // legacy record, nothing to freeze
    const additional = selection.map(f => f.id).filter(id => !isFoundation(id));
    if (additional.length === 0) continue;
    db.data.frameworkGrandfather.push({
      userId,
      frameworkIds: additional,
      assessmentId: a.id,
      capturedAt: at,
      reason: "pre_enforcement_selection",
    });
    captured++;
  }

  db.data.frameworkGrandfatherCapturedAt = at;
  return captured;
}

// ── The allow-list ────────────────────────────────────────────

/**
 * Which frameworks this client may actually see, and why.
 *
 * This is the single source of truth for the cap. It replaced two copies of
 * the same `.slice(0, limit)` logic — one in checkFrameworkAccess() and one
 * inlined in GET /api/compliance/overview — that could and did drift. The
 * write-side clamp calls it too, so a framework can never be saved that the
 * read side would then refuse to show.
 *
 * `gate` only needs tierOf(); passing the whole gate keeps the call sites
 * identical to what they already had.
 */
export function frameworkAllowance(db, gate, clientId, assessment) {
  const tierId = gate.tierOf(clientId);
  const limit = complianceFrameworkLimit(tierId);
  const selection = normaliseSelection(assessment?.data?.selectedFrameworks);
  const selectedIds = selection ? selection.map(f => f.id) : null;

  const nameById = new Map((selection || []).map(f => [f.id, f.name]));
  const foundationIds = (selectedIds || []).filter(isFoundation);
  const additionalIds = (selectedIds || []).filter(id => !isFoundation(id));

  const entitledIds = paidFrameworkIds(db, clientId).filter(id => !isFoundation(id));
  const grandfatheredIds = grandfatheredIdsFor(db, clientId).filter(id => !isFoundation(id));
  const counts = entitlementCounts(db, clientId);

  // Unlimited, or a legacy assessment with no selection recorded at all —
  // preserve the existing "show everything rather than silently hide
  // compliance data nobody chose to hide" behaviour.
  if (limit == null || selectedIds === null) {
    return {
      tierId, limit, selectedIds, foundationIds, additionalIds,
      includedIds: additionalIds, entitledIds, grandfatheredIds,
      allowedIds: new Set(selectedIds || []),
      blockedIds: [],
      unlimited: limit == null,
      included: { used: additionalIds.length, limit },
      entitlements: counts,
      nameById,
    };
  }

  // Grandfathered frameworks consume the included allowance FIRST. A legacy
  // Starter with 8 selected keeps all 8 and gains nothing extra for free —
  // the amnesty covers what they had, it isn't a permanent bigger plan.
  const grandfatheredSelected = additionalIds.filter(id => grandfatheredIds.includes(id));
  const headroom = Math.max(0, limit - grandfatheredSelected.length);

  // A paid slot does NOT consume an included slot. Buying one framework must
  // never evict another — that eviction was the artifact of the old
  // order-slice, and it's the specific thing this feature exists to kill.
  const includedIds = additionalIds
    .filter(id => !entitledIds.includes(id) && !grandfatheredSelected.includes(id))
    .slice(0, headroom);

  const allowedIds = new Set([
    ...foundationIds,
    ...includedIds,
    ...additionalIds.filter(id => entitledIds.includes(id)),
    ...grandfatheredSelected,
  ]);

  return {
    tierId, limit, selectedIds, foundationIds, additionalIds,
    includedIds, entitledIds, grandfatheredIds: grandfatheredSelected,
    allowedIds,
    blockedIds: additionalIds.filter(id => !allowedIds.has(id)),
    unlimited: false,
    included: { used: includedIds.length + grandfatheredSelected.length, limit },
    entitlements: counts,
    nameById,
  };
}

/**
 * Is there a free included slot going spare?
 *
 * The anti-overcharge guard. Without it a client who ticks a framework while
 * two of their five included slots sit empty gets offered a $49.99 purchase
 * for something they already pay for.
 */
export function hasFreeIncludedSlot(allowance) {
  if (allowance.unlimited) return true;
  return allowance.included.used < allowance.limit;
}

// ── Write-side clamp ──────────────────────────────────────────

/**
 * Strip frameworks the client isn't entitled to out of an incoming assessment
 * save, and report what was dropped.
 *
 * Deliberately sanitises rather than rejecting with a 402. The assessment
 * PATCH blind-merges an entire data blob — company profile, checklist
 * answers, tech stack — so failing the whole request over a framework
 * overage would break the Edit Assessment screen for edits that have nothing
 * to do with compliance. And silently charging $49.99 because a checkbox got
 * ticked is exactly the kind of thing "humans act" rules out: the purchase is
 * its own explicit step.
 *
 * Staff (admin/analyst) bypass entirely, consistent with tierGate.
 */
export function clampSelectedFrameworks(db, gate, actor, incomingData, existingAssessment = null) {
  const data = incomingData || {};
  if (actor?.isAdmin || actor?.isAnalyst) return { data, dropped: [] };

  const selection = normaliseSelection(data.selectedFrameworks);
  if (!selection || selection.length === 0) return { data, dropped: [] };

  const clientId = actor?.userId;

  // Evaluate the INCOMING selection, not what's on file — the question is
  // "may they save this?", and the stored record may not have it yet.
  const probe = {
    ...(existingAssessment || {}),
    data: { ...(existingAssessment?.data || {}), selectedFrameworks: data.selectedFrameworks },
  };
  const allowance = frameworkAllowance(db, gate, clientId, probe);
  if (allowance.blockedIds.length === 0) return { data, dropped: [] };

  const blocked = new Set(allowance.blockedIds);
  const kept = (Array.isArray(data.selectedFrameworks) ? data.selectedFrameworks : [])
    .filter(f => !blocked.has(typeof f === "string" ? f : f?.id));

  return {
    data: { ...data, selectedFrameworks: kept },
    dropped: allowance.blockedIds.map(id => ({
      id,
      name: allowance.nameById.get(id) || id,
      reason: `Beyond your plan's ${allowance.limit} included framework${allowance.limit === 1 ? "" : "s"}. Add it for ${addonPrice()} or upgrade.`,
    })),
  };
}

function addonPrice() {
  const a = getAddon(FRAMEWORK_ADDON_ID);
  if (!a) return "an add-on";
  return a.priceCents % 100 === 0
    ? `$${(a.priceCents / 100).toFixed(0)}/mo`
    : `$${(a.priceCents / 100).toFixed(2)}/mo`;
}

// ── Entitlement records ───────────────────────────────────────
// Builders/mutators only — the caller pushes onto db.data and awaits
// db.write(). Keeping persistence out of here is what lets the tests run
// against a plain object with no lowdb.

export function newEntitlement({
  userId, frameworkId = null, frameworkName = null, kind = "registry",
  status = "pending_billing", billingMode = "manual_invoice",
  source = "self_serve", requestedByUserId = null, grantedByUserId = null,
  supportRequestId = null, note = "",
}) {
  const addon = getAddon(FRAMEWORK_ADDON_ID);
  const at = nowIso();
  return {
    id: randomUUID(),
    userId,
    frameworkId,
    frameworkName,
    kind,
    priceCents: addon?.priceCents ?? 4999,
    interval: addon?.interval ?? "month",
    status,
    billing: {
      mode: billingMode,
      invoiceState: billingMode === "comped" ? "void" : "not_invoiced",
      invoicedAt: null,
      paidAt: null,
      lastInvoiceRef: null,
      // Reserved for the Stripe swap. When billing goes live these carry the
      // quantity-based subscription item; which framework a slot is applied
      // to stays our data and never becomes Stripe's, which is what makes
      // that swap invisible to the client.
      stripePriceId: null,
      stripeSubscriptionItemId: null,
    },
    source,
    requestedByUserId,
    grantedByUserId,
    supportRequestId,
    previousFrameworkIds: [],
    createdAt: at,
    updatedAt: at,
    activatedAt: status === "active" ? at : null,
    unassignedAt: null,
    cancelledAt: null,
    note: note || "",
  };
}

export function assignEntitlement(rec, { frameworkId, frameworkName, kind = "registry" }) {
  if (rec.frameworkId && rec.frameworkId !== frameworkId) {
    rec.previousFrameworkIds = [...(rec.previousFrameworkIds || []), rec.frameworkId];
  }
  rec.frameworkId = frameworkId;
  rec.frameworkName = frameworkName || frameworkId;
  rec.kind = kind;
  rec.unassignedAt = null;
  rec.updatedAt = nowIso();
  return rec;
}

/**
 * Release the framework, KEEP the slot.
 *
 * Unticking a checkbox must not cancel a recurring charge — that's a billing
 * decision, and it belongs to a human who meant to make it. The slot stays
 * live and re-applicable at no extra cost; cancelling is a separate, explicit
 * admin action (see cancelEntitlement).
 */
export function unassignEntitlement(rec) {
  if (rec.frameworkId) {
    rec.previousFrameworkIds = [...(rec.previousFrameworkIds || []), rec.frameworkId];
  }
  rec.frameworkId = null;
  rec.unassignedAt = nowIso();
  rec.updatedAt = rec.unassignedAt;
  return rec;
}

export function cancelEntitlement(rec, note = "") {
  rec.status = "cancelled";
  rec.cancelledAt = nowIso();
  rec.updatedAt = rec.cancelledAt;
  if (note) rec.note = note;
  return rec;
}

/**
 * Monthly cents this client is committed to pay for live framework slots —
 * pending_billing included, comped excluded. This is the client's own "what
 * you'll owe" number (GET /api/billing/me): a pending_billing slot is a real
 * commitment they already have access to, just not yet invoiced, so it
 * belongs in what THEY see as their total.
 *
 * NOT for revenue/MRR reporting — see activeMonthlyCentsFor for that. Mixing
 * the two was a real bug: a pending_billing entitlement was being summed into
 * both the admin overview's mrrCents (via this function) AND pendingCents
 * (via pendingBillingEntitlements), double-counting the same $49.99 as both
 * earned revenue and money owed, directly contradicting billingRoutes.js's
 * own "never folded into mrrCents" comment.
 */
/**
 * Move an add-on through its invoice lifecycle from a Stripe invoice event or
 * an admin-triggered Stripe invoice. Mirrors the rules of the manual admin
 * PATCH (paid promotes pending_billing -> active) but is safe to call twice:
 * it returns { changed:false } when the record is already in that state, so a
 * replayed webhook does nothing. Caller awaits db.write().
 *   state: "invoiced" | "paid" | "void"
 */
export function setInvoiceState(rec, state, { ref = null, url = null, at = nowIso() } = {}) {
  if (!rec || !INVOICE_STATES.includes(state)) return { changed: false };
  rec.billing ||= {};
  const b = rec.billing;
  if (ref) b.lastInvoiceRef = String(ref).slice(0, 120);
  if (url) b.invoiceUrl = String(url).slice(0, 500);
  // A paid invoice is final: never let a late "invoiced"/"void" event undo it.
  if (b.invoiceState === "paid" && state !== "paid") return { changed: false };
  if (b.invoiceState === state) return { changed: false };
  b.invoiceState = state;
  if (state === "invoiced" && !b.invoicedAt) b.invoicedAt = at;
  if (state === "paid") {
    b.paidAt = at;
    if (rec.status === "pending_billing") {
      rec.status = "active";
      rec.activatedAt ||= at;
    }
  }
  rec.updatedAt = at;
  return { changed: true };
}

export function monthlyCentsFor(db, userId) {
  return entitlementsFor(db, userId)
    .filter(e => ENTITLING_STATUSES.has(e.status) && e.status !== "comped")
    .reduce((sum, e) => sum + (e.priceCents || 0), 0);
}

/**
 * Monthly cents ACTUALLY BEING BILLED for this client's framework slots —
 * `active` only. Excludes both `comped` (real access, zero revenue) and
 * `pending_billing` (owed, not yet invoiced — see pendingBillingEntitlements
 * for that queue). This is the one that belongs in MRR and in anything
 * labeled revenue; monthlyCentsFor above is a different, larger number by
 * design and must not be used for financial reporting.
 */
export function activeMonthlyCentsFor(db, userId) {
  return entitlementsFor(db, userId)
    .filter(e => e.status === "active")
    .reduce((sum, e) => sum + (e.priceCents || 0), 0);
}

/** Live slots that haven't been invoiced yet — the manual-billing worklist. */
export function pendingBillingEntitlements(db) {
  return (db.data.frameworkEntitlements || [])
    .filter(e => e.status === "pending_billing" && e.billing?.invoiceState === "not_invoiced")
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

/** Public view of one entitlement — no internal ids a client shouldn't see. */
export function publicEntitlement(e) {
  return {
    id: e.id,
    frameworkId: e.frameworkId,
    frameworkName: e.frameworkName,
    status: e.status,
    inUse: !!e.frameworkId,
    priceCents: e.priceCents,
    interval: e.interval,
    invoiceState: e.billing?.invoiceState || null,
    source: e.source,
    createdAt: e.createdAt,
  };
}
