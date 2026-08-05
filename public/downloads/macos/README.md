Drop the pkgbuild output here as `ShieldAI-Agent.pkg`.

Build from `agent/installers/macos/ShieldAI-macOS-Installer-Source/` (or the
`.zip` alongside it) by running `build-pkg.sh` on a Mac — see that folder's
`README-BUILD-MACOS-INSTALLER.md`. The download route
(`GET /api/agent/download/native/macos` in `agentRoutes.js`) reads this exact
path, so the file just needs to land here with this name; no code change
needed to pick up a rebuild. Not yet signed/notarized — Gatekeeper will block
it as-is until that's done.
