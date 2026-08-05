<#
  ShieldAI Windows Agent Runner
  -----------------------------
  Invoked on a schedule by the installed Scheduled Task. It:
    1. Ensures the agent is enrolled (exchanges a one-time enrollment token for a
       durable agent token on first run; reuses the stored token thereafter).
    2. Runs collect.ps1 to gather posture.
    3. Uploads the report to the ShieldAI backend.

  Config & state live in a per-machine data dir (default: C:\ProgramData\ShieldAI).
    - config.json : { serverUrl, enrollmentToken? }   (enrollmentToken removed after use)
    - agent.json  : { agentId, agentToken }            (created on enrollment; secured)

  Nothing here modifies the monitored system; it only reads posture and sends it.
#>

[CmdletBinding()]
param(
  [string]$DataDir = "$env:ProgramData\ShieldAI"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Read-Json($path) {
  if (Test-Path $path) { return (Get-Content $path -Raw | ConvertFrom-Json) }
  return $null
}
function Write-Json($path, $obj) {
  $obj | ConvertTo-Json -Depth 8 | Out-File -FilePath $path -Encoding utf8
}

# Lock down the agent token file so only SYSTEM/Administrators can read it.
function Protect-File($path) {
  Try {
    icacls $path /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(R)" | Out-Null
  } Catch { }
}

$configPath = Join-Path $DataDir "config.json"
$agentPath  = Join-Path $DataDir "agent.json"

if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }
$config = Read-Json $configPath
if (-not $config -or -not $config.serverUrl) {
  Write-Error "Missing config.json with serverUrl in $DataDir. Run the installer first."
  exit 1
}
$serverUrl = $config.serverUrl.TrimEnd("/")

# ── 1. Enrollment (first run only) ────────────────────────────
$agent = Read-Json $agentPath
if (-not $agent -or -not $agent.agentToken) {
  if (-not $config.enrollmentToken) {
    Write-Error "Not enrolled and no enrollmentToken present. Re-run the installer with a fresh token."
    exit 1
  }
  $body = @{
    enrollmentToken = $config.enrollmentToken
    hostname        = $env:COMPUTERNAME
    os              = "windows"
  } | ConvertTo-Json
  try {
    $resp = Invoke-RestMethod -Method Post -Uri "$serverUrl/api/agent/enroll" `
      -ContentType "application/json" -Body $body
  } catch {
    Write-Error "Enrollment failed: $($_.Exception.Message)"
    exit 1
  }
  $agent = @{ agentId = $resp.agentId; agentToken = $resp.agentToken }
  Write-Json $agentPath $agent
  Protect-File $agentPath
  # Burn the one-time enrollment token from config so it can't be reused.
  $config.PSObject.Properties.Remove("enrollmentToken")
  Write-Json $configPath $config
  Write-Host "Enrolled successfully as agent $($agent.agentId)."
}

# ── 2. Collect ────────────────────────────────────────────────
$reportPath = Join-Path $env:TEMP ("shieldai_report_{0}.json" -f ([guid]::NewGuid().ToString("N")))
& powershell -ExecutionPolicy Bypass -File (Join-Path $here "collect.ps1") -OutFile $reportPath | Out-Null
if (-not (Test-Path $reportPath)) { Write-Error "Collection produced no report."; exit 1 }
$report = Get-Content $reportPath -Raw

# ── 3. Upload ─────────────────────────────────────────────────
try {
  Invoke-RestMethod -Method Post -Uri "$serverUrl/api/agent/report" `
    -Headers @{ Authorization = "Bearer $($agent.agentToken)" } `
    -ContentType "application/json" -Body $report | Out-Null
  Write-Host "Report uploaded."
} catch {
  $code = $_.Exception.Response.StatusCode.value__ 2>$null
  if ($code -eq 401 -or $code -eq 403) {
    Write-Error "Agent token rejected (revoked or invalid). Re-enrollment required."
  } else {
    Write-Error "Upload failed: $($_.Exception.Message)"
  }
  Remove-Item $reportPath -Force -ErrorAction SilentlyContinue
  exit 1
} finally {
  Remove-Item $reportPath -Force -ErrorAction SilentlyContinue
}

exit 0
