# ShieldAI Integrations — Setup

This covers two distinct integration families, both reachable from the
client's **🔌 Integrations** screen:

1. **Security-tool webhooks** (`integrationRoutes.js` /
   `integrationAdapters.js`) — Nessus/Tenable, Qualys, Rapid7 InsightVM,
   Microsoft Defender, CrowdStrike, Wazuh, Splunk, or a generic custom
   payload. **Fully live today, nothing to configure.**
2. **Directory connections** (`directoryRoutes.js` / `directoryAdapters.js`)
   — Microsoft 365/Entra ID, Google Workspace, Okta. Okta is live today;
   Microsoft 365 and Google Workspace need an OAuth app registered with
   each vendor first (steps below) before a client can connect one.

Both are gated behind the same `integrations` tier capability (Growth and
above — see `tiers.js`'s `FEATURE_CATALOG`, 3/10/unlimited connections on
Growth/Guided/Managed) and both feed the same place: findings at medium
severity or above get auto-drafted into the analyst recommendation queue by
Mastermind, exactly like the endpoint monitoring agent's findings do. Neither
family touches `riskEngine.js`'s posture score directly — that engine is a
closed, fixed set of assessment-driven factors by design (see `CLAUDE.md`);
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
- **Per-client secrets are encrypted at rest.** OAuth refresh tokens and the
  Okta API token are AES-256-GCM encrypted (`credentialCrypto.js`) using
  `CREDENTIAL_ENCRYPTION_KEY`, never stored in plaintext. Nothing else in
  ShieldAI stores a reversible secret like this — see `SECRETS_RUNBOOK.md`
  for why it's treated differently from the other provider keys (rotating
  it is a migration, not a routine swap).

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

### Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `CREDENTIAL_ENCRYPTION_KEY` | Any directory connection (incl. Okta) | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `MS_GRAPH_CLIENT_ID` / `MS_GRAPH_CLIENT_SECRET` | Microsoft 365 | From the Azure app registration above |
| `GOOGLE_WORKSPACE_CLIENT_ID` / `GOOGLE_WORKSPACE_CLIENT_SECRET` | Google Workspace | From the Google Cloud OAuth client above |
| `APP_URL` | Both OAuth providers | Already used by billing/phishing/training links — must exactly match the redirect URIs registered above |

Set these in Railway → Variables in production, `.env` locally (never
commit real values — see `SECRETS_RUNBOOK.md`). Without
`CREDENTIAL_ENCRYPTION_KEY`, connecting anything fails with a clear error at
connect time — the rest of the app keeps running normally (see
`credentialCrypto.js`'s header comment for why this fails lazily, not at
boot). Without the Microsoft/Google client id+secret, that provider's
"Connect" button returns "isn't configured on this server yet" instead of
erroring.

### Restart and verify

You should see this line in the server logs:
```
ShieldAI directory integration routes registered.
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

## Routes summary

- `GET  /api/directory` / `GET /api/directory/:id` (client) — list/detail
- `GET  /api/directory/oauth/:provider/start` (client, `m365`|`google_workspace`) — returns `{url}`
- `GET  /api/directory/oauth/:provider/callback` (provider redirect, no auth header) — completes the connection
- `POST /api/directory/connect/okta` (client) — `{label, oktaDomain, apiToken}`
- `POST /api/directory/:id/sync` (client) — pulls posture data on demand
- `POST /api/directory/:id/revoke` / `DELETE /api/directory/:id` (client)

## Without Microsoft/Google configured (today's default state)

Everything else keeps working. Okta connects normally. The webhook
integrations in Part 1 are entirely unaffected — different file, different
capability check reuse aside. Clicking "Connect" on Microsoft 365 or Google
Workspace returns a clear "isn't configured on this server yet" error
instead of a broken redirect.

## Mastermind

`helpManual.js`'s `integrations` section documents both flows for clients,
and is included verbatim in Mastermind's chat system prompt
(`mastermindRoutes.js`) — ask it "how do I connect Okta" or "how do I feed
my Nessus scans into ShieldAI" and it answers from the real, current UI
flow rather than guessing.
