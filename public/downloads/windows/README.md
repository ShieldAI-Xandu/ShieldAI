Drop the Inno Setup output here as `ShieldAI-Agent-Setup.exe`.

Build from `agent/installers/windows/ShieldAI-Windows-Installer-Source/` (or the
`.zip` alongside it) with Inno Setup — see that folder's
`README-BUILD-INSTALLER.md`. The download route
(`GET /api/agent/download/native/windows` in `agentRoutes.js`) reads this exact
path, so the file just needs to land here with this name; no code change
needed to pick up a rebuild.
