// frameworkAddonRoutes.js
// Client-facing purchase and management of paid compliance-framework slots
// ($49.99/mo each — ADDONS.compliance_framework in tiers.js).
//
// WHY ITS OWN FILE
// ----------------
// complianceRoutes.js is already ~1000 lines doing two unrelated jobs (the
// framework walkthrough and the analyst portfolio). This is a third, and
// billing-adjacent, so it gets its own mount rather than growing that file
// again.
//
// WHY THESE ROUTES DON'T TOUCH STRIPE
// -----------------------------------
// Stripe is intentionally deferred: billingRoutes.js returns 503 whenever
// STRIPE_SECRET_KEY is unset, and that's on purpose, not an outage. So the
// purchase here records an entitlement flagged for manual invoicing and
// grants access immediately. Deliberately NOT routed through
// /api/billing/checkout-addon, which would 503 and leave the client with no
// way to buy something we're perfectly willing to sell them.
//
// The swap seam is the response shape: today POST returns
// { entitlement, message }. When Stripe goes live it starts returning
// { url } instead and the frontend's existing redirect branch takes over
// with no UI change. See UpgradeModal.buyFrameworkAddon in src/App.jsx.
//
// ANALYST ISOLATION — THE NON-OBVIOUS GUARD
// -----------------------------------------
// gate.capability() deliberately waves staff through (`if (req.isAdmin ||
// req.isAnalyst) return next()`), because staff aren't bound by client plan
// limits. That's correct for every other route it protects and WRONG here:
// without an explicit block, an analyst hitting this endpoint would create a
// billable entitlement on their own account, and — worse — the capability
// gate would never stop them. Staff are 403'd on purpose, via tierGate.js's
// `clientOnly` option/middleware (see gate.capability(..., {clientOnly:true})
// and gate.clientOnly() below) — a shared mechanism rather than a bespoke
// per-route guard, so a future client-only route gets this by construction
// instead of needing to remember to reinvent it. They add a framework for a
// client through the admin grant (adminRoutes.js) or by filing a support
// request, which is the one path that still enforces analystOwnsClient.

import {
  frameworkAllowance, hasFreeIncludedSlot, newEntitlement, assignEntitlement,
  unassignEntitlement, findUnassignedEntitlement, entitlementForFramework,
  entitlementsFor, publicEntitlement, monthlyCentsFor, isFoundation,
  FRAMEWORK_ADDON_ID,
} from "./frameworkEntitlements.js";
import { getFrameworkDef } from "./complianceBridge.js";
import { getAddon, addonPriceLabel, canPurchaseAddon, getTier } from "./tiers.js";
import { pushNotification } from "./portfolioRoutes.js";

export function registerFrameworkAddonRoutes(app, {
  db, requireAuth, gate, logClientAction,
}) {
  // Accessor, not a one-time bootstrap at registration. A registration-time
  // `db.data.x ||= []` only ever touches whichever store is ambient at boot,
  // so it never reaches demo-db.json's template or a per-visitor demo
  // sandbox cloned from it — those would then 500 on first access. Same
  // self-healing pattern supportRoutes.js's requests() uses, for the same
  // bug.
  const entitlements = () => (db.data.frameworkEntitlements ||= []);
  const users = () => (db.data.users || []);
  const userById = id => users().find(u => u.id === id) || null;

  function latestAssessmentFor(userId) {
    const list = (db.data.assessments || []).filter(a => a.userId === userId);
    if (!list.length) return null;
    return list.reduce((best, a) =>
      !best || new Date(a.updatedAt || a.createdAt) > new Date(best.updatedAt || best.createdAt) ? a : best, null);
  }

  // Assigned analysts if there are any, otherwise every admin — so a purchase
  // that needs invoicing always lands in front of someone.
  function staffContactsFor(clientId) {
    const analystIds = (db.data.assignments || [])
      .filter(a => a.clientUserId === clientId)
      .map(a => a.analystUserId);
    const admins = users().filter(u => u.isAdmin).map(u => u.id);
    return [...new Set([...analystIds, ...admins])];
  }

  function allowanceFor(userId) {
    return frameworkAllowance(db, gate, userId, latestAssessmentFor(userId));
  }

  function allowanceView(a) {
    return {
      tier: a.tierId,
      limit: a.limit,
      unlimited: a.unlimited,
      included: a.included,
      entitlements: a.entitlements,
      selectedIds: a.selectedIds,
      blocked: a.blockedIds.map(id => ({ id, name: a.nameById.get(id) || id })),
      grandfathered: a.grandfatheredIds,
    };
  }

  // ── What this client has, and what a slot costs ──
  app.get("/api/client/framework-addons", requireAuth, (req, res) => {
    const addon = getAddon(FRAMEWORK_ADDON_ID);
    const tierId = gate.tierOf(req.userId);
    const a = allowanceFor(req.userId);
    res.json({
      allowance: allowanceView(a),
      entitlements: entitlementsFor(db, req.userId).map(publicEntitlement),
      monthlyCents: monthlyCentsFor(db, req.userId),
      addon: {
        id: FRAMEWORK_ADDON_ID,
        name: addon?.name || "Additional Compliance Framework",
        priceCents: addon?.priceCents ?? 4999,
        priceLabel: addonPriceLabel(FRAMEWORK_ADDON_ID),
        // Whether we'd sell them one right now. Free can't buy (no compliance
        // editing at all), Managed can't buy (already unlimited).
        purchasable: canPurchaseAddon(tierId, FRAMEWORK_ADDON_ID),
        description: addon?.description || "",
      },
      // Stripe isn't live, so the client should be told what actually happens
      // when they press the button rather than being surprised by an invoice.
      billingNote: "Framework add-ons are invoiced by your ShieldAI vCISO admin. Access is enabled as soon as you add one.",
    });
  });

  // ── Buy (or re-use) a slot for one framework ──
  app.post("/api/client/framework-addons", requireAuth, gate.capability("complianceAccess", { clientOnly: true }), async (req, res) => {
    const tierId = gate.tierOf(req.userId);
    const frameworkId = String(req.body?.frameworkId || "").trim();
    if (!frameworkId) return res.status(400).json({ error: "frameworkId is required." });

    if (isFoundation(frameworkId)) {
      return res.status(409).json({
        error: "That's part of your scoring foundation — it's included on every plan and never costs extra.",
        code: "FOUNDATION_FRAMEWORK",
      });
    }

    const def = getFrameworkDef(frameworkId);
    const custom = def ? null : (db.data.customFrameworks || []).find(f => f.id === frameworkId);
    if (!def && !custom) return res.status(404).json({ error: "Unknown framework." });
    const frameworkName = def ? (def.short || def.name) : custom.name;

    if (!canPurchaseAddon(tierId, FRAMEWORK_ADDON_ID)) {
      // Managed is the only paid tier that lands here — unlimited already.
      return res.status(400).json({
        error: getTier(tierId).limits?.complianceFrameworks == null
          ? "Your plan already includes unlimited compliance frameworks — just select it."
          : "Framework add-ons aren't available on your current plan.",
        code: "ADDON_NOT_AVAILABLE",
        currentTier: tierId,
      });
    }

    if (entitlementForFramework(db, req.userId, frameworkId)) {
      return res.status(409).json({
        error: `You already have an add-on covering ${frameworkName}.`,
        code: "ALREADY_ENTITLED",
      });
    }

    // The anti-overcharge guard. If an included slot is going spare we refuse
    // to take their money and tell them to just tick the box — selling
    // something a client already pays for is the single worst failure mode
    // this feature could have.
    const allowance = allowanceFor(req.userId);
    if (hasFreeIncludedSlot(allowance)) {
      return res.status(409).json({
        error: `You're using ${allowance.included.used} of your ${allowance.limit} included frameworks. Just select ${frameworkName} — there's no charge.`,
        code: "SLOT_AVAILABLE",
        included: allowance.included,
      });
    }

    const actor = userById(req.userId);
    const kind = def ? "registry" : "custom";

    // A slot they already pay for that isn't applied to anything — move it
    // rather than selling a second one.
    const spare = findUnassignedEntitlement(db, req.userId);
    if (spare) {
      assignEntitlement(spare, { frameworkId, frameworkName, kind });
      logClientAction?.(db, {
        clientUserId: req.userId,
        actorUserId: req.userId,
        actorRole: "client",
        action: "framework_addon_reused",
        detail: `Applied an existing framework add-on to ${frameworkName} — no new charge.`,
      });
      await db.write();
      return res.json({
        entitlement: publicEntitlement(spare),
        charged: false,
        reused: true,
        message: `${frameworkName} is now covered by the add-on slot you already have. Nothing new to pay.`,
      });
    }

    const rec = newEntitlement({
      userId: req.userId,
      frameworkId,
      frameworkName,
      kind,
      status: "pending_billing",
      billingMode: "manual_invoice",
      source: "self_serve",
      requestedByUserId: req.userId,
    });
    entitlements().push(rec);

    logClientAction?.(db, {
      clientUserId: req.userId,
      actorUserId: req.userId,
      actorRole: "client",
      action: "framework_addon_purchased",
      detail: `Added ${frameworkName} as a paid framework add-on (${addonPriceLabel(FRAMEWORK_ADDON_ID)}), pending invoice.`,
    });
    for (const staffId of staffContactsFor(req.userId)) {
      pushNotification(db, {
        userId: staffId,
        type: "framework_addon_pending_billing",
        title: `${actor?.companyName || actor?.email || "A client"} added a paid framework`,
        body: `${frameworkName} — ${addonPriceLabel(FRAMEWORK_ADDON_ID)}, not yet invoiced. Access is already enabled.`,
        actorRole: "client",
      });
    }
    await db.write();

    // No db.data.transactions row. A transaction means money collected; this
    // is money owed. Writing one would inflate revenue reporting with an
    // invoice nobody has sent, which is exactly the kind of plausible-looking
    // fabrication this codebase refuses to ship.
    res.status(201).json({
      entitlement: publicEntitlement(rec),
      charged: true,
      reused: false,
      message: `${frameworkName} is enabled now. Your ShieldAI vCISO admin will invoice the ${addonPriceLabel(FRAMEWORK_ADDON_ID)} add-on.`,
    });
  });

  // ── Release a framework, keep the slot ──
  app.delete("/api/client/framework-addons/:id", requireAuth, gate.clientOnly(), async (req, res) => {
    const rec = entitlements().find(e => e.id === req.params.id && e.userId === req.userId);
    if (!rec) return res.status(404).json({ error: "Add-on not found." });
    if (rec.status === "cancelled") return res.status(409).json({ error: "That add-on has already been cancelled." });

    const was = rec.frameworkName || rec.frameworkId;
    if (!rec.frameworkId) {
      return res.json({
        entitlement: publicEntitlement(rec),
        message: "That add-on slot is already free — apply it to any framework at no extra cost.",
      });
    }

    unassignEntitlement(rec);

    logClientAction?.(db, {
      clientUserId: req.userId,
      actorUserId: req.userId,
      actorRole: "client",
      action: "framework_addon_released",
      detail: `Released ${was} from a framework add-on slot. The slot (and its charge) is retained.`,
    });
    await db.write();

    // Unticking a checkbox must never cancel a recurring charge on its own.
    // The slot stays live and reusable; stopping the billing is a separate,
    // deliberate decision that belongs to a human who meant to make it.
    res.json({
      entitlement: publicEntitlement(rec),
      message: `${was} removed. You keep this ${addonPriceLabel(FRAMEWORK_ADDON_ID)} slot and can apply it to a different framework at no extra cost — contact your ShieldAI vCISO admin to stop the charge entirely.`,
    });
  });

  console.log("ShieldAI vCISO framework add-on routes registered.");
}
