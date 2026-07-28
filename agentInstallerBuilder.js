// agentInstallerBuilder.js
// Builds a SINGLE self-contained, pre-configured installer script per OS, so
// a client only has to download and run one file — no zip, no extraction,
// no copy/pasting flags. The collector + runner scripts (source of truth in
// agent/<os>/ and agent/shared/) are embedded verbatim into the generated
// file; nothing here changes what they collect or how the agent behaves,
// only how the installer is packaged and delivered.

import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_SRC_DIR = path.join(__dirname, "agent");

async function readAgentFile(relPath) {
  return readFile(path.join(AGENT_SRC_DIR, relPath), "utf8");
}

// Guard against embedded script content ever containing a line that would
// prematurely close a here-string/heredoc. Static source files today don't,
// but this fails loudly instead of silently shipping a corrupt installer if
// that ever changes.
function assertNoTerminatorCollision(content, marker, where) {
  const lines = content.split(/\r?\n/);
  if (lines.some(l => l.trim() === marker)) {
    throw new Error(`Embedded content in ${where} collides with terminator "${marker}" — cannot safely embed.`);
  }
}

// PowerShell single-quoted string literal: only ' needs escaping (doubled).
function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

// POSIX shell single-quoted string literal: close quote, escaped quote, reopen.
function shQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

function normalizeInterval(intervalMinutes) {
  const n = Math.floor(Number(intervalMinutes));
  return Number.isFinite(n) && n > 0 ? n : 60;
}

async function buildWindowsInstaller({ serverUrl, enrollmentToken, intervalMinutes }) {
  const collectPs1 = await readAgentFile("windows/collect.ps1");
  const agentRunPs1 = await readAgentFile("windows/agent-run.ps1");
  assertNoTerminatorCollision(collectPs1, "'@", "windows/collect.ps1");
  assertNoTerminatorCollision(agentRunPs1, "'@", "windows/agent-run.ps1");

  const interval = normalizeInterval(intervalMinutes);
  const lines = [
    "<#",
    "  ShieldAI Windows Agent Installer — self-contained, pre-configured for this endpoint.",
    "  Just run from an elevated (Administrator) PowerShell:",
    "    powershell -ExecutionPolicy Bypass -File .\\ShieldAI-Install.ps1",
    "  No other files are needed — the collector and runner are embedded below.",
    "#>",
    "",
    "[CmdletBinding()]",
    "param(",
    `  [string]$ServerUrl = ${psQuote(serverUrl)},`,
    `  [string]$EnrollmentToken = ${psQuote(enrollmentToken)},`,
    `  [int]$IntervalMinutes = ${interval},`,
    '  [string]$DataDir = "$env:ProgramData\\ShieldAI",',
    '  [string]$InstallDir = "$env:ProgramFiles\\ShieldAI\\agent"',
    ")",
    "",
    '$ErrorActionPreference = "Stop"',
    "",
    "$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())",
    "if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {",
    '  Write-Error "Please run this installer from an elevated (Administrator) PowerShell."',
    "  exit 1",
    "}",
    "",
    "New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null",
    "",
    "@'",
    collectPs1,
    "'@ | Set-Content -Path (Join-Path $InstallDir \"collect.ps1\") -Encoding utf8",
    "",
    "@'",
    agentRunPs1,
    "'@ | Set-Content -Path (Join-Path $InstallDir \"agent-run.ps1\") -Encoding utf8",
    "",
    "New-Item -ItemType Directory -Path $DataDir -Force | Out-Null",
    '@{ serverUrl = $ServerUrl; enrollmentToken = $EnrollmentToken } | ConvertTo-Json | Out-File -FilePath (Join-Path $DataDir "config.json") -Encoding utf8',
    "",
    '$taskName = "ShieldAI Agent"',
    '$agentRunPath = Join-Path $InstallDir "agent-run.ps1"',
    '$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$agentRunPath`""',
    "$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)",
    '$principalDef = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest',
    "$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)",
    "",
    "Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue",
    "Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principalDef -Settings $settings | Out-Null",
    "Start-ScheduledTask -TaskName $taskName",
    "",
    'Write-Host "ShieldAI Agent installed."',
    'Write-Host "  Scripts:  $InstallDir"',
    'Write-Host "  Data:     $DataDir"',
    'Write-Host "  Schedule: every $IntervalMinutes minute(s) as SYSTEM"',
    'Write-Host "It will enroll and send its first report within ~1 minute."',
    "",
  ];

  return { filename: "ShieldAI-Install.ps1", content: lines.join("\n"), contentType: "text/plain; charset=utf-8" };
}

const UNIX_OS_CONFIG = {
  linux: {
    installDir: "/opt/shieldai/agent",
    dataDir: "/etc/shieldai",
    collectSrc: "linux/collect.sh",
    schedulerBlock: (interval) => [
      'cat > /etc/systemd/system/shieldai-agent.service <<EOF',
      "[Unit]",
      "Description=ShieldAI posture collection agent (read-only)",
      "After=network-online.target",
      "Wants=network-online.target",
      "",
      "[Service]",
      "Type=oneshot",
      "Environment=SHIELDAI_DATA_DIR=$DATA_DIR",
      "ExecStart=/usr/bin/env bash $INSTALL_DIR/agent-run.sh",
      "Nice=10",
      "EOF",
      "",
      'cat > /etc/systemd/system/shieldai-agent.timer <<EOF',
      "[Unit]",
      `Description=Run ShieldAI agent every ${interval} minute(s)`,
      "",
      "[Timer]",
      "OnBootSec=1min",
      `OnUnitActiveSec=${interval}min`,
      "AccuracySec=30s",
      "Persistent=true",
      "",
      "[Install]",
      "WantedBy=timers.target",
      "EOF",
      "",
      "systemctl daemon-reload",
      "systemctl enable --now shieldai-agent.timer",
      "systemctl start shieldai-agent.service || true",
      "",
      'echo "ShieldAI Agent installed."',
      'echo "  Scripts:  $INSTALL_DIR"',
      'echo "  Data:     $DATA_DIR"',
      `echo "  Schedule: every ${interval} minute(s) via systemd timer"`,
      'echo "  Status:   systemctl status shieldai-agent.timer"',
      'echo "  Logs:     journalctl -u shieldai-agent.service"',
    ],
    preflight: ['command -v systemctl >/dev/null 2>&1 || { echo "systemd (systemctl) is required." >&2; exit 1; }'],
  },
  macos: {
    installDir: "/usr/local/shieldai/agent",
    dataDir: "/etc/shieldai",
    collectSrc: "macOS/collect.sh",
    schedulerBlock: (interval) => [
      'PLIST="/Library/LaunchDaemons/com.shieldai.agent.plist"',
      'LABEL="com.shieldai.agent"',
      `INTERVAL_SEC=$(( ${interval} * 60 ))`,
      "",
      'cat > "$PLIST" <<EOF',
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      "<dict>",
      "  <key>Label</key><string>$LABEL</string>",
      "  <key>EnvironmentVariables</key>",
      "  <dict><key>SHIELDAI_DATA_DIR</key><string>$DATA_DIR</string></dict>",
      "  <key>ProgramArguments</key>",
      "  <array>",
      "    <string>/bin/bash</string>",
      "    <string>$INSTALL_DIR/agent-run.sh</string>",
      "  </array>",
      "  <key>StartInterval</key><integer>$INTERVAL_SEC</integer>",
      "  <key>RunAtLoad</key><true/>",
      "  <key>StandardOutPath</key><string>/var/log/shieldai-agent.log</string>",
      "  <key>StandardErrorPath</key><string>/var/log/shieldai-agent.log</string>",
      "</dict>",
      "</plist>",
      "EOF",
      'chmod 644 "$PLIST"',
      "",
      'launchctl unload "$PLIST" 2>/dev/null || true',
      'launchctl load -w "$PLIST"',
      "",
      'echo "ShieldAI Agent installed."',
      'echo "  Scripts:  $INSTALL_DIR"',
      'echo "  Data:     $DATA_DIR"',
      `echo "  Schedule: every ${interval} minute(s) via launchd ($LABEL)"`,
      'echo "  Logs:     /var/log/shieldai-agent.log"',
      'echo "It will enroll and send its first report shortly."',
    ],
    preflight: [],
  },
};

async function buildUnixInstaller(os, { serverUrl, enrollmentToken, intervalMinutes }) {
  const cfg = UNIX_OS_CONFIG[os];
  const collectSh = await readAgentFile(cfg.collectSrc);
  const agentRunSh = await readAgentFile("shared/agent-run.sh");
  const COLLECT_MARKER = "__SHIELDAI_COLLECT_EOF__";
  const RUN_MARKER = "__SHIELDAI_RUN_EOF__";
  assertNoTerminatorCollision(collectSh, COLLECT_MARKER, cfg.collectSrc);
  assertNoTerminatorCollision(agentRunSh, RUN_MARKER, "shared/agent-run.sh");

  const interval = normalizeInterval(intervalMinutes);
  const lines = [
    "#!/usr/bin/env bash",
    `# ShieldAI ${os === "linux" ? "Linux" : "macOS"} Agent Installer — self-contained, pre-configured for this endpoint.`,
    `# Just run: sudo bash ShieldAI-Install-${os}.sh`,
    "# No other files are needed — the collector and runner are embedded below.",
    "set -euo pipefail",
    "",
    `SERVER_URL=${shQuote(serverUrl)}`,
    `ENROLL_TOKEN=${shQuote(enrollmentToken)}`,
    `INTERVAL=${interval}`,
    `INSTALL_DIR=${shQuote(cfg.installDir)}`,
    `DATA_DIR=${shQuote(cfg.dataDir)}`,
    "",
    '[ "$(id -u)" -eq 0 ] || { echo "Please run as root (sudo)." >&2; exit 1; }',
    ...cfg.preflight,
    "",
    "mkdir -p \"$INSTALL_DIR\"",
    `cat > "$INSTALL_DIR/collect.sh" <<'${COLLECT_MARKER}'`,
    collectSh,
    COLLECT_MARKER,
    'chmod 0755 "$INSTALL_DIR/collect.sh"',
    "",
    `cat > "$INSTALL_DIR/agent-run.sh" <<'${RUN_MARKER}'`,
    agentRunSh,
    RUN_MARKER,
    'chmod 0755 "$INSTALL_DIR/agent-run.sh"',
    "",
    'mkdir -p "$DATA_DIR"',
    "umask 077",
    'cat > "$DATA_DIR/config.json" <<EOF',
    '{"serverUrl":"$SERVER_URL","enrollmentToken":"$ENROLL_TOKEN"}',
    "EOF",
    'chmod 600 "$DATA_DIR/config.json"',
    "",
    ...cfg.schedulerBlock(interval),
    "",
  ];

  return {
    filename: `ShieldAI-Install-${os}.sh`,
    content: lines.join("\n"),
    contentType: "text/plain; charset=utf-8",
  };
}

// Build a single, ready-to-run installer for the given OS. Throws on
// missing/invalid input — callers should validate os/serverUrl/enrollmentToken
// before calling, or catch and surface a 400.
export async function buildInstaller(os, { serverUrl, enrollmentToken, intervalMinutes }) {
  if (!serverUrl) throw new Error("serverUrl is required.");
  if (!enrollmentToken) throw new Error("enrollmentToken is required.");
  if (os === "windows") return buildWindowsInstaller({ serverUrl, enrollmentToken, intervalMinutes });
  if (os === "linux" || os === "macos") return buildUnixInstaller(os, { serverUrl, enrollmentToken, intervalMinutes });
  throw new Error("Unsupported OS. Use windows, linux, or macos.");
}
