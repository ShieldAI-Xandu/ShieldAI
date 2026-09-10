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
AGENT_VERSION="1.2.0"
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

# ── 3. Antivirus / EDR presence (ClamAV or vendor agents) ──────
AV_TOOLS=""
add_av() { AV_TOOLS="${AV_TOOLS:+$AV_TOOLS, }$1"; add_tool "$1"; }
if have clamscan || have clamdscan; then add_av "ClamAV"; fi
if systemctl is-active --quiet falcon-sensor 2>/dev/null; then add_av "CrowdStrike Falcon"; fi
if systemctl is-active --quiet sentinelone 2>/dev/null || have sentinelctl; then add_av "SentinelOne"; fi
if systemctl is-active --quiet sophos-spl 2>/dev/null || have savdstatus; then add_av "Sophos"; fi
if systemctl is-active --quiet wazuh-agent 2>/dev/null; then add_av "Wazuh Agent"; fi
if systemctl is-active --quiet esets 2>/dev/null || have esets_daemon; then add_av "ESET"; fi
# Bitdefender GravityZone Business Security for Linux. Service unit naming
# has varied across GravityZone agent versions (bd / epsecurity are the two
# most commonly documented); unlike the checks above this one couldn't be
# verified against a live install — confirm against a real GravityZone-for-
# Linux host before trusting it blindly, same caveat this repo's other
# best-effort vendor detections carry.
if systemctl is-active --quiet bd 2>/dev/null || systemctl is-active --quiet epsecurity 2>/dev/null || have bdscan; then add_av "Bitdefender"; fi
if [ -n "$AV_TOOLS" ]; then
  add_check "av_present" "Protect" "Endpoint protection installed" "pass" "info" "$AV_TOOLS" \
    "An endpoint protection product is installed." "10"
else
  add_check "av_present" "Protect" "Endpoint protection installed" "warn" "medium" "None detected" \
    "No endpoint protection product was detected on this host." "10"
fi

# ── 3b. VPN client installed + tunnel active ───────────────────
VPN_CLIENTS=""
add_vpn() { VPN_CLIENTS="${VPN_CLIENTS:+$VPN_CLIENTS, }$1"; }
if have openvpn || systemctl list-units --all 2>/dev/null | grep -q 'openvpn@'; then add_vpn "OpenVPN"; fi
if have wg || systemctl is-active --quiet 'wg-quick@*' 2>/dev/null; then add_vpn "WireGuard"; fi
if have tailscale || systemctl is-active --quiet tailscaled 2>/dev/null; then add_vpn "Tailscale"; fi
if [ -x /opt/cisco/anyconnect/bin/vpn ] || systemctl is-active --quiet vpnagentd 2>/dev/null; then add_vpn "Cisco AnyConnect"; fi
if have nordvpn; then add_vpn "NordVPN"; fi

if [ -n "$VPN_CLIENTS" ]; then
  add_check "vpn_client_installed" "Protect" "VPN client installed" "pass" "info" "$VPN_CLIENTS" \
    "A VPN client is installed on this host." "12"
else
  add_check "vpn_client_installed" "Protect" "VPN client installed" "warn" "low" "None detected" \
    "No known VPN client software was found on this host." "12"
fi

# Tunnel-active: vendor-specific confirmations first (more precise), falling
# back to a generic UP tun/tap/wg interface check for anything else.
TUNNEL_ACTIVE=0; TUNNEL_VENDOR=""
if have wg && wg show interfaces 2>/dev/null | grep -q .; then
  TUNNEL_ACTIVE=1; TUNNEL_VENDOR="WireGuard"
elif have tailscale && tailscale status --json 2>/dev/null | grep -q '"BackendState":"Running"'; then
  TUNNEL_ACTIVE=1; TUNNEL_VENDOR="Tailscale"
elif systemctl is-active --quiet tailscaled 2>/dev/null; then
  TUNNEL_ACTIVE=1; TUNNEL_VENDOR="Tailscale"
elif have nordvpn && nordvpn status 2>/dev/null | grep -qi connected; then
  TUNNEL_ACTIVE=1; TUNNEL_VENDOR="NordVPN"
elif ip link show 2>/dev/null | grep -qE '^[0-9]+: (tun|tap)[0-9]*.*state UP'; then
  TUNNEL_ACTIVE=1; TUNNEL_VENDOR="unknown"
fi

if [ "$TUNNEL_ACTIVE" -eq 1 ]; then
  add_check "vpn_tunnel_active" "Protect" "VPN tunnel active" "pass" "info" "Connected ($TUNNEL_VENDOR)" \
    "An active VPN tunnel was detected." "12"
elif [ -n "$VPN_CLIENTS" ]; then
  add_check "vpn_tunnel_active" "Protect" "VPN tunnel active" "warn" "low" "Installed but not connected" \
    "A VPN client is installed but no active tunnel was detected right now." "12"
else
  add_check "vpn_tunnel_active" "Protect" "VPN tunnel active" "warn" "low" "No VPN client installed" \
    "No VPN client is installed, so no tunnel can be active." "12"
fi

# ── 3c. Password manager detection ─────────────────────────────
PWD_MGRS=""
add_pwdmgr() { PWD_MGRS="${PWD_MGRS:+$PWD_MGRS, }$1"; }
if have 1password || [ -d /opt/1Password ]; then add_pwdmgr "1Password"; fi
if have bitwarden; then add_pwdmgr "Bitwarden"; fi
if have keepassxc; then add_pwdmgr "KeePassXC"; fi
# lpass is the LastPass CLI — a distinct tool from a vault-manager GUI — not
# treated as "LastPass installed" here, to avoid a misleading positive.
# Dashlane has no reliable standalone Linux binary (it's primarily a browser
# extension there) — not checked, so this limitation is visible rather than
# silently under-detecting it as a false negative.

if [ -n "$PWD_MGRS" ]; then
  add_check "password_manager_installed" "Protect" "Password manager installed" "pass" "info" "$PWD_MGRS" \
    "A third-party password manager is installed on this host." "6"
else
  add_check "password_manager_installed" "Protect" "Password manager installed" "warn" "low" "None detected" \
    "No known third-party password manager was found on this host." "6"
fi

# ── 3d/3e. Browser-native password manager, Safe Browsing, version ──
# Chrome/Edge (Chromium) store this in a JSON Preferences file per profile.
# Uses jq when present for a real JSON read; falls back to a plain-text
# grep otherwise, matching this file's existing "prefer a real tool, fall
# back to text scraping" convention (see json_escape above).
read_chromium_pref() {
  # $1 = Preferences file path, $2 = key, dotted for a nested lookup
  # (e.g. "safebrowsing.enabled"); prints "true"/"false"/"" (unset).
  local f="$1" key="$2"
  if have jq; then
    jq -r ".${key} // empty" "$f" 2>/dev/null
  else
    local leaf="${key##*.}"
    grep -o "\"${leaf}\":[a-z]*" "$f" 2>/dev/null | head -1 | cut -d: -f2
  fi
}

# Major-version floor per browser, "current stable major minus ~2" as of
# when this was written. Must be refreshed periodically and kept
# numerically identical across the Windows/Linux/macOS collectors — see
# agent/ARCHITECTURE.md's installer-sync / version-baseline note.
MIN_CHROME_MAJOR=128
MIN_EDGE_MAJOR=128
MIN_FIREFOX_MAJOR=128

# Scans every local user's Chromium-family profile(s) for this browser and
# returns (via echo, "|"-joined): pwdmgr|safebrowsing|any_profile_found
scan_chromium_profiles() {
  local config_dir_name="$1" pwdmgr_disabled=0 sb_disabled=0 any_profile=0 home prefs
  for home in /home/*; do
    [ -d "$home" ] || continue
    for prefs in "$home/.config/$config_dir_name/Default/Preferences" "$home"/.config/"$config_dir_name"/Profile*/Preferences; do
      [ -f "$prefs" ] || continue
      any_profile=1
      [ "$(read_chromium_pref "$prefs" credentials_enable_service)" = "false" ] && pwdmgr_disabled=1
      [ "$(read_chromium_pref "$prefs" safebrowsing.enabled)" = "false" ] && sb_disabled=1
    done
  done
  echo "${pwdmgr_disabled}|${sb_disabled}|${any_profile}"
}

# Managed-policy JSON files (authoritative override when present), same
# precedence as the Windows/macOS collectors' registry-policy/plist checks.
chromium_policy_says_disabled() {
  local policy_key="$1" pf
  for pf in /etc/opt/chrome/policies/managed/*.json /etc/chromium/policies/managed/*.json /etc/opt/edge/policies/managed/*.json; do
    [ -f "$pf" ] || continue
    have jq || continue
    if [ "$(jq -r ".${policy_key} // empty" "$pf" 2>/dev/null)" = "false" ]; then echo 1; return; fi
  done
  echo 0
}

emit_browser_checks() {
  # $1 display name, $2 check-id key, $3 version, $4 min major, $5 pwdmgr_disabled,
  # $6 sb_disabled, $7 any_profile_found, $8 policy_pwdmgr_disabled, $9 policy_sb_disabled
  local name="$1" key="$2" ver="$3" min_major="$4" pwdmgr_off="$5" sb_off="$6" any_profile="$7" pol_pwdmgr_off="$8" pol_sb_off="$9"
  local major current="true" pwdmgr="unknown" safebrowsing="unknown"
  major="$(echo "$ver" | cut -d. -f1)"
  if [ -n "$major" ] && [ "$major" -lt "$min_major" ] 2>/dev/null; then current="false"; fi
  if [ "$pol_pwdmgr_off" -eq 1 ]; then
    pwdmgr="disabled"
  elif [ "$any_profile" -eq 1 ]; then
    pwdmgr="enabled"; [ "$pwdmgr_off" -eq 1 ] && pwdmgr="disabled"
  fi
  if [ "$pol_sb_off" -eq 1 ]; then
    safebrowsing="disabled"
  elif [ "$any_profile" -eq 1 ]; then
    safebrowsing="enabled"; [ "$sb_off" -eq 1 ] && safebrowsing="disabled"
  fi

  if [ "$pwdmgr" != "unknown" ]; then
    add_check "browser_pwdmgr_$key" "Protect" "$name password manager" \
      "$([ "$pwdmgr" = "enabled" ] && echo pass || echo warn)" \
      "$([ "$pwdmgr" = "enabled" ] && echo info || echo low)" \
      "$pwdmgr" "Built-in $name password manager state." "6"
  fi
  if [ "$safebrowsing" != "unknown" ]; then
    add_check "browser_safebrowsing_$key" "Protect" "$name Safe Browsing" \
      "$([ "$safebrowsing" = "enabled" ] && echo pass || echo fail)" \
      "$([ "$safebrowsing" = "enabled" ] && echo info || echo medium)" \
      "$safebrowsing" "Built-in phishing/malware protection state." "9"
  fi
  add_check "browser_version_$key" "Identify" "$name version currency" \
    "$([ "$current" = "true" ] && echo pass || echo warn)" \
    "$([ "$current" = "true" ] && echo info || echo medium)" \
    "$ver" "Installed browser version compared against the supported baseline." "7"
  BROWSERS_JSON="${BROWSERS_JSON:+$BROWSERS_JSON,}{\"name\":$(json_escape "$name"),\"version\":$(json_escape "$ver"),\"safeBrowsing\":$(json_escape "$safebrowsing"),\"currentVersion\":$current}"
}

BROWSERS_JSON=""
PWDMGR_CHROME="not-installed"; PWDMGR_EDGE="not-installed"; PWDMGR_FIREFOX="not-installed"

CHROME_VER=""
if have google-chrome-stable; then CHROME_VER="$(google-chrome-stable --version 2>/dev/null | grep -o '[0-9][0-9.]*' | head -1)"
elif have google-chrome; then CHROME_VER="$(google-chrome --version 2>/dev/null | grep -o '[0-9][0-9.]*' | head -1)"; fi
if [ -n "$CHROME_VER" ]; then
  IFS='|' read -r c_pwdmgr_off c_sb_off c_any_profile <<< "$(scan_chromium_profiles google-chrome)"
  pol_pwdmgr_off="$(chromium_policy_says_disabled PasswordManagerEnabled)"
  pol_sb_off=0
  emit_browser_checks "Google Chrome" "chrome" "$CHROME_VER" "$MIN_CHROME_MAJOR" \
    "$c_pwdmgr_off" "$c_sb_off" "$c_any_profile" "$pol_pwdmgr_off" "$pol_sb_off"
  [ "$c_any_profile" -eq 1 ] && { PWDMGR_CHROME="enabled"; [ "$c_pwdmgr_off" -eq 1 ] && PWDMGR_CHROME="disabled"; }
  [ "$pol_pwdmgr_off" -eq 1 ] && PWDMGR_CHROME="disabled"
fi

EDGE_VER=""
if have microsoft-edge-stable; then EDGE_VER="$(microsoft-edge-stable --version 2>/dev/null | grep -o '[0-9][0-9.]*' | head -1)"
elif have microsoft-edge; then EDGE_VER="$(microsoft-edge --version 2>/dev/null | grep -o '[0-9][0-9.]*' | head -1)"; fi
if [ -n "$EDGE_VER" ]; then
  IFS='|' read -r e_pwdmgr_off e_sb_off e_any_profile <<< "$(scan_chromium_profiles microsoft-edge)"
  pol_pwdmgr_off="$(chromium_policy_says_disabled PasswordManagerEnabled)"
  pol_sb_off=0
  emit_browser_checks "Microsoft Edge" "edge" "$EDGE_VER" "$MIN_EDGE_MAJOR" \
    "$e_pwdmgr_off" "$e_sb_off" "$e_any_profile" "$pol_pwdmgr_off" "$pol_sb_off"
  [ "$e_any_profile" -eq 1 ] && { PWDMGR_EDGE="enabled"; [ "$e_pwdmgr_off" -eq 1 ] && PWDMGR_EDGE="disabled"; }
  [ "$pol_pwdmgr_off" -eq 1 ] && PWDMGR_EDGE="disabled"
fi

# Firefox uses a different preferences format entirely (prefs.js, a
# JS-literal text file, not JSON) — handled separately, a genuinely
# different idiom rather than an oversight.
FIREFOX_VER=""
if have firefox; then FIREFOX_VER="$(firefox --version 2>/dev/null | grep -o '[0-9][0-9.]*' | head -1)"; fi
if [ -n "$FIREFOX_VER" ]; then
  ff_pwdmgr_off=0; ff_sb_off=0; ff_any_profile=0
  for home in /home/*; do
    [ -d "$home" ] || continue
    for pf in "$home"/.mozilla/firefox/*.default*/prefs.js; do
      [ -f "$pf" ] || continue
      ff_any_profile=1
      grep -Eq 'user_pref\("signon\.rememberSignons",[[:space:]]*false\)' "$pf" && ff_pwdmgr_off=1
      grep -Eq 'user_pref\("browser\.safebrowsing\.(malware|phishing)\.enabled",[[:space:]]*false\)' "$pf" && ff_sb_off=1
    done
  done
  emit_browser_checks "Mozilla Firefox" "firefox" "$FIREFOX_VER" "$MIN_FIREFOX_MAJOR" \
    "$ff_pwdmgr_off" "$ff_sb_off" "$ff_any_profile" 0 0
  PWDMGR_FIREFOX="enabled"; [ "$ff_pwdmgr_off" -eq 1 ] && PWDMGR_FIREFOX="disabled"
fi

PWDMGRS_BROWSER_JSON="{\"chrome\":$(json_escape "$PWDMGR_CHROME"),\"edge\":$(json_escape "$PWDMGR_EDGE"),\"firefox\":$(json_escape "$PWDMGR_FIREFOX")}"

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

# ── installed software inventory (read-only) ──────────────────
# Reads installed packages + versions from whichever package manager is present
# (dpkg on Debian/Ubuntu, rpm on RHEL/Fedora/SUSE). Feeds ShieldAI CVE matching.
# Read-only: only queries the package database, never installs or changes.
SOFTWARE_JSON=""
build_software() {
  local raw="" line name ver first=1
  if command -v dpkg-query >/dev/null 2>&1; then
    raw="$(dpkg-query -W -f='${Package}\t${Version}\n' 2>/dev/null)"
  elif command -v rpm >/dev/null 2>&1; then
    raw="$(rpm -qa --qf '%{NAME}\t%{VERSION}\n' 2>/dev/null)"
  fi
  [ -z "$raw" ] && { SOFTWARE_JSON=""; return; }
  # Cap to 200 entries to keep the payload reasonable.
  while IFS=$'\t' read -r name ver; do
    [ -z "$name" ] && continue
    if [ $first -eq 1 ]; then first=0; else SOFTWARE_JSON+=","; fi
    SOFTWARE_JSON+="{\"name\":$(json_escape "$name"),\"version\":$(json_escape "${ver:-}")}"
  done <<< "$(printf '%s\n' "$raw" | head -n 200)"
}
build_software

# ── inventory ─────────────────────────────────────────────────
VPN_CLIENTS_JSON=""
if [ -n "$VPN_CLIENTS" ]; then
  IFS=',' read -ra _vc <<< "$VPN_CLIENTS"
  for v in "${_vc[@]}"; do
    v="$(echo "$v" | sed 's/^ *//;s/ *$//')"
    VPN_CLIENTS_JSON="${VPN_CLIENTS_JSON:+$VPN_CLIENTS_JSON,}$(json_escape "$v")"
  done
fi
VPN_INV="{\"installedClients\":[${VPN_CLIENTS_JSON}],\"tunnelActive\":$([ "$TUNNEL_ACTIVE" -eq 1 ] && echo true || echo false),\"activeTunnelClient\":$(json_escape "${TUNNEL_VENDOR:-}")}"

PWD_MGRS_JSON=""
if [ -n "$PWD_MGRS" ]; then
  IFS=',' read -ra _pm <<< "$PWD_MGRS"
  for p in "${_pm[@]}"; do
    p="$(echo "$p" | sed 's/^ *//;s/ *$//')"
    PWD_MGRS_JSON="${PWD_MGRS_JSON:+$PWD_MGRS_JSON,}$(json_escape "$p")"
  done
fi
PWDMGR_INV="{\"thirdPartyInstalled\":[${PWD_MGRS_JSON}],\"browserNative\":${PWDMGRS_BROWSER_JSON}}"

INV="{\"localAdmins\":[],\"installedSecurityTools\":[${SEC_TOOLS}],"
INV+="\"diskEncryption\":$(json_escape "$ENC_OBSERVED"),\"pendingPatches\":${PEND:-0},"
INV+="\"firewall\":$(json_escape "$FW_OBSERVED"),"
INV+="\"vpn\":${VPN_INV},\"passwordManagers\":${PWDMGR_INV},\"browsers\":[${BROWSERS_JSON}],"
INV+="\"software\":[${SOFTWARE_JSON}]}"

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
