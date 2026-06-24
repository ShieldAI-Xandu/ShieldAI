#!/usr/bin/env bash
# ShieldAI macOS Agent Installer
# ------------------------------
# Installs the collector + runner and registers a launchd daemon that runs the
# agent every N minutes. Must be run with sudo (root).
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
INSTALL_DIR="/usr/local/shieldai/agent"
DATA_DIR="/etc/shieldai"
PLIST="/Library/LaunchDaemons/com.shieldai.agent.plist"
LABEL="com.shieldai.agent"

while [ $# -gt 0 ]; do
  case "$1" in
    --server-url) SERVER_URL="$2"; shift 2 ;;
    --enrollment-token) ENROLL_TOKEN="$2"; shift 2 ;;
    --interval-minutes) INTERVAL="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "Please run with sudo (root)." >&2; exit 1; }
[ -n "$SERVER_URL" ] || { echo "--server-url is required." >&2; exit 1; }
[ -n "$ENROLL_TOKEN" ] || { echo "--enrollment-token is required." >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTERVAL_SEC=$(( INTERVAL * 60 ))

# 1. Install scripts
mkdir -p "$INSTALL_DIR"
install -m 0755 "$HERE/collect.sh"   "$INSTALL_DIR/collect.sh"
install -m 0755 "$HERE/../shared/agent-run.sh" "$INSTALL_DIR/agent-run.sh"

# 2. Write config (root-only)
mkdir -p "$DATA_DIR"
umask 077
cat > "$DATA_DIR/config.json" <<EOF
{"serverUrl":"$SERVER_URL","enrollmentToken":"$ENROLL_TOKEN"}
EOF
chmod 600 "$DATA_DIR/config.json"

# 3. launchd daemon — runs at load and every INTERVAL seconds
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>EnvironmentVariables</key>
  <dict><key>SHIELDAI_DATA_DIR</key><string>$DATA_DIR</string></dict>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$INSTALL_DIR/agent-run.sh</string>
  </array>
  <key>StartInterval</key><integer>$INTERVAL_SEC</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/var/log/shieldai-agent.log</string>
  <key>StandardErrorPath</key><string>/var/log/shieldai-agent.log</string>
</dict>
</plist>
EOF
chmod 644 "$PLIST"

# 4. Load (or reload) the daemon
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo "ShieldAI Agent installed."
echo "  Scripts:  $INSTALL_DIR"
echo "  Data:     $DATA_DIR"
echo "  Schedule: every $INTERVAL minute(s) via launchd ($LABEL)"
echo "  Logs:     /var/log/shieldai-agent.log"
echo "It will enroll and send its first report shortly."
