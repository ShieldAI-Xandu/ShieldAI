# HIBP Breach Monitoring — Setup & Workflow

## The constraint that shapes everything

Have I Been Pwned's domain-search API only returns data for domains **verified
inside your HIBP dashboard**. There is no API to enroll a domain — a human adds
it at https://haveibeenpwned.com/DomainSearch and completes HIBP's own
verification.

So per-client domain verification is an **operational workflow**, not code that
can be fully automated. ShieldAI now manages that workflow end to end.

## Two independent gates

Monitoring only goes live when **both** are green:

| Gate | Who does it | How |
|---|---|---|
| **Ownership** | Client | Publishes a DNS TXT record; ShieldAI verifies it automatically |
| **HIBP enrollment** | You (admin) | Adds the domain in the HIBP dashboard, records the result in ShieldAI |

The ownership gate isn't ceremony. Without it, a client could point ShieldAI at
a domain they don't own and read a third party's breach exposure. The system
**refuses** (HTTP 409) to mark HIBP monitoring live until ownership passes.

## Railway setup

| Variable | Required | Notes |
|---|---|---|
| `HIBP_API_KEY` | Yes | 32-char hex from https://haveibeenpwned.com/API/Key |
| `HIBP_USER_AGENT` | No | Defaults to `ShieldAI-vCISO` |
| `NVD_API_KEY` | No | Free key drops CVE rate limit from ~6s to ~0.6s per request |

Without `HIBP_API_KEY`, breach monitoring reports **"Not active"** — never a
fabricated all-clear.

## Client workflow

1. Client submits their company domain (`POST /api/client/domain`)
   - Normalized: `https://www.Acme.com/about` → `acme.com`
   - Public email domains (gmail, outlook, …) are **rejected** — you can't prove
     ownership of them and querying them exposes unrelated people's data
   - A domain already registered to another account is **rejected** (409)
2. ShieldAI returns a DNS TXT record to publish:
   ```
   Type: TXT   Host: @   Value: shieldai-domain-verification=<token>
   ```
3. Client publishes it, then hits **Verify** (`POST /api/client/domain/verify`)
4. ShieldAI resolves the TXT record itself. Pass → ownership verified.

Changing the domain **resets both gates**. Prior proof doesn't transfer.

## Your workflow (admin)

1. `GET /api/admin/domains` — the queue, sorted by what's actionable now
   - `readyToEnroll` — client proved ownership; add it to HIBP next
   - `awaitingHibp` — you submitted it; HIBP hasn't confirmed
   - `awaitingClient` — client hasn't published their TXT record
2. Add the domain at https://haveibeenpwned.com/DomainSearch
3. Record it: `POST /api/admin/domains/:userId/hibp-status`
   - `{"status":"submitted","note":"added to dashboard"}`
   - `{"status":"verified"}` once HIBP confirms → monitoring goes live
   - `{"status":"rejected","note":"..."}` if HIBP declines

Every status change is written to `adminAudit` with the actor's email.

## Endpoints

**Client** (own data; analysts may pass `?userId=` for assigned clients only)
- `GET  /api/client/domain` — current state + next step
- `POST /api/client/domain` — submit/change domain
- `POST /api/client/domain/verify` — run the DNS check
- `GET  /api/client/darkweb-exposure` — gated exposure
- `POST /api/client/darkweb-exposure/refresh`

**Admin**
- `GET  /api/admin/domains` — enrollment queue
- `GET  /api/admin/domains/statuses` — valid status values
- `POST /api/admin/domains/:userId/hibp-status`
- `POST /api/admin/domains/:userId/recheck` — re-run a client's DNS check

## Honesty guarantees

Consistent with "never ship fake security data":

- No API key → **"Not active"**, not "Low risk"
- Unverified domain → **"Not monitored"** with the exact reason
- HIBP 403 → **"Not monitored / needs verification"**, not an all-clear
- HIBP 429/5xx → **"Unknown (degraded)"**, not a clean result
- `clientView()` is the single source of what a client is told, so the UI can't
  drift into implying monitoring that isn't running

## Verification

```bash
DB_DIR=./testdata node domain.test.mjs                                  # 26 tests
DB_DIR=./testdata JWT_SECRET=test HIBP_API_KEY=test node domain.http.test.mjs  # 24 tests
```

Covers: normalization, validation, public-domain rejection, cross-account
collision, the ownership gate, both-gates-required, reset-on-change, analyst
isolation, admin authorization, and the audit trail.
