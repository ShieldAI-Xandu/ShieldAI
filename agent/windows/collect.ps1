<#
  ShieldAI Windows Posture Collector
  ----------------------------------
  READ-ONLY. Collects security posture from built-in Windows tooling and the
  security products already installed (Microsoft Defender, firewall, BitLocker,
  Windows Update). Makes NO changes to the system.

  It does not scan for malware itself — it reports what Defender (or another
  registered AV) has already found and its current protection state.

  Output: a single JSON document (the ShieldAI agent report schema v1) written
  to -OutFile, or to stdout if -OutFile is omitted.

  Usage:
    powershell -ExecutionPolicy Bypass -File collect.ps1 -OutFile report.json

  Exit codes: 0 always (collection failures degrade to status "unknown" so the
  scheduled run never hard-fails; partial data is more useful than none).
#>

[CmdletBinding()]
param(
  [string]$OutFile = "",
  [string]$AgentVersion = "1.1.0"
)

$ErrorActionPreference = "SilentlyContinue"

# ── helpers ───────────────────────────────────────────────────
$checks    = New-Object System.Collections.ArrayList
$events    = New-Object System.Collections.ArrayList
$nowUtc    = (Get-Date).ToUniversalTime().ToString("o")

function Add-Check {
  param(
    [string]$Id, [string]$Category, [string]$Title,
    [ValidateSet("pass","warn","fail","unknown")][string]$Status,
    [ValidateSet("info","low","medium","high","critical")][string]$Severity = "info",
    [string]$Observed = "", [string]$Detail = "", [string]$CisControl = ""
  )
  [void]$checks.Add([ordered]@{
    id = $Id; category = $Category; title = $Title; status = $Status;
    severity = $Severity; observed = $Observed; detail = $Detail; cisControl = $CisControl
  })
}

function Add-Event {
  param([string]$Source, [string]$Severity, [string]$Type, [string]$Message, $Raw = $null)
  [void]$events.Add([ordered]@{
    ts = (Get-Date).ToUniversalTime().ToString("o");
    source = $Source; severity = $Severity; type = $Type; message = $Message; raw = $Raw
  })
}

# Safely run a scriptblock; on any error, invoke the provided fallback.
function Try-Run { param([scriptblock]$Do, [scriptblock]$OnError)
  try { & $Do } catch { if ($OnError) { & $OnError } }
}

# ── host info ─────────────────────────────────────────────────
$os   = Get-CimInstance Win32_OperatingSystem
$cs   = Get-CimInstance Win32_ComputerSystem
$boot = $null
# Plain try/catch, not Try-Run — see the note further down (AV productState
# decode) for why: Try-Run's scriptblock runs in a child scope, so
# `Try-Run { $boot = ... }` would silently never update this $boot.
try { $boot = $os.LastBootUpTime.ToUniversalTime().ToString("o") } catch { }

$hostInfo = [ordered]@{
  hostname     = $env:COMPUTERNAME
  os           = "windows"
  osVersion    = "$($os.Caption) $($os.Version)"
  arch         = $env:PROCESSOR_ARCHITECTURE
  lastBootUtc  = $boot
  collectedAtUtc = $nowUtc
}

$inventory = [ordered]@{
  # installedSecurityTools must be a mutable list (not a plain @() array) —
  # several checks below call .Add() on it, which throws on a fixed-size
  # array and was silently swallowed by the enclosing Try-Run, breaking AV
  # tool reporting.
  localAdmins = @(); installedSecurityTools = (New-Object System.Collections.ArrayList);
  diskEncryption = "unknown"; pendingPatches = 0; firewall = "unknown";
  software = @()
}

# ── 1a. Full AV/security product enumeration (Security Center) ──
# Windows Security Center tracks EVERY registered AV product on the
# machine — this is how we catch a third-party AV/EDR (Bitdefender, Norton,
# Sophos, CrowdStrike, SentinelOne, etc.) instead of only ever reporting
# Defender's state, which is what an SMB is actually protected by if
# they've replaced/augmented Defender. Runs BEFORE the Defender-specific
# block below because that block needs to know whether a third-party AV is
# active to correctly interpret Defender's own state (see the note there).
#
# Plain try/catch (not the Try-Run helper) for the CIM query itself —
# Try-Run invokes its scriptblock via `&`, which runs in a child scope, so
# `Try-Run { $avProducts = ... }` would silently never update $avProducts
# in the outer scope, same footgun documented elsewhere in this file for
# $boot/$age/$nlaOn.
$avProducts = @()
try {
  $avProducts = @(Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName AntiVirusProduct -ErrorAction Stop)
} catch {
  # Non-fatal: Security Center's WMI provider isn't present on Server SKUs
  # (no Action Center service) or may be restricted — the Defender-specific
  # checks below still provide baseline AV visibility in that case.
}

# Two passes: the first just decodes each product's real-time state so we
# know, BEFORE adding any check, whether a third-party AV is confirmed
# active — Defender's own Security-Center entry needs that fact to score
# itself correctly (see below), and depending on enumeration order Defender
# could come before the third-party product in $avProducts.
$decoded = @{}  # name -> { rtOn, defUpToDate }
foreach ($p in $avProducts) {
  $name = "$($p.displayName)".Trim()
  if ([string]::IsNullOrWhiteSpace($name) -or $decoded.ContainsKey($name)) { continue }
  $rtOn = $false; $defUpToDate = $false
  try {
    $stateHex = "{0:X6}" -f [int]$p.productState
    $rtOn = $stateHex.Substring(2,2) -in @("10","11")
    $defUpToDate = $stateHex.Substring(4,2) -eq "00"
  } catch { }
  $decoded[$name] = @{ rtOn = $rtOn; defUpToDate = $defUpToDate }
}
$activeThirdPartyAv = ($decoded.GetEnumerator() | Where-Object { $_.Value.rtOn -and $_.Key -ne "Windows Defender" } | Select-Object -First 1).Key

foreach ($name in $decoded.Keys) {
  if (-not ($inventory.installedSecurityTools -contains $name)) {
    [void]$inventory.installedSecurityTools.Add($name)
  }
  $rtOn = $decoded[$name].rtOn
  $defUpToDate = $decoded[$name].defUpToDate
  $statusText = "registered with Security Center"
  $checkStatus = "pass"; $checkSeverity = "info"
  if ($rtOn -and $defUpToDate) {
    $statusText = "enabled, definitions current"; $checkStatus = "pass"; $checkSeverity = "info"
  } elseif ($rtOn) {
    $statusText = "enabled, definitions may be stale"; $checkStatus = "warn"; $checkSeverity = "medium"
  } elseif ($name -eq "Windows Defender" -and $activeThirdPartyAv) {
    # Same passive-mode reasoning as av_realtime below: Defender showing
    # "disabled" here is EXPECTED when $activeThirdPartyAv is confirmed
    # active, not a gap — don't flag it as a high-severity failure.
    $statusText = "passive - $activeThirdPartyAv is the active antivirus"; $checkStatus = "pass"; $checkSeverity = "info"
  } else {
    $statusText = "protection appears disabled"; $checkStatus = "fail"; $checkSeverity = "high"
  }
  Add-Check -Id "av_product_$($name -replace '[^a-zA-Z0-9]','_')" -Category "Protect" `
    -Title "Registered AV product: $name" -Status $checkStatus -Severity $checkSeverity `
    -Observed $statusText -Detail "Reported by Windows Security Center." -CisControl "10"
}
if ($avProducts.Count -eq 0) {
  Add-Check -Id "av_registered" -Category "Protect" -Title "Registered AV products" `
    -Status "warn" -Severity "medium" -Observed "None registered with Security Center" `
    -Detail "No antivirus product is registered with Windows Security Center." -CisControl "10"
}

# ── 1b. Microsoft Defender's own detailed state ─────────────────
Try-Run {
  $mp = Get-MpComputerStatus
  if ($mp) {
    # Real-time protection. When a third-party AV (e.g. Bitdefender) is
    # installed, Windows correctly and intentionally puts Defender into
    # Passive Mode — RealTimeProtectionEnabled goes to $false as EXPECTED
    # behavior, not a protection gap. The old version of this check treated
    # that as an unconditional high-severity failure, which produced a
    # false "no real-time protection" finding on every machine running a
    # third-party AV — exactly the kind of false negative that made a
    # correctly-installed Bitdefender look like it wasn't being detected.
    # AMRunningMode (values: Normal | Passive Mode | SxS Passive Mode |
    # EDR Block Mode) is what tells us WHY it's off, so we can tell a real
    # gap apart from expected passive-mode behavior.
    $passiveMode = ($mp.PSObject.Properties.Name -contains "AMRunningMode") -and ($mp.AMRunningMode -ne "Normal")
    if ($mp.RealTimeProtectionEnabled) {
      Add-Check -Id "av_realtime" -Category "Protect" -Title "Antivirus real-time protection" `
        -Status "pass" -Severity "info" -Observed "Enabled (Microsoft Defender)" `
        -Detail "Microsoft Defender real-time protection is enabled." -CisControl "10"
    } elseif ($passiveMode -and $activeThirdPartyAv) {
      Add-Check -Id "av_realtime" -Category "Protect" -Title "Antivirus real-time protection" `
        -Status "pass" -Severity "info" -Observed "Enabled ($activeThirdPartyAv)" `
        -Detail "Defender is intentionally in $($mp.AMRunningMode) because $activeThirdPartyAv is the active antivirus — this is expected, not a gap. See the 'Registered AV product: $activeThirdPartyAv' check for its own status." -CisControl "10"
    } elseif ($passiveMode) {
      Add-Check -Id "av_realtime" -Category "Protect" -Title "Antivirus real-time protection" `
        -Status "warn" -Severity "medium" -Observed "Defender passive ($($mp.AMRunningMode)), no active third-party AV confirmed" `
        -Detail "Defender reports $($mp.AMRunningMode) but no other registered antivirus product could be confirmed active via Security Center — verify a real-time AV is actually running." -CisControl "10"
    } else {
      Add-Check -Id "av_realtime" -Category "Protect" -Title "Antivirus real-time protection" `
        -Status "fail" -Severity "high" -Observed "Disabled" `
        -Detail "Real-time protection is OFF and no other antivirus is active. The endpoint is not actively protected." -CisControl "10"
    }
    # Signature freshness
    $age = $null
    # Plain try/catch, not Try-Run — see the note further down (AV productState
    # decode) for why: Try-Run's scriptblock runs in a child scope, so this
    # assignment to $age would silently never reach the check below,
    # permanently disabling the signature-freshness check.
    try { $age = (New-TimeSpan -Start $mp.AntivirusSignatureLastUpdated -End (Get-Date)).Days } catch { }
    if ($age -ne $null) {
      if ($age -le 3) {
        Add-Check -Id "av_signatures" -Category "Protect" -Title "Antivirus signature freshness" `
          -Status "pass" -Severity "info" -Observed "$age day(s) old" `
          -Detail "Defender definitions are current." -CisControl "10"
      } elseif ($age -le 14) {
        Add-Check -Id "av_signatures" -Category "Protect" -Title "Antivirus signature freshness" `
          -Status "warn" -Severity "medium" -Observed "$age days old" `
          -Detail "Defender definitions are getting stale." -CisControl "10"
      } else {
        Add-Check -Id "av_signatures" -Category "Protect" -Title "Antivirus signature freshness" `
          -Status "fail" -Severity "high" -Observed "$age days old" `
          -Detail "Defender definitions are badly out of date." -CisControl "10"
      }
    }
    # Tamper protection
    if ($mp.PSObject.Properties.Name -contains "IsTamperProtected") {
      Add-Check -Id "av_tamper" -Category "Protect" -Title "Tamper protection" `
        -Status ($(if ($mp.IsTamperProtected) {"pass"} else {"warn"})) `
        -Severity ($(if ($mp.IsTamperProtected) {"info"} else {"medium"})) `
        -Observed ($(if ($mp.IsTamperProtected) {"Enabled"} else {"Disabled"})) `
        -Detail "Tamper protection prevents attackers disabling Defender." -CisControl "10"
    }
    [void]$inventory.installedSecurityTools.Add("Microsoft Defender")
  }
} {
  Add-Check -Id "av_realtime" -Category "Protect" -Title "Antivirus real-time protection" `
    -Status "unknown" -Severity "medium" -Observed "Not determinable" `
    -Detail "Could not query Defender directly. See the 'Registered AV product' checks above for what Security Center reports instead." -CisControl "10"
}

# Active/quarantined threats → events
Try-Run {
  $threats = Get-MpThreatDetection | Sort-Object InitialDetectionTime -Descending | Select-Object -First 25
  foreach ($t in $threats) {
    $name = $t.ThreatName; if (-not $name) { $name = "Unknown threat" }
    Add-Event -Source "defender" -Severity "high" -Type "malware_detected" `
      -Message "Defender detection: $name" -Raw ([ordered]@{
        threatId = $t.ThreatID; detectedAt = "$($t.InitialDetectionTime)";
        action = "$($t.CleaningActionID)"; resources = @($t.Resources)
      })
  }
  if ($threats -and $threats.Count -gt 0) {
    Add-Check -Id "av_threats" -Category "Detect" -Title "Recent malware detections" `
      -Status "warn" -Severity "high" -Observed "$($threats.Count) detection(s)" `
      -Detail "Defender has recorded recent threat detections; review the events list." -CisControl "10"
  } else {
    Add-Check -Id "av_threats" -Category "Detect" -Title "Recent malware detections" `
      -Status "pass" -Severity "info" -Observed "None recorded" `
      -Detail "No recent Defender threat detections." -CisControl "10"
  }
}

# ── 2. Firewall ───────────────────────────────────────────────
Try-Run {
  $profiles = Get-NetFirewallProfile
  $allOn = ($profiles | Where-Object { -not $_.Enabled } | Measure-Object).Count -eq 0
  $inventory.firewall = if ($allOn) { "all profiles enabled" } else { "one or more profiles disabled" }
  Add-Check -Id "firewall" -Category "Protect" -Title "Host firewall" `
    -Status ($(if ($allOn) {"pass"} else {"fail"})) `
    -Severity ($(if ($allOn) {"info"} else {"high"})) `
    -Observed $inventory.firewall `
    -Detail "Windows Firewall should be enabled on Domain, Private, and Public profiles." -CisControl "4"
} {
  Add-Check -Id "firewall" -Category "Protect" -Title "Host firewall" -Status "unknown" `
    -Severity "medium" -Observed "Not determinable" -Detail "Could not query firewall profiles." -CisControl "4"
}

# ── 3. Disk encryption (BitLocker) ────────────────────────────
Try-Run {
  $sys = $env:SystemDrive
  $vol = Get-BitLockerVolume -MountPoint $sys
  $on  = $vol.ProtectionStatus -eq "On"
  $inventory.diskEncryption = if ($on) { "BitLocker On ($sys)" } else { "BitLocker Off ($sys)" }
  Add-Check -Id "disk_encryption" -Category "Protect" -Title "Disk encryption" `
    -Status ($(if ($on) {"pass"} else {"fail"})) `
    -Severity ($(if ($on) {"info"} else {"high"})) `
    -Observed $inventory.diskEncryption `
    -Detail "The system drive should be encrypted to protect data at rest." -CisControl "3"
} {
  Add-Check -Id "disk_encryption" -Category "Protect" -Title "Disk encryption" -Status "unknown" `
    -Severity "medium" -Observed "Not determinable" `
    -Detail "Could not query BitLocker (may require elevation, or no TPM)." -CisControl "3"
}

# ── 4. Pending OS updates ─────────────────────────────────────
Try-Run {
  $session  = New-Object -ComObject Microsoft.Update.Session
  $searcher = $session.CreateUpdateSearcher()
  $result   = $searcher.Search("IsInstalled=0 and IsHidden=0")
  $count    = $result.Updates.Count
  $inventory.pendingPatches = [int]$count
  if ($count -eq 0) {
    Add-Check -Id "patches" -Category "Identify" -Title "Pending OS updates" `
      -Status "pass" -Severity "info" -Observed "0 pending" -Detail "No pending Windows updates." -CisControl "7"
  } elseif ($count -le 5) {
    Add-Check -Id "patches" -Category "Identify" -Title "Pending OS updates" `
      -Status "warn" -Severity "medium" -Observed "$count pending" -Detail "Some Windows updates are pending." -CisControl "7"
  } else {
    Add-Check -Id "patches" -Category "Identify" -Title "Pending OS updates" `
      -Status "fail" -Severity "high" -Observed "$count pending" -Detail "Many Windows updates are pending; patch promptly." -CisControl "7"
  }
} {
  Add-Check -Id "patches" -Category "Identify" -Title "Pending OS updates" -Status "unknown" `
    -Severity "low" -Observed "Not determinable" -Detail "Could not query Windows Update." -CisControl "7"
}

# ── 5. Local administrators ───────────────────────────────────
Try-Run {
  $admins = Get-LocalGroupMember -Group "Administrators" | ForEach-Object { $_.Name }
  $inventory.localAdmins = @($admins)
  $n = @($admins).Count
  Add-Check -Id "local_admins" -Category "Identify" -Title "Local administrator accounts" `
    -Status ($(if ($n -le 3) {"pass"} elseif ($n -le 6) {"warn"} else {"fail"})) `
    -Severity ($(if ($n -le 3) {"info"} elseif ($n -le 6) {"medium"} else {"high"})) `
    -Observed "$n admin account(s)" `
    -Detail "Limit local admin rights to the minimum necessary (least privilege)." -CisControl "5"
} {
  Add-Check -Id "local_admins" -Category "Identify" -Title "Local administrator accounts" -Status "unknown" `
    -Severity "low" -Observed "Not determinable" -Detail "Could not enumerate local Administrators group." -CisControl "5"
}

# ── 6. Screen lock / inactivity timeout ───────────────────────
Try-Run {
  $val = (Get-ItemProperty "HKCU:\Control Panel\Desktop" -Name ScreenSaveActive).ScreenSaveActive
  $sec = (Get-ItemProperty "HKCU:\Control Panel\Desktop" -Name ScreenSaveTimeOut).ScreenSaveTimeOut
  $secure = (Get-ItemProperty "HKCU:\Control Panel\Desktop" -Name ScreenSaverIsSecure).ScreenSaverIsSecure
  $ok = ($val -eq 1 -and [int]$sec -le 900 -and $secure -eq 1)
  Add-Check -Id "screen_lock" -Category "Protect" -Title "Automatic screen lock" `
    -Status ($(if ($ok) {"pass"} else {"warn"})) `
    -Severity ($(if ($ok) {"info"} else {"low"})) `
    -Observed ($(if ($ok) {"Secured, <=15 min"} else {"Not enforced / too long"})) `
    -Detail "Screens should auto-lock after a short idle period and require a password." -CisControl "4"
}

# ── 7. Guest account ────────────────────────────────────────────
Try-Run {
  $guest = Get-LocalUser -Name "Guest" -ErrorAction Stop
  Add-Check -Id "guest_account" -Category "Protect" -Title "Guest account disabled" `
    -Status ($(if (-not $guest.Enabled) {"pass"} else {"fail"})) `
    -Severity ($(if (-not $guest.Enabled) {"info"} else {"high"})) `
    -Observed ($(if ($guest.Enabled) {"Enabled"} else {"Disabled"})) `
    -Detail "The built-in Guest account should stay disabled - it's a common low-friction entry point." -CisControl "5"
} {
  Add-Check -Id "guest_account" -Category "Protect" -Title "Guest account disabled" -Status "unknown" `
    -Severity "low" -Observed "Not determinable" -Detail "Could not query the local Guest account." -CisControl "5"
}

# ── 8. Legacy SMBv1 protocol ────────────────────────────────────
Try-Run {
  $smb1 = Get-WindowsOptionalFeature -Online -FeatureName "SMB1Protocol" -ErrorAction Stop
  $on = $smb1.State -eq "Enabled"
  Add-Check -Id "smb1" -Category "Protect" -Title "Legacy SMBv1 protocol" `
    -Status ($(if (-not $on) {"pass"} else {"fail"})) `
    -Severity ($(if (-not $on) {"info"} else {"critical"})) `
    -Observed ($(if ($on) {"Enabled"} else {"Disabled"})) `
    -Detail "SMBv1 is a legacy, vulnerable protocol (e.g. EternalBlue/WannaCry) and should stay disabled unless a specific legacy device requires it." -CisControl "4"
} {
  Add-Check -Id "smb1" -Category "Protect" -Title "Legacy SMBv1 protocol" -Status "unknown" `
    -Severity "low" -Observed "Not determinable" -Detail "Could not query the SMB1Protocol optional feature." -CisControl "4"
}

# ── 9. Remote Desktop (RDP) exposure ────────────────────────────
Try-Run {
  $rdpDeny = (Get-ItemProperty "HKLM:\System\CurrentControlSet\Control\Terminal Server" -Name "fDenyTSConnections" -ErrorAction Stop).fDenyTSConnections
  if ($rdpDeny -eq 0) {
    $nlaOn = $false
    # Plain try/catch, not Try-Run — see the note above the AV productState
    # decode for why: Try-Run's scriptblock invocation would shadow $nlaOn
    # instead of updating it.
    try {
      $nlaOn = ((Get-ItemProperty "HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp" -Name "UserAuthentication" -ErrorAction Stop).UserAuthentication -eq 1)
    } catch { }
    Add-Check -Id "rdp_exposure" -Category "Protect" -Title "Remote Desktop (RDP)" `
      -Status ($(if ($nlaOn) {"warn"} else {"fail"})) `
      -Severity ($(if ($nlaOn) {"medium"} else {"critical"})) `
      -Observed ($(if ($nlaOn) {"Enabled, NLA required"} else {"Enabled, NLA NOT required"})) `
      -Detail "RDP is a common ransomware entry point. If it must stay enabled, Network Level Authentication should be required and access restricted (VPN/firewall)." -CisControl "4"
  } else {
    Add-Check -Id "rdp_exposure" -Category "Protect" -Title "Remote Desktop (RDP)" `
      -Status "pass" -Severity "info" -Observed "Disabled" -Detail "Remote Desktop is disabled." -CisControl "4"
  }
} {
  Add-Check -Id "rdp_exposure" -Category "Protect" -Title "Remote Desktop (RDP)" -Status "unknown" `
    -Severity "low" -Observed "Not determinable" -Detail "Could not query Remote Desktop configuration." -CisControl "4"
}

# ── 10. Installed software inventory (read-only) ───────────────
# Enumerates installed applications with versions from the registry uninstall
# keys — the standard, fast, read-only method (avoids the slow Win32_Product
# WMI query, which can trigger MSI reconfiguration). Covers 64-bit, 32-bit, and
# per-user installs. This feeds ShieldAI's CVE matching (name + version -> NVD).
Try-Run {
  $paths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  $seen = @{}
  $sw = New-Object System.Collections.ArrayList
  foreach ($p in $paths) {
    Get-ItemProperty $p -ErrorAction SilentlyContinue | ForEach-Object {
      $name = $_.DisplayName
      $ver  = $_.DisplayVersion
      # Skip entries with no name, system components, and updates/hotfixes.
      if ([string]::IsNullOrWhiteSpace($name)) { return }
      if ($_.SystemComponent -eq 1) { return }
      if ($name -match "^(KB\d+|Security Update|Update for|Hotfix)") { return }
      $key = "$name|$ver"
      if ($seen.ContainsKey($key)) { return }
      $seen[$key] = $true
      [void]$sw.Add([ordered]@{
        name    = "$name".Trim()
        version = if ([string]::IsNullOrWhiteSpace($ver)) { "" } else { "$ver".Trim() }
      })
    }
  }
  # Cap the list to keep report payloads reasonable; most relevant for CVEs are
  # the named third-party apps, which this comfortably covers.
  $inventory.software = @($sw | Sort-Object { $_.name } | Select-Object -First 200)
} {
  # Non-fatal: if the scan fails, software stays an empty array (honest — no
  # fabricated inventory), and CVE matching falls back to OS + assessment data.
  $inventory.software = @()
}

# ── assemble report ───────────────────────────────────────────
$report = [ordered]@{
  agentVersion = $AgentVersion
  schema       = 1
  host         = $hostInfo
  checks       = $checks
  events       = $events
  inventory    = $inventory
}

$json = $report | ConvertTo-Json -Depth 8

if ($OutFile -ne "") {
  $json | Out-File -FilePath $OutFile -Encoding utf8
  Write-Host "ShieldAI report written to $OutFile ($($checks.Count) checks, $($events.Count) events)."
} else {
  Write-Output $json
}

exit 0
