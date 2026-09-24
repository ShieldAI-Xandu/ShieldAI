// billing.test.mjs — the Stripe integration, tested against a FAKE Stripe client.
// Nothing here touches the network or a real key.
//   node --test billing.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { resolveBillingConfig, modeOfKey, STRIPE_API_VERSION } from "./stripeConfig.js";
import { registerBillingRoutes, periodEndOf } from "./billingRoutes.js";
import { newEntitlement, setInvoiceState } from "./frameworkEntitlements.js";

const WHSEC = "whsec_testsecret";
const ENV = {
  BILLING_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_abc123", STRIPE_WEBHOOK_SECRET: WHSEC,
  APP_URL: "http://localhost:5173", BILLING_RATE_LIMIT_MAX: "1000",
  STRIPE_PRICE_STARTER: "price_starter", STRIPE_PRICE_GROWTH: "price_growth", STRIPE_PRICE_GUIDED: "price_guided",
  STRIPE_PRICE_TRAINING_DELIVERY: "price_train", STRIPE_PRICE_COMPLIANCE_FRAMEWORK: "price_fw",
  BILLING_ACH: "true",
};

// ── fake Stripe ─────────────────────────────────────────────
function fakeStripe() {
  const s = { calls: [], subs: {}, failNextList: false, failFinalize: false, n: 0, deleted: [] };
  const rec = (name, ...a) => s.calls.push([name, ...a]);
  s.webhooks = { constructEvent(body, sig, secret) {
    if (secret !== WHSEC || sig !== "valid") throw new Error("bad signature");
    return JSON.parse(body.toString("utf8"));
  } };
  s.customers = { create: async (p, o) => { rec("customers.create", p, o); await new Promise(r => setTimeout(r, 15)); return { id: `cus_${++s.n}` }; } };
  s.checkout = { sessions: { create: async (p, o) => { rec("checkout.create", p, o); return { url: `https://checkout.test/${++s.n}` }; } } };
  s.billingPortal = { sessions: { create: async (p) => { rec("portal.create", p); return { url: "https://portal.test/x" }; } } };
  s.subscriptions = { list: async (p) => {
    rec("subs.list", p);
    if (s.failNextList) { s.failNextList = false; throw new Error("stripe down"); }
    return { data: s.subs[p.customer] || [], has_more: false };
  } };
  s.invoices = {
    create: async (p, o) => { rec("invoices.create", p, o); return { id: `in_${++s.n}` }; },
    finalizeInvoice: async (id) => { rec("invoices.finalize", id); if (s.failFinalize) throw new Error("finalize failed"); return { id, hosted_invoice_url: `https://invoice.test/${id}`, amount_due: 4999, currency: "usd", number: "AB-0001" }; },
    sendInvoice: async (id) => { rec("invoices.send", id); return { id, hosted_invoice_url: `https://invoice.test/${id}`, amount_due: 4999, currency: "usd", number: "AB-0001" }; },
    del: async (id) => { rec("invoices.del", id); s.deleted.push(id); },
  };
  s.invoiceItems = { create: async (p, o) => { rec("invoiceItems.create", p, o); return { id: `ii_${++s.n}` }; } };
  return s;
}

async function boot({ env = ENV, stripe = fakeStripe(), users, subs = [], ents = [] } = {}) {
  const db = { data: {
    users: users || [
      { id: "u1", email: "one@x.com", companyName: "One", tier: "free" },
      { id: "u2", email: "two@x.com", companyName: "Two", tier: "starter" },
      { id: "adm", email: "adm@x.com", isAdmin: true },
    ],
    subscriptions: subs, transactions: [], stripeEvents: [], frameworkEntitlements: ents, adminAudit: [], notifications: [],
  }, write: async () => {} };
  const app = express();
  app.use((req, res, next) => req.originalUrl.split("?")[0] === "/api/billing/webhook" ? next() : express.json()(req, res, next));
  const requireAuth = (req, res, next) => {
    const u = db.data.users.find(x => x.id === req.headers["x-user"]);
    if (!u) return res.status(401).json({ error: "no" });
    req.userId = u.id; req.userEmail = u.email; req.isAdmin = !!u.isAdmin; next();
  };
  const requireAdmin = (req, res, next) => requireAuth(req, res, () => req.isAdmin ? next() : res.status(403).json({ error: "admin" }));
  const origLog = console.log, origWarn = console.warn, origErr = console.error;
  console.log = console.warn = console.error = () => {};
  await registerBillingRoutes(app, { db, requireAuth, requireAdmin, express, env, stripeClient: stripe });
  console.log = origLog; console.warn = origWarn; console.error = origErr;
  const srv = app.listen(0); const port = srv.address().port;
  const call = async (method, path, user, body, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: { "content-type": "application/json", ...(user ? { "x-user": user } : {}), ...headers },
      body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
    });
    let j = null; try { j = await r.json(); } catch { /* not json */ }
    return { status: r.status, body: j };
  };
  const hook = (event, sig = "valid", path = "/api/billing/webhook") => call("POST", path, null, event, { "stripe-signature": sig });
  return { db, stripe, call, hook, stop: () => srv.close() };
}

let evn = 0;
const evt = (type, object, extra = {}) => ({ id: `evt_${++evn}`, type, livemode: false, data: { object }, ...extra });
const activeSub = (priceId, extra = {}) => ({ id: "sub_" + Math.random().toString(36).slice(2), status: "active",
  current_period_end: 1893456000, items: { data: [{ price: { id: priceId } }] }, ...extra });
const withStripeSub = (ctx, userId, customer, subsList) => {
  ctx.db.data.subscriptions.push({ id: "s_" + userId, userId, tier: "free", status: "free", stripeCustomerId: customer, stripeSubscriptionId: null, addons: [] });
  ctx.stripe.subs[customer] = subsList;
};

// ── config ──────────────────────────────────────────────────
test("config: off unless BILLING_ENABLED is exactly true", () => {
  for (const v of [undefined, "", "1", "TRUE ", "yes", "false"]) {
    if (v === "TRUE ") continue;                         // trim+lowercase makes this a valid "true"
    assert.equal(resolveBillingConfig({ ...ENV, BILLING_ENABLED: v }).enabled, false, `BILLING_ENABLED=${v}`);
  }
  assert.equal(resolveBillingConfig(ENV).enabled, true);
  assert.equal(resolveBillingConfig({}).enabled, false);
});
test("config: refuses a live key without BILLING_ALLOW_LIVE; allows it with", () => {
  const live = { ...ENV, STRIPE_SECRET_KEY: "sk_live_abc123", APP_URL: "https://app.example.com" };
  const off = resolveBillingConfig(live);
  assert.equal(off.enabled, false); assert.match(off.reason, /BILLING_ALLOW_LIVE/);
  const on = resolveBillingConfig({ ...live, BILLING_ALLOW_LIVE: "true" });
  assert.equal(on.enabled, true); assert.equal(on.mode, "live");
});
test("config: webhook secret is mandatory and must look real", () => {
  assert.equal(resolveBillingConfig({ ...ENV, STRIPE_WEBHOOK_SECRET: "" }).enabled, false);
  assert.equal(resolveBillingConfig({ ...ENV, STRIPE_WEBHOOK_SECRET: "nope" }).enabled, false);
});
test("config: live mode needs an https, non-localhost APP_URL; bad keys rejected", () => {
  const live = { ...ENV, STRIPE_SECRET_KEY: "sk_live_abc123", BILLING_ALLOW_LIVE: "true" };
  assert.equal(resolveBillingConfig({ ...live, APP_URL: "http://app.example.com" }).enabled, false);
  assert.equal(resolveBillingConfig({ ...live, APP_URL: "https://localhost:3000" }).enabled, false);
  assert.equal(resolveBillingConfig({ ...live, APP_URL: "" }).enabled, false);
  assert.equal(resolveBillingConfig({ ...ENV, STRIPE_SECRET_KEY: "pk_test_abc" }).enabled, false);
  assert.equal(modeOfKey("rk_test_zzz"), "test"); assert.equal(modeOfKey("garbage"), null);
});
test("config: the secret never appears in a disabled config; API version is pinned", () => {
  const off = resolveBillingConfig({ ...ENV, BILLING_ENABLED: "false" });
  assert.equal(off.secret, undefined); assert.equal(off.webhookSecret, undefined);
  assert.equal(off.apiVersion, STRIPE_API_VERSION); assert.match(STRIPE_API_VERSION, /^\d{4}-\d{2}-\d{2}/);
});
test("periodEndOf reads both the legacy and the item-level location", () => {
  assert.equal(periodEndOf({ current_period_end: 1893456000 }), "2030-01-01T00:00:00.000Z");
  assert.equal(periodEndOf({ items: { data: [{ current_period_end: 1893456000 }, { current_period_end: 1893542400 }] } }), "2030-01-02T00:00:00.000Z");
  assert.equal(periodEndOf({}), null);
});

// ── OFF means OFF ───────────────────────────────────────────
test("OFF: every money-moving route is 503, webhook 503, Stripe never touched; reads still work", async () => {
  const stripe = fakeStripe();
  const c = await boot({ env: { ...ENV, BILLING_ENABLED: undefined }, stripe });
  try {
    for (const [m, p, b] of [["POST", "/api/billing/checkout", { tier: "growth" }], ["POST", "/api/billing/checkout-addon", { addon: "training_delivery" }],
      ["POST", "/api/billing/portal", {}]]) {
      const r = await c.call(m, p, "u1", b); assert.equal(r.status, 503, p); assert.equal(r.body.code, "BILLING_DISABLED");
      assert.ok(!/STRIPE|env|BILLING_ENABLED/i.test(JSON.stringify(r.body)), "no config hints leak to clients");
    }
    assert.equal((await c.hook(evt("invoice.paid", {}))).status, 503);
    assert.equal((await c.call("POST", "/api/admin/billing/framework-addons/x/invoice", "adm", {})).status, 503);
    const plans = await c.call("GET", "/api/billing/plans", "u1"); assert.equal(plans.status, 200); assert.equal(plans.body.configured, false);
    assert.equal((await c.call("GET", "/api/billing/me", "u1")).status, 200);
    assert.equal((await c.call("GET", "/api/billing/invoices", "u1")).status, 200);
    assert.equal(stripe.calls.length, 0, "the Stripe client must never be used while OFF");
  } finally { c.stop(); }
});
test("OFF: a live key without the live opt-in is also fully off", async () => {
  const stripe = fakeStripe();
  const c = await boot({ env: { ...ENV, STRIPE_SECRET_KEY: "sk_live_abc123" }, stripe });
  try {
    assert.equal((await c.call("POST", "/api/billing/checkout", "u1", { tier: "growth" })).status, 503);
    assert.equal(stripe.calls.length, 0);
  } finally { c.stop(); }
});

// ── checkout (payments) ─────────────────────────────────────
test("checkout: builds a hardened session (ref id, metadata, ACH + Financial Connections, idempotency)", async () => {
  const c = await boot();
  try {
    const r = await c.call("POST", "/api/billing/checkout", "u1", { tier: "growth" });
    assert.equal(r.status, 200); assert.match(r.body.url, /^https:\/\/checkout\.test\//);
    const cust = c.stripe.calls.find(x => x[0] === "customers.create");
    assert.equal(cust[1].metadata.shieldaiUserId, "u1"); assert.equal(cust[2].idempotencyKey, "customer:u1");
    const [, p, o] = c.stripe.calls.find(x => x[0] === "checkout.create");
    assert.equal(p.mode, "subscription"); assert.equal(p.client_reference_id, "u1");
    assert.deepEqual(p.line_items, [{ price: "price_growth", quantity: 1 }]);
    assert.equal(p.subscription_data.metadata.shieldaiUserId, "u1");
    assert.deepEqual(p.payment_method_types, ["card", "us_bank_account"]);
    assert.deepEqual(p.payment_method_options.us_bank_account.financial_connections.permissions, ["payment_method"]);
    assert.match(p.success_url, /billing=success&session_id=\{CHECKOUT_SESSION_ID\}/); assert.match(p.cancel_url, /billing=cancelled/);
    assert.match(o.idempotencyKey, /^checkout:tier:growth:u1:\d+$/);
    assert.equal(p.automatic_tax, undefined, "tax is off unless its flag is on");
  } finally { c.stop(); }
});
test("checkout: ACH/tax/promo are off by default and on only with their flags", async () => {
  const c = await boot({ env: { ...ENV, BILLING_ACH: undefined } });
  try {
    await c.call("POST", "/api/billing/checkout", "u1", { tier: "starter" });
    const [, p] = c.stripe.calls.find(x => x[0] === "checkout.create");
    assert.equal(p.payment_method_types, undefined); assert.equal(p.allow_promotion_codes, undefined);
  } finally { c.stop(); }
  const d = await boot({ env: { ...ENV, BILLING_AUTOMATIC_TAX: "true", BILLING_PROMO_CODES: "true" } });
  try {
    await d.call("POST", "/api/billing/checkout", "u1", { tier: "starter" });
    const [, p] = d.stripe.calls.find(x => x[0] === "checkout.create");
    assert.deepEqual(p.automatic_tax, { enabled: true }); assert.equal(p.tax_id_collection.enabled, true); assert.equal(p.allow_promotion_codes, true);
  } finally { d.stop(); }
});
test("checkout: rejects unknown/contact-sales tiers, missing price, and a second subscription", async () => {
  const c = await boot();
  try {
    assert.equal((await c.call("POST", "/api/billing/checkout", "u1", { tier: "managed" })).status, 400);
    assert.equal((await c.call("POST", "/api/billing/checkout", "u1", { tier: "nope" })).status, 400);
    c.db.data.subscriptions.push({ id: "s", userId: "u2", tier: "starter", status: "active", stripeCustomerId: "cus_x", stripeSubscriptionId: "sub_x", addons: [] });
    const dup = await c.call("POST", "/api/billing/checkout", "u2", { tier: "growth" });
    assert.equal(dup.status, 409); assert.equal(dup.body.code, "USE_PORTAL");
    assert.ok(!c.stripe.calls.some(x => x[0] === "checkout.create"), "no second checkout session");
  } finally { c.stop(); }
  const noPrice = await boot({ env: { ...ENV, STRIPE_PRICE_GROWTH: undefined } });
  try {
    const r = await noPrice.call("POST", "/api/billing/checkout", "u1", { tier: "growth" });
    assert.equal(r.status, 503); assert.equal(r.body.code, "PRICE_NOT_CONFIGURED");
  } finally { noPrice.stop(); }
});
test("checkout: two simultaneous checkouts create exactly ONE Stripe customer", async () => {
  const c = await boot();
  try {
    const [a, b] = await Promise.all([c.call("POST", "/api/billing/checkout", "u1", { tier: "growth" }), c.call("POST", "/api/billing/checkout", "u1", { tier: "guided" })]);
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.equal(c.stripe.calls.filter(x => x[0] === "customers.create").length, 1);
    assert.equal(c.db.data.subscriptions.filter(s => s.userId === "u1").length, 1);
  } finally { c.stop(); }
});
test("add-on checkout: available add-on works; owned/unavailable/framework add-on are rejected", async () => {
  const c = await boot();
  try {
    const ok = await c.call("POST", "/api/billing/checkout-addon", "u2", { addon: "training_delivery" });
    assert.equal(ok.status, 200);
    assert.equal((await c.call("POST", "/api/billing/checkout-addon", "u2", { addon: "compliance_framework" })).status, 400, "the framework add-on is invoiced, not checked out");
    c.db.data.users.find(u => u.id === "u2").addons = ["training_delivery"];
    assert.equal((await c.call("POST", "/api/billing/checkout-addon", "u2", { addon: "training_delivery" })).body.code, "ADDON_ALREADY_OWNED");
    assert.equal((await c.call("POST", "/api/billing/checkout-addon", "u1", { addon: "training_delivery" })).status, 400, "not offered on the free tier");
  } finally { c.stop(); }
});
test("portal: needs a billing account; returns the portal url", async () => {
  const c = await boot();
  try {
    assert.equal((await c.call("POST", "/api/billing/portal", "u1", {})).status, 400);
    c.db.data.subscriptions.push({ id: "s", userId: "u1", stripeCustomerId: "cus_1", addons: [] });
    const r = await c.call("POST", "/api/billing/portal", "u1", {});
    assert.equal(r.status, 200); assert.match(r.body.url, /portal\.test/);
    assert.match(c.stripe.calls.find(x => x[0] === "portal.create")[1].return_url, /billing=portal_return/);
  } finally { c.stop(); }
});

// ── webhook: security ───────────────────────────────────────
test("webhook: a bad or missing signature is rejected and changes nothing", async () => {
  const c = await boot();
  try {
    withStripeSub(c, "u1", "cus_1", [activeSub("price_growth")]);
    const ev = evt("customer.subscription.updated", { customer: "cus_1" });
    assert.equal((await c.hook(ev, "forged")).status, 400);
    assert.equal((await c.hook(ev, "")).status, 400);          // empty/missing signature header
    assert.equal(c.db.data.users.find(u => u.id === "u1").tier, "free");
    assert.equal(c.db.data.stripeEvents.length, 0);
  } finally { c.stop(); }
});
test("webhook: with the secret missing, billing is OFF — it never accepts unsigned events", async () => {
  const stripe = fakeStripe();
  const c = await boot({ env: { ...ENV, STRIPE_WEBHOOK_SECRET: "" }, stripe });
  try {
    c.db.data.subscriptions.push({ id: "s", userId: "u1", stripeCustomerId: "cus_1", addons: [] }); stripe.subs.cus_1 = [activeSub("price_growth")];
    const r = await c.hook(evt("customer.subscription.updated", { customer: "cus_1" }));
    assert.equal(r.status, 503); assert.equal(c.db.data.users.find(u => u.id === "u1").tier, "free");
  } finally { c.stop(); }
});
test("webhook: the webhook path still works with a query string", async () => {
  const c = await boot();
  try {
    withStripeSub(c, "u1", "cus_1", [activeSub("price_growth")]);
    const r = await c.hook(evt("customer.subscription.updated", { customer: "cus_1" }), "valid", "/api/billing/webhook?x=1");
    assert.equal(r.status, 200); assert.equal(c.db.data.users.find(u => u.id === "u1").tier, "growth");
  } finally { c.stop(); }
});
test("webhook: an event from the other mode (livemode mismatch) is ignored", async () => {
  const c = await boot();
  try {
    withStripeSub(c, "u1", "cus_1", [activeSub("price_growth")]);
    const r = await c.hook(evt("customer.subscription.updated", { customer: "cus_1" }, { livemode: true }));
    assert.equal(r.status, 200); assert.equal(r.body.ignored, "livemode_mismatch");
    assert.equal(c.db.data.users.find(u => u.id === "u1").tier, "free");
    assert.equal(c.stripe.calls.filter(x => x[0] === "subs.list").length, 0);
  } finally { c.stop(); }
});
test("webhook: the same event id is processed exactly once", async () => {
  const c = await boot();
  try {
    withStripeSub(c, "u1", "cus_1", [activeSub("price_growth")]);
    const ev = evt("customer.subscription.updated", { customer: "cus_1" });
    assert.equal((await c.hook(ev)).body.received, true);
    const again = await c.hook(ev); assert.equal(again.body.duplicate, true);
    assert.equal(c.stripe.calls.filter(x => x[0] === "subs.list").length, 1);
    assert.equal(c.db.data.stripeEvents.length, 1);
  } finally { c.stop(); }
});
test("webhook: a handler failure returns 500 and the retry IS processed (not skipped as a duplicate)", async () => {
  const c = await boot();
  try {
    withStripeSub(c, "u1", "cus_1", [activeSub("price_growth")]);
    c.stripe.failNextList = true;
    const ev = evt("customer.subscription.updated", { customer: "cus_1" });
    assert.equal((await c.hook(ev)).status, 500);
    assert.equal(c.db.data.stripeEvents.length, 0);
    assert.equal((await c.hook(ev)).status, 200);
    assert.equal(c.db.data.users.find(u => u.id === "u1").tier, "growth");
  } finally { c.stop(); }
});
test("webhook: an event for an unknown customer is acknowledged without error", async () => {
  const c = await boot();
  try {
    assert.equal((await c.hook(evt("customer.subscription.updated", { customer: "cus_nobody" }))).status, 200);
    assert.equal((await c.hook(evt("invoice.paid", { id: "in_x", customer: "cus_nobody" }))).status, 200);
    assert.equal(c.db.data.transactions.length, 0);
  } finally { c.stop(); }
});

// ── webhook: subscription state ─────────────────────────────
test("sync: active tier + add-on resolve; the framework price NEVER enters addons", async () => {
  const c = await boot();
  try {
    withStripeSub(c, "u2", "cus_2", [activeSub("price_starter"), activeSub("price_train"), activeSub("price_fw")]);
    await c.hook(evt("customer.subscription.updated", { customer: "cus_2" }));
    const u = c.db.data.users.find(x => x.id === "u2"); const s = c.db.data.subscriptions.find(x => x.userId === "u2");
    assert.equal(u.tier, "starter"); assert.deepEqual(u.addons, ["training_delivery"]); assert.deepEqual(s.addons, ["training_delivery"]);
    assert.equal(s.status, "active"); assert.equal(s.currentPeriodEnd, "2030-01-01T00:00:00.000Z");
  } finally { c.stop(); }
});
test("sync: item-level period end, cancel-at-period-end, and the higher tier wins if two exist", async () => {
  const c = await boot();
  try {
    const item = { id: "sub_a", status: "active", cancel_at_period_end: true, items: { data: [{ price: { id: "price_growth" }, current_period_end: 1893456000 }] } };
    withStripeSub(c, "u1", "cus_1", [item, activeSub("price_starter")]);
    await c.hook(evt("customer.subscription.updated", { customer: "cus_1" }));
    const s = c.db.data.subscriptions.find(x => x.userId === "u1");
    assert.equal(c.db.data.users.find(u => u.id === "u1").tier, "growth");
    assert.equal(s.currentPeriodEnd, "2030-01-01T00:00:00.000Z"); assert.equal(s.cancelAtPeriodEnd, true);
  } finally { c.stop(); }
});
test("sync: past_due keeps the plan, records pastDueSince; recovery clears it", async () => {
  const c = await boot();
  try {
    withStripeSub(c, "u1", "cus_1", [activeSub("price_growth", { status: "past_due" })]);
    await c.hook(evt("customer.subscription.updated", { customer: "cus_1" }));
    let s = c.db.data.subscriptions.find(x => x.userId === "u1");
    assert.equal(c.db.data.users.find(u => u.id === "u1").tier, "growth"); assert.equal(s.status, "past_due"); assert.ok(s.pastDueSince);
    const since = s.pastDueSince;
    const me = await c.call("GET", "/api/billing/me", "u1");
    assert.equal(me.body.subscription.pastDue.since, since); assert.ok(Date.parse(me.body.subscription.pastDue.graceEndsAt) > Date.parse(since));
    c.stripe.subs.cus_1 = [activeSub("price_growth")];
    await c.hook(evt("customer.subscription.updated", { customer: "cus_1" }));
    s = c.db.data.subscriptions.find(x => x.userId === "u1"); assert.equal(s.pastDueSince, null); assert.equal(s.status, "active");
  } finally { c.stop(); }
});
test("sync: unpaid/canceled/none active -> free; an admin-comped plan with nothing live is preserved", async () => {
  const c = await boot();
  try {
    withStripeSub(c, "u2", "cus_2", [activeSub("price_starter", { status: "unpaid" })]);
    c.db.data.users.find(u => u.id === "u2").tier = "starter";
    await c.hook(evt("customer.subscription.deleted", { customer: "cus_2" }));
    assert.equal(c.db.data.users.find(u => u.id === "u2").tier, "free");
    assert.equal(c.db.data.subscriptions.find(x => x.userId === "u2").status, "canceled");
    // comped plan
    c.db.data.subscriptions.push({ id: "m", userId: "u1", tier: "guided", status: "manual", stripeCustomerId: "cus_1", stripeSubscriptionId: null, addons: [] });
    c.db.data.users.find(u => u.id === "u1").tier = "guided"; c.stripe.subs.cus_1 = [];
    await c.hook(evt("customer.subscription.updated", { customer: "cus_1" }));
    assert.equal(c.db.data.users.find(u => u.id === "u1").tier, "guided", "comp must survive an empty Stripe account");
    // ...but a real active subscription overrides the comp
    c.stripe.subs.cus_1 = [activeSub("price_growth")];
    await c.hook(evt("customer.subscription.updated", { customer: "cus_1" }));
    assert.equal(c.db.data.users.find(u => u.id === "u1").tier, "growth");
  } finally { c.stop(); }
});
test("sync: the user is found through client_reference_id when the customer isn't stored yet", async () => {
  const c = await boot();
  try {
    c.stripe.subs.cus_new = [activeSub("price_growth")];
    await c.hook(evt("checkout.session.completed", { mode: "subscription", customer: "cus_new", client_reference_id: "u1" }));
    assert.equal(c.db.data.users.find(u => u.id === "u1").tier, "growth");
    assert.equal(c.db.data.subscriptions.find(s => s.userId === "u1").stripeCustomerId, "cus_new");
    // a hint must not hijack a user who already has a DIFFERENT customer
    c.db.data.subscriptions.push({ id: "z", userId: "u2", stripeCustomerId: "cus_real", addons: [] });
    c.stripe.subs.cus_evil = [activeSub("price_guided")];
    await c.hook(evt("checkout.session.completed", { mode: "subscription", customer: "cus_evil", client_reference_id: "u2" }));
    assert.notEqual(c.db.data.users.find(u => u.id === "u2").tier, "guided");
  } finally { c.stop(); }
});
test("sync: an event with no customer id never lists subscriptions account-wide", async () => {
  const c = await boot();
  try {
    c.stripe.subs[undefined] = [activeSub("price_guided")];          // what an unfiltered list would leak
    for (const obj of [{ client_reference_id: "u1" }, { customer: null, client_reference_id: "u1" }, { customer: { id: "obj" }, client_reference_id: "u1" }]) {
      assert.equal((await c.hook(evt("customer.subscription.updated", obj))).status, 200);
    }
    assert.equal(c.stripe.calls.filter(x => x[0] === "subs.list").length, 0);
    assert.equal(c.db.data.users.find(u => u.id === "u1").tier, "free");
  } finally { c.stop(); }
});
test("sync: non-subscription checkout sessions are ignored", async () => {
  const c = await boot();
  try {
    await c.hook(evt("checkout.session.completed", { mode: "payment", customer: "cus_1", client_reference_id: "u1" }));
    assert.equal(c.stripe.calls.filter(x => x[0] === "subs.list").length, 0);
  } finally { c.stop(); }
});

// ── webhook: invoices / transactions ────────────────────────
test("invoices: one transaction per invoice even across repeated events, and paid is never downgraded", async () => {
  const c = await boot();
  try {
    withStripeSub(c, "u1", "cus_1", []);
    const inv = { id: "in_1", customer: "cus_1", amount_paid: 34900, amount_due: 34900, currency: "usd", created: 1893456000, number: "N-1",
      hosted_invoice_url: "https://h.test/in_1", invoice_pdf: "https://p.test/in_1.pdf", livemode: false, lines: { data: [{ description: "Growth" }] } };
    await c.hook(evt("invoice.paid", inv)); await c.hook(evt("invoice.paid", inv));       // two DIFFERENT event ids, same invoice
    await c.hook(evt("invoice.finalized", inv)); await c.hook(evt("invoice.payment_failed", inv));   // late/out-of-order
    assert.equal(c.db.data.transactions.length, 1);
    const t = c.db.data.transactions[0];
    assert.equal(t.status, "paid"); assert.equal(t.amountCents, 34900); assert.equal(t.number, "N-1");
    assert.equal(t.hostedInvoiceUrl, "https://h.test/in_1"); assert.equal(t.invoicePdf, "https://p.test/in_1.pdf");
    assert.equal(t.createdAt, "2030-01-01T00:00:00.000Z"); assert.equal(t.livemode, false);
  } finally { c.stop(); }
});
test("invoices: a failed payment records a failed row and notifies the client", async () => {
  const c = await boot();
  try {
    withStripeSub(c, "u1", "cus_1", []);
    await c.hook(evt("invoice.payment_failed", { id: "in_f", customer: "cus_1", amount_due: 15900, currency: "usd" }));
    assert.equal(c.db.data.transactions[0].status, "failed");
  } finally { c.stop(); }
});
test("invoices: refunds are recorded once and never counted as paid revenue; disputes need no customer", async () => {
  const c = await boot();
  try {
    withStripeSub(c, "u1", "cus_1", []);
    const ch = { id: "ch_1", customer: "cus_1", invoice: "in_1", amount_refunded: 5000, currency: "usd" };
    await c.hook(evt("charge.refunded", ch)); await c.hook(evt("charge.refunded", ch));
    assert.equal(c.db.data.transactions.filter(t => t.status === "refunded").length, 1);
    const ov = await c.call("GET", "/api/admin/billing/overview", "adm");
    assert.equal(ov.body.totalPaidCents, 0);
    assert.equal((await c.hook(evt("charge.dispute.created", { id: "dp_1", amount: 15900, currency: "usd" }))).status, 200);
  } finally { c.stop(); }
});
test("invoices: GET /api/billing/invoices is scoped to the caller", async () => {
  const c = await boot();
  try {
    c.db.data.transactions.push(
      { id: "t1", userId: "u1", stripeInvoiceId: "in_1", status: "paid", amountCents: 100, currency: "usd", createdAt: "2026-01-01T00:00:00.000Z", hostedInvoiceUrl: "https://h/1" },
      { id: "t2", userId: "u2", stripeInvoiceId: "in_2", status: "paid", amountCents: 999, currency: "usd", createdAt: "2026-01-02T00:00:00.000Z" });
    const mine = await c.call("GET", "/api/billing/invoices", "u1");
    assert.deepEqual(mine.body.invoices.map(i => i.id), ["t1"]);
    assert.equal(mine.body.invoices[0].hostedInvoiceUrl, "https://h/1");
    assert.equal((await c.call("GET", "/api/billing/invoices")).status, 401);
  } finally { c.stop(); }
});

// ── framework add-on invoicing ──────────────────────────────
function pendingEnt(userId = "u2") { return newEntitlement({ userId, frameworkId: "soc2", frameworkName: "SOC 2", status: "pending_billing" }); }

test("framework invoice: an admin creates + sends a Stripe invoice; it is recorded and can't be sent twice", async () => {
  const ent = pendingEnt(); const c = await boot({ ents: [ent] });
  try {
    const r = await c.call("POST", `/api/admin/billing/framework-addons/${ent.id}/invoice`, "adm", {});
    assert.equal(r.status, 200); assert.match(r.body.hostedInvoiceUrl, /invoice\.test/);
    const create = c.stripe.calls.find(x => x[0] === "invoices.create"), item = c.stripe.calls.find(x => x[0] === "invoiceItems.create");
    assert.equal(create[1].collection_method, "send_invoice"); assert.equal(create[1].auto_advance, false);
    assert.equal(create[1].metadata.entitlementId, ent.id); assert.ok(create[2].idempotencyKey);
    assert.equal(item[1].amount, 4999); assert.equal(item[1].currency, "usd");
    assert.deepEqual(c.stripe.calls.map(x => x[0]).filter(n => /invoices\./.test(n)), ["invoices.create", "invoices.finalize", "invoices.send"]);
    assert.equal(ent.billing.invoiceState, "invoiced"); assert.ok(ent.billing.lastInvoiceRef.startsWith("in_"));
    assert.equal(ent.status, "pending_billing", "access status unchanged until paid");
    assert.equal(c.db.data.transactions.filter(t => t.status === "open").length, 1);
    assert.equal(c.db.data.adminAudit.at(-1).action, "framework_addon_billing");
    assert.equal((await c.call("POST", `/api/admin/billing/framework-addons/${ent.id}/invoice`, "adm", {})).body.code, "ALREADY_INVOICED");
  } finally { c.stop(); }
});
test("framework invoice: admin-only; comped/unknown/non-pending add-ons are refused", async () => {
  const ent = pendingEnt(); const comped = newEntitlement({ userId: "u2", status: "comped", billingMode: "comped" });
  const c = await boot({ ents: [ent, comped] });
  try {
    assert.equal((await c.call("POST", `/api/admin/billing/framework-addons/${ent.id}/invoice`, "u1", {})).status, 403);
    assert.equal((await c.call("POST", `/api/admin/billing/framework-addons/${comped.id}/invoice`, "adm", {})).body.code, "NOT_INVOICEABLE");
    assert.equal((await c.call("POST", `/api/admin/billing/framework-addons/nope/invoice`, "adm", {})).status, 404);
    assert.equal(c.stripe.calls.filter(x => x[0] === "invoices.create").length, 0);
  } finally { c.stop(); }
});
test("framework invoice: a Stripe failure deletes the draft, sends nothing, and leaves the add-on unbilled", async () => {
  const ent = pendingEnt(); const c = await boot({ ents: [ent] });
  try {
    c.stripe.failFinalize = true;
    const r = await c.call("POST", `/api/admin/billing/framework-addons/${ent.id}/invoice`, "adm", {});
    assert.equal(r.status, 502); assert.equal(c.stripe.deleted.length, 1);
    assert.ok(!c.stripe.calls.some(x => x[0] === "invoices.send"));
    assert.equal(ent.billing.invoiceState, "not_invoiced");
    c.stripe.failFinalize = false;                                   // retry works with a fresh idempotency key
    assert.equal((await c.call("POST", `/api/admin/billing/framework-addons/${ent.id}/invoice`, "adm", {})).status, 200);
    const keys = c.stripe.calls.filter(x => x[0] === "invoices.create").map(x => x[2].idempotencyKey);
    assert.equal(new Set(keys).size, 2);
  } finally { c.stop(); }
});
test("framework invoice: the paid webhook activates the add-on exactly once, and a later void can't undo it", async () => {
  const ent = pendingEnt(); const c = await boot({ ents: [ent] });
  try {
    await c.call("POST", `/api/admin/billing/framework-addons/${ent.id}/invoice`, "adm", {});
    c.db.data.subscriptions.find(s => s.userId === "u2");           // customer created by the invoice route
    const cust = c.db.data.subscriptions.find(s => s.userId === "u2").stripeCustomerId;
    const inv = { id: ent.billing.lastInvoiceRef, customer: cust, amount_paid: 4999, amount_due: 4999, currency: "usd", metadata: { entitlementId: ent.id }, hosted_invoice_url: "https://h/x" };
    await c.hook(evt("invoice.paid", inv)); await c.hook(evt("invoice.paid", inv));
    assert.equal(ent.billing.invoiceState, "paid"); assert.equal(ent.status, "active"); assert.ok(ent.billing.paidAt && ent.activatedAt);
    const paidAt = ent.billing.paidAt;
    await c.hook(evt("invoice.voided", inv));
    assert.equal(ent.billing.invoiceState, "paid"); assert.equal(ent.billing.paidAt, paidAt);
    assert.equal(c.db.data.transactions.filter(t => t.stripeInvoiceId === inv.id).length, 1);
  } finally { c.stop(); }
});
test("framework invoice: a paid webhook can't activate another customer's add-on", async () => {
  const ent = pendingEnt("u2"); const c = await boot({ ents: [ent] });
  try {
    withStripeSub(c, "u1", "cus_1", []);
    await c.hook(evt("invoice.paid", { id: "in_evil", customer: "cus_1", amount_paid: 1, currency: "usd", metadata: { entitlementId: ent.id } }));
    assert.equal(ent.status, "pending_billing"); assert.equal(ent.billing.invoiceState, "not_invoiced");
  } finally { c.stop(); }
});
test("setInvoiceState: idempotent and never regresses paid", () => {
  const rec = newEntitlement({ userId: "u", status: "pending_billing" });
  assert.equal(setInvoiceState(rec, "invoiced", { ref: "in_1" }).changed, true);
  assert.equal(setInvoiceState(rec, "invoiced").changed, false);
  assert.equal(setInvoiceState(rec, "paid").changed, true); assert.equal(rec.status, "active");
  assert.equal(setInvoiceState(rec, "void").changed, false); assert.equal(rec.billing.invoiceState, "paid");
  assert.equal(setInvoiceState(rec, "bogus").changed, false);
});

// ── admin reads keep working ────────────────────────────────
test("admin reads: overview and worklist work, and report whether Stripe invoicing is available", async () => {
  const ent = pendingEnt(); const c = await boot({ ents: [ent] });
  try {
    const wl = await c.call("GET", "/api/admin/billing/framework-addons", "adm");
    assert.equal(wl.body.pendingCount, 1); assert.equal(wl.body.canInvoiceViaStripe, true);
    assert.equal((await c.call("GET", "/api/admin/billing/overview", "adm")).body.configured, true);
    assert.equal((await c.call("GET", "/api/admin/billing/overview", "u1")).status, 403);
  } finally { c.stop(); }
});
