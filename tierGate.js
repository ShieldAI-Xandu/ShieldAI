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

import { getTier, hasCapability, DEFAULT_TIER } from "./tiers.js";

export function makeTierGate(db) {
  function tierOf(userId) {
    const u = (db.data.users || []).find(x => x.id === userId);
    return u?.tier && getTier(u.tier).id === u.tier ? u.tier : DEFAULT_TIER;
  }

  // Gate a route on a capability flag (on/off feature).
  function capability(cap) {
    return (req, res, next) => {
      // Admins and analysts are staff — not bound by client plan limits.
      if (req.isAdmin || req.isAnalyst) return next();
      const tier = tierOf(req.userId);
      if (hasCapability(tier, cap)) return next();
      return res.status(402).json({
        error: `Your current plan doesn't include this feature.`,
        code: "UPGRADE_REQUIRED",
        capability: cap,
        currentTier: tier,
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
      return res.status(402).json({
        error: `You've reached your plan's limit of ${cap} ${resource}. Upgrade for more.`,
        code: "LIMIT_REACHED",
        resource,
        currentTier: tier,
        limit: cap,
        current,
      });
    };
  }

  return { capability, limit, tierOf };
}

// Common counting helpers (creation-time enforcement).
export const counters = {
  policies: (db, userId) => (db.data.policyDocs || []).filter(p => p.userId === userId).length,
  programs: (db, userId) => (db.data.programs || []).filter(p => p.userId === userId).length,
  trainingPrograms: (db, userId) => (db.data.trainingPrograms || []).filter(t => t.userId === userId).length,
  endpoints: (db, userId) => (db.data.agents || []).filter(a => a.ownerUserId === userId && a.status !== "revoked").length,
};
