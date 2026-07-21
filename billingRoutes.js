// billingRoutes.js
// ShieldAI Stripe billing backend.
//
// SECURITY / PCI: No card data ever touches this server. All card entry happens
// in Stripe-hosted Checkout and the Stripe Billing Portal. We only create
// customers/sessions and READ subscription + invoice data via the Stripe API.
// The secret key is read from process.env.STRIPE_SECRET_KEY (never hardcoded).
//
// Graceful degradation: if STRIPE_SECRET_KEY is not set, the module still loads
// and every billing route returns 503 "billing not configured" instead of
// crashing — so the app runs fine without Stripe until you wire keys.
//
// Mount from server.js:
//   import { registerBillingRoutes } from "./billingRoutes.js";
//   await registerBillingRoutes(app, { db, requireAuth, requireAdmin, express });
//
// IMPORTANT (webhook): the webhook route needs the RAW body to verify the
// Stripe signature. registerBillingRoutes mounts express.raw() on just that
// path, so it must be registered BEFORE any global express.json() — see the
// server.js mounting note.

import { TIERS, TIER_ORDER, getTier, DEFAULT_TIER, SELF_SERVE_PAID_TIERS, getAddon, canPurchaseAddon, ADDONS } from "./tiers.js";

const nowIso = () => new Date().toISOString();

// Map a Stripe price id back to our internal tier id.
function tierFromPriceId(priceId) {
  for (const id of TIER_ORDER) {
    if (TIERS[id].stripePriceId && TIERS[id].stripePriceId === priceId) return id;
  }
  return null;
}

// Map a Stripe price id back to our internal add-on id (e.g. training_delivery).
// Mirrors tierFromPriceId — add-ons are sold as their own Stripe price, separate
// from the tier's price, so a price id resolves to EITHER a tier OR an add-on,
// never both.
function addonFromPriceId(priceId) {
  for (const id of Object.keys(ADDONS)) {
    if (ADDONS[id].stripePriceId && ADDONS[id].stripePriceId === priceId) return id;
  }
  return null;
}

export async function registerBillingRoutes(app, { db, requireAuth, requireAdmin, express }) {
  db.data.subscriptions ||= [];
  db.data.transactions ||= [];

  const SECRET = process.env.STRIPE_SECRET_KEY || "";
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
  const APP_URL = process.env.APP_URL || "http://localhost:5173";

  let stripe = null;
  if (SECRET) {
    try {
      const Stripe = (await import("stripe")).default;
      stripe = new Stripe(SECRET);
      console.log("ShieldAI billing: Stripe configured.");
    } catch (err) {
      console.warn("ShieldAI billing: stripe package not available —", err.message);
    }
  } else {
    console.warn("ShieldAI billing: STRIPE_SECRET_KEY not set — billing routes return 503 until configured.");
  }

  // Guard used by every route that needs a live Stripe client.
  function needStripe(res) {
    if (!stripe) {
      res.status(503).json({ error: "Billing is not configured. Set STRIPE_SECRET_KEY in the server environment." });
      return false;
    }
    return true;
  }

  const findUser = (id) => (db.data.users || []).find(u => u.id === id);
  function getSub(userId) {
    return (db.data.subscriptions || []).find(s => s.userId === userId) || null;
  }
  function upsertSub(userId, patch) {
    let sub = getSub(userId);
    if (!sub) {
      sub = { id: cryptoRandom(), userId, tier: DEFAULT_TIER, status: "free",
              stripeCustomerId: null, stripeSubscriptionId: null, currentPeriodEnd: null,
              addons: [], updatedAt: nowIso() };
      db.data.subscriptions.push(sub);
    }
    Object.assign(sub, patch, { updatedAt: nowIso() });
    return sub;
  }
  function cryptoRandom() {
    return "sub_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // Ensure the user has a Stripe customer; create one if missing.
  async function ensureCustomer(user) {
    let sub = getSub(user.id);
    if (sub?.stripeCustomerId) return sub.stripeCustomerId;
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.companyName || user.email,
      metadata: { shieldaiUserId: user.id },
    });
    upsertSub(user.id, { stripeCustomerId: customer.id });
    await db.write();
    return customer.id;
  }

  // ════════════════════════════════════════════════════════════
  //  WEBHOOK — must receive the RAW body for signature verification.
  //  Mounted with express.raw() on this path only.
  // ════════════════════════════════════════════════════════════
  app.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    if (!stripe) return res.status(503).end();
    let event;
    try {
      if (WEBHOOK_SECRET) {
        const sig = req.headers["stripe-signature"];
        event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
      } else {
        // No webhook secret set: accept unverified (dev only). Parse the raw body.
        event = JSON.parse(req.body.toString("utf8"));
        console.warn("ShieldAI billing: webhook received WITHOUT signature verification (set STRIPE_WEBHOOK_SECRET).");
      }
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed":
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const obj = event.data.object;
          const customerId = obj.customer || obj.customer_id;
          const user = (db.data.users || []).find(u => getSub(u.id)?.stripeCustomerId === customerId);
          if (user) {
            // Re-fetch EVERY subscription for this customer, not just one.
            //
            // A customer can hold two separate Stripe subscription objects at
            // once: the base tier (Starter/Growth/...) and the $40/mo training
            // delivery add-on, each its own recurring line item created by its
            // own checkout session (see /api/billing/checkout-addon below).
            // Reading only subs.data[0] — the previous behaviour — meant an
            // add-on purchase completed a real charge in Stripe but never
            // reached sub.addons, so tierGate.js kept rejecting the client's
            // access to the thing they'd just paid for.
            const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
            const active = subs.data.filter(s => ["active", "trialing", "past_due"].includes(s.status));

            // Classify every line item across every active subscription as
            // either a tier price or an add-on price. A customer's tier comes
            // from whichever active subscription matches a tier price; their
            // add-ons are the union of every active subscription matching an
            // add-on price. The two are mutually exclusive by price id, so
            // there's no ambiguity in which bucket a given item belongs to.
            let resolvedTier = null;
            let latestTierSub = null;
            const resolvedAddons = new Set();
            for (const s of active) {
              for (const item of s.items?.data || []) {
                const priceId = item.price?.id;
                const t = tierFromPriceId(priceId);
                if (t) {
                  resolvedTier = t;
                  latestTierSub = s;
                  continue;
                }
                const a = addonFromPriceId(priceId);
                if (a) resolvedAddons.add(a);
              }
            }

            if (active.length === 0) {
              // Nothing active at all — fully canceled/lapsed.
              upsertSub(user.id, { status: "canceled", tier: DEFAULT_TIER, stripeSubscriptionId: null, addons: [] });
              user.tier = DEFAULT_TIER;
              user.addons = [];
              await db.write();
            } else {
              const tier = resolvedTier || getSub(user.id)?.tier || DEFAULT_TIER;
              upsertSub(user.id, {
                tier,
                status: latestTierSub?.status || active[0].status,
                stripeSubscriptionId: latestTierSub?.id || active[0].id,
                currentPeriodEnd: (latestTierSub || active[0]).current_period_end
                  ? new Date((latestTierSub || active[0]).current_period_end * 1000).toISOString() : null,
                addons: [...resolvedAddons],
              });
              user.tier = tier; // keep the user record's tier in sync
              user.addons = [...resolvedAddons]; // keep the user record's add-ons in sync too
              await db.write();
            }
          }
          break;
        }
        case "invoice.paid":
        case "invoice.payment_failed": {
          const inv = event.data.object;
          const customerId = inv.customer;
          const user = (db.data.users || []).find(u => getSub(u.id)?.stripeCustomerId === customerId);
          if (user) {
            db.data.transactions.push({
              id: cryptoRandom().replace("sub_", "txn_"),
              userId: user.id,
              stripeInvoiceId: inv.id,
              amountCents: inv.amount_paid ?? inv.amount_due ?? 0,
              currency: inv.currency || "usd",
              status: event.type === "invoice.paid" ? "paid" : "failed",
              description: inv.lines?.data?.[0]?.description || "Subscription invoice",
              createdAt: nowIso(),
            });
            await db.write();
          }
          break;
        }
        default:
          break;
      }
      res.json({ received: true });
    } catch (err) {
      console.error("Webhook handler error:", err.message);
      res.status(500).json({ error: "Webhook handler failed." });
    }
  });

  // ════════════════════════════════════════════════════════════
  //  CLIENT BILLING ROUTES (authenticated user, own billing)
  // ════════════════════════════════════════════════════════════

  // Start a Checkout Session to subscribe to a paid tier.
  // body: { tier: "starter"|"growth"|"guided" }  (free is set directly; managed = contact sales)
  app.post("/api/billing/checkout", requireAuth, async (req, res) => {
    if (!needStripe(res)) return;
    const user = findUser(req.userId);
    if (!user) return res.status(404).json({ error: "User not found." });
    const { tier } = req.body || {};
    const t = getTier(tier);
    if (!t || !SELF_SERVE_PAID_TIERS.includes(t.id)) {
      return res.status(400).json({ error: "Choose a self-serve paid tier (Starter, Growth, or Guided). Managed vCISO is contact-sales." });
    }
    if (!t.stripePriceId) {
      return res.status(503).json({ error: `Tier "${t.id}" has no Stripe price configured yet. Set stripePriceId in tiers.js.` });
    }
    try {
      const customerId = await ensureCustomer(user);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: t.stripePriceId, quantity: 1 }],
        success_url: `${APP_URL}/?billing=success`,
        cancel_url: `${APP_URL}/?billing=cancelled`,
        metadata: { shieldaiUserId: user.id, tier: t.id },
      });
      res.json({ url: session.url });
    } catch (err) {
      console.error("Checkout error:", err.message);
      res.status(500).json({ error: "Could not start checkout." });
    }
  });

  // Purchase an add-on (e.g. the $40/mo training delivery add-on for Starter).
  // body: { addon: "training_delivery" }
  // The add-on is a separate recurring line item; on success the webhook/portal
  // records it on the user's sub.addons array (see webhook handler).
  app.post("/api/billing/checkout-addon", requireAuth, async (req, res) => {
    if (!needStripe(res)) return;
    const user = findUser(req.userId);
    if (!user) return res.status(404).json({ error: "User not found." });
    const { addon } = req.body || {};
    const a = getAddon(addon);
    if (!a) return res.status(400).json({ error: "Unknown add-on." });
    const userTier = user.tier || DEFAULT_TIER;
    // Growth+ already bundle training delivery, so there's nothing to buy.
    if (!canPurchaseAddon(userTier, a.id)) {
      return res.status(400).json({
        error: `The ${a.name} add-on isn't available on your plan — it's either already included or not offered at this tier.`,
        code: "ADDON_NOT_AVAILABLE",
        currentTier: userTier,
      });
    }
    if (!a.stripePriceId) {
      return res.status(503).json({ error: `Add-on "${a.id}" has no Stripe price configured yet. Set stripePriceId in tiers.js (ADDONS).` });
    }
    try {
      const customerId = await ensureCustomer(user);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: a.stripePriceId, quantity: 1 }],
        success_url: `${APP_URL}/?billing=addon-success`,
        cancel_url: `${APP_URL}/?billing=cancelled`,
        metadata: { shieldaiUserId: user.id, addon: a.id },
      });
      res.json({ url: session.url });
    } catch (err) {
      console.error("Add-on checkout error:", err.message);
      res.status(500).json({ error: "Could not start add-on checkout." });
    }
  });

  // Open the Stripe Billing Portal to manage/cancel an existing subscription.
  app.post("/api/billing/portal", requireAuth, async (req, res) => {
    if (!needStripe(res)) return;
    const user = findUser(req.userId);
    const sub = getSub(req.userId);
    if (!sub?.stripeCustomerId) return res.status(400).json({ error: "No billing account yet. Subscribe first." });
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: `${APP_URL}/?billing=portal_return`,
      });
      res.json({ url: session.url });
    } catch (err) {
      console.error("Portal error:", err.message);
      res.status(500).json({ error: "Could not open billing portal." });
    }
  });

  // The current user's own billing summary.
  app.get("/api/billing/me", requireAuth, (req, res) => {
    const sub = getSub(req.userId);
    const user = findUser(req.userId);
    res.json({
      tier: user?.tier || DEFAULT_TIER,
      subscription: sub ? {
        status: sub.status, currentPeriodEnd: sub.currentPeriodEnd,
        hasStripe: !!sub.stripeCustomerId,
      } : null,
    });
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
    res.json({
      tier: user.tier || DEFAULT_TIER,
      subscription: sub || null,
      transactions: txns.slice(0, 100),
      lifetimePaidCents: paid,
    });
  });

  // Portfolio-wide financial summary (MRR estimate + per-client rollup).
  app.get("/api/admin/billing/overview", requireAdmin, (req, res) => {
    const rows = (db.data.users || []).map(u => {
      const sub = getSub(u.id);
      const tier = u.tier || DEFAULT_TIER;
      const txns = (db.data.transactions || []).filter(t => t.userId === u.id);
      const paid = txns.filter(t => t.status === "paid").reduce((s, t) => s + (t.amountCents || 0), 0);
      // Add-ons ride alongside the tier price rather than replacing it — a
      // Starter customer with the training-delivery add-on pays $159 + $40,
      // and MRR undercounts every such account if this is left out. Same union
      // tierGate.js uses (user record OR subscription record), so this can't
      // silently disagree with what actually gates the feature.
      const addonIds = new Set([
        ...(Array.isArray(u?.addons) ? u.addons : []),
        ...(Array.isArray(sub?.addons) ? sub.addons : []),
      ]);
      const addonCents = [...addonIds].reduce((s, id) => s + (getAddon(id)?.priceCents || 0), 0);
      return {
        id: u.id, email: u.email, companyName: u.companyName || "",
        tier, status: sub?.status || (tier === "free" ? "free" : "none"),
        priceCents: (getTier(tier).priceCents || 0) + addonCents,
        addons: [...addonIds],
        lifetimePaidCents: paid,
        currentPeriodEnd: sub?.currentPeriodEnd || null,
      };
    });
    // MRR estimate = sum of monthly prices (tier + any add-ons) for active/manual paid tiers.
    const mrrCents = rows
      .filter(r => ["active", "trialing", "manual", "past_due"].includes(r.status))
      .reduce((s, r) => s + (r.priceCents || 0), 0);
    const totalPaidCents = rows.reduce((s, r) => s + r.lifetimePaidCents, 0);
    res.json({ rows, mrrCents, totalPaidCents, configured: !!stripe });
  });

  console.log("ShieldAI billing routes registered.");
}
