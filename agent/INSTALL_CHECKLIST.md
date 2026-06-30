# ShieldAI Agent — Install & Verification Checklist

Use this after running an installer on a client endpoint to confirm the agent
enrolled and is reporting. The agent is **read-only**; none of these steps change
the monitored system.

> Reminder of the boundary: the agent only collects and uploads. It never
> performs a security action. Only the client admin (their own systems) or a
> client-permitted analyst ever performs an action.

---

## Before you install (all platforms)
- [ ] In the **client admin account → Endpoints → Add Endpoint**, generate a
      one-time **enrollment token** (valid ~60 min, single use).
- [ ] Confirm the endpoint can reach the ShieldAI server URL over HTTPS
      (in production) — e.g. `curl https://app.shieldai.example/` succeeds.
- [ ] Copy the correct OS folder to the endpoint (`windows\`, `linux/`, or
      `macos/`). Each needs its `collect.*` and `install.*`; the Unix installers
      also pull the shared `agent-run.sh` from `../shared/`, so keep the folder
      structure intact.

---

## Windows
**Install (elevated PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 `
  -ServerUrl "https://app.shieldai.example" `
  -EnrollmentToken "PASTE-TOKEN" -IntervalMinutes 60
```
**Verify:**
- [ ] Scheduled task exists: `Get-ScheduledTask -TaskName "ShieldAI Agent"`
- [ ] Data dir created: `C:\ProgramData\ShieldAI\` contains `config.json`
- [ ] After ~1 min, `agent.json` appears (proves enrollment succeeded)
- [ ] `config.json` no longer contains `enrollmentToken` (one-time token burned)
- [ ] Manual run works:
      `powershell -ExecutionPolicy Bypass -File "C:\Program Files\ShieldAI\agent\agent-run.ps1"`
      → prints `Report uploaded.`
- [ ] Endpoint appears in the client admin **Endpoints** list with a posture
      summary and a recent "last report" time.

---

## Linux (systemd)
**Install (root):**
```bash
sudo ./install.sh --server-url "https://app.shieldai.example" \
  --enrollment-token "PASTE-TOKEN" --interval-minutes 60
```
**Verify:**
- [ ] Timer active: `systemctl status shieldai-agent.timer` → `active (waiting)`
- [ ] First run logged: `journalctl -u shieldai-agent.service --no-pager | tail`
      → shows `enrolled as ...` then `report uploaded.`
- [ ] Token file secured: `ls -l /etc/shieldai/agent.json` → mode `-rw-------`
- [ ] `enrollmentToken` removed from `/etc/shieldai/config.json`
- [ ] Manual run: `sudo SHIELDAI_DATA_DIR=/etc/shieldai bash /opt/shieldai/agent/agent-run.sh`
      → `report uploaded.`
- [ ] Endpoint appears in the client admin **Endpoints** list.

---

## macOS (launchd)
**Install (root):**
```bash
sudo ./install.sh --server-url "https://app.shieldai.example" \
  --enrollment-token "PASTE-TOKEN" --interval-minutes 60
```
**Verify:**
- [ ] Daemon loaded: `sudo launchctl list | grep com.shieldai.agent`
- [ ] Log shows activity: `tail /var/log/shieldai-agent.log`
      → `enrolled as ...` then `report uploaded.`
- [ ] Token file secured: `ls -l /etc/shieldai/agent.json` → mode `-rw-------`
- [ ] `enrollmentToken` removed from `/etc/shieldai/config.json`
- [ ] Endpoint appears in the client admin **Endpoints** list.
- [ ] On a real Mac, posture checks resolve (FileVault, firewall, Gatekeeper,
      SIP) rather than showing `unknown`.

---

## Confirm the full data path (server side)
- [ ] **Client view:** the endpoint shows under **Endpoints** with status
      Online and a posture (Healthy / Needs attention / At risk).
- [ ] **Analyst view:** the endpoint appears in the analyst **Live Fleet**,
      tagged with the owning client.
- [ ] **Auto-draft:** if the endpoint has failing/warning checks (medium+), the
      analyst **Mastermind AI · Draft Recommendations** queue shows drafts for it.
- [ ] **Boundary check:** those drafts are **not** visible in the client's
      account until an analyst forwards one.

---

## Threat intelligence integrations (server-side, optional but recommended)

ShieldAI's threat intelligence draws on two live external sources. Both are
configured once on the **server** (not per endpoint) via environment variables,
and both fail **honestly** — if a source isn't configured or a domain isn't
verified, the UI says so rather than showing a fake "all clear."

### CVE / vulnerability data — NIST NVD
- [ ] (Optional) Request a free NVD API key:
      https://nvd.nist.gov/developers/request-an-api-key
- [ ] Set `NVD_API_KEY` in the server environment.
      Without a key, lookups still work but are throttled to ~1 request / 6 s;
      with a key, ~1 / 0.6 s. A key is strongly recommended in production.
- [ ] Verify: open a client's **Threat Intel** panel (or the admin user detail
      → **CVE Exposure** card) and confirm CVEs appear once the client has a
      software inventory (from the agent or the assessment tech-stack field).
      No inventory → an honest "needs software inventory" note, not empty CVEs.

### Dark-web / breach data — Have I Been Pwned (HIBP)
> Real breach intelligence requires a paid HIBP subscription — there is no free
> dark-web source. HIBP's domain search **only works for domains whose control
> you have verified** in HIBP's own dashboard. Plan to onboard each managed
> client's domain there; until a domain is verified it will honestly show
> **"Not monitored"** rather than a result.

- [ ] Purchase an HIBP API key (~$4/mo): https://haveibeenpwned.com/API/Key
- [ ] Set `HIBP_API_KEY` in the server environment (32-char hex).
- [ ] (Optional) Set `HIBP_USER_AGENT` (defaults to `ShieldAI-vCISO`). HIBP
      requires a user-agent header; the default is fine.
- [ ] **Per client to be monitored:** in the HIBP **domain search dashboard**,
      add the client's domain and complete HIBP's domain-control verification
      (DNS TXT record, file upload, or email to a domain mailbox — HIBP guides
      you through it). This proves you're authorized to search that domain.
- [ ] Confirm ShieldAI has the right domain on file for the client — it's taken
      from the assessment's company website/domain, falling back to the admin
      email's domain. Fix the assessment if the wrong domain is being checked.
- [ ] Verify states (open **Threat Intel** panel or the admin **CVE Exposure**
      card, which also shows the dark-web/breach section):
      - No `HIBP_API_KEY` set → **"Not active"** (feature off).
      - Key set but domain not yet verified in HIBP → **"Not monitored —
        verify domain control"**.
      - Verified domain, breaches found → a real status (Low risk / Elevated /
        High alert) with the breached-account count and named breaches.
      - Verified domain, no breaches → **"No intel"** (a genuine all-clear).
- [ ] Sanity check with HIBP's test domain: a test API key querying
      `hibp-integration-tests.com` returns sample breach data, confirming the
      integration path works before you onboard real client domains.

> Scope note: HIBP reports whether a domain's accounts appear in **known data
> breaches** (credential exposure) — what most SMBs mean by "are we on the dark
> web." It is not active dark-web forum crawling; that needs an enterprise feed
> (e.g. Recorded Future, Flare, SpyCloud) wired through the same service layer.

---

## Troubleshooting
| Symptom | Likely cause | Fix |
|---|---|---|
| `Not enrolled and no enrollmentToken` | token expired or already used | generate a fresh token, re-run installer |
| Upload returns 401/403 | agent token revoked, or wrong server URL | re-enroll (revoke + add endpoint again) |
| Endpoint never appears | network/TLS blocked, or wrong `serverUrl` | verify `curl <serverUrl>` from the endpoint |
| Checks show `unknown` | tool not present, or needs elevation | confirm the security tool is installed; run as admin/root |
| No drafts created | all checks pass, or only low-severity findings | expected — drafts are for medium+ fail/warn |
| Dark-web shows "Not active" | `HIBP_API_KEY` not set | add the key to the server env and restart |
| Dark-web shows "Not monitored" | client domain not verified in HIBP | add + verify the domain in HIBP's domain-search dashboard |
| Dark-web checks the wrong domain | assessment has wrong/no website | set the correct company website/domain on the assessment |
| CVEs empty despite known software | no inventory reached the server, or NVD throttled/unreachable | confirm the agent reported inventory; set `NVD_API_KEY`; retry |

## Removing an endpoint
- Revoke from the client admin account (its next upload returns 403 and stops).
- Windows: `Unregister-ScheduledTask -TaskName "ShieldAI Agent"`; delete
  `C:\Program Files\ShieldAI` and `C:\ProgramData\ShieldAI`.
- Linux: `sudo systemctl disable --now shieldai-agent.timer`; remove the unit
  files, `/opt/shieldai`, and `/etc/shieldai`.
- macOS: `sudo launchctl unload /Library/LaunchDaemons/com.shieldai.agent.plist`;
  delete the plist, `/usr/local/shieldai`, and `/etc/shieldai`.
