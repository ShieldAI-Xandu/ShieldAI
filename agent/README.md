# ShieldAI Agent

A **read-only** posture collector that installs on a client's servers and
endpoints, runs on a schedule, and reports security posture to the ShieldAI
backend. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design.

## Hard boundary (non-negotiable)
The agent **only collects and uploads data. It never performs any security
function and never changes anything on the endpoint.** It has no inbound command
channel by design. The Mastermind AI analyzes the data and produces
recommendations but also never acts. The **only** entities that can perform an
action on a client system are the **client's admin** (their own systems) or the
**assigned analyst — and only with the client's explicit permission.**

## Repository layout (this is the SOURCE, not where it runs)
```
agent/
├── ARCHITECTURE.md          design, data flow, roles & boundaries
├── README.md                this file
└── windows/
    ├── collect.ps1          read-only posture collector → report JSON
    ├── agent-run.ps1        enroll (first run) + collect + upload
    └── install.ps1          registers the Scheduled Task (run as Admin)
```
Linux (`agent/linux/`) and macOS (`agent/macos/`) collectors are added in a
later stage and emit the same report schema.

> **Source vs. runtime:** this folder is where you develop and version the
> agent. It is *not* where the agent runs. On a client machine, `install.ps1`
> copies the scripts to `C:\Program Files\ShieldAI\agent\` and stores tokens in
> `C:\ProgramData\ShieldAI\`. Your repo copy is the master you build from.

## Installing on a Windows endpoint (current stage)
1. In the **client admin account**, choose **Add Endpoint** to generate a
   one-time enrollment token (backend route arrives in Stage 3).
2. Copy the `windows\` folder to the target machine.
3. From an **elevated (Administrator) PowerShell**, run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1 `
     -ServerUrl "https://app.shieldai.example" `
     -EnrollmentToken "PASTE-ONE-TIME-TOKEN" `
     -IntervalMinutes 60
   ```
4. The agent enrolls and sends its first report within ~1 minute, then repeats
   on the interval. Data appears in the client admin account and is forwarded to
   the analyst console.

### Verifying / managing
- Scheduled Task: **Task Scheduler → "ShieldAI Agent"**.
- Manual run for testing: `powershell -ExecutionPolicy Bypass -File "C:\Program Files\ShieldAI\agent\agent-run.ps1"`
- Data/token dir: `C:\ProgramData\ShieldAI\`
- To revoke an endpoint, revoke its token from the admin account; the agent's
  next upload returns 401 and stops.

## What is collected (Windows)
Defender state (real-time protection, signature age, tamper protection, recent
detections), host firewall, BitLocker disk encryption, pending OS updates, local
administrator count, and screen-lock policy. Posture/config only — **no file
contents, no user documents.** Every check is read-only.

## Never commit
Generated `config.json`, `agent.json`, `*.token`, and any `*report*.json` are
git-ignored. They contain tokens or client data. The scripts themselves are
versioned; their runtime output is not.
