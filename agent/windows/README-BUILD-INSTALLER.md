# ShieldAI Agent — Building the One-Click Windows Installer

This turns the existing `install.ps1` flow into a single file — `ShieldAI-Agent-Setup.exe`
— that a client just downloads and double-clicks. Nobody opens PowerShell, nobody
types a command. They see: **Welcome → paste enrollment token → Install → Done.**

Nothing about the underlying agent changed. `install.ps1`, `agent-run.ps1`, and
`collect.ps1` are used exactly as they are today (copied in verbatim). The installer
is just a wrapper that runs `install.ps1` for the client and bakes in your
production server URL so they never have to know or type it.

## What you need

**Inno Setup** (free, ~3 MB, Windows-only build tool): https://jrsoftware.org/isinfo.php
Install it on your Windows dev machine (the same one at `E:\ShieldAI` is fine).

## Folder layout

Everything in this package should stay together in one folder:

```
shieldai-agent-installer/
├── ShieldAI-Agent-Setup.iss   ← the Inno Setup script (open this to build)
├── shieldai.ico                ← installer icon, generated from your logo
└── agent-src/
    ├── install.ps1
    ├── agent-run.ps1
    └── collect.ps1
```

These `agent-src\*.ps1` files are copies of what's already in
`E:\ShieldAI\agent\windows\`. **Whenever you update the real agent scripts,
copy the new versions into `agent-src\` before rebuilding the installer** —
this package doesn't read from your live repo automatically.

## Building it

**Option A — GUI (easiest):**
1. Double-click `ShieldAI-Agent-Setup.iss` — it opens in the Inno Setup IDE.
2. Press `Ctrl+F9` (or Build → Compile).
3. Done. Output lands at `Output\ShieldAI-Agent-Setup.exe`.

**Option B — command line:**
```powershell
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" ShieldAI-Agent-Setup.iss
```

That one `.exe` file is everything — it's what you host for download and send
to clients. No other files need to travel with it.

## What the client sees

1. Downloads `ShieldAI-Agent-Setup.exe`, double-clicks it.
2. Windows UAC prompt ("Do you want to allow this app to make changes?") — this
   is expected; the agent needs admin rights to register as a SYSTEM scheduled
   task, same as the manual install today.
3. A short wizard: a text box asking them to paste the enrollment token they
   copied from your dashboard's **Endpoints → Add Endpoint** page.
4. Click **Install**. In the background this runs the exact same
   `install.ps1 -ServerUrl "..." -EnrollmentToken "..." -IntervalMinutes 60`
   command from `INSTALL_CHECKLIST.md`, just silently.
5. Click **Finish**. Within ~1 minute the endpoint enrolls and shows up on
   your Endpoints page, same as always.

## Testing before you send it to a real client

By default the installer points at your production URL
(`https://shieldai-production-627e.up.railway.app`). To test against your local
dev backend instead, run it with an override — nobody else needs to know this
flag exists:

```powershell
ShieldAI-Agent-Setup.exe /ServerURL=http://localhost:3001
```

## Uninstalling

The installer registers a normal Windows uninstaller entry ("ShieldAI Agent" in
Add/Remove Programs). Running it unregisters the scheduled task and removes
both `C:\Program Files\ShieldAI` and `C:\ProgramData\ShieldAI` — the same
cleanup steps documented in `INSTALL_CHECKLIST.md`, just automated. As before,
revoking the endpoint from the dashboard first is the cleanest way to stop it
immediately.

## One thing worth knowing before you distribute this

An `.exe` from a brand-new publisher (yours) will trigger a Windows
**SmartScreen** warning the first several hundred/thousand times it's
downloaded — "Windows protected your PC" with an "unrecognized app" message.
It's not a sign anything is broken; it's just Microsoft's reputation system
having no history for a new binary yet. For your non-technical SMB audience,
this is worth solving before wide distribution, because it looks alarming to
someone who isn't expecting it. Two ways to fix it:

- **Code-sign the installer** with an OV (~$100–300/yr) or EV (~$300–450/yr)
  certificate from a CA like DigiCert or Sectigo. EV certs get immediate
  SmartScreen trust; OV certs build reputation over time as more people
  download and run the signed binary.
- In the meantime, a short note in your client onboarding email ("Windows may
  show a blue 'protected your PC' screen the first time — click 'More info' →
  'Run anyway'") removes most of the friction at no cost.

## If you ever need a true `.msi` instead

This build produces a `setup.exe`-style installer (the same format used by
most RMM/agent vendors — Datto, N-able, etc. all ship this way), which is the
right fit for your current direct-to-SMB motion. If a future client's IT
requires deployment via Group Policy or Intune specifically, that calls for a
real `.msi` built with the WiX Toolset — a heavier, XML-based tool. Worth
building only if/when a client actually asks; happy to put one together at
that point using the same `install.ps1` underneath.
