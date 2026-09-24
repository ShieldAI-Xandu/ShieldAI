// scripts/setupStripeProducts.js
//
// One-time setup: creates the ShieldAI vCISO Products & Prices in Stripe and
// prints the exact STRIPE_PRICE_* environment lines to set on the server.
//
// This script is NEVER run automatically, and running it does nothing to the
// app until YOU set the printed variables and BILLING_ENABLED=true. It only
// touches Stripe — never this deployment or its environment.
//
// Usage (TEST mode first — always):
//   STRIPE_SECRET_KEY=sk_test_xxx node scripts/setupStripeProducts.js
//   (or: npm run stripe:setup, with the key in your shell/.env)
// A LIVE key is refused unless you also pass --i-know-this-is-live.
// Optional: --archive-old  deactivates superseded active prices (existing
//   subscribers are unaffected; archived prices simply can't be chosen again).
//
// Idempotent: each product is tagged with a metadata key identifying which
// tier/add-on it is, and re-running finds the existing product/price by that
// tag instead of creating a duplicate. Safe to run again.
//
// The framework add-on price is created for completeness/reporting, but that
// add-on is invoiced by an admin (Stripe Invoicing) and billed as an invoice
// line, so STRIPE_PRICE_COMPLIANCE_FRAMEWORK is optional.

import Stripe from "stripe";
import { STRIPE_API_VERSION, PRICE_ENV, modeOfKey } from "../stripeConfig.js";

const args = new Set(process.argv.slice(2));
const SECRET = String(process.env.STRIPE_SECRET_KEY || "").trim();
if (!SECRET) {
  console.error("Set STRIPE_SECRET_KEY before running this script.");
  console.error("  Example: STRIPE_SECRET_KEY=sk_test_xxx node scripts/setupStripeProducts.js");
  process.exit(1);
}
const mode = modeOfKey(SECRET);
if (!mode) {
  console.error("That doesn't look like a Stripe secret key — expected sk_test_/sk_live_ (or a restricted rk_ key).");
  process.exit(1);
}
if (mode === "live" && !args.has("--i-know-this-is-live")) {
  console.error("Refusing to run against a LIVE key without --i-know-this-is-live. Use a test key first.");
  process.exit(1);
}

const stripe = new Stripe(SECRET, { apiVersion: STRIPE_API_VERSION, appInfo: { name: "ShieldAI vCISO setup" } });

// Mirrors tiers.js as plain data so this script can run standalone.
// Free ($0) and Managed (contact-sales) intentionally have no Stripe price.
const ITEMS = [
  { kind: "tier",  id: "starter", name: "ShieldAI vCISO Starter",  priceCents: 15900 },
  { kind: "tier",  id: "growth",  name: "ShieldAI vCISO Growth",   priceCents: 34900 },
  { kind: "tier",  id: "guided",  name: "ShieldAI vCISO Guided",   priceCents: 69900 },
  { kind: "addon", id: "training_delivery", name: "ShieldAI vCISO Training Delivery Add-on", priceCents: 4000 },
  { kind: "addon", id: "compliance_framework", name: "ShieldAI vCISO Additional Compliance Framework", priceCents: 4999 },
];

// Page through everything (the old version stopped at 100 products).
async function findExistingProduct(metadataKey, id) {
  for await (const p of stripe.products.list({ limit: 100, active: true })) {
    if (p.metadata?.[metadataKey] === id) return p;
  }
  return null;
}

async function ensurePriceFor(item) {
  const metadataKey = item.kind === "tier" ? "shieldaiTierId" : "shieldaiAddonId";
  let product = await findExistingProduct(metadataKey, item.id);
  if (product) {
    console.log(`↺ Product already exists for "${item.id}": ${product.id} — reusing it.`);
  } else {
    product = await stripe.products.create(
      { name: item.name, metadata: { [metadataKey]: item.id } },
      { idempotencyKey: `shieldai-setup-product-${item.id}` },
    );
    console.log(`✓ Created product for "${item.id}": ${product.id}`);
  }

  // Reuse an existing active recurring-monthly-USD price at the right amount.
  const active = [];
  for await (const pr of stripe.prices.list({ product: product.id, active: true, limit: 100 })) active.push(pr);
  const matches = (p) => p.unit_amount === item.priceCents && p.recurring?.interval === "month" && p.currency === "usd";
  let price = active.find(matches);
  if (price) {
    console.log(`  ↺ Reusing existing price: ${price.id} ($${(item.priceCents / 100).toFixed(2)}/mo)`);
  } else {
    price = await stripe.prices.create({
      product: product.id, unit_amount: item.priceCents, currency: "usd",
      recurring: { interval: "month" }, metadata: { [metadataKey]: item.id },
    }, { idempotencyKey: `shieldai-setup-price-${item.id}-${item.priceCents}` });
    console.log(`  ✓ Created price: ${price.id} ($${(item.priceCents / 100).toFixed(2)}/mo)`);
  }

  // A changed amount leaves the old price active. Say so; archive only on request.
  const stale = active.filter(p => p.id !== price.id);
  for (const old of stale) {
    if (args.has("--archive-old")) {
      await stripe.prices.update(old.id, { active: false });
      console.log(`  ⌫ Archived superseded price ${old.id} ($${((old.unit_amount || 0) / 100).toFixed(2)}/${old.recurring?.interval || "one-time"})`);
    } else {
      console.log(`  ! Older active price still exists: ${old.id} ($${((old.unit_amount || 0) / 100).toFixed(2)}) — re-run with --archive-old to deactivate it.`);
    }
  }
  return { ...item, priceId: price.id };
}

console.log(`Running against Stripe in ${mode === "live" ? "LIVE ⚠️  (real money)" : "TEST"} mode (API ${STRIPE_API_VERSION}).\n`);

const results = [];
for (const item of ITEMS) results.push(await ensurePriceFor(item));

console.log("\n── Set these environment variables (Railway → Variables, or your local .env) ──\n");
for (const r of results) {
  console.log(`${PRICE_ENV[r.id]}=${r.priceId}     # ${r.name}, $${(r.priceCents / 100).toFixed(2)}/mo`);
}
console.log("\nThen, when you are ready to switch billing on (see BILLING_SETUP.md):");
console.log("  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, APP_URL, and BILLING_ENABLED=true");
console.log("Nothing is live until BILLING_ENABLED=true — this script only touches Stripe.");
