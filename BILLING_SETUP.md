# ShieldAI vCISO Billing (Stripe) — Setup

Billing is **fully built and tested, and switched OFF.** One master switch,
`BILLING_ENABLED`, controls it. While it is unset nothing talks to Stripe:
every money-moving route returns `503 "Billing is not enabled"`, the webhook
returns 503, and the read-only screens (plans, your plan, invoices, admin
financial views) keep working from internal data. Setting a Stripe key alone
does **not** turn it on.

## What is built
| Area | What it does |
|---|---|
| **Billing** | Self-serve subscriptions (Starter/Growth/Guided) via Stripe Checkout; Training Delivery add-on; Customer Portal (update card/bank, change plan, cancel); the webhook keeps tier + add-ons in sync; `past_due`, cancel-at-period-end and "action required" surfaced to the client |
| **Payments** | Hosted Checkout (cards). Optional **ACH bank debit** with instant bank verification through **Financial Connections** (`BILLING_ACH=true`) |
| **Invoicing** | The $49.99/mo framework add-on is invoiced by an admin: **Send Stripe invoice** creates and emails a real invoice; when it is paid the add-on activates automatically. Clients see their invoices/payments (with hosted page + PDF links) under Plan & Billing |
| **Financial Connections** | Used for ACH bank verification inside Checkout. No bank-data features are used or requested |

## Security model
- **No card or bank data ever touches ShieldAI vCISO.** Entry happens on Stripe-hosted Checkout, the Billing Portal, and hosted invoice pages.
- Keys live **only in environment variables** (Railway → Variables; `.env` locally, git-ignored). Never commit or paste them into chat. The server never logs them.
- The webhook **always verifies Stripe's signature**. There is no "unsigned dev mode": without `STRIPE_WEBHOOK_SECRET` billing stays off.
- Webhook events are **de-duplicated by event id**, invoice records are upserts (a replay changes nothing), and a test-mode event delivered to a live endpoint (or the reverse) is ignored.
- A **live key is refused** unless `BILLING_ALLOW_LIVE=true` is also set; live mode also requires an `https` `APP_URL`.
- Humans act: every charge-related action starts from a client's click or an admin's click. Nothing AI-generated can trigger billing.

## The tier ladder
| Tier | Price | Self-serve? |
|---|---|---|
| Free | $0 | n/a — no Stripe price |
| Starter | $159/mo | Yes |
| Growth | $349/mo | Yes |
| Guided | $699/mo | Yes |
| Managed vCISO | $1,950/mo | No — contact-sales |

Add-ons: **Training Delivery** $40/mo (Starter only; Growth+ bundle it) — bought through Checkout.
**Additional Compliance Framework** $49.99/mo per extra framework — **invoiced by an admin**, never a Checkout item. It is a countable slot (`frameworkEntitlements`), and the webhook deliberately never writes it into `addons`.

## Environment variables
| Variable | Purpose |
|---|---|
| `BILLING_ENABLED` | **Master switch.** Must be exactly `true`. Unset = OFF |
| `STRIPE_SECRET_KEY` | `sk_test_…` first. A restricted `rk_…` key also works |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from the webhook endpoint (required) |
| `APP_URL` | Your real site URL, used for Checkout/portal return links. `https` required in live mode |
| `BILLING_ALLOW_LIVE` | Must be `true` to allow a live (`sk_live_`) key |
| `STRIPE_PRICE_STARTER` / `_GROWTH` / `_GUIDED` / `_TRAINING_DELIVERY` / `_COMPLIANCE_FRAMEWORK` | Price ids printed by `npm run stripe:setup` (override `tiers.js`; test and live differ by environment, not code) |
| `BILLING_ACH` | `true` = offer bank debit (needs ACH enabled in the Stripe dashboard) |
| `BILLING_AUTOMATIC_TAX` | `true` = Stripe Tax at checkout (needs a tax registration configured) |
| `BILLING_PROMO_CODES` | `true` = promotion-code box in Checkout |
| `BILLING_PAST_DUE_GRACE_DAYS` | Default 7. Shown to clients as "fix your payment by…" |
| `BILLING_INVOICE_DAYS_UNTIL_DUE` | Default 14. Framework add-on invoices |

The **publishable key** (`pk_…`) is **not used** by this backend — everything is Stripe-hosted, so no Stripe.js runs in the browser. You may store it as `STRIPE_PUBLISHABLE_KEY` for later; nothing reads it today.

Startup log tells you the state plainly, without printing any secret:
`billing OFF — <reason>` or `billing ON (test mode, API 2026-08-26.dahlia, ACH)`.

## Go-live checklist (do TEST mode end to end first)
1. **Stripe dashboard (test mode):** enable Customer Portal (Settings → Billing → Customer portal: allow cancel + update payment method; add the Starter/Growth/Guided prices for plan changes). For ACH also enable *ACH Direct Debit* under Payment methods. For invoice emails set your business name/support email under Settings → Business.
2. **Create products/prices:** `STRIPE_SECRET_KEY=sk_test_xxx npm run stripe:setup`. It reuses existing products (matched by metadata), refuses a live key without `--i-know-this-is-live`, and prints the `STRIPE_PRICE_*` lines. Add `--archive-old` to deactivate superseded prices.
3. **Webhook endpoint:** point Stripe at `https://<your-domain>/api/billing/webhook` and subscribe to:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`,
   `invoice.paid`, `invoice.payment_failed`, `invoice.finalized`, `invoice.payment_action_required`, `invoice.voided`, `invoice.marked_uncollectible`,
   `charge.refunded`, `charge.dispute.created`. Copy its signing secret to `STRIPE_WEBHOOK_SECRET`.
   Locally: `stripe listen --forward-to localhost:3001/api/billing/webhook` prints a `whsec_…`.
4. **Set the variables in Railway** (Variables tab): the key, webhook secret, `APP_URL`, the price ids, then `BILLING_ENABLED=true` **last**.
5. **Test it (test mode):** subscribe with card `4242 4242 4242 4242`; confirm the tier flips and the banner confirms payment; open Manage Billing; cancel and see "ends on…"; for ACH set `BILLING_ACH=true` and use Stripe's test bank in the Financial Connections dialog (bank payments settle over days, so the banner says so); as admin, click **Send Stripe invoice** on a pending framework add-on, pay the hosted invoice with a test card, and confirm the add-on becomes active; replay a webhook from the dashboard and confirm nothing duplicates.
6. **Going live:** repeat with live keys + `BILLING_ALLOW_LIVE=true` and an `https` `APP_URL`, after your Stripe account is activated. Test and live are separate worlds: separate keys, prices, customers and webhook secrets. Do not reuse a test database of customers in live mode.

## How it flows
- **Subscribe:** Plan & Billing → **Upgrade** → `POST /api/billing/checkout {tier}` → Stripe Checkout → back to `/?billing=success` → the app opens Plan & Billing, shows "Confirming your payment…", and polls until Stripe's webhook has applied the plan (or explains that a bank payment is still settling).
- **Already subscribed?** Checkout answers `409 USE_PORTAL` (a second subscription would double-bill); plan changes go through **Manage Billing**.
- **Failed payment:** the client gets a notification and a banner with a "fix it by" date. Stripe's own dunning settings decide when the subscription becomes `unpaid`/canceled — at which point the plan drops to Free automatically.
- **Framework add-on:** client requests it (access is granted immediately, status *pending billing*) → an admin clicks **Send Stripe invoice** (two-step confirm) → the client receives a Stripe invoice → paid webhook activates it. The manual "Mark invoiced / Mark paid" buttons remain as a fallback and are audited.
- **Admin overrides:** an admin-comped plan is left alone while nothing is live in Stripe; a real active Stripe subscription overrides it on the next event ("the webhook wins").
- **Refunds & disputes:** refunds appear as their own transaction rows and never count as paid revenue; a new dispute notifies admins, who respond in the Stripe dashboard before the deadline.

## Routes
- `GET  /api/billing/plans` · `GET /api/billing/me` · `GET /api/billing/invoices` — always available (own data only)
- `POST /api/billing/checkout` · `/checkout-addon` · `/portal` — client, rate-limited, need billing ON
- `POST /api/billing/webhook` — Stripe only (raw body, signature verified)
- `POST /api/admin/billing/framework-addons/:id/invoice` — admin: create + send the Stripe invoice
- `GET  /api/admin/billing/overview` · `/framework-addons` · `GET /api/admin/accounts/:id/billing` — admin reads

## Not done on purpose
Stripe Tax registrations (flag only), bank-data features of Financial Connections, automatic (unattended) invoicing, and any enforcement that cuts off a plan on a timer instead of on Stripe's own dunning outcome.

## Testing
`node --test billing.test.mjs` runs 38 tests against a **fake** Stripe client — no network, no keys.
