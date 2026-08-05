#!/usr/bin/env bash
# ShieldAI Unix Agent Runner (Linux + macOS)
# ------------------------------------------
# Invoked on a schedule by systemd (Linux) or launchd (macOS). It:
#   1. Ensures enrollment (one-time enrollment token → durable agent token).
#   2. Runs the OS-appropriate collect.sh.
#   3. Uploads the report to the ShieldAI backend.
#
# Config & state live in a data dir (default /etc/shieldai, overridable):
#   config.json : { "serverUrl": "...", "enrollmentToken": "..."? }
#   agent.json  : { "agentId": "...", "agentToken": "..." }  (created on enroll)
#
# Read-only with respect to the monitored system; only collects + uploads.
# Requires: bash, curl. Uses python3 or jq for JSON parsing if available.

set -u

DATA_DIR="${SHIELDAI_DATA_DIR:-/etc/shieldai}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CONFIG="$DATA_DIR/config.json"
AGENT="$DATA_DIR/agent.json"

die() { echo "shieldai-agent: $*" >&2; exit 1; }

# ── minimal JSON field reader (python3 → jq → grep fallback) ──
json_get() { # json_get <file> <key>
  local file="$1" key="$2"
  [ -r "$file" ] || return 1
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import json,sys
try:
  print(json.load(open('$file')).get('$key',''))
except Exception:
  pass"
  elif command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$key" '.[$k] // empty' "$file"
  else
    grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$file" 2>/dev/null \
      | head -1 | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/'
  fi
}

[ -r "$CONFIG" ] || die "Missing $CONFIG. Run the installer first."
SERVER_URL="$(json_get "$CONFIG" serverUrl)"
SERVER_URL="${SERVER_URL%/}"
[ -n "$SERVER_URL" ] || die "serverUrl missing from $CONFIG."

command -v curl >/dev/null 2>&1 || die "curl is required."

# ── detect OS + collector ─────────────────────────────────────
case "$(uname -s)" in
  Linux)  COLLECTOR="$SCRIPT_DIR/collect.sh"; OS_NAME="linux" ;;
  Darwin) COLLECTOR="$SCRIPT_DIR/collect.sh"; OS_NAME="macos" ;;
  *) die "Unsupported OS: $(uname -s)" ;;
esac
[ -x "$COLLECTOR" ] || [ -r "$COLLECTOR" ] || die "Collector not found at $COLLECTOR."

# ── 1. enrollment (first run only) ────────────────────────────
AGENT_TOKEN="$(json_get "$AGENT" agentToken 2>/dev/null || true)"
if [ -z "${AGENT_TOKEN:-}" ]; then
  ENROLL_TOKEN="$(json_get "$CONFIG" enrollmentToken)"
  [ -n "$ENROLL_TOKEN" ] || die "Not enrolled and no enrollmentToken present. Re-run installer with a fresh token."
  HN="$(hostname 2>/dev/null || echo unknown)"
  RESP="$(curl -fsS -X POST "$SERVER_URL/api/agent/enroll" \
    -H "Content-Type: application/json" \
    -d "{\"enrollmentToken\":\"$ENROLL_TOKEN\",\"hostname\":\"$HN\",\"os\":\"$OS_NAME\"}" 2>/dev/null)" \
    || die "Enrollment request failed."
  # parse response
  if command -v python3 >/dev/null 2>&1; then
    AGENT_ID="$(printf '%s' "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("agentId",""))' 2>/dev/null)"
    AGENT_TOKEN="$(printf '%s' "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("agentToken",""))' 2>/dev/null)"
  else
    AGENT_ID="$(printf '%s' "$RESP" | grep -o '"agentId"[^,]*' | sed 's/.*:"\([^"]*\)"/\1/')"
    AGENT_TOKEN="$(printf '%s' "$RESP" | grep -o '"agentToken"[^,}]*' | sed 's/.*:"\([^"]*\)"/\1/')"
  fi
  [ -n "$AGENT_TOKEN" ] || die "Enrollment did not return an agent token. Response: $RESP"

  umask 077
  printf '{"agentId":"%s","agentToken":"%s"}\n' "$AGENT_ID" "$AGENT_TOKEN" > "$AGENT"
  chmod 600 "$AGENT" 2>/dev/null || true

  # Burn the one-time enrollment token from config so it can't be reused.
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import json
c=json.load(open('$CONFIG')); c.pop('enrollmentToken',None)
json.dump(c, open('$CONFIG','w'))" 2>/dev/null || true
  fi
  echo "shieldai-agent: enrolled as $AGENT_ID"
fi

# ── 2. collect ────────────────────────────────────────────────
TMP_REPORT="$(mktemp /tmp/shieldai_report.XXXXXX.json)"
trap 'rm -f "$TMP_REPORT"' EXIT
bash "$COLLECTOR" -o "$TMP_REPORT" >/dev/null 2>&1 || die "Collection failed."
[ -s "$TMP_REPORT" ] || die "Collection produced no report."

# ── 3. upload ─────────────────────────────────────────────────
RESP_BODY="$(mktemp /tmp/shieldai_resp.XXXXXX.json)"
trap 'rm -f "$TMP_REPORT" "$RESP_BODY"' EXIT
HTTP_CODE="$(curl -s -o "$RESP_BODY" -w '%{http_code}' -X POST "$SERVER_URL/api/agent/report" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "@$TMP_REPORT")"

case "$HTTP_CODE" in
  200) echo "shieldai-agent: report uploaded." ;;
  401|403) die "Agent token rejected (revoked or invalid). Re-enrollment required." ;;
  *) die "Upload failed (HTTP $HTTP_CODE)." ;;
esac

# ── 4. read server directive (data only — never executed) ─────
# The server may return a directive: a requested check-in ack, a suggested poll
# interval, and the latest available agent version. This is informational; the
# agent already sends a full report every run, so a check-in needs no extra work.
if command -v python3 >/dev/null 2>&1; then
  LATEST="$(python3 -c "import json,sys;
try: print((json.load(open('$RESP_BODY')).get('directive') or {}).get('latestAgentVersion',''))
except Exception: pass" 2>/dev/null)"
  CHECKIN="$(python3 -c "import json,sys;
try: print((json.load(open('$RESP_BODY')).get('directive') or {}).get('checkInRequested',''))
except Exception: pass" 2>/dev/null)"
  [ "$CHECKIN" = "True" ] && echo "shieldai-agent: a check-in was requested; fresh report delivered."
  if [ -n "$LATEST" ] && [ -n "${AGENT_VERSION:-}" ] && [ "$LATEST" != "$AGENT_VERSION" ]; then
    echo "shieldai-agent: a newer agent version ($LATEST) is available; current is $AGENT_VERSION."
  fi
fi

exit 0
