#!/usr/bin/env bash
# ShieldAI macOS Posture Collector
# --------------------------------
# READ-ONLY. Collects security posture from native macOS tooling. Makes NO
# changes to the system. It does not scan for malware itself — it reports the
# state of macOS's built-in protections (FileVault, firewall, Gatekeeper, SIP,
# XProtect) and software-update status.
#
# Output: ShieldAI agent report schema v1 to -o <file>, or stdout.
# Always exits 0; missing data degrades to status "unknown".
#
# Usage: collect.sh [-o report.json] [-V 1.0.0]
# Pure bash + built-in macOS utilities. Uses `plutil`/`python3` only if present.

set -u
AGENT_VERSION="1.0.0"
OUTFILE=""

while getopts "o:V:" opt; do
  case "$opt" in
    o) OUTFILE="$OPTARG" ;;
    V) AGENT_VERSION="$OPTARG" ;;
    *) ;;
  esac
done

NOW_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/ }"
  s="${s//$'\r'/ }"
  s="${s//$'\n'/ }"
  printf '"%s"' "$s"
}

CHECKS_JSON=""
EVENTS_JSON=""
SEC_TOOLS=""
add_tool() { local t; t="$(json_escape "$1")"; SEC_TOOLS="${SEC_TOOLS:+$SEC_TOOLS,}$t"; }
sanitize_int() { local v; v="$(printf '%s' "$1" | tr -cd '0-9' | head -c 9)"; printf '%s' "${v:-0}"; }

add_check() {
  local obj
  obj="{\"id\":$(json_escape "$1"),\"category\":$(json_escape "$2"),\"title\":$(json_escape "$3"),"
  obj+="\"status\":$(json_escape "$4"),\"severity\":$(json_escape "$5"),\"observed\":$(json_escape "$6"),"
  obj+="\"detail\":$(json_escape "$7"),\"cisControl\":$(json_escape "${8:-}")}"
  CHECKS_JSON="${CHECKS_JSON:+$CHECKS_JSON,}$obj"
}
add_event() {
  local obj
  obj="{\"ts\":$(json_escape "$NOW_UTC"),\"source\":$(json_escape "$1"),\"severity\":$(json_escape "$2"),"
  obj+="\"type\":$(json_escape "$3"),\"message\":$(json_escape "$4"),\"raw\":null}"
  EVENTS_JSON="${EVENTS_JSON:+$EVENTS_JSON,}$obj"
}
have() { command -v "$1" >/dev/null 2>&1; }

# ── host info ─────────────────────────────────────────────────
HOSTNAME_VAL="$(scutil --get ComputerName 2>/dev/null || hostname 2>/dev/null || echo unknown)"
PROD="$(sw_vers -productName 2>/dev/null || echo macOS)"
PVER="$(sw_vers -productVersion 2>/dev/null || echo '')"
OS_VERSION="$PROD $PVER"
ARCH="$(uname -m 2>/dev/null || echo unknown)"
LAST_BOOT="$(sysctl -n kern.boottime 2>/dev/null | sed -n 's/.*sec = \([0-9]*\).*/\1/p')"
if [ -n "$LAST_BOOT" ]; then
  LAST_BOOT="$(date -u -r "$LAST_BOOT" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo '')"
fi

# ── 1. FileVault disk encryption ──────────────────────────────
ENC_OBSERVED="unknown"; ENC_STATUS="unknown"; ENC_SEV="medium"
if have fdesetup; then
  if fdesetup status 2>/dev/null | grep -qi "FileVault is On"; then
    ENC_OBSERVED="FileVault On"; ENC_STATUS="pass"; ENC_SEV="info"
  else
    ENC_OBSERVED="FileVault Off"; ENC_STATUS="fail"; ENC_SEV="high"
  fi
fi
add_check "disk_encryption" "Protect" "Disk encryption (FileVault)" "$ENC_STATUS" "$ENC_SEV" "$ENC_OBSERVED" \
  "FileVault should be enabled to protect data at rest." "3"

# ── 2. Application firewall ───────────────────────────────────
FW_BIN="/usr/libexec/ApplicationFirewall/socketfilterfw"
FW_OBSERVED="unknown"; FW_STATUS="unknown"; FW_SEV="medium"
if [ -x "$FW_BIN" ]; then
  if "$FW_BIN" --getglobalstate 2>/dev/null | grep -qi "enabled"; then
    FW_OBSERVED="Application firewall enabled"; FW_STATUS="pass"; FW_SEV="info"
  else
    FW_OBSERVED="Application firewall disabled"; FW_STATUS="fail"; FW_SEV="high"
  fi
fi
add_check "firewall" "Protect" "Host firewall" "$FW_STATUS" "$FW_SEV" "$FW_OBSERVED" \
  "The macOS application firewall should be enabled." "4"

# ── 3. Gatekeeper ─────────────────────────────────────────────
if have spctl; then
  if spctl --status 2>/dev/null | grep -qi "assessments enabled"; then
    add_check "gatekeeper" "Protect" "Gatekeeper" "pass" "info" "enabled" \
      "Gatekeeper enforces signed/notarized apps." "10"
  else
    add_check "gatekeeper" "Protect" "Gatekeeper" "fail" "high" "disabled" \
      "Gatekeeper is disabled; unsigned apps can run freely." "10"
  fi
else
  add_check "gatekeeper" "Protect" "Gatekeeper" "unknown" "low" "Not determinable" \
    "Could not query Gatekeeper." "10"
fi

# ── 4. System Integrity Protection (SIP) ──────────────────────
if have csrutil; then
  if csrutil status 2>/dev/null | grep -qi "enabled"; then
    add_check "sip" "Protect" "System Integrity Protection" "pass" "info" "enabled" \
      "SIP protects critical system files from tampering." "4"
  else
    add_check "sip" "Protect" "System Integrity Protection" "fail" "high" "disabled" \
      "SIP is disabled; system files are unprotected." "4"
  fi
else
  add_check "sip" "Protect" "System Integrity Protection" "unknown" "low" "Not determinable" \
    "Could not query SIP." "4"
fi

# ── 5. XProtect / built-in malware tooling presence ───────────
XPROTECT="/Library/Apple/System/Library/CoreServices/XProtect.bundle"
[ -d "$XPROTECT" ] || XPROTECT="/System/Library/CoreServices/XProtect.bundle"
if [ -d "$XPROTECT" ]; then
  add_tool "Apple XProtect"
  add_check "av_present" "Protect" "Built-in malware protection" "pass" "info" "XProtect present" \
    "Apple's built-in XProtect malware signatures are present." "10"
else
  add_check "av_present" "Protect" "Built-in malware protection" "unknown" "low" "XProtect not found" \
    "Could not confirm XProtect presence." "10"
fi
# Third-party EDR detection
if [ -d "/Applications/Falcon.app" ] || pgrep -q falcon 2>/dev/null; then add_tool "CrowdStrike Falcon"; fi
if [ -d "/Applications/SentinelOne" ] || pgrep -q SentinelAgent 2>/dev/null; then add_tool "SentinelOne"; fi

# ── 6. Pending software updates ───────────────────────────────
if have softwareupdate; then
  SU_OUT="$(softwareupdate -l 2>&1)"
  if printf '%s' "$SU_OUT" | grep -qi "No new software available"; then
    add_check "patches" "Identify" "Pending OS updates" "pass" "info" "0 pending" \
      "No pending macOS updates." "7"
  else
    NUP="$(sanitize_int "$(printf '%s' "$SU_OUT" | grep -c '^\s*\* ')")"
    if [ "$NUP" -eq 0 ]; then
      add_check "patches" "Identify" "Pending OS updates" "unknown" "low" "Not determinable" \
        "Could not parse softwareupdate output." "7"
    elif [ "$NUP" -le 5 ]; then
      add_check "patches" "Identify" "Pending OS updates" "warn" "medium" "$NUP pending" \
        "Some macOS updates are pending." "7"
    else
      add_check "patches" "Identify" "Pending OS updates" "fail" "high" "$NUP pending" \
        "Many macOS updates are pending; patch promptly." "7"
    fi
  fi
else
  add_check "patches" "Identify" "Pending OS updates" "unknown" "low" "Not determinable" \
    "softwareupdate not available." "7"
fi

# ── 7. Admin accounts ─────────────────────────────────────────
if have dseditgroup || have dscl; then
  ADMINS="$(dscl . -read /Groups/admin GroupMembership 2>/dev/null | sed 's/GroupMembership: //')"
  if [ -n "$ADMINS" ]; then
    NADM="$(sanitize_int "$(echo "$ADMINS" | tr ' ' '\n' | grep -c .)")"
    ST="pass"; SV="info"
    [ "$NADM" -gt 3 ] && ST="warn" && SV="medium"
    [ "$NADM" -gt 6 ] && ST="fail" && SV="high"
    add_check "admins" "Identify" "Administrator accounts" "$ST" "$SV" "$NADM account(s)" \
      "Limit admin accounts to the minimum necessary." "5"
  else
    add_check "admins" "Identify" "Administrator accounts" "unknown" "low" "Not determinable" \
      "Could not read admin group membership." "5"
  fi
fi

# ── 8. Automatic updates configured ───────────────────────────
AUTO_PLIST="/Library/Preferences/com.apple.SoftwareUpdate"
AUTO_ON="$(defaults read "$AUTO_PLIST" AutomaticCheckEnabled 2>/dev/null || echo '')"
if [ "$AUTO_ON" = "1" ]; then
  add_check "auto_updates" "Protect" "Automatic update checks" "pass" "info" "enabled" \
    "Automatic update checking is enabled." "7"
else
  add_check "auto_updates" "Protect" "Automatic update checks" "warn" "low" "not enabled / unknown" \
    "Consider enabling automatic update checks." "7"
fi

# ── installed software inventory (read-only) ──────────────────
# Enumerates installed applications + versions. Prefers system_profiler's JSON
# output (parsed with the built-in plutil/python where available); falls back to
# reading each /Applications/*.app Info.plist. Read-only. Feeds CVE matching.
SOFTWARE_JSON=""
build_software() {
  local first=1 name ver
  # Fallback approach that needs no extra tools: read app bundle Info.plists.
  local appdir line
  for appdir in /Applications/*.app /Applications/*/*.app; do
    [ -d "$appdir" ] || continue
    name="$(basename "$appdir" .app)"
    ver=""
    if [ -f "$appdir/Contents/Info.plist" ]; then
      ver="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$appdir/Contents/Info.plist" 2>/dev/null)"
    fi
    [ -z "$name" ] && continue
    if [ $first -eq 1 ]; then first=0; else SOFTWARE_JSON+=","; fi
    SOFTWARE_JSON+="{\"name\":$(json_escape "$name"),\"version\":$(json_escape "${ver:-}")}"
  done
}
build_software 2>/dev/null || SOFTWARE_JSON=""

# ── inventory ─────────────────────────────────────────────────
INV="{\"localAdmins\":[],\"installedSecurityTools\":[${SEC_TOOLS}],"
INV+="\"diskEncryption\":$(json_escape "$ENC_OBSERVED"),\"pendingPatches\":0,"
INV+="\"firewall\":$(json_escape "$FW_OBSERVED"),"
INV+="\"software\":[${SOFTWARE_JSON}]}"

# ── assemble report ───────────────────────────────────────────
REPORT="{\"agentVersion\":$(json_escape "$AGENT_VERSION"),\"schema\":1,"
REPORT+="\"host\":{\"hostname\":$(json_escape "$HOSTNAME_VAL"),\"os\":\"macos\","
REPORT+="\"osVersion\":$(json_escape "$OS_VERSION"),\"arch\":$(json_escape "$ARCH"),"
REPORT+="\"lastBootUtc\":$(json_escape "${LAST_BOOT:-}"),\"collectedAtUtc\":$(json_escape "$NOW_UTC")},"
REPORT+="\"checks\":[${CHECKS_JSON}],\"events\":[${EVENTS_JSON}],\"inventory\":${INV}}"

if [ -n "$OUTFILE" ]; then
  printf '%s' "$REPORT" > "$OUTFILE"
  echo "ShieldAI report written to $OUTFILE"
else
  printf '%s\n' "$REPORT"
fi

exit 0
