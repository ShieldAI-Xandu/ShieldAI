# ShieldAI Phishing Simulation — Setup

The phishing simulation feature is fully built: scenario catalog, campaign
creation, per-learner tracking, click-rate reporting, and a real-time-safe
educational reveal page. It runs today **without** email configured —
campaigns can be created, but `Send Now` returns a clear "not configured yet"
message instead of erroring. Nothing sends until you complete the steps below.

Two providers are supported today, both implemented and verified against
each vendor's real API — pick whichever you already use or prefer:
**Resend** (simpler, JSON API, good default if you're starting from
scratch) or **Mailgun** (if you already have an account, or prefer its
longer track record).

## Why this needed new infrastructure
ShieldAI had no outbound email capability at all before this feature —
learner training links have always been distributed out-of-band (copied and
sent manually). Phishing simulation is the first thing that actually
requires sending real email, so this introduces `emailService.js`, a small
provider-agnostic sender that other features (automatic learner invites,
password reset) can build on later without re-doing this work.

## 1a. Option A — Resend
1. Sign up at resend.com.
2. Add and verify a domain you control (Domains → Add Domain) — a few DNS
   records (SPF, DKIM) at your registrar. This is what gives the simulated
   phishing emails real deliverability rather than landing in spam or
   getting the domain flagged. **Do not use a client's own domain** — see
   "Sending domain and deliverability" below.
3. Create an API key (API Keys → Create API Key).
4. Set in the environment (Railway Variables tab in production, `.env` locally):
   ```
   EMAIL_PROVIDER=resend
   RESEND_API_KEY=re_xxxxxxxxx
   EMAIL_FROM_DOMAIN=simulate.yourdomain.com
   ```

## 1b. Option B — Mailgun
1. Sign up at mailgun.com (or use your existing account).
2. Add and verify a sending domain (Sending → Domains → Add New Domain) —
   again, a dedicated subdomain, not a client's own domain.
3. Create a Domain Sending Key scoped to that domain (Account Settings → API
   Keys), rather than using your primary account key — this limits the blast
   radius if the key is ever compromised, since a sending key can only send
   through `/messages` for its own domain.
4. Note whether your account is on Mailgun's US or EU infrastructure — this
   was chosen when you signed up and determines which API region to use.
5. Set in the environment:
   ```
   EMAIL_PROVIDER=mailgun
   MAILGUN_API_KEY=key-xxxxxxxxx
   EMAIL_FROM_DOMAIN=simulate.yourdomain.com
   MAILGUN_REGION=us
   ```
   `MAILGUN_REGION` defaults to `us` if omitted; set it to `eu` if your
   Mailgun account is EU-region. If you ever want Mailgun's sending domain
   (the one in the API URL) to differ from `EMAIL_FROM_DOMAIN` (the one
   people see in the From address), set `MAILGUN_DOMAIN` explicitly — in the
   ordinary case you won't need to, they're the same domain.

## 2. Restart the backend
You should see, depending on which provider you configured:
```
ShieldAI email: Resend configured.
```
or
```
ShieldAI email: Mailgun configured (US region, domain simulate.yourdomain.com).
```
followed by `ShieldAI phishing simulation routes registered.` If you only
see the routes line and not the provider line, the relevant API key isn't
set where the running process can see it.

## Sending domain and deliverability — read before going live
Phishing-simulation email is sent from a **ShieldAI-controlled domain**
with a realistic-but-distinguishable sender identity (e.g. "IT Help Desk
<it-helpdesk@simulate.shieldai.io>"), never from a client's own domain.
This is deliberate:
- Sending "as" a client's exact domain would require every client to
  authorize ShieldAI in their own SPF/DKIM records — a heavy per-client
  setup burden that doesn't scale.
- If a simulation email is ever misfiled as spam or reported by a mail
  provider, you want that risk isolated to a dedicated sending domain, not
  bleeding into your primary product email's sender reputation.
- This is how commercial phishing-simulation tools (KnowBe4, Proofpoint,
  etc.) handle it by default.

## What's tracked, and what's deliberately NOT built
- **Tracked:** email sent, delivery failures, and link clicks (timestamped,
  one click recorded per learner even if they click multiple times).
- **Not built, on purpose:** a fake credential-harvesting form. Clicking the
  link goes straight to an educational reveal page explaining what should
  have been the tip-off — it never prompts for a password, real or fake.
  This avoids any ambiguity about capturing real credentials in a training
  context, and click-through rate alone is the metric that actually matters
  for a training program.
- **Not built yet:** open-tracking (via a pixel) — click-through is a more
  reliable and more meaningful signal than opens, and pixel tracking is
  increasingly blocked by mail clients anyway, so it was left out rather
  than added for a metric of limited value.

## Scenario catalog
Six scenarios ship today (see `phishingScenarios.js`): password expiration,
overdue invoice, urgent request impersonating a manager/executive, delivery
notification, shared-document notification, and benefits enrollment
reminder. Each has been deliberately kept in "plausible routine business
email" territory — none exploit health, job-security, or financial-hardship
fear, which is where some commercial phishing-simulation vendors have drawn
real employee backlash. Add more by extending `PHISHING_SCENARIOS` in that
file; each needs a subject/body with a `{{LINK}}` placeholder and a
`redFlags` list shown on the reveal page after a click.

## How it's gated
Phishing simulation is gated on the same `trainingDelivery` capability as
the rest of the training product — Growth and above bundle it, Starter can
add it via the existing $40/mo training delivery add-on. It is not a
separate priced item today. If you'd rather price it separately, that's a
change to the `gate.trainingDelivery()` calls in `phishingRoutes.js` and a
new capability flag in `tiers.js` — a small, contained change, not a rebuild.

## Routes summary
- `GET  /api/phishing/scenarios` (client/staff) — scenario catalog
- `GET  /api/phishing/campaigns` (client/staff) — list campaigns
- `POST /api/phishing/campaigns` (client/staff, gated) — create a draft
- `GET  /api/phishing/campaigns/:id` (client/staff) — detail + per-learner results
- `POST /api/phishing/campaigns/:id/send` (client/staff, gated) — send now
- `DELETE /api/phishing/campaigns/:id` (client/staff) — delete a draft
- `GET  /api/phishing/overview` (client/staff) — click-rate summary
- `GET  /api/phish/:token` (public, no auth) — the link an email points to;
  records the click and returns the scenario's red flags for the reveal page
