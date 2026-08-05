; ============================================================================
;  ShieldAI Agent — Windows Installer (Inno Setup script)
; ----------------------------------------------------------------------------
;  Produces a single double-clickable Setup.exe for non-technical endpoint
;  installs. The tech-side logic (copy scripts, write config, register the
;  scheduled task) is UNCHANGED — this just wraps install.ps1 in a GUI so a
;  client never has to open PowerShell or type a command.
;
;  What the person running Setup.exe sees:
;    Welcome  ->  paste Enrollment Token  ->  Install  ->  Done
;
;  What happens under the hood (identical to the manual process):
;    1. Extracts install.ps1 / agent-run.ps1 / collect.ps1 to a staging folder
;    2. Runs install.ps1 with -ServerUrl (baked in) and -EnrollmentToken
;       (from the wizard field), exactly as documented in INSTALL_CHECKLIST.md
;    3. install.ps1 does its normal job: copies scripts to
;       C:\Program Files\ShieldAI\agent, writes C:\ProgramData\ShieldAI\config.json,
;       registers the "ShieldAI Agent" Scheduled Task as SYSTEM, kicks off the
;       first run.
;
;  BUILD INSTRUCTIONS: see README-BUILD-INSTALLER.md in this same folder.
; ============================================================================

#define MyAppName "ShieldAI Agent"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Xandu Limited LLC"
#define MyDefaultServerUrl "https://shieldai-production-627e.up.railway.app"

[Setup]
AppId={{C08485EF-6C5A-4EE8-A90B-D6CB3A704133}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL=https://shieldai-production-627e.up.railway.app
DefaultDirName={autopf}\ShieldAI\Installer
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableWelcomePage=no
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=Output
OutputBaseFilename=ShieldAI-Agent-Setup
SetupIconFile=shieldai.ico
UninstallDisplayIcon={app}\shieldai.ico
UninstallDisplayName={#MyAppName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
; This is an agent installer, not a user-facing application — no Start Menu
; shortcuts, no "Launch" checkbox, nothing to pin.
Uninstallable=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "agent-src\install.ps1";    DestDir: "{app}"; Flags: ignoreversion
Source: "agent-src\agent-run.ps1";  DestDir: "{app}"; Flags: ignoreversion
Source: "agent-src\collect.ps1";    DestDir: "{app}"; Flags: ignoreversion
Source: "shieldai.ico";             DestDir: "{app}"; Flags: ignoreversion

[Code]
var
  TokenPage: TInputQueryWizardPage;

{ Allows overriding the server URL for internal/staging test installs:
    ShieldAI-Agent-Setup.exe /ServerURL=http://localhost:3001
  Clients never need to know this exists; production is the default. }
function GetServerURL(Param: string): string;
begin
  Result := ExpandConstant('{param:ServerURL|{#MyDefaultServerUrl}}');
end;

function GetToken(Param: string): string;
begin
  Result := Trim(TokenPage.Values[0]);
end;

procedure InitializeWizard;
begin
  TokenPage := CreateInputQueryPage(wpWelcome,
    'Connect This Computer to ShieldAI',
    'Paste the one-time enrollment token for this endpoint',
    'In your ShieldAI dashboard, go to Endpoints -> Add Endpoint, then click ' +
    'Copy next to the enrollment token it generates. Paste it below. ' +
    'The token is single-use and expires about 60 minutes after it''s created, ' +
    'so generate it right before running this installer.');
  TokenPage.Add('Enrollment token:', False);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = TokenPage.ID then
  begin
    if Trim(TokenPage.Values[0]) = '' then
    begin
      MsgBox('Please paste the enrollment token before continuing. ' +
             'You can find it on the Endpoints page of your ShieldAI dashboard.',
             mbError, MB_OK);
      Result := False;
    end;
  end;
end;

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install.ps1"" -ServerUrl ""{code:GetServerURL}"" -EnrollmentToken ""{code:GetToken}"" -IntervalMinutes 60"; \
  StatusMsg: "Enrolling this computer with ShieldAI and starting the agent..."; \
  Flags: runhidden waituntilterminated

[UninstallRun]
; Mirrors the manual teardown steps from INSTALL_CHECKLIST.md: revoke on the
; Endpoints page first (stops it being accepted), then this removes the
; scheduled task and both install locations.
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Unregister-ScheduledTask -TaskName 'ShieldAI Agent' -Confirm:$false -ErrorAction SilentlyContinue; Remove-Item -Recurse -Force '$env:ProgramFiles\ShieldAI' -ErrorAction SilentlyContinue; Remove-Item -Recurse -Force '$env:ProgramData\ShieldAI' -ErrorAction SilentlyContinue"""; \
  Flags: runhidden waituntilterminated
