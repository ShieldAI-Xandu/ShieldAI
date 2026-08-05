<#
  ShieldAI Windows Agent Installer
  --------------------------------
  Installs the collector + runner into ProgramData, writes config, and registers
  a Scheduled Task that runs the agent every N minutes as SYSTEM. Must be run
  from an elevated (Administrator) PowerShell.

  Example:
    powershell -ExecutionPolicy Bypass -File install.ps1 `
      -ServerUrl "https://app.shieldai.example" `
      -EnrollmentToken "PASTE-ONE-TIME-TOKEN" `
      -IntervalMinutes 60

  The EnrollmentToken comes from the client admin account ("Add Endpoint").
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ServerUrl,
  [Parameter(Mandatory=$true)][string]$EnrollmentToken,
  [int]$IntervalMinutes = 60,
  [string]$DataDir = "$env:ProgramData\ShieldAI",
  [string]$InstallDir = "$env:ProgramFiles\ShieldAI\agent"
)

$ErrorActionPreference = "Stop"

# Require elevation (Scheduled Task as SYSTEM + ProgramFiles write).
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "Please run this installer from an elevated (Administrator) PowerShell."
  exit 1
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. Copy agent scripts into place
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item (Join-Path $here "collect.ps1")   (Join-Path $InstallDir "collect.ps1")   -Force
Copy-Item (Join-Path $here "agent-run.ps1") (Join-Path $InstallDir "agent-run.ps1") -Force

# 2. Write config (server URL + one-time enrollment token)
New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
@{ serverUrl = $ServerUrl; enrollmentToken = $EnrollmentToken } |
  ConvertTo-Json | Out-File -FilePath (Join-Path $DataDir "config.json") -Encoding utf8

# 3. Register the Scheduled Task (runs as SYSTEM, repeats every N minutes)
$taskName = "ShieldAI Agent"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$InstallDir\agent-run.ps1`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$principalDef = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $principalDef -Settings $settings | Out-Null

# 4. Kick off an immediate first run so it enrolls now
Start-ScheduledTask -TaskName $taskName

Write-Host "ShieldAI Agent installed."
Write-Host "  Scripts:  $InstallDir"
Write-Host "  Data:     $DataDir"
Write-Host "  Schedule: every $IntervalMinutes minute(s) as SYSTEM"
Write-Host "It will enroll and send its first report within ~1 minute."
