# ShieldAI Monitoring Agent — Architecture

## What it is
A lightweight, **transparent** posture-collection agent installed on a client's
servers and endpoints. It is built from native scripts (PowerShell on Windows,
Bash on Linux/macOS) so a client's own IT team can read every line and know
exactly what runs on their machines. It runs on a schedule as a native OS
service, collects security posture, and reports to the ShieldAI backend.

## Roles & boundaries (FOUNDATIONAL — enforced, not just intended)
This separation is a hard architectural rule. No component may be built in a way
that violates it.

| Entity | May READ data | May ANALYZE / RECOMMEND | May PERFORM ACTIONS on systems |
|---|---|---|---|
| **Agent** (on endpoint) | Yes (read-only posture) | No | **NEVER** |
| **Mastermind AI** (backend) | Yes | Yes — produces recommendations | **NEVER** |
| **Assigned Analyst** (human) | Yes | Yes | **Only with the client's explicit permission** |
| **Client Admin** (human) | Yes (their own fleet) | Yes | Yes (on their own systems) |

- The **agent never performs a security function.** It does not scan, block,
  quarantine, change settings, kill processes, or remediate anything. It reads
  posture and uploads JSON. There is no code path from the agent (or the AI, or
  the backend) back down to "do something" on the endpoint. This is enforced by
  design: the agent has no inbound command channel at all.
- The **Mastermind AI never acts.** It is an analysis and recommendation layer
  only. It converts collected data into actionable, human-readable
  recommendations. Issuing a recommendation is not performing it.
- **Only two human entities can ever perform an action on a client system:** the
  **client's admin** (on their own systems), or the **assigned analyst** — and
  the analyst **only after the client grants explicit permission** for that
  specific action. Software never has an execution path to the endpoint.

## What it collects
The collector produces a normalized `inventory` (same schema on Windows, Linux,
and macOS):
- **Security posture** — installed security tools (e.g. Microsoft Defender),
  host firewall state, disk encryption (BitLocker/FileVault/LUKS), pending OS
  patches, local administrator accounts, and screen-lock policy.
- **Host** — OS and version, architecture, hostname, last boot.
- **Installed software inventory** — a list of installed applications with their
  versions, as `[{ "name": "...", "version": "..." }]`. Sources per OS:
  - Windows: registry uninstall keys (64-bit, 32-bit, per-user); excludes system
    components and OS updates; the slow/risky `Win32_Product` WMI query is
    deliberately avoided.
  - Linux: the package database via `dpkg-query` or `rpm`.
  - macOS: `/Applications/*.app` bundles, versions read from each Info.plist.
  The list is capped (~200 entries) to keep report payloads reasonable.

  **Why this exists:** it feeds ShieldAI's CVE matching. The backend turns each
  `name + version` into a descriptor and queries the live NIST NVD, so a client's
  real installed software drives their vulnerability exposure — not just the OS
  version or assessment answers. This is **read-only**: the collector only reads
  the package/registry databases; it never installs, updates, or changes
  anything, preserving the agent boundary described above. If a scan fails, the
  software list is left **empty** rather than fabricated, and CVE matching falls
  back to OS + assessment data.

## What it is NOT (set client expectations honestly)
- It is **not an antivirus or anti-malware engine.** It does not scan for or
  detect malware itself. Instead it **reads the status and findings of the
  security tools already installed** (e.g. Microsoft Defender, the OS firewall,
  disk encryption, patch state) and forwards that telemetry. Rolling our own
  scanner would give clients false confidence; surfacing the real tools' output
  is both honest and more useful.
- It is **not a remote-control or remediation tool** — not in v1, and not by
  design later either. Per the roles table above, the agent and the AI never
  execute actions. "Actions" always means a **human** (client admin or
  permitted analyst) doing the work; the platform's role is to recommend and to
  record approval, never to reach into the endpoint and change it.

## Data flow
```
[ Endpoint / Server ]
   collector script (PS1 / SH)  ──run on schedule by native service──┐
        │ produces report.json (normalized schema, same on all OSes) │
        ▼                                                             │
   agent-send (curl/Invoke-RestMethod)                               │
        │  POST /api/agent/report   (Bearer = agent token)           │
        ▼                                                             │
[ ShieldAI Backend (Express + lowdb) ]                               │
   requireAgent middleware validates the agent token ◄───────────────┘
        │  stores AgentReport, updates Agent.lastSeen, computes deltas
        ▼
   ┌───────────────────────────┬─────────────────────────────────────┐
   ▼                           ▼                                     ▼
[ Client Admin account ]   [ Mastermind AI / analyst console ]   [ Alerts ]
   sees their own fleet       sees all clients' fleets,             security
   posture + findings         authors recommendations only         violations
```

## Enrollment & identity (how an agent proves who it is)
1. In the client admin UI, the admin clicks **"Add Endpoint"** → backend issues a
   one-time **enrollment token** (short-lived, single-use) tied to their company.
2. The installer is run on the endpoint with that enrollment token.
3. On first contact the agent exchanges the enrollment token for a long-lived,
   per-agent **agent token** (stored locally with strict file permissions). The
   backend records a new `Agent` row bound to that company/user.
4. Every report is sent with `Authorization: Bearer <agent token>`.
5. Tokens can be **revoked** from the admin UI; a revoked agent is rejected.

> Why a two-step token exchange: the enrollment token is what a human handles
> (copy/paste, could leak); making it single-use and short-lived limits damage.
> The durable agent token never has to be seen by a person.

## Report schema (identical across OSes — collectors normalize to this)
```jsonc
{
  "agentVersion": "1.0.0",
  "schema": 1,
  "host": {
    "hostname": "", "os": "windows|linux|macos", "osVersion": "",
    "arch": "", "lastBootUtc": "", "collectedAtUtc": ""
  },
  "checks": [
    {
      "id": "defender_realtime",          // stable id, maps to a control
      "category": "Protect",              // NIST function (feeds riskEngine)
      "title": "Antivirus real-time protection",
      "status": "pass|warn|fail|unknown",
      "severity": "info|low|medium|high|critical",
      "observed": "Enabled",             // what we actually saw
      "detail": "Microsoft Defender real-time protection is on.",
      "cisControl": "10"                  // optional CIS Controls v8.1 mapping
    }
  ],
  "events": [                            // point-in-time security events
    {
      "ts": "", "source": "defender", "severity": "high",
      "type": "malware_detected",
      "message": "Defender quarantined Trojan:Win32/...",
      "raw": { }                         // tool-native detail
    }
  ],
  "inventory": {                         // for compliance evidence
    "localAdmins": [], "installedSecurityTools": [],
    "diskEncryption": "", "pendingPatches": 0, "firewall": ""
  }
}
```

## Collectors (per OS) — all read-only, all native tools
- **Windows (PowerShell):** Defender status (`Get-MpComputerStatus`,
  `Get-MpThreat`), firewall (`Get-NetFirewallProfile`), BitLocker
  (`Get-BitLockerVolume`), pending updates, local admins, OS build, screen-lock.
- **Linux (Bash):** ufw/firewalld state, LUKS/`cryptsetup` encryption, `clamav`
  or vendor AV status if present, pending package updates, sudo group members,
  SSH config posture, auto-update config.
- **macOS (Bash/zsh):** XProtect/MRT presence, `socketfilterfw` firewall,
  FileVault (`fdesetup status`), `softwareupdate` pending, admin group members,
  Gatekeeper/SIP status.

Each collector outputs the **same JSON schema** so the backend and AI treat all
hosts uniformly.

## Backend additions (Stage 3)
- lowdb collections: `agents[]`, `agentReports[]`, `agentEvents[]`,
  `recommendations[]` (AI/analyst-authored advice + its human-handled lifecycle).
- `requireAgent` middleware (validates agent token, attaches `req.agent`).
- Routes:
  - `POST /api/agent/enroll`   (enrollment token → agent token)
  - `POST /api/agent/report`   (requireAgent; ingest a report)
  - `GET  /api/admin/endpoints` (client admin: their fleet)
  - `GET  /api/analyst/endpoints` (analyst: all fleets)
  - `POST /api/analyst/recommendations` (analyst authors a recommendation)
  - `POST /api/admin/recommendations/:id/permit` (client grants permission for
    the analyst to perform it, OR marks that they performed it themselves)
  - `PATCH /api/recommendations/:id` (lifecycle updates: declined, completed)

### Recommendation lifecycle (no software ever executes on the endpoint)
```
[Mastermind AI]  drafts a recommendation from the data  ──►  status: "suggested"
[Analyst]        reviews / refines / forwards to client ──►  status: "proposed"
[Client Admin]   one of:
                   • "I'll handle it"   ─────────────────►  status: "client_performing"
                   • "Analyst, you may do X on my behalf" ─►  status: "permitted"
                   • "Decline"          ─────────────────►  status: "declined"
[Analyst]        (only if permitted) performs X manually ─►  status: "completed"
[Client Admin]   (if self-handled)    marks done         ─►  status: "completed"
```
The platform **records** this lifecycle; it never carries it out. There is no
endpoint command channel, so neither the AI, the backend, nor the agent can act.
The actual change is always made by a human (client admin, or analyst with
explicit per-action client permission) using their own tools.

## Security & privacy principles
- **Least data:** collect posture/config, not file contents or user documents.
- **Read-only on the endpoint, always** — the agent makes no changes to client
  systems, and there is **no inbound command channel** to the agent by design,
  so nothing upstream can ever instruct it to act.
- **Humans-only execution:** only the client admin (own systems) or a
  client-permitted analyst ever performs an action; software never does.
- **Transparent:** scripts are human-readable; publish exactly what's collected.
- **Token hygiene:** single-use enrollment tokens, revocable agent tokens,
  least-privilege local storage of the token file.
- **Transport:** HTTPS in production (the dev backend is http://localhost:3001;
  must be fronted by TLS before any real deployment).

## Staged build plan
1. **Stage 1 (this delivery):** architecture + Windows collector.
2. **Stage 2:** Linux + macOS collectors (same schema).
3. **Stage 3:** backend enrollment + ingestion + storage.
4. **Stage 4:** client fleet dashboard in the admin account.
5. **Stage 5:** analyst console + recommendation lifecycle (AI suggests →
   analyst proposes → client permits/declines → human performs → marked done).
6. **Installers:** per-OS service registration (Task Scheduler / systemd / launchd).
