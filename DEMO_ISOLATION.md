# ShieldAI — Demo / Production Isolation

The demo is a **separate database file on the same server**, reached through a
public gateway that requires no credentials. Demo and production data cannot
cross.

## The boundary

| | Production | Demo |
|---|---|---|
| Data | `db.json` | private in-memory sandbox per visitor |
| Entry | Login (email + password) | Public "Try the demo" button |
| JWT secret | `JWT_SECRET` | `DEMO_JWT_SECRET` (separate) |
| Token claim | *(none)* | `store: "demo"`, `sid: <session>` |
| Writes | Yes | **Yes — fully functional** |
| Billing / Admin / Agent enrollment | Yes | Blocked (403) |
| Accounts | Real clients | `*@shieldai.demo` only |
| Lifetime | Permanent | Discarded on exit (or after 4h) |

## Per-visitor sandboxes

`demo-db.json` is a **template, not a live store**. Each visitor gets a deep
in-memory clone of it, keyed by a session id inside their signed token.

- Every button works. Writes persist within the session.
- No visitor can see another's work — different sandbox objects entirely.
- The template is never written to, so it stays pristine without a reset job.
- Exiting destroys the sandbox immediately; abandoned ones expire after 4h.
- Sandboxes die with the process. A redeploy ends live demo sessions — correct
  for throwaway data, and it never affects production.

Capped at 200 concurrent sandboxes with LRU eviction, as back-pressure.

## Demo threat intelligence

This is the one place where "make the demo realistic" could have meant shipping
fake security data. It doesn't.

| | Approach | Why |
|---|---|---|
| **CVEs** | **Real, live from NVD** | Demo companies have fixed, plausible software stacks. We query NVD for them exactly as a real client does. Copy any CVE ID out of the demo and look it up at nvd.nist.gov — it's real and says what we said. |
| **Breach data** | **Canned fixture**, flagged `simulated: true` | HIBP can only answer for domains verified in our dashboard, and the demo companies are fictional — a live query is impossible by construction. |

No LLM invents a CVE number, a CVSS score, or a breach. A fabricated CVE ID
would either collide with a real record that says something else, or be
checkable-and-absent in ten seconds — in the exact feature the pitch sells as
"real data, unlike competitors."

## How it's enforced (four independent layers)

1. **Separate files.** `db.js` opens two lowdb stores. There is no code path
   that reads one and writes the other.
2. **Request-scoped binding.** `AsyncLocalStorage` binds each request to exactly
   one store before any route runs. Every existing `db.data.x` / `db.write()`
   call site resolves to the bound store automatically — no route code changed.
3. **Separate signing secrets.** A demo token fails verification against the
   production secret, and vice versa. Forging `store:"demo"` into a
   production-signed token doesn't work: `verifyDemoToken` checks the signature
   against the demo secret first.
4. **Boot guard.** The server refuses to start if any demo identity is found in
   `db.json`.

Store selection reads **only** the URL prefix and the token's own verified
claim — never request body or headers a visitor controls.

## Deploy steps

### Local
```bash
node migrateDemoOut.js             # dry run — shows what would be removed
node migrateDemoOut.js --apply     # writes a timestamped backup first
node seedDemo.js                   # builds the sandbox in demo-db.json
npm start
```

### Railway (or any PaaS)
Seeding runs the real AI pipeline and takes several minutes — far longer than a
healthcheck window. So **don't** put it in the start command: the server would
not be listening yet and the deploy would be killed mid-seed.

Instead, set an environment variable and let the app seed itself in the
background *after* it's already serving traffic:

| Variable | Value | Purpose |
|---|---|---|
| `SEED_DEMO_ON_BOOT` | `true` | Seed the sandbox in the background on startup |
| `SEED_DEMO_FORCE` | `true` | Rebuild even if already seeded (optional) |
| `DEMO_JWT_SECRET` | long random string | Must differ from `JWT_SECRET` |
| `DB_DIR` | volume mount path (e.g. `/data`) | Keeps both stores across deploys |

1. Set `SEED_DEMO_ON_BOOT=true` and redeploy.
2. `/health` answers within milliseconds; the healthcheck passes immediately.
3. Watch the logs for `✅ Demo sandbox ready`. Demo buttons appear on their own.
4. Remove `SEED_DEMO_ON_BOOT` (optional — it no-ops once seeded).

Seeding is **idempotent** and **non-fatal**: it skips if the sandbox already
exists, and if it fails the app keeps serving normally with the demo buttons
simply hidden. `npm start` stays the start command; nothing in `railway.json`
needs to change.

**`DB_DIR` must point at the mounted volume**, or `demo-db.json` lands on
ephemeral disk and vanishes on the next deploy.

## Endpoints

- `GET  /api/demo/status`  → `{ seeded, readOnly, personas[] }` (public)
- `POST /api/demo/session` → `{ token, user, readOnly }` (public, no credentials)
  - body: `{ "persona": "client" | "analyst" }`

Demo sessions expire after 4 hours and reuse the real read routes, so the demo
always reflects the actual product.

## Personas

| Persona | Email (demo store only) | Sees |
|---|---|---|
| Client view | `demo-client@shieldai.demo` | 3 seeded companies + programs/policies |
| Analyst console | `demo-analyst@shieldai.demo` | Only its assigned demo client |

Analyst isolation is enforced inside the sandbox exactly as in production — the
demo demonstrates the real boundary, not a mock of it.

## Verification

`isolation.test.mjs` and `e2e.test.mjs` cover: cross-store reads, concurrent
requests in both stores, token forgery, request routing, write blocking, and the
boot guard.

```bash
DB_DIR=./testdata JWT_SECRET=test node e2e.test.mjs
```

## Design notes

- **The sandbox is fully writable.** An investor clicking a button that silently
  refuses is worse than no demo. Isolation comes from giving each visitor their
  own copy, not from taking features away.
- **Only real-world side effects are blocked**: billing (real Stripe charges),
  admin (real accounts), agent enrollment (real tokens). Each returns a specific
  reason, not a generic refusal.
- **A purple banner rides above every authenticated demo view** so sample
  companies are never mistaken for real clients.
- **Demo sessions are never admin**, regardless of the underlying record.
