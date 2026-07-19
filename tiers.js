// tiers.js
// Single source of truth for ShieldAI subscription tiers and their limits.
// Used by the backend to enforce limits and by the admin UI to display/move
// clients between tiers. Prices are in USD cents (Stripe convention).
//
// `stripePriceId` is filled in once you create the products/prices in Stripe
// (Stage 4). Until then it's null and tier changes are internal-only.
//
// Limits use `null` to mean "unlimited".
//
// TRAINING MODEL (two distinct things — do not conflate):
//   1. Training PLAN (the "recommendation version"): the AI-generated, CISA/NIST-
//      aligned recommended curriculum + schedule from trainingCatalog.js. This is
//      a recommendation deliverable, not a delivery system. Included from Starter up.
//      Capability flag: `trainingPlan`.
//   2. Training PRODUCT (standalone delivery): tokenized learner links, assignments,
//      quarterly scheduling, completion tracking, and fleet reporting. This is the
//      thing employees actually complete. BUNDLED at Growth and above. On Starter it
//      is a paid ADD-ON (see ADDONS.training_delivery). Capability flag: `trainingDelivery`.

export const TIERS = {
  free: {
    id: "free",
    name: "Free",
    rank: 0,
    priceCents: 0,
    interval: "month",
    stripePriceId: null,
    description: "Run a baseline security assessment and see your NIST/CIS posture score. Upgrade to build programs, policies, and monitor endpoints.",
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
      trainingPlan: false,          // AI-recommended training plan (recommendation version)
      trainingDelivery: false,      // standalone training delivery product
      downloadExports: false,
      endpoints: false,             // can't enroll agents (feature shown locked)
      threatIntel: false,           // CVE/breach exposure views
      analystSupport: false,
      mastermind: false,            // client-facing Mastermind Q&A
    },
    features: ["Security assessment & posture score only", "Upgrade to unlock programs, policies & monitoring"],
  },

  starter: {
    id: "starter",
    name: "Starter",
    rank: 1,
    priceCents: 15900,              // $159/mo
    interval: "month",
    stripePriceId: null,
    description: "Multiple assessments, programs, up to 6 policies, and the AI-recommended training plan. Monitor up to 5 endpoints. Employee training delivery available as an add-on.",
    limits: {
      endpoints: 5,
      policies: 6,
      programs: null,               // multiple
      trainingPrograms: 1,          // 1 recommended training plan
      analystSupport: "none",
    },
    capabilities: {
      assessments: true,
      buildPrograms: true,
      createPolicies: true,         // capped at 6 via limits
      trainingPlan: true,           // includes the recommendation-version training plan
      trainingDelivery: false,      // OFF by default — unlocked via the paid add-on
      downloadExports: false,       // no downloads at this tier
      endpoints: true,              // up to 5
      threatIntel: false,
      analystSupport: false,
      mastermind: false,
    },
    // Add-ons this tier can purchase on top of the base subscription.
    addons: ["training_delivery"],
    features: ["Multiple assessments", "Build programs", "Up to 6 policies", "AI-recommended training plan", "5 endpoints", "Employee training delivery add-on ($40/mo)", "No downloads"],
  },

  growth: {
    id: "growth",
    name: "Growth",
    rank: 2,
    priceCents: 34900,             // $349/mo
    interval: "month",
    stripePriceId: null,
    description: "Everything in Starter plus real threat intelligence, the full employee training delivery product, expanded policies and endpoints, and downloads.",
    limits: {
      endpoints: 25,
      policies: 10,
      programs: null,
      trainingPrograms: null,
      analystSupport: "none",
    },
    capabilities: {
      assessments: true,
      buildPrograms: true,
      createPolicies: true,
      trainingPlan: true,
      trainingDelivery: true,       // BUNDLED from Growth up
      downloadExports: true,        // full downloads/exports
      endpoints: true,              // up to 25
      threatIntel: true,            // CVE/breach exposure
      analystSupport: false,
      mastermind: false,
    },
    features: ["Everything in Starter", "Real threat intel (CVE/breach)", "Employee training delivery (bundled)", "Up to 10 policies", "Downloads & exports", "Up to 25 endpoints"],
  },

  guided: {
    id: "guided",
    name: "Guided",
    rank: 3,
    priceCents: 69900,             // $699/mo
    interval: "month",
    stripePriceId: null,
    description: "Everything in Growth plus periodic engineer review, compliance tracking, and scheduled check-ins for SMBs with light compliance needs.",
    limits: {
      endpoints: 100,
      policies: null,
      programs: null,
      trainingPrograms: null,
      analystSupport: "limited",
    },
    capabilities: {
      assessments: true,
      buildPrograms: true,
      createPolicies: true,
      trainingPlan: true,
      trainingDelivery: true,
      downloadExports: true,
      endpoints: true,              // up to 100
      threatIntel: true,
      analystSupport: true,         // limited — periodic engineer review
      mastermind: false,
    },
    features: ["Everything in Growth", "Periodic engineer review", "Compliance tracking", "Scheduled check-ins", "Up to 100 endpoints"],
  },

  managed: {
    id: "managed",
    name: "Managed vCISO",
    rank: 4,
    priceCents: 195000,            // $1,950/mo
    interval: "month",
    stripePriceId: null,
    description: "A ShieldAI engineer runs the security program end-to-end — unlimited endpoints, full agent access, client-facing Mastermind Q&A, and full engineer support. Still below human-only vCISO retainers.",
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
      trainingPlan: true,
      trainingDelivery: true,
      downloadExports: true,
      endpoints: true,              // unlimited
      threatIntel: true,
      analystSupport: true,         // full — engineer runs the program
      mastermind: true,             // client-facing Q&A
    },
    features: ["Engineer runs your program end-to-end", "Unlimited endpoints", "Full agent access", "Mastermind Q&A", "Full engineer support"],
  },
};

// -----------------------------------------------------------------------------
// Add-ons: purchasable line items layered on top of a base subscription.
// Enforced separately from tier capabilities (see hasTrainingDelivery below).
// -----------------------------------------------------------------------------
export const ADDONS = {
  training_delivery: {
    id: "training_delivery",
    name: "Employee Training Delivery",
    priceCents: 4000,              // $40/mo
    interval: "month",
    stripePriceId: null,
    // Which tiers may buy it. Growth+ already bundle it, so it's only sold to Starter.
    availableFor: ["starter"],
    unlocksCapability: "trainingDelivery",
    description: "Unlocks the standalone employee training delivery product — tokenized learner links, assignments, quarterly scheduling, completion tracking, and reports — for Starter customers. Bundled free at Growth and above.",
  },
};

// Ordered list (low → high) for UI dropdowns and up/downgrade logic.
export const TIER_ORDER = ["free", "starter", "growth", "guided", "managed"];

export const DEFAULT_TIER = "free";

// Self-serve, self-checkout paid tiers (Managed is contact-sales / engineer-onboarded).
export const SELF_SERVE_PAID_TIERS = ["starter", "growth", "guided"];

export function getTier(tierId) {
  return TIERS[tierId] || TIERS[DEFAULT_TIER];
}

// Does this tier have a given capability? Unknown capability → false (deny by default).
export function hasCapability(tierId, capability) {
  return !!getTier(tierId).capabilities?.[capability];
}

// Does this user have training DELIVERY? True if their tier bundles it OR they hold
// the training_delivery add-on. `userAddons` is an array of addon ids on the user/sub.
export function hasTrainingDelivery(tierId, userAddons = []) {
  if (hasCapability(tierId, "trainingDelivery")) return true;
  return Array.isArray(userAddons) && userAddons.includes("training_delivery");
}

// Is a given add-on purchasable by this tier? (Bundled tiers can't "buy" it again.)
export function canPurchaseAddon(tierId, addonId) {
  const a = ADDONS[addonId];
  if (!a) return false;
  return a.availableFor.includes(tierId);
}

export function getAddon(addonId) {
  return ADDONS[addonId] || null;
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

export function addonPriceLabel(addonId) {
  const a = getAddon(addonId);
  if (!a) return "";
  return `$${(a.priceCents / 100).toFixed(0)}/${a.interval}`;
}

export default TIERS;
