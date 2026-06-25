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
    description: "Get started with a single endpoint and a baseline assessment.",
    limits: {
      endpoints: 1,
      policies: 2,
      programs: 1,
      trainingPrograms: 0,
      analystSupport: "none",        // none | email | priority | dedicated
    },
    features: ["Security assessment", "1 monitored endpoint", "2 starter policies"],
  },
  starter: {
    id: "starter",
    name: "Starter",
    rank: 1,
    priceCents: 9900,               // $99/mo
    interval: "month",
    stripePriceId: null,
    description: "For small teams beginning to formalize their security program.",
    limits: {
      endpoints: 5,
      policies: 10,
      programs: 3,
      trainingPrograms: 1,
      analystSupport: "email",
    },
    features: ["Up to 5 endpoints", "10 policies", "Email analyst support", "Awareness training"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    rank: 2,
    priceCents: 29900,              // $299/mo
    interval: "month",
    stripePriceId: null,
    description: "Full program management with priority analyst guidance.",
    limits: {
      endpoints: 25,
      policies: null,
      programs: null,
      trainingPrograms: 5,
      analystSupport: "priority",
    },
    features: ["Up to 25 endpoints", "Unlimited policies & programs", "Priority analyst support", "Full training suite"],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    rank: 3,
    priceCents: null,              // custom / contact sales
    interval: "month",
    stripePriceId: null,
    description: "Unlimited scale with a dedicated analyst and custom terms.",
    limits: {
      endpoints: null,
      policies: null,
      programs: null,
      trainingPrograms: null,
      analystSupport: "dedicated",
    },
    features: ["Unlimited endpoints", "Everything in Pro", "Dedicated analyst", "Custom contract & SLA"],
  },
};

// Ordered list (low → high) for UI dropdowns and up/downgrade logic.
export const TIER_ORDER = ["free", "starter", "pro", "enterprise"];

export const DEFAULT_TIER = "free";

export function getTier(tierId) {
  return TIERS[tierId] || TIERS[DEFAULT_TIER];
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
