# ShieldAI — Claude Code Project Guide

## What this is
ShieldAI is a full-stack virtual CISO (vCISO) SaaS platform for small and mid-sized
businesses, sold direct — not through MSPs. Founder/CEO: Derrick Brooks, Xandu Limited LLC.

- Production: https://shieldai-production-627e.up.railway.app (Railway)
- Repo: github.com/ShieldAI-Xandu/ShieldAI (branch: `main`)
- Local dev: Windows, `E:\ShieldAI`

## Stack
- Frontend: React 19 + Vite, single large `src/App.jsx`
- Backend: Express / Node ESM
- Storage: lowdb (JSON file-based)
- Auth: JWT
- AI providers (unified in `aiProviders.js`):
  - Anthropic Claude — primary reasoning/writing, and fallback
  - Google Gemini (`gemini-2.5-flash`) — threat intel / search grounding
  - OpenAI GPT-4o — tool recommendations, training content, executive report generation
  - Provider choice per step follows the `STEP_PROVIDER` mapping. UI badges read from a
    `generatedBy` field recorded at generation time — never hardcode a badge value.

## Non-negotiable architectural boundaries
These are investor/pitch-deck selling points. Do not weaken them, even incidentally
while fixing something else:

1. **Analyst isolation** — analysts are scoped strictly to their assigned clients only.
   Any change touching `agentRoutes.js` or other analyst-facing routes must preserve this.
2. **"AI advises, humans act"** — the monitoring agent is permanently read-only with no
   inbound command channel. Mastermind is advisory only. Never add a path that lets AI
   output trigger an action without a human in the loop.
3. **Real data over fabrication** — never silently ship fake/fabricated security data.
   If real data isn't available, flag it rather than substituting something plausible.
   CVEs must be real and checkable at nvd.nist.gov. HIBP fixtures must be flagged
   `simulated: true` and confined to `.example` domains.

## Workflow rules
- **Pull fresh before editing.** Always work from the latest `main` — stale local copies
  have caused the worst bugs in this project's history. `ace0a97` is the canonical clean
  baseline if a known-good reference point is needed.
- **Frontend/backend lineage must stay in sync.** Any change to an `App.jsx` API call must
  be cross-checked against its matching backend route (and vice versa) before the change
  is considered done.
- **Verify before calling something done:**
  - Frontend build: `npx esbuild@0.23.0` with the project's loader flags
  - Backend syntax: `node --check <file>`
  - Runtime behavior: actually run the dev server / hit `/health` — don't assume.
- **Database writes:** always `await db.write()` inside async handlers. Never
  fire-and-forget with `db.write?.()` — this has caused persistence bugs with the lowdb
  Proxy wrapper.
- **Secrets:** run `scanSecrets.js` (pre-commit hook) before any commit. Nine tracked
  secrets are documented with rotation steps in `SECRETS_RUNBOOK.md`. Never commit real
  key values, including into this file.

## Known "do not fix" items
- **NIST CSF scoring has no `assess()` by design.** Do not add one — a parallel score
  could disagree with the headline number. There's an in-code comment marking this
  intentional; leave it as-is.
- **`unbackedClaims()` CI guard** — any control-mapped framework without an `assess()` or
  documented `scoredBy` fails CI on purpose. This is intentional integrity enforcement,
  not a bug. Extend this pattern to new frameworks rather than routing around it.
- **Stripe billing is intentionally deferred.** `billingRoutes.js` returns 503 on purpose.
  Dev/admin tier-switchers bypass billing for demos — expected behavior, not a security
  hole to patch without discussion first.

## Key files
- `tiers.js`, `tierGate.js` — pricing tiers, `FEATURE_CATALOG`, `featureAccess()`, `ADDONS`
- `aiProviders.js` — AI provider routing
- `complianceBridge.js`, `frameworks.js` — framework lens/bridge system (12 frameworks)
- `riskEngine.js`
- `agentRoutes.js` — monitoring agent endpoints; the read-only boundary lives here
- `billingRoutes.js` — intentionally stubbed (503)
- `reportRoutes.js`, `trainingProgramRoutes.js`, `evidenceRoutes.js`
- `server.js` — dotenv load order matters here; has broken before
- `src/App.jsx` — large single-file frontend
- `seedDemo.js` — three demo companies: Meridian Dental Group (Healthcare/HIPAA),
  Lakeside Financial (Finance/SEC+SOC2), Apex Manufacturing (Manufacturing/CMMC)

## Environment variables
Set in Railway's Variables tab, not `.env` (which is gitignored):
`ADMIN_EMAIL`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENAI_API_KEY`,
`JWT_SECRET`, `DEMO_JWT_SECRET`, `HIBP_API_KEY`, `NVD_API_KEY` (optional),
`SHIELDAI_DEV_MODE`, `STRIPE_*`. JWT secret has no hardcoded fallback — it should throw
clearly if unset.

**`CREDENTIAL_ENCRYPTION_KEY`** — required for every OAuth-based integration
(directory, Slack, task-tracker, scheduling). Missing/malformed makes
`credentialCrypto.js` throw at first use; every OAuth `/finish` route catches
that now, so a client sees a clean error instead of the whole app crashing —
but the feature is dead without it. Generate with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
Confirm this is actually set in Railway, not just documented — full details
in `SECRETS_RUNBOOK.md`.

Per-provider OAuth app credentials (each integration degrades to a clear
"isn't configured on this server yet" error if unset, not a crash) — see
`INTEGRATIONS_SETUP.md` for the registration steps: `MS_GRAPH_CLIENT_ID` /
`MS_GRAPH_CLIENT_SECRET`, `GOOGLE_WORKSPACE_CLIENT_ID` /
`GOOGLE_WORKSPACE_CLIENT_SECRET`, `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET`,
`SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`, `JIRA_CLIENT_ID` /
`JIRA_CLIENT_SECRET`, `ASANA_CLIENT_ID` / `ASANA_CLIENT_SECRET`.

## Test accounts
- Admin: `dbrooks@xandultd.com` (auto-promoted via `ADMIN_EMAIL`)
- Analyst: `analyst@xandultd.com`
- Demo client: `demo@shieldai.com`
- Passwords live in local, gitignored notes — not in this file.

## Git / deploy
- This repo is committed to and pushed directly to `main`; Railway auto-deploys from there.
- After committing, re-fetch from GitHub and diff to confirm the push landed as expected
  before considering a change fully shipped.
