// scripts/setupStripeProducts.js
//
// One-time setup script: creates the ShieldAI Products & Prices in Stripe and
// prints the exact stripePriceId values to paste into tiers.js.
//
// This script is NEVER run automatically by ShieldAI, and running it does
// nothing until YOU execute it with YOUR OWN Stripe secret key. It's the
// "make it active" step that's deliberately left to you — see BILLING_SETUP.md.
//
// Usage:
//   STRIPE_SECRET_KEY=sk_test_xxx node scripts/setupStripeProducts.js
//
// Use a TEST key (sk_test_...) first and confirm everything looks right in
// the Stripe Dashboard before ever pointing this at a live key. The script
// prints which mode it's running in so you don't do this by accident.
//
// Idempotent: each product is tagged with a metadata key identifying which
// ShieldAI tier/add-on it is. Re-running the script finds the existing
// product/price by that tag instead of creating a duplicate — safe to run
// again if you tweak a price or just want to confirm nothing's missing.

import Stripe from "stripe";

const SECRET = process.env.STRIPE_SECRET_KEY;
if (!SECRET) {
  console.error("Set STRIPE_SECRET_KEY before running this script.");
  console.error("  Example: STRIPE_SECRET_KEY=sk_test_xxx node scripts/setupStripeProducts.js");
  process.exit(1);
}
if (!SECRET.startsWith("sk_test_") && !SECRET.startsWith("sk_live_")) {
  console.error("That doesn't look like a Stripe secret key — it should start with sk_test_ or sk_live_.");
  process.exit(1);
}
const isLive = SECRET.startsWith("sk_live_");

const stripe = new Stripe(SECRET);

// Mirrors tiers.js. Kept as plain data here (not imported from tiers.js) so
// this script has zero dependency on the app's module graph and can be run
// completely standalone, even before the app is deployed anywhere.
// Free ($0) and Managed (contact-sales, not self-serve — see
// SELF_SERVE_PAID_TIERS in tiers.js) intentionally have no Stripe price.
const ITEMS = [
  { kind: "tier",  id: "starter", name: "ShieldAI Starter",  priceCents: 15900 },
  { kind: "tier",  id: "growth",  name: "ShieldAI Growth",   priceCents: 34900 },
  { kind: "tier",  id: "guided",  name: "ShieldAI Guided",   priceCents: 69900 },
  { kind: "addon", id: "training_delivery", name: "ShieldAI Training Delivery Add-on", priceCents: 4000 },
];

async function findExistingProduct(metadataKey, id) {
  // list+filter rather than the Search API: works on every account with no
  // extra enablement step, and is plenty fast at this handful-of-products scale.
  const products = await stripe.products.list({ limit: 100, active: true });
  return products.data.find(p => p.metadata?.[metadataKey] === id) || null;
}

async function ensurePriceFor(item) {
  const metadataKey = item.kind === "tier" ? "shieldaiTierId" : "shieldaiAddonId";
  let product = await findExistingProduct(metadataKey, item.id);
  if (product) {
    console.log(`↺ Product already exists for "${item.id}": ${product.id} — reusing it.`);
  } else {
    product = await stripe.products.create({
      name: item.name,
      metadata: { [metadataKey]: item.id },
    });
    console.log(`✓ Created product for "${item.id}": ${product.id}`);
  }

  // Reuse an existing active recurring-monthly-USD price at the right amount
  // rather than creating a duplicate if one's already attached.
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  let price = prices.data.find(p =>
    p.unit_amount === item.priceCents && p.recurring?.interval === "month" && p.currency === "usd"
  );
  if (price) {
    console.log(`  ↺ Reusing existing price: ${price.id} ($${(item.priceCents / 100).toFixed(2)}/mo)`);
  } else {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: item.priceCents,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: { [metadataKey]: item.id },
    });
    console.log(`  ✓ Created price: ${price.id} ($${(item.priceCents / 100).toFixed(2)}/mo)`);
  }
  return { ...item, priceId: price.id };
}

console.log(`Running against Stripe in ${isLive ? "LIVE ⚠️  (real money)" : "TEST"} mode.\n`);

const results = [];
for (const item of ITEMS) {
  results.push(await ensurePriceFor(item));
}

console.log("\n── Paste these into tiers.js ──────────────────────────────────────\n");
for (const r of results) {
  const path = r.kind === "tier" ? `TIERS.${r.id}` : `ADDONS.${r.id}`;
  console.log(`${path}.stripePriceId = "${r.priceId}";   // ${r.name}, $${(r.priceCents / 100).toFixed(2)}/mo`);
}
console.log("\nConcretely: open tiers.js and set stripePriceId on each matching entry above.");
console.log("Then set STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET, once the webhook is");
console.log('added — see BILLING_SETUP.md) in the running environment and restart the');
console.log('backend. You should see "ShieldAI billing: Stripe configured." in the logs.');
console.log("\nNothing is live until you do that — this script only touches Stripe, never");
console.log("your ShieldAI deployment or its environment variables.");
