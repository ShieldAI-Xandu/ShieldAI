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

---

# Update — Analyst can now see full client security work

## The gap
The analyst console showed client names + action history only. Programs,
assessments, and policies (everything the client admin sees) were invisible,
because those endpoints (`/api/programs`, `/api/policies`, `/api/assessments`)
are scoped to `req.userId` — the client's own login — with no analyst path.

## Fix — new analyst read endpoints (portfolioRoutes.js)
All assignment-scoped and read-only:
- GET /api/analyst/clients/:id/programs                  — program summary rows
- GET /api/analyst/clients/:id/programs/:programId       — full program sections
- GET /api/analyst/clients/:id/assessments               — assessment rows
- GET /api/analyst/clients/:id/assessments/:assessmentId — full assessment
- GET /api/analyst/clients/:id/policies                  — policy rows
- GET /api/analyst/clients/:id/policies/:policyDocId      — full policy (content)

Each returns the same shape as the corresponding client endpoint, so the
frontend reuses its renderers. Access is gated by `canSee` (assignment or
admin); unassigned or cross-client access returns 403.

## Frontend (src/App.jsx)
- `loadClientDetail` now also fetches the client's programs + policies.
- New on-demand loaders `loadProgramDetail` / `loadPolicyDetail` with caches.
- New "Security Program & Deliverables" panel in the analyst client detail:
  - Expandable program(s) showing posture score, executive summary, NIST
    function scores, and top threats — the real generated program.
  - Expandable policy documents showing full policy content.
  - Clean empty states when a client has no program/policies yet.

## Verified
- Frontend `vite build` — succeeds (caught + fixed an `await`-in-object parse
  issue along the way).
- Backend syntax + eslint — clean.
- Runtime smoke test: program list/detail, assessments, policy list/detail all
  return real data; unassigned + cross-client access both return 403.

## To apply
Redeploy portfolioRoutes.js and src/App.jsx (server.js already registers the
routes; no new registration needed). No schema changes.

---

# Update — Analyst write access + working Approve button

## What changed
Analysts can now ACT on client work, not just view it. The review queue's
Approve button is wired to a real backend action, plus a "Request Changes"
option. Every decision is assignment-scoped and audited.

## Backend (portfolioRoutes.js)
- New: POST /api/analyst/clients/:id/review-decision
  Body: { kind: "program"|"policy", id, decision: "approve"|"request_changes", note? }
  - Sets a **separate `reviewStatus`** field ("approved" | "changes_requested")
    — deliberately NOT the program's generation `status`, so the client's own
    program views (which check status==="complete") never break.
  - Records reviewedAt/reviewedBy + a reviewHistory trail on the item.
  - Writes an audit entry via logClientAction (imported from assignmentRoutes)
    with actor role "analyst" and a human-readable detail line.
  - 403 unassigned client / 400 bad decision / 404 missing item.
- Review-queue read now reflects `reviewStatus` (awaiting_review → approved /
  changes_requested) and correctly treats a generated program (status
  "complete") as reviewable — previously programs never appeared in the queue.
- Program/policy list endpoints now include `reviewStatus` for badges.

## Frontend (src/App.jsx)
- Review & Approval Queue: real **Approve** and **Request Changes** buttons,
  with busy state; on success it reloads the client detail so the queue and
  deliverables reflect the new status.
- Security Program & Deliverables panel: APPROVED / CHANGES REQUESTED badges on
  programs and policies.
- reviewQueue mapping now carries id + kind so actions can target the right item.

## Design note — read vs write
This is a scoped write: analysts can approve / request-changes on programs and
policies for their ASSIGNED clients. It does not let analysts edit content or
regenerate programs (still the client's action). The generation status is never
overwritten; approval is tracked in a parallel reviewStatus field.

## Verified
- Backend syntax + eslint — clean.
- Frontend vite build — succeeds.
- Full write-flow smoke test: approve program (reviewStatus set, generation
  status preserved), request-changes on policy (note captured), audit log gets
  both entries, queue reflects new statuses, and access control returns
  403/400/404 for unassigned/bad-decision/missing cases.

---

# Update — Request-changes note prompt + client notifications

## What changed
Two connected pieces: analysts can now attach a NOTE when requesting changes,
and clients are NOTIFIED (with that note) via an in-app notification bell.

## Backend
- **db.js** — new `notifications` collection (self-initializing).
- **portfolioRoutes.js**
  - `pushNotification(db, {...})` helper (bounded to 200/user, 10k total).
  - review-decision now creates a client notification on approve AND on
    request-changes, embedding the analyst's note.
  - New client endpoints (own login, requireAuth):
    - GET  /api/notifications          → { unread, notifications[] } (latest 50)
    - POST /api/notifications/:id/read → mark one read
    - POST /api/notifications/read-all → mark all read
- **server.js** — passes `requireAuth` into registerPortfolioRoutes.

## Frontend (src/App.jsx)
- **Request Changes** now opens an inline note textarea in the review queue;
  "Send to Client" is disabled until a note is entered. The note is delivered
  to the client verbatim.
- **NotificationBell** component on the client HomeScreen: unread badge, dropdown
  of recent notifications, marks all read on open, light 60s poll. Approvals show
  ✅, change-requests show ✏️.

## Privacy / access
- Notifications are strictly per-recipient: a user only ever reads their own
  (verified — the analyst does not see the client's notifications).
- Unauthenticated → 401.

## Verified
- Backend syntax + eslint clean; frontend vite build succeeds.
- Full flow smoke test: request-changes-with-note creates a client notification
  carrying the note; approve creates one too; unread count tracks correctly;
  read-all clears it; recipient scoping and 401 both hold.

## To apply
Redeploy db.js, portfolioRoutes.js, server.js, and src/App.jsx. The
notifications collection auto-creates on first boot; no migration needed.
