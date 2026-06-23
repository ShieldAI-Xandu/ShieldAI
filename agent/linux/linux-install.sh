#!/usr/bin/env bash
# ShieldAI Linux Agent Installer
# ------------------------------
# Installs the collector + runner and registers a systemd service + timer that
# runs the agent every N minutes. Must be run as root (sudo).
#
# Usage:
#   sudo ./install.sh \
#     --server-url "https://app.shieldai.example" \
#     --enrollment-token "PASTE-ONE-TIME-TOKEN" \
#     [--interval-minutes 60]
#
# The enrollment token comes from the client admin account ("Add Endpoint").

set -euo pipefail

SERVER_URL=""
ENROLL_TOKEN=""
INTERVAL=60
INSTALL_DIR="/opt/shieldai/agent"
DATA_DIR="/etc/shieldai"

while [ $# -gt 0 ]; do
  case "$1" in
    --server-url) SERVER_URL="$2"; shift 2 ;;
    --enrollment-token) ENROLL_TOKEN="$2"; shift 2 ;;
    --interval-minutes) INTERVAL="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "Please run as root (sudo)." >&2; exit 1; }
[ -n "$SERVER_URL" ] || { echo "--server-url is required." >&2; exit 1; }
[ -n "$ENROLL_TOKEN" ] || { echo "--enrollment-token is required." >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "systemd (systemctl) is required." >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Install scripts
mkdir -p "$INSTALL_DIR"
install -m 0755 "$HERE/collect.sh"   "$INSTALL_DIR/collect.sh"
install -m 0755 "$HERE/agent-run.sh" "$INSTALL_DIR/agent-run.sh"

# 2. Write config (server URL + one-time enrollment token), root-only
mkdir -p "$DATA_DIR"
umask 077
cat > "$DATA_DIR/config.json" <<EOF
{"serverUrl":"$SERVER_URL","enrollmentToken":"$ENROLL_TOKEN"}
EOF
chmod 600 "$DATA_DIR/config.json"

# 3. systemd service (oneshot) + timer (every N minutes)
cat > /etc/systemd/system/shieldai-agent.service <<EOF
[Unit]
Description=ShieldAI posture collection agent (read-only)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=SHIELDAI_DATA_DIR=$DATA_DIR
ExecStart=/usr/bin/env bash $INSTALL_DIR/agent-run.sh
Nice=10
EOF

cat > /etc/systemd/system/shieldai-agent.timer <<EOF
[Unit]
Description=Run ShieldAI agent every $INTERVAL minute(s)

[Timer]
OnBootSec=1min
OnUnitActiveSec=${INTERVAL}min
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now shieldai-agent.timer

# 4. Kick off an immediate first run (enrolls + first report now)
systemctl start shieldai-agent.service || true

echo "ShieldAI Agent installed."
echo "  Scripts:  $INSTALL_DIR"
echo "  Data:     $DATA_DIR"
echo "  Schedule: every $INTERVAL minute(s) via systemd timer"
echo "  Status:   systemctl status shieldai-agent.timer"
echo "  Logs:     journalctl -u shieldai-agent.service"
