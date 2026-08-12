// tierGate.js
// Backend tier enforcement — the REAL gate. UI hiding is cosmetic; these
// middlewares are what actually prevent a client from exceeding their plan,
// even if they call the API directly.
//
// Usage in server.js (after requireAuth sets req.userId):
//   import { makeTierGate } from "./tierGate.js";
//   const gate = makeTierGate(db);
//   app.post("/api/policies/generate", requireAuth, gate.capability("createPolicies"),
//            gate.limit("policies", countPoliciesFor), handler);
//
// Responses use HTTP 402 (Payment Required) with a structured body so the UI
// can show a graceful "upgrade to unlock" prompt:
//   { error, code: "UPGRADE_REQUIRED" | "LIMIT_REACHED", capability?, resource?,
//     currentTier, limit?, current? }

import { getTier, hasCapability, hasTrainingDelivery, DEFAULT_TIER, minTierForCapability, nextTierForLimit, priceLabel } from "./tiers.js";

export function makeTierGate(db) {
  function tierOf(userId) {
    const u = (db.data.users || []).find(x => x.id === userId);
    return u?.tier && getTier(u.tier).id === u.tier ? u.tier : DEFAULT_TIER;
  }

  // A user's active add-on ids. Add-ons may live on the user record or on their
  // subscription record; we union both so either storage location works.
  function addonsOf(userId) {
    const u = (db.data.users || []).find(x => x.id === userId);
    const sub = (db.data.subscriptions || []).find(s => s.userId === userId);
    const a = new Set([
      ...(Array.isArray(u?.addons) ? u.addons : []),
      ...(Array.isArray(sub?.addons) ? sub.addons : []),
    ]);
    return [...a];
  }

  // Gate a route on a capability flag (on/off feature).
  function capability(cap) {
    return (req, res, next) => {
      // Admins and analysts are staff — not bound by client plan limits.
      if (req.isAdmin || req.isAnalyst) return next();
      const tier = tierOf(req.userId);
      if (hasCapability(tier, cap)) return next();
      const minTier = minTierForCapability(cap);
      return res.status(402).json({
        error: `Your current plan doesn't include this feature.`,
        code: "UPGRADE_REQUIRED",
        capability: cap,
        currentTier: tier,
        requiresTier: minTier,
        requiresTierName: minTier ? getTier(minTier).name : null,
        requiresPrice: minTier ? priceLabel(minTier) : null,
      });
    };
  }

  // Gate a route on a numeric limit. countFn(db, userId) → current count.
  // Enforced at creation: blocks the action that would EXCEED the limit.
  function limit(resource, countFn) {
    return (req, res, next) => {
      if (req.isAdmin || req.isAnalyst) return next();
      const tier = tierOf(req.userId);
      const cap = getTier(tier).limits?.[resource];
      if (cap == null) return next();                 // unlimited
      const current = countFn(db, req.userId);
      if (current < cap) return next();
      const nextTier = nextTierForLimit(tier, resource, current + 1);
      return res.status(402).json({
        error: `You've reached your plan's limit of ${cap} ${resource}. Upgrade for more.`,
        code: "LIMIT_REACHED",
        resource,
        currentTier: tier,
        limit: cap,
        current,
        requiresTier: nextTier,
        requiresTierName: nextTier ? getTier(nextTier).name : null,
        requiresPrice: nextTier ? priceLabel(nextTier) : null,
      });
    };
  }

  // Gate the standalone training DELIVERY product. Passes when the user's tier
  // bundles trainingDelivery (Growth+) OR they hold the training_delivery add-on
  // (Starter who purchased it). Staff bypass. This is what the $40 add-on unlocks.
  function trainingDelivery() {
    return (req, res, next) => {
      if (req.isAdmin || req.isAnalyst) return next();
      const tier = tierOf(req.userId);
      if (hasTrainingDelivery(tier, addonsOf(req.userId))) return next();
      return res.status(402).json({
        error: `Employee training delivery isn't included on your plan. Add it for $40/mo, or upgrade to Growth or higher where it's bundled.`,
        code: "UPGRADE_REQUIRED",
        capability: "trainingDelivery",
        addon: "training_delivery",
        currentTier: tier,
        requiresTier: "growth",
        requiresTierName: getTier("growth").name,
        requiresPrice: priceLabel("growth"),
      });
    };
  }

  return { capability, limit, trainingDelivery, tierOf, addonsOf };
}

// Common counting helpers (creation-time enforcement).
export const counters = {
  policies: (db, userId) => (db.data.policyDocs || []).filter(p => p.userId === userId).length,
  programs: (db, userId) => (db.data.programs || []).filter(p => p.userId === userId).length,
  trainingPrograms: (db, userId) => (db.data.trainingPrograms || []).filter(t => t.userId === userId).length,
  endpoints: (db, userId) => (db.data.agents || []).filter(a => a.ownerUserId === userId && a.status !== "revoked").length,
  // Counts webhook integrations, directory connections (M365/Google
  // Workspace/Okta/Zoom), productivity connections (Slack/Teams), task
  // tracker connections (Jira/Asana/Trello), and scheduling connections
  // (Zoom/Google Meet) toward the same "integrations" entitlement — one
  // coherent "connect your tools" limit, not five separate caps.
  integrations: (db, userId) =>
    (db.data.integrations || []).filter(i => i.ownerUserId === userId && i.status !== "revoked").length +
    (db.data.directoryConnections || []).filter(c => c.ownerUserId === userId && c.status !== "revoked").length +
    (db.data.productivityConnections || []).filter(c => c.ownerUserId === userId && c.status !== "revoked").length +
    (db.data.taskTrackerConnections || []).filter(c => c.ownerUserId === userId && c.status !== "revoked").length +
    (db.data.schedulingConnections || []).filter(c => c.ownerUserId === userId && c.status !== "revoked").length,
};
