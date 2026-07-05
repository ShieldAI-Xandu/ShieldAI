// tiers.js
// Single source of truth for ShieldAI subscription tiers and their limits.
// Used by the backend to enforce limits and by the admin UI to display/move
// clients between tiers. Prices are in USD cents (Stripe convention).
//
// `stripePriceId` is filled in once you create the products/prices in Stripe
// (Stage 4). Until then it's null and tier changes are internal-only.
//
// Limits use `null` to mean "unlimited".

export const TIERS = {
  free: {
    id: "free",
    name: "Free",
    rank: 0,
    priceCents: 0,
    interval: "month",
    stripePriceId: null,
    description: "Run a baseline security assessment. Upgrade to build programs, policies, and monitor endpoints.",
    limits: {
      endpoints: 0,
      policies: 0,
      programs: 0,
      trainingPrograms: 0,
      analystSupport: "none",        // none | limited | full
    },
    capabilities: {
      assessments: true,            // can run/view assessments
      buildPrograms: false,
      createPolicies: false,
      trainingPrograms: false,
      downloadExports: false,
      endpoints: false,             // can't enroll agents (feature shown locked)
      analystSupport: false,
      mastermind: false,            // client-facing Mastermind Q&A
    },
    // What the client-facing Mastermind may see/answer about at this tier.
    // Mirrors the services the tier unlocks — the assistant's knowledge is
    // scoped to features the client actually has. null = no Mastermind.
    mastermindScope: null,
    features: ["Security assessment only", "Upgrade to unlock programs, policies & monitoring"],
  },
  starter: {
    id: "starter",
    name: "Starter",
    rank: 1,
    priceCents: 9900,               // $99/mo  (your "Tier 1")
    interval: "month",
    stripePriceId: null,
    description: "Multiple assessments, programs, up to 6 policies, and a training program. Monitor up to 15 endpoints.",
    limits: {
      endpoints: 15,
      policies: 6,
      programs: null,               // multiple
      trainingPrograms: 1,
      analystSupport: "none",
    },
    capabilities: {
      assessments: true,
      buildPrograms: true,
      createPolicies: true,         // capped at 6 via limits
      trainingPrograms: true,
      downloadExports: false,       // no downloads at this tier
      endpoints: true,              // up to 15
      analystSupport: false,
      mastermind: true,             // basic Q&A, scoped to Starter services
    },
    // Starter Mastermind: help with the things Starter unlocks — assessments,
    // programs, policies, training — plus a light view of their few endpoints.
    // No recommendation-lifecycle or analyst context (those are higher tiers).
    mastermindScope: {
      level: "basic",
      assessments: true,
      programs: true,
      policies: true,
      training: true,
      endpoints: "summary",         // posture summary only, no per-check detail
      events: false,
      recommendations: false,
      historyTurns: 8,
      maxTokens: 900,
    },
    features: ["Multiple assessments", "Build programs", "Up to 6 policies", "Training program", "15 endpoints", "Basic Mastermind Q&A", "No downloads"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    rank: 2,
    priceCents: 29900,              // $299/mo  (your "Tier 2")
    interval: "month",
    stripePriceId: null,
    description: "All functions with downloads, up to 50 endpoints, and limited engineer support.",
    limits: {
      endpoints: 50,
      policies: 10,
      programs: null,
      trainingPrograms: null,
      analystSupport: "limited",
    },
    capabilities: {
      assessments: true,
      buildPrograms: true,
      createPolicies: true,
      trainingPrograms: true,
      downloadExports: true,        // full downloads/exports
      endpoints: true,              // up to 50
      analystSupport: true,         // limited
      mastermind: true,             // fuller Q&A, scoped to Pro services
    },
    // Pro Mastermind: everything Starter sees, plus full per-endpoint posture
    // detail, security events, and the recommendation lifecycle (since Pro has
    // downloads, more endpoints, and limited analyst support to act on advice).
    mastermindScope: {
      level: "standard",
      assessments: true,
      programs: true,
      policies: true,
      training: true,
      endpoints: "detailed",        // per-check detail
      events: true,
      recommendations: true,
      historyTurns: 12,
      maxTokens: 1200,
    },
    features: ["All functions", "Up to 10 policies", "Downloads & exports", "Up to 50 endpoints", "Standard Mastermind Q&A", "Limited engineer support"],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    rank: 3,
    priceCents: null,              // custom / contact sales  (your "Tier 3")
    interval: "month",
    stripePriceId: null,
    description: "Everything, unlimited endpoints, full agent access, limited Mastermind Q&A, and full engineer support.",
    limits: {
      endpoints: null,
      policies: null,
      programs: null,
      trainingPrograms: null,
      analystSupport: "full",
    },
    capabilities: {
      assessments: true,
      buildPrograms: true,
      createPolicies: true,
      trainingPrograms: true,
      downloadExports: true,
      endpoints: true,              // unlimited
      analystSupport: true,         // full
      mastermind: true,             // full client-facing Q&A
    },
    // Enterprise Mastermind: full scope over all of the client's own data,
    // including endpoint detail, events, recommendations, and the longest
    // conversation memory. Still strictly isolated to this client.
    mastermindScope: {
      level: "full",
      assessments: true,
      programs: true,
      policies: true,
      training: true,
      endpoints: "detailed",
      events: true,
      recommendations: true,
      historyTurns: 16,
      maxTokens: 1500,
    },
    features: ["Everything in Pro", "Unlimited endpoints", "Full agent access", "Full Mastermind Q&A", "Full engineer support"],
  },
};

// Ordered list (low → high) for UI dropdowns and up/downgrade logic.
export const TIER_ORDER = ["free", "starter", "pro", "enterprise"];

export const DEFAULT_TIER = "free";

export function getTier(tierId) {
  return TIERS[tierId] || TIERS[DEFAULT_TIER];
}

// Does this tier have a given capability? Unknown capability → false (deny by default).
export function hasCapability(tierId, capability) {
  return !!getTier(tierId).capabilities?.[capability];
}

// The client-facing Mastermind scope for a tier, or null if it has none.
// Controls what data the assistant may see and how much it can answer about.
export function mastermindScope(tierId) {
  return getTier(tierId).mastermindScope || null;
}

// Is a given count within the tier's limit for a resource? null limit = unlimited.
export function withinLimit(tierId, resource, currentCount) {
  const tier = getTier(tierId);
  const limit = tier.limits?.[resource];
  if (limit == null) return true;            // unlimited
  return currentCount < limit;
}

// Human-readable limit ("Unlimited" or the number).
export function limitLabel(tierId, resource) {
  const limit = getTier(tierId).limits?.[resource];
  return limit == null ? "Unlimited" : String(limit);
}

// Price as a display string.
export function priceLabel(tierId) {
  const t = getTier(tierId);
  if (t.priceCents == null) return "Custom";
  if (t.priceCents === 0) return "Free";
  return `$${(t.priceCents / 100).toFixed(0)}/${t.interval}`;
}

export default TIERS;
