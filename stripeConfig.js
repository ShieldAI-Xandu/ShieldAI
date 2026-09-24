// stripeConfig.js
// Reads and VALIDATES the billing environment in one place. Pure (no I/O, no
// Stripe import), so it is trivially testable and can never make a network call.
//
// THE MASTER SWITCH
// -----------------
// Billing is built but OFF. It only turns on when BILLING_ENABLED is exactly
// the string "true" AND every safety requirement below is met. Anything else
// yields { enabled:false, reason } and billingRoutes.js behaves exactly as it
// did when Stripe was deferred: every money-moving route returns 503, and the
// read-only routes (/plans, /me) keep working.
//
// SAFETY RULES (each one turns billing off with a reason rather than guessing):
//   - the secret key must be a real Stripe key (sk_/rk_ + test|live);
//   - a LIVE key is refused unless BILLING_ALLOW_LIVE="true" is ALSO set, so
//     nobody flips real money on by pasting one variable;
//   - the webhook signing secret is mandatory (checkout without a working
//     webhook would take payment and never grant the plan);
//   - return URLs (APP_URL) must be https in live mode.
//
// Secrets are never logged or returned; `describe()` output is safe to print.

// The Stripe API version the integration is written against. Pinned so a
// dashboard/SDK upgrade can't silently change response shapes (e.g. where a
// subscription's period end lives). Bump deliberately, with tests.
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

const bool = (v) => String(v ?? "").trim().toLowerCase() === "true";
const int = (v, dflt, min = 0, max = 3650) => {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/** "test" | "live" | null (not a recognisable Stripe secret/restricted key). */
export function modeOfKey(key) {
  const k = String(key || "").trim();
  if (/^(sk|rk)_test_[A-Za-z0-9]+/.test(k)) return "test";
  if (/^(sk|rk)_live_[A-Za-z0-9]+/.test(k)) return "live";
  return null;
}

// Env var per sellable price. Tier prices and add-ons are looked up by these
// first, then by the `stripePriceId` in tiers.js (kept as a fallback).
export const PRICE_ENV = {
  starter: "STRIPE_PRICE_STARTER",
  growth: "STRIPE_PRICE_GROWTH",
  guided: "STRIPE_PRICE_GUIDED",
  training_delivery: "STRIPE_PRICE_TRAINING_DELIVERY",
  compliance_framework: "STRIPE_PRICE_COMPLIANCE_FRAMEWORK",
};

export function resolveBillingConfig(env = process.env) {
  const off = (reason, extra = {}) => ({ enabled: false, reason, mode: null, ...base(env), ...extra });

  if (!bool(env.BILLING_ENABLED)) return off("BILLING_ENABLED is not set to \"true\" (billing is switched off).");

  const secret = String(env.STRIPE_SECRET_KEY || "").trim();
  if (!secret) return off("STRIPE_SECRET_KEY is not set.");
  const mode = modeOfKey(secret);
  if (!mode) return off("STRIPE_SECRET_KEY is not a Stripe secret/restricted key (expected sk_test_/sk_live_/rk_test_/rk_live_).");
  if (mode === "live" && !bool(env.BILLING_ALLOW_LIVE)) {
    return off("A LIVE Stripe key is configured but BILLING_ALLOW_LIVE is not \"true\" — refusing to move real money.");
  }

  const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!webhookSecret) return off("STRIPE_WEBHOOK_SECRET is not set (a verified webhook is required).");
  if (!/^whsec_/.test(webhookSecret)) return off("STRIPE_WEBHOOK_SECRET does not look like a Stripe signing secret (whsec_...).");

  let appUrl = String(env.APP_URL || "").trim().replace(/\/+$/, "");
  if (!appUrl) {
    if (mode === "live") return off("APP_URL is not set (required in live mode for checkout return URLs).");
    appUrl = "http://localhost:5173";           // test mode only: local dev default
  }
  if (!/^https?:\/\/[^\s/]+/i.test(appUrl)) return off("APP_URL is not a valid http(s) URL.");
  if (mode === "live" && !/^https:\/\//i.test(appUrl)) return off("APP_URL must be https in live mode.");
  if (mode === "live" && /localhost|127\.0\.0\.1/i.test(appUrl)) return off("APP_URL points at localhost in live mode.");

  return { enabled: true, reason: null, mode, secret, webhookSecret, appUrl, ...base(env) };
}

// Settings that don't depend on whether billing is enabled.
function base(env) {
  const prices = {};
  for (const [id, name] of Object.entries(PRICE_ENV)) {
    const v = String(env[name] || "").trim();
    if (v) prices[id] = v;
  }
  return {
    apiVersion: STRIPE_API_VERSION,
    prices,                                   // env overrides only; see priceIdFor()
    // Feature flags — each defaults OFF so enabling billing never silently
    // turns on a payment method or tax behaviour that needs dashboard setup.
    ach: bool(env.BILLING_ACH),               // us_bank_account via Financial Connections
    automaticTax: bool(env.BILLING_AUTOMATIC_TAX),
    promoCodes: bool(env.BILLING_PROMO_CODES),
    pastDueGraceDays: int(env.BILLING_PAST_DUE_GRACE_DAYS, 7, 0, 90),
    invoiceDaysUntilDue: int(env.BILLING_INVOICE_DAYS_UNTIL_DUE, 14, 1, 90),
    rateLimitMax: int(env.BILLING_RATE_LIMIT_MAX, 30, 1, 10000),
  };
}

/**
 * The Stripe price id to use for a tier or add-on: the env var if set,
 * otherwise the `stripePriceId` recorded in tiers.js, otherwise null.
 * `catalogEntry` is a TIERS[id] / ADDONS[id] object.
 */
export function priceIdFor(config, id, catalogEntry) {
  return config?.prices?.[id] || catalogEntry?.stripePriceId || null;
}

/** A one-line, secret-free description for the startup log. */
export function describe(config) {
  if (!config.enabled) return `billing OFF — ${config.reason}`;
  const flags = [config.ach && "ACH", config.automaticTax && "tax", config.promoCodes && "promo"].filter(Boolean);
  return `billing ON (${config.mode} mode, API ${config.apiVersion}${flags.length ? ", " + flags.join("+") : ""})`;
}
