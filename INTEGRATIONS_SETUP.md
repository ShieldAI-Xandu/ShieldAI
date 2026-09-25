# ShieldAI vCISO Integrations — Setup

This covers six integration families, all reachable from the client's
**🔌 Integrations** screen (scheduling is the one exception, reachable from
the Support Center instead):

1. **Security-tool webhooks** (`integrationRoutes.js` /
   `integrationAdapters.js`) — Nessus/Tenable, Qualys, Rapid7 InsightVM,
   Microsoft Defender, CrowdStrike, Wazuh, Splunk, or a generic custom
   payload. **Fully live today, nothing to configure.**
2. **Directory connections** (`directoryRoutes.js` / `directoryAdapters.js`)
   — Microsoft 365/Entra ID, Google Workspace, Okta, Zoom. Okta is live
   today; the other three need an OAuth app registered with each vendor
   first (steps below).
3. **Cloud infrastructure connections** (`cloudRoutes.js` /
   `cloudAdapters.js`) — AWS, Azure. Both are **live today, nothing to
   configure server-side** — a pasted read-only credential, same model as
   Okta.
4. **Productivity notifications** (`productivityRoutes.js` /
   `productivityAdapters.js` / `notificationDispatch.js`) — Slack and
   Microsoft Teams. Slack needs an app created first; Teams needs no app
   registration at all (paste-in webhook URL).
5. **Task trackers** (`taskTrackerRoutes.js` / `taskTrackerAdapters.js`) —
   Jira, Asana, Trello. Jira/Asana need an OAuth app each; Trello needs no
   app registration (paste-in API key + token).
6. **Scheduling** (`schedulingRoutes.js` / `schedulingAdapters.js`) — Zoom,
   Google Meet. "Schedule a call" from the Support Center. Reuses the same
   Zoom/Google OAuth apps directory connections use, requesting a different
   (write) scope on a separate, personal connection.

All six are gated behind the same `integrations` tier capability (Growth
and above — see `tiers.js`'s `FEATURE_CATALOG`, 3/10/unlimited connections
on Growth/Guided/Managed). Parts 1, 2, 3, and 5 (as a read source) feed the
same place: findings/synced tickets surface as recommendations or task
metadata, never a second posture score — that engine (`riskEngine.js`) is a
closed, fixed set of assessment-driven factors by design (see `CLAUDE.md`).
Part 4 is the other direction: telling a client's team, via chat, once
something actually reaches them. Part 6 is the only WRITE capability in
this whole framework — see its own section below for why that's a
deliberate, bounded exception rather than a relaxation of anything.

## Security model (why it's safe)

- **Webhooks are one-way in.** ShieldAI vCISO never calls out to a connected tool.
  The webhook response is just a receipt (`{ok, received, stored, ...}`) —
  no directive, no command.
- **Directory connections are read-only.** Every OAuth scope requested is a
  read scope (Microsoft Graph `Directory.Read.All`/`Policy.Read.All`/
  `Reports.Read.All`; Google `admin.directory.user.readonly`/
  `admin.reports.audit.readonly`/`admin.directory.customer.readonly`; Zoom
  `account:read:admin`). Okta's token is validated against a read-only API
  call before it's ever stored. ShieldAI vCISO cannot change anything in a
  connected directory — there's no write path anywhere in `directoryAdapters.js`.
- **Cloud connections are read-only by the cloud provider's own design**,
  not just ShieldAI vCISO's convention. AWS's credential is scoped to AWS's
  managed `SecurityAudit` policy; Azure's service principal is scoped to
  the built-in `Reader` role — both are purpose-built, read-only grants the
  provider itself maintains. Every call `cloudAdapters.js` makes is a read
  (`Get*`/`List*`/`Describe*` on AWS; ARM `GET` on Azure) — there's no write
  path anywhere in the file.
- **Task trackers only ever create the one ticket you send, then read its
  status back on request.** No inbound webhooks from any tracker (each
  signs differently — Asana HMAC-SHA256, Trello HMAC-SHA1, Jira Cloud not
  signed by default — real per-provider complexity for marginal benefit
  over a manual "Sync status" button, the same pattern directory
  connections' "Sync now" already established). Pulling a tracker's status
  never drives a ShieldAI vCISO task through the real `/complete` endpoint (which
  has posture-scoring side effects) — a human still clicks "Complete &
  Re-score" in ShieldAI vCISO itself.
- **Scheduling creates exactly one meeting per request, nothing else.** No
  calendar reads, no meeting management, no recurring access. Uses a
  **separate, personal-user connection** from the org-admin directory
  connections — reusing an admin's read-only consent grant for a write
  action would violate least-privilege, and the person scheduling a call
  isn't necessarily the same person who connected the directory.
- **Per-client secrets are encrypted at rest.** OAuth refresh tokens, the
  Okta API token, Trello's API key/token, and Slack's/Teams' bot
  token/webhook URL are all AES-256-GCM encrypted (`credentialCrypto.js`)
  using `CREDENTIAL_ENCRYPTION_KEY`, never stored in plaintext.
- **Slack/Teams notifications are outbound-only, and inbound actions replay
  through the same handlers the in-app buttons use.** Slack's interactivity
  endpoint is HMAC-signature-verified and resolves the calling workspace to
  a specific ShieldAI vCISO account by its Slack team id — never trusted from the
  button payload itself. Teams has no inbound endpoint at all (a bare
  webhook URL can't receive replies) — its buttons deep-link back into
  ShieldAI vCISO instead, applying the action through a normal authenticated
  session, not a spoofable payload.

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
   for testing): Security → API → Tokens → **Create Token**.
2. In ShieldAI vCISO: Integrations → **+ Connect Directory** → Okta → enter the
   domain (`yourorg.okta.com`) and paste the token → Connect.
3. Open the connection → **Sync now** → confirm posture findings appear.

### Microsoft 365 / Entra ID — needs an Azure AD app registration first

1. [portal.azure.com](https://portal.azure.com) → **App registrations** →
   New registration → **multitenant** ("Accounts in any organizational
   directory").
2. Redirect URI (Web platform): `<APP_URL>/api/directory/oauth/m365/callback`.
3. API permissions → Microsoft Graph → **Delegated**: `Directory.Read.All`,
   `Policy.Read.All`, `Reports.Read.All`.
4. Certificates & secrets → New client secret → copy immediately.
5. Set `MS_GRAPH_CLIENT_ID` / `MS_GRAPH_CLIENT_SECRET` (below). Test against
   a free [Microsoft 365 Developer Program](https://developer.microsoft.com/microsoft-365/dev-program) sandbox.

### Google Workspace — needs a Google Cloud OAuth client first

1. [console.cloud.google.com](https://console.cloud.google.com) → APIs &
   Services → Credentials → **Create OAuth client ID** (Web application).
2. Authorized redirect URI:
   `<APP_URL>/api/directory/oauth/google_workspace/callback`.
3. Configure the **OAuth consent screen** — these are sensitive scopes;
   Google requires app verification before anyone outside your test users
   can consent. Add your super-admin test account as a test user.
4. Set `GOOGLE_WORKSPACE_CLIENT_ID` / `GOOGLE_WORKSPACE_CLIENT_SECRET`.
5. Meet safety settings (part of this same connection's posture pull) are
   **best-effort** — the exact Admin SDK surface for that specifically
   wasn't confidently verified; it degrades to an honest "not available"
   finding rather than a fabricated one if the call fails.

### Zoom — needs a Zoom Marketplace app first

1. [marketplace.zoom.us](https://marketplace.zoom.us) → Develop → Build App
   → **General App** (OAuth, multi-account — not the single-account
   variant, to match how M365/Google support many customer tenants).
2. Redirect URL: `<APP_URL>/api/directory/oauth/zoom/callback`.
3. Scopes: `account:read:admin` (Zoom has been migrating toward more
   granular scopes — verify current guidance when registering).
4. Set `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET`. This same app is reused for
   Part 5's scheduling connection, requesting `meeting:write` instead.

## Part 3 — Cloud infrastructure (AWS, Azure)

Both live now, no ShieldAI-side app registration — a pasted, long-lived
read-only credential, same model as Okta above (not the M365/Google/Zoom
OAuth-redirect model, since neither AWS nor Azure offers a per-end-user
consent flow for these APIs).

### AWS — no app registration needed

1. In the AWS account to monitor: IAM → Users → **Add users** → name it
   (e.g. `shieldai-readonly`) → access type: Access key.
2. Attach the AWS-managed policy **`SecurityAudit`** directly (Attach
   policies directly → search "SecurityAudit") — a purpose-built,
   read-only policy AWS itself maintains for exactly this use case.
3. Create the user → copy the **Access Key ID** and **Secret Access Key**
   immediately (the secret is shown once).
4. In ShieldAI vCISO: Integrations → **+ Connect Cloud** → AWS → paste both
   (region is optional, defaults to `us-east-1`) → Connect.
5. Open the connection → **Sync now** → confirm posture findings appear.

**v1 scope note**: the security-group/CloudTrail checks run against one
region (the one you provide, or `us-east-1`) — full multi-region coverage
is a later iteration.

### Azure — needs an Entra ID app registration first (no vendor approval wait)

1. [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID** →
   App registrations → New registration (single tenant is fine — this
   isn't a multi-customer OAuth app like M365's).
2. Certificates & secrets → New client secret → copy the **value**
   immediately (not the secret ID).
3. Copy the **Application (client) ID** and **Directory (tenant) ID** from
   the app's Overview page.
4. Subscriptions → (your subscription) → Access control (IAM) → Add role
   assignment → role **Reader** → assign to the app registration you just
   created → copy the **Subscription ID**.
5. In ShieldAI vCISO: Integrations → **+ Connect Cloud** → Azure → paste Tenant
   ID, Client ID, Client Secret, Subscription ID → Connect.
6. Open the connection → **Sync now** → confirm posture findings appear.
   Unlike an OAuth app, there's no separate admin-consent wait — the Reader
   role assignment takes effect immediately.

**v1 scope note**: the Defender for Cloud secure-score check degrades to
an honest "not available" finding if Defender for Cloud isn't enabled on
the subscription — it doesn't fabricate a score.

## Part 4 — Slack and Microsoft Teams

### Slack — needs a Slack app created first

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** →
   From scratch.
2. **OAuth & Permissions** → Bot Token Scopes → `chat:write`,
   `channels:read`, `groups:read`.
3. Redirect URLs → `<APP_URL>/api/productivity/oauth/slack/callback`.
4. **Interactivity & Shortcuts** → on → Request URL:
   `<APP_URL>/api/productivity/slack/interactivity`.
5. **Basic Information** → copy Client ID, Client Secret, Signing Secret →
   set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`.
6. Test on a free Slack workspace — no paid plan needed.

### Microsoft Teams — no app registration needed

Paste-in webhook URL, same model as Okta/Trello. In the target Teams
channel: ⋯ → Workflows → "Post to a channel when a webhook request is
received" (or, on older setups, Connectors → Incoming Webhook) → copy the
URL → paste into ShieldAI vCISO. Nothing to configure server-side. Note:
Microsoft has been deprecating classic Incoming Webhooks in favor of
Workflows/Power Automate — both are URL-based so `sendTeamsMessage`'s
POST-to-URL approach adapts to either, but verify current guidance since
this has been in flux.

## Part 5 — Task trackers

### Trello — no app registration needed

Paste-in API key + token, same model as Okta. At
[trello.com/power-ups/admin](https://trello.com/power-ups/admin), grab an
API key, then generate a token from it (scope: read + write). In ShieldAI vCISO:
Integrations → **+ Connect Task Tracker** → Trello → paste both. After
connecting, pick a board and which list is "default" vs. "done" — Trello
has no universal status concept the way Jira/Asana do, so moving a card
between those two chosen lists **is** the status signal.

### Jira — needs an Atlassian OAuth app first

1. [developer.atlassian.com/console/myapps](https://developer.atlassian.com/console/myapps)
   → Create → OAuth 2.0 integration.
2. Permissions → add the Jira API, scopes `read:jira-work`,
   `write:jira-work`, `read:jira-user`, `offline_access`.
3. Authorization → Callback URL: `<APP_URL>/api/tasktracker/oauth/jira/callback`.
4. Settings → copy Client ID / Secret → set `JIRA_CLIENT_ID` /
   `JIRA_CLIENT_SECRET`.
5. Status pulls use Jira's `statusCategory` (new/indeterminate/done) rather
   than a project's custom status names, so no per-project mapping is
   needed. If the connecting account has access to more than one Jira Cloud
   site, only the first one returned is used (v1 simplification) —
   reconnect with a different account if that's ever the wrong one.

### Asana — needs an Asana OAuth app first

1. [app.asana.com/0/my-apps](https://app.asana.com/0/my-apps) → Create New
   App → OAuth.
2. Redirect URL: `<APP_URL>/api/tasktracker/oauth/asana/callback`.
3. Copy Client ID / Secret → set `ASANA_CLIENT_ID` / `ASANA_CLIENT_SECRET`.
4. After connecting, pick a workspace then a project. Status uses Asana's
   universal `completed` boolean. Asana has no built-in priority field
   without a paid custom field — priority sync is simply omitted, not
   guessed.

## Part 6 — Scheduling ("Schedule a call")

Reachable from the **Support Center**, not the Integrations screen — this
is a personal connection, not an org-admin one. Reuses the same
`ZOOM_CLIENT_ID`/`GOOGLE_WORKSPACE_CLIENT_ID` apps Part 2 registers,
requesting a different, narrower scope (`meeting:write` /
`https://www.googleapis.com/auth/calendar.events`) on a separate consent —
what matters for least-privilege is that the resulting token is minimal and
distinct, not that a whole separate app was registered. No additional
`.env` variables needed beyond what Part 2 already set for Zoom/Google.

This is the **first write capability** across every integration in this
codebase (webhooks receive only, directories/trackers-as-a-read-source read
only). Deliberately bounded: a human clicks "Schedule," picks a time,
ShieldAI vCISO creates exactly that one meeting — no calendar access, no
recurring grant beyond the single create call each time.

## Part 7 — Antivirus / EDR detections (read-only)

The endpoint agent can only read what an AV/EDR product writes locally
(Defender, ClamAV, XProtect). Products that keep detections in their cloud
console (CrowdStrike, SentinelOne, Bitdefender, ESET, ...) would otherwise
leave an endpoint's **Recent malware detections** check at `unknown`. This
part connects to the vendor's console so those detections show up too.
Growth and above (same `integrations` capability and connection limit as the
rest of this document). Code: `securityVendorAdapters.js`,
`securityVendorRoutes.js`; the Bitdefender push path is in
`integrationAdapters.js` / `integrationRoutes.js`.

**Read-only, enforced in code.** Every request goes through `makeClient()`,
which refuses any method except GET plus an explicit per-vendor allow-list of
read-only POSTs (the OAuth token endpoint and query-by-id reads). No response
or remediation API is ever called: ShieldAI vCISO can observe, never isolate,
quarantine or change anything. The client should still create a read-only
credential (below) so the vendor's own permissions back that up.

**What happens to a detection.** It is stored as a `vendorDetections` record
(metadata only: host, title, severity, time, vendor status, file path). If its
host matches (case-insensitive short hostname) an enrolled endpoint of the
same client, and the vendor says it is still open, it becomes an open
`av-detection` vulnerability on that endpoint (`source: "vendor"`, so an
agent's clean report never auto-closes it). New medium+ detections also draft
a recommendation for a human to review. The AI never triggers an action.

**Honesty rules.** A failed or partial poll never resolves or clears anything,
and never turns a check "clean". A connection that has not synced in 45
minutes, or is in `error`, is not treated as a detection source. If a vendor
gives no open/closed state (ESET), detections are shown "to review" and are not
reported as vulnerabilities or as clean. Polled every 15 minutes (backoff on
failure; a client who drops below Growth stops being polled) plus "Sync now".

**All of these are built from vendor documentation and are NOT yet verified
against a live tenant.** Verify each against a trial tenant before telling a
client it works. Shape surprises are errors (the poll fails), not "no
detections".

| Vendor | Mode | Read-only credential the client creates |
|--------|------|-------------------------------------------|
| CrowdStrike Falcon | poll | API client with only the **Alerts: Read** scope (cloud us-1 / us-2 / eu-1) |
| SentinelOne | poll | API token of a dedicated **Viewer**-role user; console URL must be `https://<tenant>.sentinelone.net` |
| Microsoft Defender for Business | poll | Entra app with **SecurityAlert.Read.All** (application) + admin consent; Defender for Endpoint alerts only |
| Sophos Central | poll | Tenant-level credential with the **Service Principal Read-Only** role (partner/org credentials are refused) |
| ESET PROTECT | poll | Dedicated ESET Business Account API user, Integrations on, **read** access. Auth host names unverified; detections carry no hostname or remediation state, so they are review-only |
| Bitdefender GravityZone | **push** | No credential stored. The client calls `setPushEventSettings` (`serviceType: jsonRPC`, our webhook URL, `authorization: "Bearer <token>"`, subscribe to `av`, `avc`, `hd`, `antiexploit`). Add it under Add Integration > Bitdefender GravityZone. A push has no heartbeat, so a quiet feed never marks an endpoint clean |

Not built yet (no usable public API specification could be confirmed):
Malwarebytes/ThreatDown Nebula, Huntress, Trend Micro Vision One, Webroot.
Their endpoints stay `unknown`.

Routes (all client-scoped, `requireAuth`): `GET /api/security-vendors/catalog`,
`GET /api/security-vendors`, `GET /api/security-vendors/:id`,
`POST /api/security-vendors/connect/:vendor` (Growth+, counts toward the
integrations limit), `POST /api/security-vendors/:id/sync`,
`POST /api/security-vendors/:id/revoke`, `DELETE /api/security-vendors/:id`.
No new Railway variables: the credential is encrypted with the existing
`CREDENTIAL_ENCRYPTION_KEY`. Tests: `node securityVendorAdapters.test.mjs`,
`node securityVendorRoutes.test.mjs`, `node bitdefenderPush.test.mjs`.

## Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `CREDENTIAL_ENCRYPTION_KEY` | Any connection at all | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `MS_GRAPH_CLIENT_ID` / `MS_GRAPH_CLIENT_SECRET` | Microsoft 365 | Azure app registration |
| `GOOGLE_WORKSPACE_CLIENT_ID` / `GOOGLE_WORKSPACE_CLIENT_SECRET` | Google Workspace + Google Meet scheduling | Google Cloud OAuth client |
| `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` | Zoom directory + Zoom scheduling | Zoom Marketplace app |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Slack | Slack app's Basic Information page |
| `SLACK_SIGNING_SECRET` | Slack | Same page — verifies inbound button-click requests |
| `JIRA_CLIENT_ID` / `JIRA_CLIENT_SECRET` | Jira | Atlassian developer console |
| `ASANA_CLIENT_ID` / `ASANA_CLIENT_SECRET` | Asana | Asana developer console |
| `APP_URL` | Every OAuth provider | Already used by billing/phishing/training links — must exactly match every redirect URI registered above |

Teams, Trello, AWS, and Azure need no env vars at all (paste-in
credentials, no ShieldAI-side OAuth app). Set these in Railway → Variables
in production, `.env` locally (never
commit real values — see `SECRETS_RUNBOOK.md`). Without
`CREDENTIAL_ENCRYPTION_KEY`, connecting anything fails with a clear error at
connect time — the rest of the app keeps running normally. Without a
provider's client id+secret, that provider's "Connect" button returns
"isn't configured on this server yet" instead of erroring.

### Restart and verify

You should see these lines in the server logs:
```
ShieldAI vCISO directory integration routes registered.
ShieldAI vCISO cloud integration routes registered.
ShieldAI vCISO productivity integration routes registered.
ShieldAI vCISO task tracker integration routes registered.
ShieldAI vCISO scheduling routes registered.
```
That confirms the routes are mounted regardless of which env vars are set —
it doesn't mean any provider is actually configured yet.

## How it flows

- **Read connections (directory/cloud/webhooks):** posture facts or
  findings → deterministic severity mapping → medium+ findings deduped and
  drafted into `db.data.recommendations` (`origin: "ai"`,
  `status: "suggested"`) — a human always reviews before a client sees it.
- **Task trackers:** "Sync to Jira/Asana/Trello" creates a ticket once,
  storing `task.externalRef`. "Sync status" pulls current
  status/priority back into that same field — informational only, never
  auto-completing the ShieldAI vCISO task.
- **Slack/Teams (outbound):** something becomes client-visible (a
  recommendation is proposed, a task completes, a phishing campaign sends,
  a policy is assigned) → `notify(db, {...})` (`notificationDispatch.js`) →
  each active connection with that event enabled gets a message. Slack gets
  interactive buttons on recommendation events; Teams gets deep-link
  buttons instead, since a bare webhook URL can't receive replies.
- **Slack (inbound — button click):** signed POST to
  `/api/productivity/slack/interactivity` → signature verified → workspace
  resolved to a ShieldAI vCISO account by Slack team id → same recommendation
  decision/complete logic the in-app buttons use → Slack's message updated
  via `response_url`.
- **Teams (inbound — deep link):** the button opens
  `${APP_URL}/?action=...&refType=...&refId=...` in the browser → a
  top-level frontend effect detects it, calls
  `POST /api/productivity/apply-action` (a normal authenticated request,
  since the browser is the logged-in user) → same decision/complete logic
  applied → confirmation shown.
- **Scheduling:** client clicks Schedule → refreshes an access token from
  the stored personal refresh token → calls Zoom's create-meeting or Google
  Calendar's create-event-with-Meet-link API → returns the join link.

## Routes summary

- `GET/POST /api/directory[...]` — list/detail/oauth/sync/revoke/delete (M365, Google Workspace, Okta, Zoom)
- `GET/POST /api/cloud[...]` — list/detail/connect/sync/revoke/delete (AWS, Azure)
- `GET/POST /api/productivity[...]` — list/detail/oauth/connect/interactivity/apply-action/revoke/delete (Slack, Teams)
- `GET/POST /api/tasktracker[...]` — list/detail/oauth/connect/picker/sync-task/revoke/delete (Jira, Asana, Trello)
- `GET/POST /api/scheduling[...]` — list/oauth/create-meeting/revoke/delete (Zoom, Google Meet)

Each family's routes file has its own header comment with the full path
list and exact request/response shapes — this summary is deliberately
high-level; read the source for the authoritative contract.

## Without a provider configured (today's default state)

Everything else keeps working. Okta, AWS, Azure, Teams, and Trello connect
normally with no env vars at all. The webhook integrations in Part 1 are entirely
unaffected. Clicking "Connect" on any unconfigured OAuth provider returns a
clear "isn't configured on this server yet" error instead of a broken
redirect.

## Mastermind

`helpManual.js`'s `integrations` section documents every flow for clients,
included verbatim in Mastermind's chat system prompt (`mastermindRoutes.js`)
— ask it "how do I connect Jira," "how do I get Teams notifications," or
"how do I schedule a call" and it answers from the real, current UI flow
rather than guessing.
