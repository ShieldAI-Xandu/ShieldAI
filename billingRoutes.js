// billingRoutes.js
// ShieldAI vCISO Stripe billing backend — Billing (subscriptions), Payments
// (Checkout incl. optional ACH via Financial Connections), Invoicing (framework
// add-on) and the webhook that keeps our records in sync.
//
// BUILT BUT OFF. Nothing here talks to Stripe unless BILLING_ENABLED="true" and
// every safety check in stripeConfig.js passes (real key, live-mode opt-in,
// webhook secret, https return URL). When off, every money-moving route
// returns 503 "billing not enabled" and the read-only routes (/plans, /me,
// /invoices, admin reads) keep working from our own data.
//
// SECURITY / PCI: No card or bank data ever touches this server. Card and bank
// entry happens in Stripe-hosted Checkout / the Billing Portal / hosted invoice
// pages. We create customers, sessions and invoices and READ subscription +
// invoice data. Keys come from the environment only and are never logged.
//
// HUMANS ACT: no AI output can trigger anything here. Every charge-related
// action starts from a signed-in user's click or an admin's click.
//
// Mount from server.js:
//   await registerBillingRoutes(app, { db, requireAuth, requireAdmin, express });
// The webhook needs the RAW body; server.js excludes its path from express.json.

import { randomUUID } from "crypto";
import { rateLimit } from "express-rate-limit";
import {
  TIERS, TIER_ORDER, getTier, DEFAULT_TIER, SELF_SERVE_PAID_TIERS, getAddon,
  canPurchaseAddon, ADDONS,
} from "./tiers.js";
import {
  entitlementsFor, publicEntitlement, monthlyCentsFor, activeMonthlyCentsFor,
  pendingBillingEntitlements, ENTITLING_STATUSES, FRAMEWORK_ADDON_ID,
  findEntitlement, setInvoiceState,
} from "./frameworkEntitlements.js";
import { pushNotification } from "./portfolioRoutes.js";
import { resolveBillingConfig, priceIdFor, describe } from "./stripeConfig.js";

const nowIso = () => new Date().toISOString();
const isoFromSeconds = (s) => (s ? new Date(Number(s) * 1000).toISOString() : null);

// Subscription statuses that keep the plan switched on. `past_due` keeps access
// (Stripe is still retrying) — we track since when so the UI can warn; Stripe's
// own dunning settings decide when it turns unpaid/canceled, which drops the plan.
const ACCESS_STATUSES = new Set(["active", "trialing", "past_due"]);
const EVENT_TTL_MS = 30 * 24 * 3600 * 1000;
const STALE_INFLIGHT_MS = 5 * 60 * 1000;

// Where a subscription's period end lives changed across Stripe API versions
// (subscription level -> item level). Read either.
export function periodEndOf(sub) {
  if (!sub) return null;
  if (sub.current_period_end) return isoFromSeconds(sub.current_period_end);
  const ends = (sub.items?.data || []).map(i => i.current_period_end).filter(Boolean);
  return ends.length ? isoFromSeconds(Math.max(...ends)) : null;
}

export async function registerBillingRoutes(app, { db, requireAuth, requireAdmin, express, env = process.env, stripeClient = null }) {
  db.data.subscriptions ||= [];
  db.data.transactions ||= [];
  db.data.stripeEvents ||= [];

  const cfg = resolveBillingConfig(env);
  let stripe = null;
  if (cfg.enabled) {
    try {
      if (stripeClient) {
        stripe = stripeClient;                       // injected (tests) — never the network
      } else {
        const Stripe = (await import("stripe")).default;
        stripe = new Stripe(cfg.secret, {
          apiVersion: cfg.apiVersion,
          maxNetworkRetries: 2,
          appInfo: { name: "ShieldAI vCISO" },
        });
      }
    } catch (err) {
      console.warn("ShieldAI vCISO billing: stripe package not available —", err.message);
    }
  }
  console.log(`ShieldAI vCISO ${stripe ? describe(cfg) : describe({ ...cfg, enabled: false, reason: cfg.reason || "Stripe client unavailable." })}`);

  // Every money-moving route ends here when billing is off. Deliberately
  // generic: no env-var names or config hints go to clients (they're logged above).
  function disabled(res) {
    res.status(503).json({ error: "Billing is not enabled.", code: "BILLING_DISABLED" });
    return false;
  }
  const needStripe = (res) => (stripe ? true : disabled(res));

  // ── price / catalog helpers (env override first, tiers.js as fallback) ──
  const tierPrice = (id) => priceIdFor(cfg, id, TIERS[id]);
  const addonPrice = (id) => priceIdFor(cfg, id, ADDONS[id]);
  function tierFromPriceId(priceId) {
    if (!priceId) return null;
    return TIER_ORDER.find(id => tierPrice(id) === priceId) || null;
  }
  // The framework add-on is an invoiced, countable slot — NEVER a boolean entry
  // in `addons` (that array is re-derived from Stripe and would erase slots).
  function addonFromPriceId(priceId) {
    if (!priceId) return null;
    return Object.keys(ADDONS).find(id => id !== FRAMEWORK_ADDON_ID && addonPrice(id) === priceId) || null;
  }

  // ── data helpers ──
  const findUser = (id) => (db.data.users || []).find(u => u.id === id);
  const getSub = (userId) => (db.data.subscriptions || []).find(s => s.userId === userId) || null;
  function upsertSub(userId, patch) {
    let sub = getSub(userId);
    if (!sub) {
      sub = { id: `sub_${randomUUID()}`, userId, tier: DEFAULT_TIER, status: "free",
              stripeCustomerId: null, stripeSubscriptionId: null, currentPeriodEnd: null,
              addons: [], updatedAt: nowIso() };
      db.data.subscriptions.push(sub);
    }
    Object.assign(sub, patch, { updatedAt: nowIso() });
    return sub;
  }
  function audit(req, action, targetUserId, detail) {
    (db.data.adminAudit ||= []).push({
      id: randomUUID(), actorUserId: req.userId, actorEmail: req.userEmail || "",
      action, targetUserId: targetUserId || null, detail: detail || "", at: nowIso(),
    });
  }
  function notify(userId, type, title, body) {
    try { pushNotification(db, { userId, type, title, body, link: "/", actorRole: "system" }); } catch { /* never block billing on a notification */ }
  }
  function notifyAdmins(type, title, body) {
    for (const u of (db.data.users || [])) if (u.isAdmin) notify(u.id, type, title, body);
  }

  // One Stripe customer per user: a per-user in-process lock plus a Stripe
  // idempotency key, so two simultaneous checkouts can't create two customers.
  const customerLocks = new Map();
  async function ensureCustomer(user) {
    const existing = getSub(user.id)?.stripeCustomerId;
    if (existing) return existing;
    if (customerLocks.has(user.id)) return customerLocks.get(user.id);
    const p = (async () => {
      try {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.companyName || user.email,
          metadata: { shieldaiUserId: user.id },
        }, { idempotencyKey: `customer:${user.id}` });
        upsertSub(user.id, { stripeCustomerId: customer.id });
        await db.write();
        return customer.id;
      } finally {
        customerLocks.delete(user.id);
      }
    })();
    customerLocks.set(user.id, p);
    return p;
  }

  // Money-moving routes get a stricter limit than the global /api limiter.
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: cfg.rateLimitMax, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => String(req.userId || "anon"),
    message: { error: "Too many billing requests. Please wait a few minutes and try again." },
  });

  // ════════════════════════════════════════════════════════════
  //  WEBHOOK — RAW body, signature ALWAYS verified, events de-duplicated.
  // ════════════════════════════════════════════════════════════
  function findUserByCustomer(customerId, hintUserId) {
    if (hintUserId) {
      const hinted = findUser(hintUserId);
      const s = hinted && getSub(hinted.id);
      // Trust the hint only when it can't contradict a customer we already know.
      if (hinted && (!s?.stripeCustomerId || s.stripeCustomerId === customerId)) {
        if (customerId && !s?.stripeCustomerId) upsertSub(hinted.id, { stripeCustomerId: customerId });
        return hinted;
      }
    }
    if (!customerId) return null;
    const s = (db.data.subscriptions || []).find(x => x.stripeCustomerId === customerId);
    return s ? findUser(s.userId) : null;
  }
  const hintOf = (obj) => obj?.metadata?.shieldaiUserId || obj?.client_reference_id
    || obj?.subscription_details?.metadata?.shieldaiUserId || null;

  async function listAllSubscriptions(customerId) {
    const out = [];
    let startingAfter;
    for (let page = 0; page < 5; page++) {           // 500 subscriptions is far beyond any real customer
      const res = await stripe.subscriptions.list({
        customer: customerId, status: "all", limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      out.push(...(res.data || []));
      if (!res.has_more || !res.data?.length) break;
      startingAfter = res.data[res.data.length - 1].id;
    }
    return out;
  }

  // Re-derive the customer's plan + add-ons from Stripe's own list of
  // subscriptions (order-independent, so out-of-order events are harmless).
  async function syncCustomer(customerId, hintUserId) {
    // Never list subscriptions without a customer filter: Stripe would return
    // subscriptions across the WHOLE account and we'd grant one customer's plan
    // to another. A customer-less event has nothing to sync.
    if (!customerId || typeof customerId !== "string") return;
    const user = findUserByCustomer(customerId, hintUserId);
    if (!user) { console.warn("ShieldAI vCISO billing: webhook for an unknown customer (ignored)."); return; }
    const prev = getSub(user.id);
    const subs = await listAllSubscriptions(customerId);
    const active = subs.filter(s => ACCESS_STATUSES.has(s.status));

    let resolvedTier = null, tierSub = null;
    const resolvedAddons = new Set();
    for (const s of active) {
      for (const item of s.items?.data || []) {
        const priceId = item.price?.id;
        const t = tierFromPriceId(priceId);
        if (t) {
          // Two live tier subscriptions shouldn't happen (checkout guards it);
          // if it does, the higher tier wins rather than "whichever came last".
          if (!resolvedTier || TIER_ORDER.indexOf(t) > TIER_ORDER.indexOf(resolvedTier)) { resolvedTier = t; tierSub = s; }
          continue;
        }
        const a = addonFromPriceId(priceId);
        if (a) resolvedAddons.add(a);
      }
    }

    // An admin-comped ("manual") plan with nothing live in Stripe is left
    // alone; a real active Stripe subscription overrides it (webhook wins).
    if (active.length === 0 && prev?.status === "manual" && !prev.stripeSubscriptionId) return;

    if (active.length === 0) {
      upsertSub(user.id, { status: "canceled", tier: DEFAULT_TIER, stripeSubscriptionId: null, addons: [],
        currentPeriodEnd: null, cancelAtPeriodEnd: false, pastDueSince: null, actionRequired: null });
      user.tier = DEFAULT_TIER; user.addons = [];
    } else {
      const tier = resolvedTier || (prev?.status === "manual" ? prev.tier : DEFAULT_TIER);
      const lead = tierSub || active[0];
      const pastDue = active.some(s => s.status === "past_due");
      upsertSub(user.id, {
        tier, status: lead.status, stripeSubscriptionId: lead.id,
        currentPeriodEnd: periodEndOf(lead),
        cancelAtPeriodEnd: !!(lead.cancel_at_period_end || lead.cancel_at),
        pastDueSince: pastDue ? (prev?.pastDueSince || nowIso()) : null,
        actionRequired: lead.status === "active" ? null : (prev?.actionRequired || null),
        addons: [...resolvedAddons], livemode: cfg.mode === "live",
      });
      user.tier = tier;
      user.addons = [...resolvedAddons];
    }
    await db.write();
  }

  // Insert or update one transaction row per Stripe invoice (idempotent).
  const RANK = { open: 0, failed: 1, void: 2, uncollectible: 2, paid: 3, refunded: 4 };
  function upsertInvoiceTxn(user, inv, status) {
    let txn = (db.data.transactions || []).find(t => t.stripeInvoiceId === inv.id);
    // A later, out-of-order event must never downgrade a settled invoice.
    if (txn && (RANK[txn.status] ?? 0) > (RANK[status] ?? 0)) return txn;
    const fields = {
      userId: user.id, stripeInvoiceId: inv.id, status,
      amountCents: (status === "paid" ? inv.amount_paid : inv.amount_due) ?? inv.total ?? 0,
      currency: inv.currency || "usd",
      description: inv.lines?.data?.[0]?.description || inv.description || "Subscription invoice",
      number: inv.number || null,
      hostedInvoiceUrl: inv.hosted_invoice_url || null,
      invoicePdf: inv.invoice_pdf || null,
      livemode: typeof inv.livemode === "boolean" ? inv.livemode : null,
      entitlementId: inv.metadata?.entitlementId || null,
    };
    if (txn) Object.assign(txn, fields);
    else {
      txn = { id: `txn_${randomUUID()}`, ...fields, createdAt: isoFromSeconds(inv.created) || nowIso() };
      db.data.transactions.push(txn);
    }
    return txn;
  }

  async function handleInvoiceEvent(type, inv) {
    const user = findUserByCustomer(inv.customer, hintOf(inv));
    if (!user) { console.warn("ShieldAI vCISO billing: invoice event for an unknown customer (ignored)."); return; }
    const status = { "invoice.paid": "paid", "invoice.payment_failed": "failed", "invoice.finalized": "open",
      "invoice.payment_action_required": "open", "invoice.voided": "void", "invoice.marked_uncollectible": "uncollectible" }[type];
    if (!status) return;
    upsertInvoiceTxn(user, inv, status);

    // Admin-triggered framework add-on invoices carry the entitlement id.
    const entId = inv.metadata?.entitlementId;
    if (entId) {
      const rec = findEntitlement(db, entId);
      if (rec && rec.userId === user.id) {
        const state = status === "paid" ? "paid" : (status === "void" || status === "uncollectible") ? "void" : "invoiced";
        setInvoiceState(rec, state, { ref: inv.id, url: inv.hosted_invoice_url });
      }
    }
    const sub = getSub(user.id);
    if (status === "paid" && sub?.actionRequired) upsertSub(user.id, { actionRequired: null });
    if (type === "invoice.payment_action_required") {
      upsertSub(user.id, { actionRequired: { invoiceId: inv.id, url: inv.hosted_invoice_url || null, at: nowIso() } });
      notify(user.id, "billing_action_required", "Payment needs your attention", "Your bank or card needs an extra confirmation to complete a payment.");
    }
    if (type === "invoice.payment_failed") {
      notify(user.id, "billing_payment_failed", "A payment didn't go through",
        "We couldn't collect your latest payment. Update your payment method under Plan & Billing to keep your plan active.");
    }
    await db.write();
  }

  async function handleEvent(event) {
    const obj = event.data?.object || {};
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (obj.mode && obj.mode !== "subscription") break;
        await syncCustomer(obj.customer, hintOf(obj));
        break;
      case "checkout.session.async_payment_failed": {
        const user = findUserByCustomer(obj.customer, hintOf(obj));
        if (user) { notify(user.id, "billing_payment_failed", "Your bank payment didn't complete",
          "The bank transfer for your subscription failed. Please try again or use a different payment method."); await db.write(); }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncCustomer(obj.customer, hintOf(obj));
        break;
      case "customer.subscription.trial_will_end": {
        const user = findUserByCustomer(obj.customer, hintOf(obj));
        if (user) { notify(user.id, "billing_trial_ending", "Your trial ends soon", "Add a payment method under Plan & Billing to keep your plan."); await db.write(); }
        break;
      }
      case "invoice.paid": case "invoice.payment_failed": case "invoice.finalized":
      case "invoice.payment_action_required": case "invoice.voided": case "invoice.marked_uncollectible":
        await handleInvoiceEvent(event.type, obj);
        break;
      case "charge.refunded": {
        const user = findUserByCustomer(obj.customer, hintOf(obj));
        if (user && !(db.data.transactions || []).some(t => t.stripeChargeId === obj.id && t.status === "refunded")) {
          db.data.transactions.push({ id: `txn_${randomUUID()}`, userId: user.id, stripeInvoiceId: obj.invoice || null,
            stripeChargeId: obj.id, amountCents: obj.amount_refunded ?? 0, currency: obj.currency || "usd",
            status: "refunded", description: "Refund", livemode: typeof obj.livemode === "boolean" ? obj.livemode : null, createdAt: nowIso() });
          await db.write();
        }
        break;
      }
      case "charge.dispute.created":
        // A dispute has a deadline — surface it to staff; a human responds in Stripe.
        notifyAdmins("billing_dispute", "A payment was disputed",
          `Dispute ${obj.id || ""} for ${((obj.amount || 0) / 100).toFixed(2)} ${String(obj.currency || "usd").toUpperCase()}. Respond in the Stripe dashboard before the deadline.`);
        await db.write();
        break;
      default:
        break;
    }
  }

  app.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    if (!stripe) return res.status(503).end();
    let event;
    try {
      // ALWAYS verified. There is deliberately no "unsigned dev mode" path.
      event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], cfg.webhookSecret);
    } catch (err) {
      console.error("ShieldAI vCISO billing: webhook signature verification failed.");
      return res.status(400).send("Webhook signature verification failed.");
    }
    // A test event delivered to a live endpoint (or vice-versa) is ignored, never applied.
    if (typeof event.livemode === "boolean" && event.livemode !== (cfg.mode === "live")) {
      console.warn("ShieldAI vCISO billing: webhook livemode mismatch — event ignored.");
      return res.json({ received: true, ignored: "livemode_mismatch" });
    }
    if (!event.id) return res.status(400).send("Malformed event.");

    // De-duplicate on the Stripe event id (Stripe retries; deliveries can repeat).
    db.data.stripeEvents = (db.data.stripeEvents || []).filter(e => Date.now() - Date.parse(e.receivedAt) < EVENT_TTL_MS);
    let rec = db.data.stripeEvents.find(e => e.id === event.id);
    if (rec && (rec.processedAt || Date.now() - Date.parse(rec.receivedAt) < STALE_INFLIGHT_MS)) {
      return res.json({ received: true, duplicate: true });
    }
    if (!rec) { rec = { id: event.id, type: event.type, receivedAt: nowIso(), processedAt: null }; db.data.stripeEvents.push(rec); }

    try {
      await handleEvent(event);
      rec.processedAt = nowIso();
      await db.write();
      res.json({ received: true });
    } catch (err) {
      // Forget the event so Stripe's retry is processed, not skipped as a duplicate.
      db.data.stripeEvents = db.data.stripeEvents.filter(e => e.id !== event.id);
      try { await db.write(); } catch { /* ignore */ }
      console.error("ShieldAI vCISO billing: webhook handler error:", err.message);
      res.status(500).json({ error: "Webhook handler failed." });
    }
  });

  // ════════════════════════════════════════════════════════════
  //  CLIENT BILLING ROUTES (authenticated user, own billing)
  // ════════════════════════════════════════════════════════════

  // Plan catalog for the "Plan & Billing" screen. Static — works with billing
  // OFF too. `configured` tells the UI whether the Upgrade buttons will work.
  app.get("/api/billing/plans", requireAuth, (req, res) => {
    const plans = TIER_ORDER.map(id => {
      const t = TIERS[id];
      return {
        id: t.id, name: t.name, priceCents: t.priceCents, interval: t.interval,
        description: t.description, features: t.features,
        selfServe: SELF_SERVE_PAID_TIERS.includes(t.id),
        hasStripePrice: !!tierPrice(t.id),
      };
    });
    const addons = Object.values(ADDONS).map(a => ({
      id: a.id, name: a.name, priceCents: a.priceCents, interval: a.interval,
      description: a.description, availableFor: a.availableFor,
      hasStripePrice: !!addonPrice(a.id),
    }));
    res.json({ plans, addons, configured: !!stripe, achEnabled: !!(stripe && cfg.ach) });
  });

  // Checkout options shared by tier and add-on sessions. Every option beyond
  // the basics is behind a flag that defaults OFF (each needs dashboard setup).
  function checkoutOptions() {
    const o = {};
    if (cfg.promoCodes) o.allow_promotion_codes = true;
    if (cfg.ach) {
      // ACH debit with instant bank verification through Financial Connections.
      o.payment_method_types = ["card", "us_bank_account"];
      o.payment_method_options = { us_bank_account: {
        financial_connections: { permissions: ["payment_method"] }, verification_method: "automatic" } };
    }
    if (cfg.automaticTax) {
      o.automatic_tax = { enabled: true };
      o.billing_address_collection = "required";
      o.tax_id_collection = { enabled: true };
      o.customer_update = { address: "auto", name: "auto" };
    }
    return o;
  }
  const idemBucket = () => Math.floor(Date.now() / (30 * 60 * 1000));   // same click within 30 min => same session

  const hasLiveTierSub = (sub) =>
    !!(sub && sub.tier && sub.tier !== DEFAULT_TIER && sub.stripeSubscriptionId && ACCESS_STATUSES.has(sub.status));

  // Subscribe to a paid tier. body: { tier: "starter"|"growth"|"guided" }
  app.post("/api/billing/checkout", requireAuth, limiter, async (req, res) => {
    if (!needStripe(res)) return;
    const user = findUser(req.userId);
    if (!user) return res.status(404).json({ error: "User not found." });
    const t = getTier((req.body || {}).tier);
    if (!t || !SELF_SERVE_PAID_TIERS.includes(t.id)) {
      return res.status(400).json({ error: "Choose a self-serve paid tier (Starter, Growth, or Guided). Managed vCISO is contact-sales." });
    }
    const priceId = tierPrice(t.id);
    if (!priceId) {
      console.error(`ShieldAI vCISO billing: no Stripe price configured for tier "${t.id}".`);
      return res.status(503).json({ error: "This plan isn't available for online checkout yet.", code: "PRICE_NOT_CONFIGURED" });
    }
    // Already subscribed? Plan changes go through the Billing Portal, not a
    // second subscription (which would double-bill).
    if (hasLiveTierSub(getSub(user.id))) {
      return res.status(409).json({ error: "You already have an active subscription. Use Manage Billing to change or cancel your plan.", code: "USE_PORTAL" });
    }
    try {
      const customerId = await ensureCustomer(user);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: user.id,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${cfg.appUrl}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${cfg.appUrl}/?billing=cancelled`,
        metadata: { shieldaiUserId: user.id, tier: t.id },
        subscription_data: { metadata: { shieldaiUserId: user.id, tier: t.id } },
        ...checkoutOptions(),
      }, { idempotencyKey: `checkout:tier:${t.id}:${user.id}:${idemBucket()}` });
      res.json({ url: session.url });
    } catch (err) {
      console.error("ShieldAI vCISO billing: checkout error:", err.message);
      res.status(500).json({ error: "Could not start checkout." });
    }
  });

  // Purchase a boolean add-on (e.g. training delivery). body: { addon }
  // (The framework add-on is NOT sold here — it is invoiced by an admin.)
  app.post("/api/billing/checkout-addon", requireAuth, limiter, async (req, res) => {
    if (!needStripe(res)) return;
    const user = findUser(req.userId);
    if (!user) return res.status(404).json({ error: "User not found." });
    const a = getAddon((req.body || {}).addon);
    if (!a || a.id === FRAMEWORK_ADDON_ID) return res.status(400).json({ error: "Unknown add-on." });
    const userTier = user.tier || DEFAULT_TIER;
    if (!canPurchaseAddon(userTier, a.id)) {
      return res.status(400).json({
        error: `The ${a.name} add-on isn't available on your plan — it's either already included or not offered at this tier.`,
        code: "ADDON_NOT_AVAILABLE", currentTier: userTier,
      });
    }
    const sub = getSub(user.id);
    const owned = new Set([...(Array.isArray(user.addons) ? user.addons : []), ...(Array.isArray(sub?.addons) ? sub.addons : [])]);
    if (owned.has(a.id)) {
      return res.status(409).json({ error: `You already have the ${a.name} add-on.`, code: "ADDON_ALREADY_OWNED" });
    }
    const priceId = addonPrice(a.id);
    if (!priceId) {
      console.error(`ShieldAI vCISO billing: no Stripe price configured for add-on "${a.id}".`);
      return res.status(503).json({ error: "This add-on isn't available for online checkout yet.", code: "PRICE_NOT_CONFIGURED" });
    }
    try {
      const customerId = await ensureCustomer(user);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: user.id,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${cfg.appUrl}/?billing=addon-success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${cfg.appUrl}/?billing=cancelled`,
        metadata: { shieldaiUserId: user.id, addon: a.id },
        subscription_data: { metadata: { shieldaiUserId: user.id, addon: a.id } },
        ...checkoutOptions(),
      }, { idempotencyKey: `checkout:addon:${a.id}:${user.id}:${idemBucket()}` });
      res.json({ url: session.url });
    } catch (err) {
      console.error("ShieldAI vCISO billing: add-on checkout error:", err.message);
      res.status(500).json({ error: "Could not start add-on checkout." });
    }
  });

  // Open the Stripe Billing Portal to update payment methods / cancel / change plan.
  app.post("/api/billing/portal", requireAuth, limiter, async (req, res) => {
    if (!needStripe(res)) return;
    const sub = getSub(req.userId);
    if (!sub?.stripeCustomerId) return res.status(400).json({ error: "No billing account yet. Subscribe first." });
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: `${cfg.appUrl}/?billing=portal_return`,
      });
      res.json({ url: session.url });
    } catch (err) {
      console.error("ShieldAI vCISO billing: portal error:", err.message);
      res.status(500).json({ error: "Could not open billing portal." });
    }
  });

  // The current user's own billing summary.
  app.get("/api/billing/me", requireAuth, (req, res) => {
    const sub = getSub(req.userId);
    const user = findUser(req.userId);
    const addonIds = new Set([
      ...(Array.isArray(user?.addons) ? user.addons : []),
      ...(Array.isArray(sub?.addons) ? sub.addons : []),
    ]);
    const fwAddons = entitlementsFor(db, req.userId).filter(e => ENTITLING_STATUSES.has(e.status));
    const graceEndsAt = sub?.pastDueSince
      ? new Date(Date.parse(sub.pastDueSince) + cfg.pastDueGraceDays * 86400000).toISOString() : null;
    res.json({
      tier: user?.tier || DEFAULT_TIER,
      addons: [...addonIds],
      billingEnabled: !!stripe,
      subscription: sub ? {
        status: sub.status, currentPeriodEnd: sub.currentPeriodEnd,
        hasStripe: !!sub.stripeCustomerId,
        cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
        pastDue: sub.pastDueSince ? { since: sub.pastDueSince, graceEndsAt } : null,
        actionRequired: sub.actionRequired || null,
      } : null,
      // Framework slots are their own line items, not entries in `addons`.
      frameworkAddons: {
        assigned: fwAddons.filter(e => e.frameworkId).map(publicEntitlement),
        unassigned: fwAddons.filter(e => !e.frameworkId).length,
        monthlyCents: monthlyCentsFor(db, req.userId),
      },
    });
  });

  // The user's own invoices/payments (from our records — no Stripe call, so it
  // works offline and is strictly scoped to the caller).
  app.get("/api/billing/invoices", requireAuth, (req, res) => {
    const rows = (db.data.transactions || [])
      .filter(t => t.userId === req.userId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 100)
      .map(t => ({
        id: t.id, number: t.number || null, status: t.status, amountCents: t.amountCents, currency: t.currency,
        description: t.description, createdAt: t.createdAt,
        hostedInvoiceUrl: t.hostedInvoiceUrl || null, invoicePdf: t.invoicePdf || null,
      }));
    res.json({ invoices: rows });
  });

  // ════════════════════════════════════════════════════════════
  //  ADMIN: framework add-on invoicing (a human clicks "Send invoice")
  // ════════════════════════════════════════════════════════════
  app.post("/api/admin/billing/framework-addons/:id/invoice", requireAdmin, limiter, async (req, res) => {
    if (!needStripe(res)) return;
    const rec = findEntitlement(db, req.params.id);
    if (!rec) return res.status(404).json({ error: "Add-on not found." });
    if (rec.status !== "pending_billing" || rec.billing?.mode !== "manual_invoice") {
      return res.status(409).json({ error: "Only an add-on that is pending billing can be invoiced.", code: "NOT_INVOICEABLE" });
    }
    if (["invoiced", "paid"].includes(rec.billing?.invoiceState)) {
      return res.status(409).json({ error: "This add-on has already been invoiced.", code: "ALREADY_INVOICED" });
    }
    const user = findUser(rec.userId);
    if (!user) return res.status(404).json({ error: "Account not found." });

    rec.billing.invoiceAttempts = (rec.billing.invoiceAttempts || 0) + 1;
    const key = `fwaddon-invoice:${rec.id}:${rec.billing.invoiceAttempts}`;
    let invoiceId = null;
    try {
      const customerId = await ensureCustomer(user);
      const meta = { entitlementId: rec.id, shieldaiUserId: user.id, kind: "framework_addon" };
      const draft = await stripe.invoices.create({
        customer: customerId, collection_method: "send_invoice", days_until_due: cfg.invoiceDaysUntilDue,
        auto_advance: false, metadata: meta,
        description: `Additional compliance framework${rec.frameworkName ? " — " + rec.frameworkName : ""}`,
      }, { idempotencyKey: key });
      invoiceId = draft.id;
      await stripe.invoiceItems.create({
        customer: customerId, invoice: invoiceId, amount: rec.priceCents, currency: "usd", metadata: meta,
        description: `Additional compliance framework${rec.frameworkName ? " — " + rec.frameworkName : ""} (monthly)`,
      }, { idempotencyKey: key + ":item" });
      const finalized = await stripe.invoices.finalizeInvoice(invoiceId);
      const sent = (await stripe.invoices.sendInvoice(invoiceId)) || finalized;

      setInvoiceState(rec, "invoiced", { ref: invoiceId, url: sent.hosted_invoice_url || finalized?.hosted_invoice_url });
      upsertInvoiceTxn(user, { ...finalized, ...sent, id: invoiceId, metadata: meta, customer: customerId }, "open");
      audit(req, "framework_addon_billing", user.id, `Stripe invoice ${invoiceId} sent · ${rec.frameworkName || "unassigned slot"}`);
      await db.write();
      res.json({ ok: true, invoiceId, hostedInvoiceUrl: sent.hosted_invoice_url || finalized?.hosted_invoice_url || null });
    } catch (err) {
      console.error("ShieldAI vCISO billing: framework invoice error:", err.message);
      if (invoiceId) { try { await stripe.invoices.del(invoiceId); } catch { /* draft cleanup is best-effort */ } }
      try { await db.write(); } catch { /* ignore */ }
      res.status(502).json({ error: "Could not create the invoice. Nothing was sent to the client." });
    }
  });

  // ════════════════════════════════════════════════════════════
  //  ADMIN FINANCIAL READS
  // ════════════════════════════════════════════════════════════

  // Financial overview for one client: subscription + transaction history.
  app.get("/api/admin/accounts/:id/billing", requireAdmin, (req, res) => {
    const user = findUser(req.params.id);
    if (!user) return res.status(404).json({ error: "Account not found." });
    const sub = getSub(user.id);
    const txns = (db.data.transactions || [])
      .filter(t => t.userId === user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const paid = txns.filter(t => t.status === "paid").reduce((s, t) => s + (t.amountCents || 0), 0);
    const fwAddons = entitlementsFor(db, user.id);
    res.json({
      tier: user.tier || DEFAULT_TIER,
      subscription: sub || null,
      transactions: txns.slice(0, 100),
      lifetimePaidCents: paid,
      frameworkAddons: fwAddons,
      // "Mrr" = confirmed recurring revenue — active only. pending_billing is owed, not earned.
      frameworkAddonsMrrCents: activeMonthlyCentsFor(db, user.id),
    });
  });

  // The invoicing worklist: framework add-ons that are live but not yet invoiced.
  app.get("/api/admin/billing/framework-addons", requireAdmin, (req, res) => {
    const status = String(req.query.status || "pending_billing");
    const all = (db.data.frameworkEntitlements || []);
    const rows = (status === "all" ? all : all.filter(e => e.status === status))
      .map(e => {
        const u = findUser(e.userId);
        return {
          ...e,
          email: u?.email || null,
          companyName: u?.companyName || "",
          tier: u?.tier || DEFAULT_TIER,
          ageDays: Math.floor((Date.now() - new Date(e.createdAt).getTime()) / 86400000),
        };
      })
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));   // oldest owed first
    res.json({
      rows,
      pendingCount: all.filter(e => e.status === "pending_billing").length,
      pendingCents: pendingBillingEntitlements(db).reduce((s, e) => s + (e.priceCents || 0), 0),
      canInvoiceViaStripe: !!stripe,
    });
  });

  // Portfolio-wide financial summary (MRR estimate + per-client rollup).
  app.get("/api/admin/billing/overview", requireAdmin, (req, res) => {
    const rows = (db.data.users || []).map(u => {
      const sub = getSub(u.id);
      const tier = u.tier || DEFAULT_TIER;
      const txns = (db.data.transactions || []).filter(t => t.userId === u.id);
      const paid = txns.filter(t => t.status === "paid").reduce((s, t) => s + (t.amountCents || 0), 0);
      // Add-ons ride alongside the tier price (same union tierGate.js uses).
      const addonIds = new Set([
        ...(Array.isArray(u?.addons) ? u.addons : []),
        ...(Array.isArray(sub?.addons) ? sub.addons : []),
      ]);
      const addonCents = [...addonIds].reduce((s, id) => s + (getAddon(id)?.priceCents || 0), 0);
      // activeMonthlyCentsFor(), not monthlyCentsFor(): comped slots are zero
      // revenue and pending_billing is owed-not-earned; counting either would
      // fabricate revenue (and double count with pendingBillingCents below).
      const frameworkAddonCents = activeMonthlyCentsFor(db, u.id);
      return {
        id: u.id, email: u.email, companyName: u.companyName || "",
        tier, status: sub?.status || (tier === "free" ? "free" : "none"),
        priceCents: (getTier(tier).priceCents || 0) + addonCents + frameworkAddonCents,
        addons: [...addonIds],
        frameworkAddonCents,
        lifetimePaidCents: paid,
        currentPeriodEnd: sub?.currentPeriodEnd || null,
      };
    });
    const mrrCents = rows
      .filter(r => ["active", "trialing", "manual", "past_due"].includes(r.status))
      .reduce((s, r) => s + (r.priceCents || 0), 0);
    const totalPaidCents = rows.reduce((s, r) => s + r.lifetimePaidCents, 0);
    // Reported SEPARATELY, never folded into mrrCents or totalPaidCents: an
    // uninvoiced add-on is money owed, not money earned.
    const pending = pendingBillingEntitlements(db);
    res.json({
      rows, mrrCents, totalPaidCents, configured: !!stripe,
      pendingBillingCents: pending.reduce((s, e) => s + (e.priceCents || 0), 0),
      pendingBillingCount: pending.length,
    });
  });

  console.log("ShieldAI vCISO billing routes registered.");
}
