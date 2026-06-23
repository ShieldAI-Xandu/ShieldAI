#!/usr/bin/env bash
# ShieldAI Linux Posture Collector
# --------------------------------
# READ-ONLY. Collects security posture from native Linux tooling and whatever
# security products are already installed. Makes NO changes to the system.
#
# It does not scan for malware itself — it reports the state of the tools that
# are present (firewall, disk encryption, AV if installed, patch state, etc.).
#
# Output: a single JSON document (ShieldAI agent report schema v1) to -o <file>,
# or to stdout. Always exits 0 so a scheduled run never hard-fails; missing data
# degrades to status "unknown".
#
# Usage: collect.sh [-o report.json] [-V 1.0.0]
#
# Depends only on coreutils + bash. `jq` is used if available for safe JSON
# string escaping; if absent, a built-in escaper is used.

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

# ── JSON string escaper (fallback when jq is absent) ──────────
json_escape() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -Rsa .
  else
    # Escape backslash, double-quote, control chars; collapse newlines.
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\t'/ }"
    s="${s//$'\r'/ }"
    s="${s//$'\n'/ }"
    printf '"%s"' "$s"
  fi
}

# ── accumulators ──────────────────────────────────────────────
CHECKS_JSON=""
EVENTS_JSON=""
SEC_TOOLS=""        # comma-joined JSON strings
add_tool() { local t; t="$(json_escape "$1")"; SEC_TOOLS="${SEC_TOOLS:+$SEC_TOOLS,}$t"; }

# add_check id category title status severity observed detail cis
add_check() {
  local obj
  obj="{\"id\":$(json_escape "$1"),\"category\":$(json_escape "$2"),\"title\":$(json_escape "$3"),"
  obj+="\"status\":$(json_escape "$4"),\"severity\":$(json_escape "$5"),\"observed\":$(json_escape "$6"),"
  obj+="\"detail\":$(json_escape "$7"),\"cisControl\":$(json_escape "${8:-}")}"
  CHECKS_JSON="${CHECKS_JSON:+$CHECKS_JSON,}$obj"
}

# add_event source severity type message
add_event() {
  local obj
  obj="{\"ts\":$(json_escape "$NOW_UTC"),\"source\":$(json_escape "$1"),\"severity\":$(json_escape "$2"),"
  obj+="\"type\":$(json_escape "$3"),\"message\":$(json_escape "$4"),\"raw\":null}"
  EVENTS_JSON="${EVENTS_JSON:+$EVENTS_JSON,}$obj"
}

have() { command -v "$1" >/dev/null 2>&1; }

# sanitize_int → clean single integer (defends against multi-line/locale quirks)
sanitize_int() { local v; v="$(printf '%s' "$1" | tr -cd '0-9' | head -c 9)"; printf '%s' "${v:-0}"; }

# ── host info ─────────────────────────────────────────────────
HOSTNAME_VAL="$(hostname 2>/dev/null || echo unknown)"
OS_VERSION="$( . /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-Linux}" )"
ARCH="$(uname -m 2>/dev/null || echo unknown)"
LAST_BOOT="$(uptime -s 2>/dev/null | sed 's/ /T/; s/$/Z/' || echo '')"

# ── 1. Firewall (ufw / firewalld / nftables / iptables) ───────
FW_OBSERVED="unknown"; FW_STATUS="unknown"; FW_SEV="medium"
if have ufw; then
  if ufw status 2>/dev/null | grep -qi "Status: active"; then
    FW_OBSERVED="ufw active"; FW_STATUS="pass"; FW_SEV="info"
  else
    FW_OBSERVED="ufw inactive"; FW_STATUS="fail"; FW_SEV="high"
  fi
elif have firewall-cmd; then
  if firewall-cmd --state 2>/dev/null | grep -qi running; then
    FW_OBSERVED="firewalld running"; FW_STATUS="pass"; FW_SEV="info"
  else
    FW_OBSERVED="firewalld not running"; FW_STATUS="fail"; FW_SEV="high"
  fi
elif have nft && nft list ruleset 2>/dev/null | grep -q .; then
  FW_OBSERVED="nftables rules present"; FW_STATUS="pass"; FW_SEV="info"
elif have iptables && [ "$(iptables -S 2>/dev/null | grep -c '^-A')" -gt 0 ]; then
  FW_OBSERVED="iptables rules present"; FW_STATUS="warn"; FW_SEV="low"
else
  FW_OBSERVED="no active firewall detected"; FW_STATUS="fail"; FW_SEV="high"
fi
add_check "firewall" "Protect" "Host firewall" "$FW_STATUS" "$FW_SEV" "$FW_OBSERVED" \
  "A host firewall should be active to limit network exposure." "4"

# ── 2. Disk encryption (LUKS) ─────────────────────────────────
ENC_OBSERVED="unknown"; ENC_STATUS="unknown"; ENC_SEV="medium"
if have lsblk; then
  if lsblk -o TYPE 2>/dev/null | grep -qi crypt; then
    ENC_OBSERVED="LUKS/crypt volume present"; ENC_STATUS="pass"; ENC_SEV="info"
  else
    ENC_OBSERVED="no encrypted volumes detected"; ENC_STATUS="warn"; ENC_SEV="medium"
  fi
fi
add_check "disk_encryption" "Protect" "Disk encryption" "$ENC_STATUS" "$ENC_SEV" "$ENC_OBSERVED" \
  "Disks holding sensitive data should be encrypted at rest." "3"

# ── 3. Antivirus presence (ClamAV or vendor) ──────────────────
AV_FOUND=""
if have clamscan || have clamdscan; then AV_FOUND="ClamAV"; add_tool "ClamAV"; fi
if systemctl is-active --quiet falcon-sensor 2>/dev/null; then AV_FOUND="CrowdStrike Falcon"; add_tool "CrowdStrike Falcon"; fi
if systemctl is-active --quiet sentinelone 2>/dev/null || have sentinelctl; then AV_FOUND="SentinelOne"; add_tool "SentinelOne"; fi
if [ -n "$AV_FOUND" ]; then
  add_check "av_present" "Protect" "Endpoint protection installed" "pass" "info" "$AV_FOUND" \
    "An endpoint protection product is installed." "10"
else
  add_check "av_present" "Protect" "Endpoint protection installed" "warn" "medium" "None detected" \
    "No endpoint protection product was detected on this host." "10"
fi

# ── 4. Pending package updates ────────────────────────────────
PEND=0; PEND_KNOWN=0
if have apt-get; then
  PEND_KNOWN=1
  PEND="$(sanitize_int "$(apt-get -s upgrade 2>/dev/null | grep -c '^Inst')")"
elif have dnf; then
  PEND_KNOWN=1
  PEND="$(sanitize_int "$(dnf -q check-update 2>/dev/null | grep -c '^[a-zA-Z0-9]')")"
elif have yum; then
  PEND_KNOWN=1
  PEND="$(sanitize_int "$(yum -q check-update 2>/dev/null | grep -c '^[a-zA-Z0-9]')")"
fi
if [ "$PEND_KNOWN" -eq 1 ]; then
  if [ "$PEND" -eq 0 ]; then
    add_check "patches" "Identify" "Pending OS updates" "pass" "info" "0 pending" "System packages are up to date." "7"
  elif [ "$PEND" -le 20 ]; then
    add_check "patches" "Identify" "Pending OS updates" "warn" "medium" "$PEND pending" "Some package updates are pending." "7"
  else
    add_check "patches" "Identify" "Pending OS updates" "fail" "high" "$PEND pending" "Many package updates are pending; patch promptly." "7"
  fi
else
  add_check "patches" "Identify" "Pending OS updates" "unknown" "low" "Not determinable" "No supported package manager found." "7"
fi

# ── 5. Sudo / admin accounts ──────────────────────────────────
SUDOERS="$(getent group sudo 2>/dev/null | cut -d: -f4)"
[ -z "$SUDOERS" ] && SUDOERS="$(getent group wheel 2>/dev/null | cut -d: -f4)"
if [ -n "$SUDOERS" ]; then
  NSUDO="$(sanitize_int "$(echo "$SUDOERS" | tr ',' '\n' | grep -c .)")"
  ST="pass"; SV="info"
  [ "$NSUDO" -gt 3 ] && ST="warn" && SV="medium"
  [ "$NSUDO" -gt 6 ] && ST="fail" && SV="high"
  add_check "admins" "Identify" "Privileged (sudo) accounts" "$ST" "$SV" "$NSUDO account(s)" \
    "Limit sudo/wheel membership to the minimum necessary." "5"
else
  add_check "admins" "Identify" "Privileged (sudo) accounts" "unknown" "low" "Not determinable" \
    "Could not read sudo/wheel group." "5"
fi

# ── 6. SSH hardening (root login / password auth) ─────────────
SSHCFG="/etc/ssh/sshd_config"
if [ -r "$SSHCFG" ]; then
  ROOT_LOGIN="$(grep -Ei '^[[:space:]]*PermitRootLogin' "$SSHCFG" | tail -1 | awk '{print tolower($2)}')"
  PASS_AUTH="$(grep -Ei '^[[:space:]]*PasswordAuthentication' "$SSHCFG" | tail -1 | awk '{print tolower($2)}')"
  if [ "$ROOT_LOGIN" = "no" ] && { [ "$PASS_AUTH" = "no" ] || [ -z "$PASS_AUTH" ]; }; then
    add_check "ssh" "Protect" "SSH hardening" "pass" "info" "root login disabled" \
      "SSH disallows direct root login (and prefers keys over passwords)." "4"
  elif [ "$ROOT_LOGIN" = "yes" ]; then
    add_check "ssh" "Protect" "SSH hardening" "fail" "high" "root login permitted" \
      "SSH permits direct root login; disable PermitRootLogin." "4"
  else
    add_check "ssh" "Protect" "SSH hardening" "warn" "medium" "review recommended" \
      "Review SSH config: prefer key auth and disable root login." "4"
  fi
else
  add_check "ssh" "Protect" "SSH hardening" "unknown" "low" "sshd_config not readable" \
    "Could not read sshd_config (may require elevation, or SSH not installed)." "4"
fi

# ── 7. Automatic security updates configured ──────────────────
AUTO="unknown"
if [ -f /etc/apt/apt.conf.d/20auto-upgrades ] && grep -q '"1"' /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null; then
  AUTO="enabled"
elif systemctl is-enabled --quiet dnf-automatic.timer 2>/dev/null; then
  AUTO="enabled"
fi
if [ "$AUTO" = "enabled" ]; then
  add_check "auto_updates" "Protect" "Automatic security updates" "pass" "info" "enabled" \
    "Automatic security updates are configured." "7"
else
  add_check "auto_updates" "Protect" "Automatic security updates" "warn" "low" "not detected" \
    "Consider enabling unattended security updates." "7"
fi

# ── inventory ─────────────────────────────────────────────────
INV="{\"localAdmins\":[],\"installedSecurityTools\":[${SEC_TOOLS}],"
INV+="\"diskEncryption\":$(json_escape "$ENC_OBSERVED"),\"pendingPatches\":${PEND:-0},"
INV+="\"firewall\":$(json_escape "$FW_OBSERVED")}"

# ── assemble report ───────────────────────────────────────────
REPORT="{\"agentVersion\":$(json_escape "$AGENT_VERSION"),\"schema\":1,"
REPORT+="\"host\":{\"hostname\":$(json_escape "$HOSTNAME_VAL"),\"os\":\"linux\","
REPORT+="\"osVersion\":$(json_escape "$OS_VERSION"),\"arch\":$(json_escape "$ARCH"),"
REPORT+="\"lastBootUtc\":$(json_escape "$LAST_BOOT"),\"collectedAtUtc\":$(json_escape "$NOW_UTC")},"
REPORT+="\"checks\":[${CHECKS_JSON}],\"events\":[${EVENTS_JSON}],\"inventory\":${INV}}"

if [ -n "$OUTFILE" ]; then
  printf '%s' "$REPORT" > "$OUTFILE"
  echo "ShieldAI report written to $OUTFILE"
else
  printf '%s\n' "$REPORT"
fi

exit 0
