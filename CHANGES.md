# ShieldAI — Analyst & Admin Console: Mockup → Live (Phases 1–3)

## What changed
The Analyst Console's **portfolio command center** was the last mockup: its
default view ran on a hardcoded `SAMPLE_CLIENTS` array. It now runs on real,
assignment-scoped data from the backend. The admin console was already live;
no changes were needed there beyond the shared portfolio endpoint.

## Files
- **portfolioRoutes.js** (NEW) — analyst portfolio backend.
- **server.js** (4 lines) — import + register the new routes; record a posture
  snapshot when a program finishes scoring.
- **src/App.jsx** (~377 lines) — portfolio view rewired to live endpoints;
  removed `SAMPLE_CLIENTS` (145 lines) and the "VISION MOCKUP" badge; added
  loading/empty/error states; null-guarded panels with no live source yet.

## New endpoints (all analyst-or-admin, assignment-scoped)
- `GET /api/analyst/portfolio` — per-client rollup: identity, tier/plan, live
  posture + weakest NIST areas, agent health, open recommendations, derived
  triage status. Admins see all real clients; analysts see only assigned ones.
- `GET /api/analyst/clients/:id/posture-history` — up to 12 trend points,
  merged from historical programs + new snapshots, one per day.
- `GET /api/analyst/clients/:id/alerts` — recent security events (agentEvents).
- `GET /api/analyst/clients/:id/review-queue` — programs/policies awaiting review.

## Posture snapshots
`recordPostureSnapshot()` appends a posture point whenever a program is scored
(de-duped: skips if score unchanged and <20 days since the last point; list is
bounded to 20k entries, matching the clientActions pattern). Existing accounts
still get a real trend because history also backfills from stored programs.

## Access control (verified via runtime smoke test)
- Admin → all real clients (excludes admin + analyst staff accounts).
- Analyst → assigned clients only.
- Analyst hitting an unassigned client → 403.
- Non-analyst/client hitting analyst routes → 403.

## Deferred to later phases (guarded, not faked)
These panels now render a clean "not tracked yet" state instead of sample data:
- **Compliance readiness %** — no live per-framework % source yet.
- **Client ↔ analyst chat/messaging** — needs a message model + client UI.
- **Training campaigns / simulations** — needs campaign fields on training
  programs. (Basic training program status still shows where present.)
- **MRR / revenue** — no revenue source in scope; replaced with plan + open-items.

## Validation performed
- `node --check` on server.js + portfolioRoutes.js — pass.
- `eslint portfolioRoutes.js` — clean (0 errors).
- `vite build` — production build succeeds.
- Runtime smoke test of all 4 endpoints + snapshot helper + 2 access-control
  cases — all pass.

## To apply
Copy these into your repo root (portfolioRoutes.js, server.js) and src/
(App.jsx), then commit. No dependency or schema changes; the new
`postureSnapshots` collection self-initializes on first run.

---

# Update — Demo analyst account + auto-assignment (Option C)

## Why
The live portfolio only shows clients an analyst is assigned to. The demo data
lives under a single client account (`demo@shieldai.com`), and nothing was
assigned to an analyst — so the console looked empty. This adds a demo analyst
and assigns the demo client to it automatically.

## Files
- **seedDemo.js** — new `ensureDemoAnalyst()`: creates a demo analyst account
  (if missing) and assigns the demo client to it (if not already). Idempotent;
  also called at the end of `seedDemo()`.
- **server.js** — the SEED_ON_BOOT block now calls `ensureDemoAnalyst()` on the
  "data already present" path too, so existing deployments get the analyst +
  assignment WITHOUT a full re-seed.

## Demo credentials
- Client:  demo@shieldai.com  / ShieldDemo2026        (the workspace being viewed)
- Analyst: analyst@shieldai.com / ShieldAnalyst2026   (logs into the console)

## How to activate on Railway
1. Deploy these files.
2. Make sure the service has `SEED_ON_BOOT=true` set (you already do — the logs
   show the seed block running). On next boot you'll see:
     "Created demo analyst: analyst@shieldai.com / ShieldAnalyst2026"
     "Assigned demo client (demo@shieldai.com) to analyst (analyst@shieldai.com)."
   (If the analyst already exists, those lines are skipped — it's idempotent.)
3. Log in as analyst@shieldai.com and open the Analyst Console. The
   "ShieldAI Demo Workspace" client now appears with live posture, agent
   health, alerts, and review queue.

## Note on how the demo appears
The three demo companies are all assessments under the SINGLE demo client
account, so the portfolio shows ONE client ("ShieldAI Demo Workspace") whose
latest scored program drives its posture — not three separate clients. If you
want three distinct clients in the portfolio for demos, that's a small seed
change (split into three client users); say the word and I'll do it.

## Verified
- Syntax check on seedDemo.js + server.js — pass.
- Runtime test of ensureDemoAnalyst: creates analyst + assignment, password
  hash verifies, second run is a no-op (idempotent), and the assigned client
  passes the portfolio's "real client" visibility filter.

---

# Update — Three separate demo client accounts

## Why
A single demo client showed as one portfolio card. Splitting the three demo
companies into three separate client accounts makes the portfolio look like a
real portfolio: three cards with genuinely different postures, and the
attention-first triage sort does real work (Apex/At-Risk floats to the top).

## What changed (seedDemo.js)
- Each of the 3 companies now has its own `account` (email/password) and is
  seeded as its OWN client user with its own assessment, program, and policies.
- `seedDemo()` rewritten to create/repair one client per company; idempotent
  (skips a client that already has data unless `force:true`).
- Legacy cleanup: the old combined `demo@shieldai.com` account (and its data +
  assignments) is automatically removed on seed, so no stale merged client.
- `demoExists()` now returns true only when all 3 company accounts exist — so
  on your CURRENT deployment it returns false and triggers the split-seed once.
- `ensureDemoAnalyst()` now assigns ALL 3 demo clients to the analyst.

## Demo credentials
Analyst (console login): analyst@shieldai.com / ShieldAnalyst2026
Clients:
  Meridian Dental Group (Healthcare, HIPAA)      → meridian@shieldai.com / ShieldDemo2026
  Lakeside Financial Advisors (Finance, SOC 2)   → lakeside@shieldai.com / ShieldDemo2026
  Apex Manufacturing (Manufacturing, CMMC)       → apex@shieldai.com     / ShieldDemo2026

## What happens on your next deploy
Your DB currently has the legacy combined account. Because `demoExists()` now
checks for the 3 new emails (absent), SEED_ON_BOOT will run `seedDemo`, which:
  1. Removes the legacy demo@shieldai.com account + its data,
  2. Creates the 3 separate client accounts (with programs — via AI, or the
     built-in fallback content if ANTHROPIC_API_KEY is unavailable),
  3. Creates the analyst and assigns all 3 clients.
Requires SEED_ON_BOOT=true (already set). Watch the logs for the "+ created
client / + assigned 3 clients" lines.

## Verified
- Syntax check — pass. Lint — no new errors (only pre-existing `process`/regex).
- Full migration simulation from the legacy-account state: legacy removed, 3
  clients created + assigned, stale assignment cleaned, one program each,
  second run fully idempotent.
