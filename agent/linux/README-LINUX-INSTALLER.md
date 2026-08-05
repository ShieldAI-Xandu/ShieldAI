# ShieldAI Agent — Linux Installer

`ShieldAI-Agent-Install.run` is finished and ready to distribute as-is — no
build step needed (unlike the Windows/macOS installers, this one packs
completely into one shell script + an embedded archive, and this sandbox can
put those together directly).

## What the client does

```bash
chmod +x ShieldAI-Agent-Install.run
sudo ./ShieldAI-Agent-Install.run
```

It asks one question — "Paste enrollment token:" — using the token from your
dashboard's **Endpoints → Add Endpoint** page, then installs the same
systemd service + timer as the manual process in `INSTALL_CHECKLIST.md`.
Requires `systemd` (true for any modern distro: Ubuntu, Debian, RHEL,
Rocky/Alma, Fedora, etc.).

## Testing against your local dev backend

```bash
sudo ./ShieldAI-Agent-Install.run --server-url http://localhost:3001
```

You can also skip the interactive prompt entirely (useful for scripted test
runs) by passing the token directly:
```bash
sudo ./ShieldAI-Agent-Install.run --enrollment-token PASTE-TOKEN
```

## Verifying / uninstalling

Same commands as the manual install, since it's the same systemd units under
the hood:
```bash
systemctl status shieldai-agent.timer
journalctl -u shieldai-agent.service --no-pager | tail
```
To remove: `systemctl disable --now shieldai-agent.timer shieldai-agent.service`,
then delete `/opt/shieldai` and `/etc/shieldai`.

## Updating the agent later

If you change `linux-install.sh`, `linux-collect.sh`, or `agent-run.sh`, this
`.run` file needs to be rebuilt to pick up the change (it's a snapshot, not a
live reference to your repo). Ask me to rebuild it any time the underlying
scripts change — it's a quick regeneration.

## No SmartScreen/Gatekeeper equivalent here

Linux has no OS-level "unrecognized publisher" warning for shell scripts the
way Windows and macOS do, so there's nothing to sign or notarize for this one
to run cleanly. The only friction is the standard "why does this need sudo"
moment, which is normal and expected for anything that installs a system
service.
