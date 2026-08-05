# ShieldAI Agent — Building the macOS Installer (.pkg)

This packages the existing `macos-install.sh` / `macos-collect.sh` / `agent-run.sh`
into a double-clickable `ShieldAI-Agent.pkg`. Running it walks through the
standard macOS Installer wizard, then pops up one native dialog asking for the
enrollment token — nobody opens Terminal.

Nothing about the agent itself changed — same launchd daemon, same
`config.json`, same enrollment flow already tested and documented in
`INSTALL_CHECKLIST.md`.

## What you need

A Mac with Xcode Command Line Tools installed (gives you `pkgbuild`):
```
xcode-select --install
```
Most dev Macs already have this.

## Folder layout

```
mac-installer/
├── build-pkg.sh                        ← run this on a Mac
├── scripts/
│   └── postinstall                     ← prompts for the token, runs install.sh
└── payload/
    ├── macos/
    │   ├── install.sh
    │   └── collect.sh
    └── shared/
        └── agent-run.sh
```

If you ever update the real agent scripts, copy the new versions into
`payload/macos/` and `payload/shared/` before rebuilding — this package
doesn't pull from your live repo automatically.

## Building it

```bash
chmod +x build-pkg.sh
./build-pkg.sh
```

Output: `Output/ShieldAI-Agent.pkg`. That one file is what you distribute.

To build a test copy pointed at your local dev backend instead of production:
```bash
./build-pkg.sh --server-url http://localhost:3001
```

## What the client sees

1. Double-clicks `ShieldAI-Agent.pkg`.
2. Standard macOS Installer wizard (Introduction → Destination → Installing).
   It'll ask for their Mac password/Touch ID partway through — normal for any
   pkg that needs admin rights, same as installing any other Mac software.
3. Once the payload finishes copying, **a dialog appears**: "Paste the
   enrollment token for this Mac..." with a text field.
4. They paste the token from your dashboard's **Endpoints → Add Endpoint**
   page and click **Continue**.
5. A macOS notification confirms: "This Mac is now connected to ShieldAI."
6. Endpoint shows up on your Endpoints page within about a minute.

If they cancel or leave it blank, the installer still finishes (the files are
in place) but tells them plainly that enrollment didn't happen and they can
re-run it with a fresh token. Every step is also logged to
`/var/log/shieldai-agent-install.log` for your own troubleshooting.

## Code signing & notarization — read this before sending to any real client

This is the one place the macOS story is meaningfully harder than Windows.
On current macOS, **Gatekeeper actively blocks unsigned, un-notarized
installers** — a non-technical person double-clicking this `.pkg` as-is will
likely see "Apple could not verify this app is free of malware" with no
obvious way to proceed, or it may refuse to open at all without them digging
into System Settings → Privacy & Security to manually allow it. That's a much
bigger obstacle than Windows SmartScreen, which at least offers a "Run
anyway" link right in the warning.

To ship this to real clients, you'll want:
1. An **Apple Developer ID** account ($99/year) — https://developer.apple.com
2. A **Developer ID Installer** certificate, used to sign the pkg:
   ```
   productsign --sign "Developer ID Installer: Xandu Limited LLC (TEAMID)" \
     Output/ShieldAI-Agent.pkg Output/ShieldAI-Agent-signed.pkg
   ```
3. **Notarization** — submit the signed pkg to Apple and staple the ticket:
   ```
   xcrun notarytool submit Output/ShieldAI-Agent-signed.pkg \
     --apple-id you@xandultd.com --team-id TEAMID --wait
   xcrun stapler staple Output/ShieldAI-Agent-signed.pkg
   ```
   (You'll set up an app-specific password or API key for `notarytool` once —
   Apple's docs walk through it.)

Until that's in place, this pkg is fine for testing on your own Mac or a
willing early client who's comfortable with "right-click → Open" to bypass
Gatekeeper once — just not for a cold download by a dental office manager.

## One more honest caveat

The "prompt for a token via a native dialog from inside a pkg installer"
technique (`launchctl asuser ... osascript`) is a standard, well-established
pattern — but it's also the part of this package I can't test myself, since
building and running a `.pkg` requires actual macOS tooling that isn't
available in this sandbox. Test the full flow on a real Mac (yours or a
colleague's) before it goes anywhere near a client machine — in particular,
confirm the dialog actually appears and captures input correctly on the
macOS version you're targeting. Check `/var/log/shieldai-agent-install.log`
if anything looks off.
