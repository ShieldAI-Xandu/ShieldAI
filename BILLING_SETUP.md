# ShieldAI Billing (Stripe) — Setup

The billing backend, the tier-gate system, and the client-facing "Plan &
Billing" UI are all **fully built and wired end-to-end**. Right now they run
**without** Stripe configured: every checkout/portal route returns a clear
"not configured yet" message instead of erroring, and the admin financial
views work off internal tier data. Nothing here is live until you complete
the steps below — that's intentional, not a limitation.

## Security model (why it's safe)
- **No card data ever touches ShieldAI.** All card entry happens on Stripe's
  hosted Checkout and Billing Portal pages.
- The **secret key lives only in an environment variable** (Railway's
  Variables tab in production, `.env` locally — see step 3), never in code
  or git.
- ShieldAI only creates customers/sessions and **reads** subscription +
  invoice data via the Stripe API.

## The real tier ladder (current, not the old 3-tier one)
| Tier | Price | Self-serve? |
|---|---|---|
| Free | $0 | n/a — no Stripe price |
| Starter | $159/mo | Yes |
| Growth | $349/mo | Yes |
| Guided | $699/mo | Yes |
| Managed vCISO | $1,950/mo | No — contact-sales, not sold through Checkout |

Plus one add-on: **Training Delivery**, $40/mo, purchasable only by Starter
customers (Growth and above already bundle it — see `tiers.js`'s `ADDONS`).

`SELF_SERVE_PAID_TIERS` in `tiers.js` is the source of truth for which tiers
`/api/billing/checkout` will accept. Managed deliberately isn't in that list;
`billingRoutes.js` rejects it with a clear message pointing to contact-sales.

## 1. Create products & prices in Stripe

**Option A — run the setup script (recommended):**
```
STRIPE_SECRET_KEY=sk_test_xxxxxxxx node scripts/setupStripeProducts.js
```
This creates (or reuses, if run again) a Stripe Product + recurring monthly
Price for Starter, Growth, Guided, and the Training Delivery add-on, and
prints the exact `stripePriceId` values to paste into `tiers.js`. It only
touches Stripe — it never modifies ShieldAI's own code or environment. Use a
**test** key first (`sk_test_...`); the script tells you which mode it ran in.

**Option B — do it by hand** in the Stripe Dashboard (Test mode first):
1. Products → add a product for each self-serve tier: Starter, Growth, Guided.
   Add one more for the Training Delivery add-on. (Free and Managed don't
   need Stripe prices — Free is $0, Managed is contact-sales.)
2. Give each a **recurring monthly price** matching the table above
   (Starter $159, Growth $349, Guided $699, Training Delivery add-on $40).
3. Copy each Price ID (looks like `price_1A2b...`).

## 2. Put the Price IDs in tiers.js
Edit `tiers.js` and set `stripePriceId` on each entry:
```js
// In TIERS:
starter: { ..., stripePriceId: "price_XXXXXXXX" },
growth:  { ..., stripePriceId: "price_YYYYYYYY" },
guided:  { ..., stripePriceId: "price_ZZZZZZZZ" },

// In ADDONS:
training_delivery: { ..., stripePriceId: "price_AAAAAAAA" },
```
Until these are set, `/api/billing/checkout` and `/api/billing/checkout-addon`
return a 503 naming exactly which tier/add-on is missing a price — so a half
-configured setup fails loudly and specifically, not silently.

## 3. Add keys to the environment (NEVER commit these)
**Locally** (`.env`, already git-ignored):
```
STRIPE_SECRET_KEY=sk_test_xxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxx
APP_URL=http://localhost:5173
```
**In production (Railway):** set the same three in the **Variables** tab —
not `.env`, which is git-ignored and never deployed. `APP_URL` should be your
real Railway URL (`https://shieldai-production-627e.up.railway.app` or your
custom domain) so Stripe Checkout's success/cancel redirects land back on the
actual site.

Use **test** keys (`sk_test_…`) until you're ready to accept real payments.

## 4. Set up the webhook
The backend exposes `POST /api/billing/webhook`. Stripe must call it so
subscription/invoice changes sync into ShieldAI — this is what actually
updates a client's tier after they pay.

**Local testing** — use the Stripe CLI:
```
stripe listen --forward-to localhost:3001/api/billing/webhook
```
It prints a `whsec_…` — put that in `STRIPE_WEBHOOK_SECRET`.

**Production** — in the Stripe Dashboard, add a webhook endpoint pointing to
`https://your-domain/api/billing/webhook`, subscribed to:
`checkout.session.completed`, `customer.subscription.created/updated/deleted`,
`invoice.paid`, `invoice.payment_failed`. Copy its signing secret into Railway's
`STRIPE_WEBHOOK_SECRET` variable.

Without a webhook secret set, the endpoint still works but accepts events
**without verifying the Stripe signature** — fine for quick local testing,
not for production. The server logs a warning every time this happens so it
can't go unnoticed.

## 5. Restart the backend
You should see both of these in the logs:
```
ShieldAI billing: Stripe configured.
ShieldAI billing routes registered.
```
If you only see the second line, `STRIPE_SECRET_KEY` isn't set where the
running process can see it.

## How it flows
- **Client subscribes (self-serve):** in the client dashboard's **Plan &
  Billing** section, or from any upgrade prompt shown when a plan limit or
  locked feature is hit, the client clicks **Upgrade** → `POST
  /api/billing/checkout {tier}` → returns a Stripe Checkout URL → client pays
  on Stripe → webhook fires → ShieldAI sets the client's tier + subscription
  status. Managed vCISO shows **Contact Sales** instead (mailto link), since
  it's never sold through self-serve checkout.
- **Client buys the training add-on:** same pattern, `POST
  /api/billing/checkout-addon {addon: "training_delivery"}`.
- **Client manages/cancels:** **Manage Billing** button (shown once they have
  a Stripe customer) → `POST /api/billing/portal` → returns a Stripe Billing
  Portal URL.
- **Invoices:** every paid/failed invoice is recorded in `transactions` via
  webhook, visible to admins and factored into the MRR estimate.
- **Admin override:** the admin tier control still works for comps/manual
  changes; once a real Stripe subscription exists, the webhook is the source
  of truth and will reconcile the tier on the next event.

## Routes summary
- `GET  /api/billing/plans` (client) — tier/add-on catalog for the Plan &
  Billing UI; works even before Stripe is configured (it's static pricing data)
- `POST /api/billing/checkout` (client) — start subscription checkout for a
  self-serve tier
- `POST /api/billing/checkout-addon` (client) — start checkout for an add-on
- `POST /api/billing/portal` (client) — manage an existing subscription
- `GET  /api/billing/me` (client) — own tier, add-ons, and subscription status
- `POST /api/billing/webhook` (Stripe) — sync events (raw body,
  signature-verified when `STRIPE_WEBHOOK_SECRET` is set)
- `GET  /api/admin/accounts/:id/billing` (admin) — one client's billing + invoices
- `GET  /api/admin/billing/overview` (admin) — portfolio MRR + per-client rollup

## Without Stripe configured (today's state)
Everything still runs. `/api/billing/plans` and `/api/billing/me` work
normally (no Stripe calls needed). Checkout, checkout-addon, and portal all
return 503 with a specific message; the client-facing Plan & Billing screen
and every upgrade prompt display that message inline rather than erroring.
Admin financial views show internal tier data and any manually-recorded
transactions. The admin tier override remains fully usable for comps and
testing regardless of Stripe's configuration state.
