# ShieldAI Integrations — Setup

This covers three integration families, all reachable from the client's
**🔌 Integrations** screen:

1. **Security-tool webhooks** (`integrationRoutes.js` /
   `integrationAdapters.js`) — Nessus/Tenable, Qualys, Rapid7 InsightVM,
   Microsoft Defender, CrowdStrike, Wazuh, Splunk, or a generic custom
   payload. **Fully live today, nothing to configure.**
2. **Directory connections** (`directoryRoutes.js` / `directoryAdapters.js`)
   — Microsoft 365/Entra ID, Google Workspace, Okta. Okta is live today;
   Microsoft 365 and Google Workspace need an OAuth app registered with
   each vendor first (steps below) before a client can connect one.
3. **Productivity notifications** (`productivityRoutes.js` /
   `productivityAdapters.js` / `notificationDispatch.js`) — Slack in this
   pass (Teams/Jira/Asana/Trello/Zoom/Google Meet are a documented roadmap,
   not built yet — see "Roadmap" below). Needs a Slack app created first
   (steps below).

All three are gated behind the same `integrations` tier capability (Growth
and above — see `tiers.js`'s `FEATURE_CATALOG`, 3/10/unlimited connections
on Growth/Guided/Managed). Parts 1 and 2 feed the same place: findings at
medium severity or above get auto-drafted into the analyst recommendation
queue by Mastermind, exactly like the endpoint monitoring agent's findings
do. Part 3 is the other direction — it's what tells a client's team, via
Slack, once that queue's contents actually reach them. Neither family
touches `riskEngine.js`'s posture score directly — that engine is a closed,
fixed set of assessment-driven factors by design (see `CLAUDE.md`);
integration findings surface as recommendations, not a second score.

## Security model (why it's safe)

- **Webhooks are one-way in.** ShieldAI never calls out to a connected tool.
  The webhook response is just a receipt (`{ok, received, stored, ...}`) —
  no directive, no command.
- **Directory connections are read-only.** Every OAuth scope requested
  (Microsoft Graph `Directory.Read.All`/`Policy.Read.All`/`Reports.Read.All`,
  Google `admin.directory.user.readonly`/`admin.reports.audit.readonly`) is
  a read scope. Okta's token is validated against a read-only API call
  before it's ever stored. ShieldAI cannot change anything in a connected
  directory — there's no write path anywhere in `directoryAdapters.js`.
- **Per-client secrets are encrypted at rest.** OAuth refresh tokens, the
  Okta API token, and Slack's bot token are all AES-256-GCM encrypted
  (`credentialCrypto.js`) using `CREDENTIAL_ENCRYPTION_KEY`, never stored in
  plaintext. Nothing else in ShieldAI stores a reversible secret like this —
  see `SECRETS_RUNBOOK.md` for why it's treated differently from the other
  provider keys (rotating it is a migration, not a routine swap).
- **Slack notifications are outbound-only, and inbound actions replay
  through the same handlers the in-app buttons use.** ShieldAI never reads
  Slack channel history — only posts. The Slack interactivity endpoint
  (button clicks) is HMAC-signature-verified (`webhookSignature.js`) and
  resolves the calling workspace to a specific ShieldAI account by its
  Slack team id before applying anything — a click can never act on another
  client's data, and it can only ever apply the exact same
  handle/complete/decline action the in-app recommendation buttons already
  offer, nothing broader.

## Part 1 — Webhook tool integrations (live now)

No setup required. To test end-to-end:

1. In the app: Integrations → **+ Add Integration** → name it → pick a
   provider → copy the webhook URL and bearer token (shown once).
2. POST a sample payload:
   ```bash
   curl -X POST "<webhook URL>" \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{
       "rule": {"id": "23505", "level": 7, "description": "Vulnerability"},
       "agent": {"id": "001", "name": "web-01", "ip": "10.0.0.5"},
       "data": {"vulnerability": {"cve": "CVE-2023-9999", "severity": "High", "package": {"name": "openssl"}}}
     }'
   ```
   (that's a Wazuh-shaped body — swap the fields for whichever provider you
   picked, or use the generic `{"findings":[{...}]}` shape the Add
   Integration screen shows).
3. Confirm the finding appears on the connection's detail page, and — since
   this one's `high` severity — a draft recommendation appears in the
   analyst oversight queue.

## Part 2 — Directory connections

### Okta — live now, no app registration needed

1. In the target Okta org (a free
   [Okta Developer Edition](https://developer.okta.com/signup/) org works
   for testing): Security → API → Tokens → **Create Token**. Use an admin
   scoped to read-only if your org supports custom admin roles.
2. In ShieldAI: Integrations → **+ Connect Directory** → Okta → enter the
   domain (`yourorg.okta.com`) and paste the token → Connect.
3. Open the connection → **Sync now** → confirm posture findings appear
   (MFA enrollment policy status, stale accounts).

### Microsoft 365 / Entra ID — needs an Azure AD app registration first

1. [portal.azure.com](https://portal.azure.com) → **App registrations** →
   New registration.
2. Supported account types: **multitenant** ("Accounts in any organizational
   directory") — this is what lets any customer's tenant admin consent,
   not just yours. Personal Microsoft accounts are intentionally excluded
   (`directoryRoutes.js` uses the `/organizations/` authorize endpoint).
3. Redirect URI (Web platform): `<APP_URL>/api/directory/oauth/m365/callback`
   — must match `APP_URL` exactly (see the env var table below).
4. API permissions → Microsoft Graph → **Delegated** permissions:
   `Directory.Read.All`, `Policy.Read.All`, `Reports.Read.All`. These are
   effectively admin-only scopes — Microsoft shows its own admin-consent
   screen automatically when the signed-in user is a tenant admin.
5. Certificates & secrets → New client secret → copy the value immediately
   (Azure only shows it once).
6. Set `MS_GRAPH_CLIENT_ID` and `MS_GRAPH_CLIENT_SECRET` (below).
7. To test against a real tenant without touching a customer's: a free
   [Microsoft 365 Developer Program](https://developer.microsoft.com/microsoft-365/dev-program)
   sandbox gives you a disposable tenant with admin rights.

### Google Workspace — needs a Google Cloud OAuth client first

1. [console.cloud.google.com](https://console.cloud.google.com) → APIs &
   Services → Credentials → **Create OAuth client ID** (Web application).
2. Authorized redirect URI:
   `<APP_URL>/api/directory/oauth/google_workspace/callback`.
3. Configure the **OAuth consent screen**. `admin.directory.user.readonly`
   and `admin.reports.audit.readonly` are sensitive scopes — Google
   requires app verification before anyone outside your listed **test
   users** can consent. Add your test super-admin account as a test user to
   develop against without waiting on verification; plan for the
   verification review before onboarding real customers.
4. Set `GOOGLE_WORKSPACE_CLIENT_ID` and `GOOGLE_WORKSPACE_CLIENT_SECRET`
   (below).
5. A Google Workspace free trial gives you a super-admin account to test
   with.

## Part 3 — Slack

### Needs a Slack app created first

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** →
   From scratch.
2. **OAuth & Permissions** → Bot Token Scopes → add `chat:write`,
   `channels:read`, `groups:read` (posting, and listing channels for the
   channel picker — nothing that reads messages).
3. Same page → Redirect URLs → add
   `<APP_URL>/api/productivity/oauth/slack/callback`.
4. **Interactivity & Shortcuts** → turn on → Request URL:
   `<APP_URL>/api/productivity/slack/interactivity` (this is what makes the
   recommendation action buttons work — Slack POSTs here when someone
   clicks one).
5. **Basic Information** → copy the **Client ID**, **Client Secret**, and
   **Signing Secret**.
6. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`
   (below).
7. To test: install the app to a free Slack workspace of your own (Slack's
   free tier is enough — no paid plan needed to test bot messages and
   interactivity).

### Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `CREDENTIAL_ENCRYPTION_KEY` | Any directory or Slack connection | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `MS_GRAPH_CLIENT_ID` / `MS_GRAPH_CLIENT_SECRET` | Microsoft 365 | From the Azure app registration above |
| `GOOGLE_WORKSPACE_CLIENT_ID` / `GOOGLE_WORKSPACE_CLIENT_SECRET` | Google Workspace | From the Google Cloud OAuth client above |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Slack | From the Slack app's Basic Information page |
| `SLACK_SIGNING_SECRET` | Slack | Same page — verifies inbound button-click requests actually came from Slack |
| `APP_URL` | All OAuth providers | Already used by billing/phishing/training links — must exactly match the redirect URIs registered above |

Set these in Railway → Variables in production, `.env` locally (never
commit real values — see `SECRETS_RUNBOOK.md`). Without
`CREDENTIAL_ENCRYPTION_KEY`, connecting anything fails with a clear error at
connect time — the rest of the app keeps running normally (see
`credentialCrypto.js`'s header comment for why this fails lazily, not at
boot). Without a provider's client id+secret, that provider's "Connect"
button returns "isn't configured on this server yet" instead of erroring.

### Restart and verify

You should see these lines in the server logs:
```
ShieldAI directory integration routes registered.
ShieldAI productivity integration routes registered.
```
That confirms the routes are mounted regardless of which env vars are set —
it doesn't mean any provider is actually configured yet.

## How it flows

- **Okta:** client pastes domain + token → server makes one read-only call
  to validate it → encrypts and stores it → client clicks "Sync now" any
  time → server decrypts, calls the Okta API, maps results to findings.
- **Microsoft 365 / Google Workspace:** client clicks Connect → frontend
  calls `GET /api/directory/oauth/:provider/start` (authenticated fetch,
  since a plain browser navigation can't carry the app's Bearer auth header)
  → gets back the provider's authorize URL → browser navigates there →
  admin signs in and approves → provider redirects to
  `GET /api/directory/oauth/:provider/callback` → server exchanges the code
  for tokens, encrypts the refresh token, stores the connection → redirects
  the browser back into the app. "Sync now" refreshes an access token from
  the stored refresh token and calls Graph/Admin SDK.
- **Every sync:** posture facts → deterministic severity mapping
  (`directoryAdapters.js`) → medium+ findings deduped and drafted into
  `db.data.recommendations` (`origin: "ai"`, `status: "suggested"`) via the
  same Mastermind auto-draft pattern `integrationRoutes.js` and
  `agentRoutes.js` already use — a human always reviews before a client
  sees it.
- **Slack (outbound):** something happens that's client-visible (an analyst
  forwards/creates a recommendation, a task completes, a phishing campaign
  sends, a policy is assigned) → the triggering route calls
  `notify(db, {...})` (`notificationDispatch.js`) → for each active Slack
  connection with that event enabled, `chat.postMessage` with Block Kit
  buttons on recommendation events. Recommendation notifications only fire
  at the moment a recommendation becomes visible to the client (status
  `"proposed"`), never when the AI first drafts it as `"suggested"` —
  notifying the client's own Slack about an unreviewed draft would skip the
  analyst review step entirely.
- **Slack (inbound — button click):** Slack POSTs the click to
  `/api/productivity/slack/interactivity`, signed over the raw body →
  verified via `webhookSignature.js` → the workspace's Slack team id is
  matched against an active `productivityConnections` row to resolve which
  ShieldAI account this belongs to (never trusted from the button payload
  itself) → the same recommendation decision/complete logic the in-app
  buttons use is applied → Slack's message is updated via `response_url` to
  confirm.

## Routes summary

- `GET  /api/directory` / `GET /api/directory/:id` (client) — list/detail
- `GET  /api/directory/oauth/:provider/start` (client, `m365`|`google_workspace`) — returns `{url}`
- `GET  /api/directory/oauth/:provider/callback` (provider redirect, no auth header) — completes the connection
- `POST /api/directory/connect/okta` (client) — `{label, oktaDomain, apiToken}`
- `POST /api/directory/:id/sync` (client) — pulls posture data on demand
- `POST /api/directory/:id/revoke` / `DELETE /api/directory/:id` (client)
- `GET  /api/productivity` / `GET /api/productivity/:id` (client) — list/detail
- `PATCH /api/productivity/:id` (client) — set channel / toggle notification events
- `GET  /api/productivity/:id/channels` (client) — channels the Slack bot's been invited to
- `GET  /api/productivity/oauth/slack/start` (client) — returns `{url}`
- `GET  /api/productivity/oauth/slack/callback` (Slack redirect, no auth header)
- `POST /api/productivity/slack/interactivity` (Slack, HMAC-signed, no auth header) — button clicks
- `POST /api/productivity/:id/revoke` / `DELETE /api/productivity/:id` (client)

## Without a provider configured (today's default state)

Everything else keeps working. Okta connects normally, and so does anything
else that's already configured. The webhook integrations in Part 1 are
entirely unaffected. Clicking "Connect" on an unconfigured provider
(Microsoft 365, Google Workspace, or Slack) returns a clear "isn't
configured on this server yet" error instead of a broken redirect.

## Mastermind

`helpManual.js`'s `integrations` section documents all three flows for
clients, and is included verbatim in Mastermind's chat system prompt
(`mastermindRoutes.js`) — ask it "how do I connect Okta," "how do I feed my
Nessus scans into ShieldAI," or "how do I get Slack notifications" and it
answers from the real, current UI flow rather than guessing.

## Roadmap (not built yet)

Scoped alongside Slack but deferred to follow-up passes, with the key
architectural decisions already identified:

- **Microsoft Teams** — classic Incoming Webhooks lost actionable-message
  support in Microsoft's 2024 deprecation; genuine two-way interactivity now
  needs a real Bot Framework registration (Azure Bot Service, adaptive
  cards), materially heavier than Slack's model. Recommended simplification:
  ship Teams as outbound-only with an adaptive-card button that deep-links
  back into ShieldAI (opens the browser, already authenticated) rather than
  a full in-Teams round-trip.
- **Jira / Asana / Trello** — task-tracker sync. Needs a new
  `task.externalRef` field on `taskRoutes.js`'s task shape (doesn't exist
  today), per-provider OAuth (Jira: Atlassian OAuth 2.0 3LO; Asana: OAuth2;
  Trello: API key + token), and a status/priority mapping UI since
  workflow states are project-configurable, not fixed. Each provider signs
  inbound webhooks differently (Asana: HMAC-SHA256; Trello: HMAC-SHA1 over
  body+callback URL; Jira Cloud: not HMAC-signed by default) —
  `webhookSignature.js` is generic enough to cover the HMAC ones; verify
  exact current behavior per provider before building, the same "verify
  against a live tenant" discipline the directory adapters already follow.
- **Zoom (posture)** — same shape as the M365/Google Workspace directory
  adapters: OAuth (Zoom's marketplace multi-account app model, to match how
  M365/Google already support many different customer tenants), pulling
  admin settings (passcode required, waiting room enabled, cloud-recording
  encryption) via Zoom's Admin API.
- **Google Meet (posture)** — likely not a new connection type at all; Meet
  safety settings live under the same Google Workspace Admin console a
  client may already have connected. Recommended: extend the existing
  `google_workspace` adapter/scopes rather than create a redundant second
  Google connection for the same tenant.
- **Zoom / Google Meet (scheduling)** — architecturally distinct from the
  posture-check connection above: creating a meeting needs a *personal
  user's* calendar/meeting scope, not an org-admin read scope, so it can't
  reuse the posture connection's consent grant. Also the first WRITE
  capability across every integration built so far (webhooks = receive
  only, directory = read only) — a deliberate, bounded exception (a human
  explicitly requests one meeting, ShieldAI creates exactly that one),
  worth calling out explicitly when it's built, not silently introduced.
