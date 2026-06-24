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

## Troubleshooting
| Symptom | Likely cause | Fix |
|---|---|---|
| `Not enrolled and no enrollmentToken` | token expired or already used | generate a fresh token, re-run installer |
| Upload returns 401/403 | agent token revoked, or wrong server URL | re-enroll (revoke + add endpoint again) |
| Endpoint never appears | network/TLS blocked, or wrong `serverUrl` | verify `curl <serverUrl>` from the endpoint |
| Checks show `unknown` | tool not present, or needs elevation | confirm the security tool is installed; run as admin/root |
| No drafts created | all checks pass, or only low-severity findings | expected — drafts are for medium+ fail/warn |

## Removing an endpoint
- Revoke from the client admin account (its next upload returns 403 and stops).
- Windows: `Unregister-ScheduledTask -TaskName "ShieldAI Agent"`; delete
  `C:\Program Files\ShieldAI` and `C:\ProgramData\ShieldAI`.
- Linux: `sudo systemctl disable --now shieldai-agent.timer`; remove the unit
  files, `/opt/shieldai`, and `/etc/shieldai`.
- macOS: `sudo launchctl unload /Library/LaunchDaemons/com.shieldai.agent.plist`;
  delete the plist, `/usr/local/shieldai`, and `/etc/shieldai`.
