# ShieldAI Billing (Stripe) — Setup

The billing backend is built and runs **without** Stripe configured (all billing
routes return a clear "not configured" message; admin financial reads still
work). Follow these steps when you're ready to turn on real billing.

## Security model (why it's safe)
- **No card data ever touches ShieldAI.** All card entry happens on Stripe's
  hosted Checkout and Billing Portal pages.
- The **secret key lives only in `.env`** on the server, never in code or git.
- ShieldAI only creates customers/sessions and **reads** subscription + invoice
  data via the Stripe API.

## 1. Create products & prices in Stripe
In the Stripe Dashboard (Test mode first):
1. Products → add a product per paid tier (Starter, Pro). (Free and Enterprise
   don't need Stripe prices — Free is $0, Enterprise is contact-sales.)
2. Give each a **recurring monthly price** matching `tiers.js`
   (Starter $99/mo, Pro $299/mo).
3. Copy each Price ID (looks like `price_1A2b...`).

## 2. Put the Price IDs in tiers.js
Edit `tiers.js` and set `stripePriceId` for each paid tier:
```js
starter: { ..., stripePriceId: "price_XXXXXXXX" },
pro:     { ..., stripePriceId: "price_YYYYYYYY" },
```

## 3. Add keys to .env (NEVER commit these)
```
STRIPE_SECRET_KEY=sk_test_xxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxx
APP_URL=http://localhost:5173
```
`.env` is already git-ignored. Use **test** keys (`sk_test_…`) until you go live.

## 4. Set up the webhook
The backend exposes `POST /api/billing/webhook`. Stripe must call it so
subscription/invoice changes sync into ShieldAI.

**Local testing** — use the Stripe CLI:
```
stripe listen --forward-to localhost:3001/api/billing/webhook
```
It prints a `whsec_…` — put that in `STRIPE_WEBHOOK_SECRET`.

**Production** — in the Stripe Dashboard, add a webhook endpoint pointing to
`https://your-domain/api/billing/webhook`, subscribe to:
`checkout.session.completed`, `customer.subscription.created/updated/deleted`,
`invoice.paid`, `invoice.payment_failed`. Copy its signing secret to `.env`.

## 5. Restart the backend
You should see: `ShieldAI billing: Stripe configured.` and
`ShieldAI billing routes registered.`

## How it flows
- **Client subscribes:** `POST /api/billing/checkout {tier}` → returns a Stripe
  Checkout URL → client pays on Stripe → webhook fires → ShieldAI sets the
  client's tier + subscription status.
- **Client manages/cancels:** `POST /api/billing/portal` → returns a Stripe
  Billing Portal URL.
- **Invoices:** every paid/failed invoice is recorded in `transactions` via
  webhook, visible to admins.
- **Admin override:** the admin tier control (Stage 2/3) still works for
  comps/manual changes; when a real Stripe subscription exists, the webhook is
  the source of truth and will reconcile the tier.

## Routes summary
- `POST /api/billing/checkout` (client) — start subscription checkout
- `POST /api/billing/portal` (client) — manage existing subscription
- `GET  /api/billing/me` (client) — own tier + status
- `POST /api/billing/webhook` (Stripe) — sync events (raw body, signature-verified)
- `GET  /api/admin/accounts/:id/billing` (admin) — one client's billing + invoices
- `GET  /api/admin/billing/overview` (admin) — portfolio MRR + per-client rollup

## Without Stripe configured
Everything still runs. Checkout/portal return 503 with a clear message; admin
financial views show internal tier data and any manually-recorded transactions.
The admin tier override is fully usable for comps and testing.
