// cloudAdapters.js
// Per-provider connectors for cloudRoutes.js: pull cloud-infrastructure
// security-posture facts (IAM/MFA hygiene, public storage exposure,
// wide-open network rules, audit-logging coverage) from a client's own AWS
// account or Azure subscription.
//
// SCOPE BOUNDARY (read this before adding a provider or a permission): every
// permission requested below is READ-ONLY — AWS's own managed `SecurityAudit`
// policy, and Azure's built-in `Reader` role. This file must never request a
// write/management permission. Same underlying rule directoryAdapters.js
// documents: a pull-based connector observes a client's environment, it
// never changes it — consistent with the "AI advises, humans act" boundary
// CLAUDE.md documents for the monitoring agent.
//
// CREDENTIAL MODEL: unlike directoryAdapters.js's M365/Google/Zoom, neither
// AWS nor Azure offers a per-end-user OAuth consent flow for their
// management/security APIs — both providers' own tooling in this space
// (and every competitor researched) uses a long-lived, pasted, read-only
// credential instead. This mirrors directoryAdapters.js's Okta path exactly
// (`kind: "token"`), not its OAuth path. A cross-account IAM-role-assumption
// model (AWS) or a broader delegated-admin model (Azure) would remove the
// long-lived-key trade-off, but requires ShieldAI to operate its own trusted
// cloud principal — a real future iteration, not v1.
//
// Severity is computed HERE, deterministically, from facts the vendor API
// actually returned — never inferred by the AI layer, mirroring
// directoryAdapters.js/integrationAdapters.js/cveService.js.
//
// CONFIDENCE NOTE: field names/API shapes below are sourced from each
// vendor's public API docs as of this writing, not verified against a live
// AWS account or Azure subscription. Same caveat directoryAdapters.js
// already carries for its own three providers — verify against a real
// account/subscription before trusting blindly.
//
// V1 SCOPE NOTE: AWS's EC2/CloudTrail checks below run against ONE region
// (the connection's stored `region`, defaulting to us-east-1) — full
// multi-region coverage is a later iteration, not silently claimed here.
// Azure's checks run at the subscription scope, which is inherently
// region-agnostic for the resource types checked.

import { IAMClient, GetAccountSummaryCommand, GetAccountPasswordPolicyCommand, ListUsersCommand, ListMFADevicesCommand } from "@aws-sdk/client-iam";
import { S3Client, ListBucketsCommand, GetPublicAccessBlockCommand } from "@aws-sdk/client-s3";
import { EC2Client, DescribeSecurityGroupsCommand } from "@aws-sdk/client-ec2";
import { CloudTrailClient, DescribeTrailsCommand } from "@aws-sdk/client-cloudtrail";

const CANON_SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);
function sev(s) {
  const v = String(s || "").toLowerCase().trim();
  return CANON_SEVERITIES.has(v) ? v : "info";
}

function finding({ externalId, title, severity, host = null, cve = null, message, raw }) {
  return { externalId, title, severity: sev(severity), category: "cloud", host, cve, message, raw };
}

const SENSITIVE_PORTS = [
  { name: "SSH", port: 22 },
  { name: "RDP", port: 3389 },
];

function portInRange(from, to, port) {
  if (from == null || to == null) return true; // no port restriction on the rule = all ports
  return port >= from && port <= to;
}

// ── AWS ──────────────────────────────────────────────────────────────
// Source: docs.aws.amazon.com API references (IAM, S3, EC2, CloudTrail).
// Credential: a static Access Key ID + Secret Access Key for an IAM user
// with AWS's managed `SecurityAudit` policy attached
// (arn:aws:iam::aws:policy/SecurityAudit) — read-only by AWS's own design.
export async function fetchAwsPosture({ accessKeyId, secretAccessKey, region }) {
  const credentials = { accessKeyId, secretAccessKey };
  const awsRegion = region || "us-east-1";

  const iam = new IAMClient({ credentials, region: "us-east-1" }); // IAM is a global service; any region works
  const s3 = new S3Client({ credentials, region: "us-east-1" });
  const ec2 = new EC2Client({ credentials, region: awsRegion });
  const cloudtrail = new CloudTrailClient({ credentials, region: awsRegion });

  const [accountSummary, passwordPolicy, users, buckets, securityGroups, trails] = await Promise.all([
    iam.send(new GetAccountSummaryCommand({})),
    iam.send(new GetAccountPasswordPolicyCommand({})).catch(err => {
      // NoSuchEntityException means no custom password policy is set — a
      // real, reportable finding, not a failure. Any other error propagates.
      if (err.name === "NoSuchEntityException") return null;
      throw err;
    }),
    iam.send(new ListUsersCommand({ MaxItems: 100 })),
    s3.send(new ListBucketsCommand({})),
    ec2.send(new DescribeSecurityGroupsCommand({})),
    cloudtrail.send(new DescribeTrailsCommand({})),
  ]);

  // Per-user MFA device check — capped to the first 50 IAM users for a
  // single sync (SMB-scale accounts; a higher cap would mean an unbounded
  // number of calls per sync). Same "top N, say so" honesty pattern as
  // directoryAdapters.js's Graph/Okta calls.
  const usersToCheck = (users.Users || []).slice(0, 50);
  const mfaChecks = await Promise.all(usersToCheck.map(async u => {
    try {
      const devices = await iam.send(new ListMFADevicesCommand({ UserName: u.UserName }));
      return { userName: u.UserName, hasMfa: (devices.MFADevices || []).length > 0 };
    } catch {
      return { userName: u.UserName, hasMfa: null }; // couldn't determine — never assume
    }
  }));

  // Public-access-block check — capped to the first 50 buckets, same reasoning.
  const bucketsToCheck = (buckets.Buckets || []).slice(0, 50);
  const bucketChecks = await Promise.all(bucketsToCheck.map(async b => {
    try {
      const pab = await s3.send(new GetPublicAccessBlockCommand({ Bucket: b.Name }));
      const cfg = pab.PublicAccessBlockConfiguration || {};
      const fullyBlocked = !!(cfg.BlockPublicAcls && cfg.BlockPublicPolicy && cfg.IgnorePublicAcls && cfg.RestrictPublicBuckets);
      return { name: b.Name, fullyBlocked };
    } catch (err) {
      // NoSuchPublicAccessBlockConfiguration means the bucket has NO public
      // access block at all — the least-safe state, a real finding.
      if (err.name === "NoSuchPublicAccessBlockConfiguration") return { name: b.Name, fullyBlocked: false };
      return { name: b.Name, fullyBlocked: null }; // some other error — never assume
    }
  }));

  return {
    region: awsRegion,
    accountMfaEnabled: accountSummary.SummaryMap?.AccountMFAEnabled === 1,
    hasCustomPasswordPolicy: !!passwordPolicy,
    passwordPolicy: passwordPolicy?.PasswordPolicy || null,
    userCount: (users.Users || []).length,
    mfaChecks,
    bucketCount: (buckets.Buckets || []).length,
    bucketChecks,
    securityGroups: securityGroups.SecurityGroups || [],
    trailCount: (trails.trailList || []).length,
  };
}

export function mapAwsPostureToFindings(facts) {
  const out = [];

  out.push(finding({
    externalId: "aws-root-mfa",
    title: facts.accountMfaEnabled ? "Root account MFA enabled" : "Root account has no MFA",
    severity: facts.accountMfaEnabled ? "info" : "critical",
    message: facts.accountMfaEnabled
      ? "The AWS account root user has a multi-factor device registered."
      : "The AWS account root user — the single most privileged identity in the account — has no MFA device registered.",
    raw: { accountMfaEnabled: facts.accountMfaEnabled },
  }));

  out.push(finding({
    externalId: "aws-password-policy",
    title: facts.hasCustomPasswordPolicy ? "Custom IAM password policy set" : "No custom IAM password policy",
    severity: facts.hasCustomPasswordPolicy ? "info" : "medium",
    message: facts.hasCustomPasswordPolicy
      ? "A custom password policy is configured for IAM users in this account."
      : "This account has no custom IAM password policy — users can set weak passwords with no minimum length, complexity, or rotation requirement.",
    raw: facts.passwordPolicy,
  }));

  const noMfa = facts.mfaChecks.filter(c => c.hasMfa === false);
  if (facts.mfaChecks.length > 0) {
    out.push(finding({
      externalId: "aws-iam-user-mfa",
      title: noMfa.length === 0
        ? `All ${facts.mfaChecks.length} checked IAM user(s) have MFA`
        : `${noMfa.length} of ${facts.mfaChecks.length} checked IAM user(s) have no MFA device`,
      severity: noMfa.length === 0 ? "info" : "high",
      message: noMfa.length === 0
        ? "Every IAM user checked has at least one MFA device registered."
        : noMfa.slice(0, 10).map(c => c.userName).join(", "),
      raw: facts.mfaChecks,
    }));
  }

  const exposedBuckets = facts.bucketChecks.filter(b => b.fullyBlocked === false);
  if (facts.bucketChecks.length > 0) {
    out.push(finding({
      externalId: "aws-s3-public-access-block",
      title: exposedBuckets.length === 0
        ? `All ${facts.bucketChecks.length} checked S3 bucket(s) block public access`
        : `${exposedBuckets.length} of ${facts.bucketChecks.length} checked S3 bucket(s) do not fully block public access`,
      severity: exposedBuckets.length === 0 ? "info" : "high",
      message: exposedBuckets.length === 0
        ? "Every bucket checked has all four public-access-block settings enabled."
        : exposedBuckets.slice(0, 10).map(b => b.name).join(", "),
      raw: facts.bucketChecks,
    }));
  }

  const wideOpenGroups = [];
  for (const sg of facts.securityGroups) {
    for (const perm of (sg.IpPermissions || [])) {
      const openToWorld = (perm.IpRanges || []).some(r => r.CidrIp === "0.0.0.0/0");
      if (!openToWorld) continue;
      for (const p of SENSITIVE_PORTS) {
        if (portInRange(perm.FromPort, perm.ToPort, p.port)) {
          wideOpenGroups.push({ groupId: sg.GroupId, groupName: sg.GroupName, port: p.name });
        }
      }
    }
  }
  if (facts.securityGroups.length > 0) {
    out.push(finding({
      externalId: "aws-sg-open-to-world",
      title: wideOpenGroups.length === 0
        ? "No security groups expose SSH/RDP to the internet"
        : `${wideOpenGroups.length} security-group rule(s) expose SSH or RDP to the internet`,
      severity: wideOpenGroups.length === 0 ? "info" : "critical",
      message: wideOpenGroups.length === 0
        ? `Checked ${facts.securityGroups.length} security group(s) in ${facts.region} — none allow SSH/RDP from 0.0.0.0/0.`
        : wideOpenGroups.slice(0, 10).map(g => `${g.groupName || g.groupId}: ${g.port} open to 0.0.0.0/0`).join("; "),
      raw: wideOpenGroups,
    }));
  }

  out.push(finding({
    externalId: "aws-cloudtrail",
    title: facts.trailCount === 0 ? "No CloudTrail trail configured" : `${facts.trailCount} CloudTrail trail(s) configured`,
    severity: facts.trailCount === 0 ? "high" : "info",
    message: facts.trailCount === 0
      ? "No CloudTrail trail was found — API activity in this account is not being logged for audit/incident-response purposes."
      : "This account has at least one CloudTrail trail configured.",
    raw: { trailCount: facts.trailCount },
  }));

  return out;
}

// ── Azure ────────────────────────────────────────────────────────────
// Source: learn.microsoft.com Azure REST API references (Resource Manager).
// Credential: an Entra ID App Registration (service principal) — Tenant ID,
// Client (Application) ID, Client Secret — granted the built-in `Reader`
// role at the subscription scope. Auth is a plain OAuth2 client-credentials
// exchange against a fixed, well-known Microsoft host, so this uses bare
// fetch() rather than the SigV4-signing SDK client AWS's calls need above —
// same reasoning directoryAdapters.js's fixed-host M365/Google calls use
// bare fetch while Okta's client-supplied host goes through safeFetch.
const ARM_BASE = "https://management.azure.com";

async function getAzureAccessToken({ tenantId, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: `${ARM_BASE}/.default`,
  });
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Azure token request failed (${res.status})`);
  return json.access_token;
}

async function armGet(accessToken, path) {
  const res = await fetch(`${ARM_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Azure ARM ${path} failed: ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

export async function fetchAzurePosture({ tenantId, clientId, clientSecret, subscriptionId }) {
  const accessToken = await getAzureAccessToken({ tenantId, clientId, clientSecret });
  const sub = `/subscriptions/${subscriptionId}`;

  const [secureScores, storageAccounts, nsgs, diagnosticSettings] = await Promise.all([
    armGet(accessToken, `${sub}/providers/Microsoft.Security/secureScores?api-version=2020-01-01-preview`).catch(() => null),
    armGet(accessToken, `${sub}/providers/Microsoft.Storage/storageAccounts?api-version=2023-01-01`).catch(() => null),
    armGet(accessToken, `${sub}/providers/Microsoft.Network/networkSecurityGroups?api-version=2023-05-01`).catch(() => null),
    // Diagnostic settings for the subscription's own Activity Log — a
    // resource-agnostic subscription-scoped read, distinct from a
    // per-resource diagnostic setting.
    armGet(accessToken, `${sub}/providers/microsoft.insights/diagnosticSettings?api-version=2021-05-01-preview`).catch(() => null),
  ]);

  return {
    secureScore: secureScores?.value?.[0]?.properties || null,
    storageAccounts: storageAccounts?.value || [],
    nsgs: nsgs?.value || [],
    diagnosticSettingsCount: diagnosticSettings?.value?.length ?? null,
  };
}

export function mapAzurePostureToFindings(facts) {
  const out = [];

  // Defender for Cloud's own secure score — reads a posture Microsoft
  // already computes rather than reimplementing individual resource
  // checks. Not every subscription has Defender for Cloud enabled, so a
  // null score is reported honestly rather than assumed to be zero/perfect.
  if (facts.secureScore) {
    const pct = facts.secureScore.percentage != null ? Math.round(facts.secureScore.percentage * 100) : null;
    out.push(finding({
      externalId: "azure-secure-score",
      title: pct != null ? `Microsoft Defender for Cloud secure score: ${pct}%` : "Defender for Cloud secure score retrieved",
      severity: pct == null ? "info" : pct < 50 ? "high" : pct < 80 ? "medium" : "info",
      message: pct != null
        ? `Defender for Cloud's own posture score for this subscription is ${pct}%.`
        : "Retrieved a Defender for Cloud secure score record, but couldn't parse a percentage from it.",
      raw: facts.secureScore,
    }));
  } else {
    out.push(finding({
      externalId: "azure-secure-score-unavailable",
      title: "Microsoft Defender for Cloud secure score not available",
      severity: "info",
      message: "Could not retrieve a Defender for Cloud secure score for this subscription — Defender for Cloud may not be enabled, or this app registration's Reader role may not extend to it. Review Defender for Cloud directly in the Azure portal.",
      raw: null,
    }));
  }

  const publicStorage = facts.storageAccounts.filter(a => a.properties?.allowBlobPublicAccess === true);
  if (facts.storageAccounts.length > 0) {
    out.push(finding({
      externalId: "azure-storage-public-access",
      title: publicStorage.length === 0
        ? `All ${facts.storageAccounts.length} storage account(s) disallow public blob access`
        : `${publicStorage.length} of ${facts.storageAccounts.length} storage account(s) allow public blob access`,
      severity: publicStorage.length === 0 ? "info" : "high",
      message: publicStorage.length === 0
        ? "Every storage account checked has allowBlobPublicAccess disabled."
        : publicStorage.slice(0, 10).map(a => a.name).join(", "),
      raw: publicStorage.map(a => a.name),
    }));
  }

  const wideOpenNsgs = [];
  for (const nsg of facts.nsgs) {
    for (const rule of (nsg.properties?.securityRules || [])) {
      if (rule.direction !== "Inbound" || rule.access !== "Allow") continue;
      const src = rule.sourceAddressPrefix;
      const openToWorld = src === "*" || src === "0.0.0.0/0" || src === "Internet";
      if (!openToWorld) continue;
      const destPort = rule.destinationPortRange;
      for (const p of SENSITIVE_PORTS) {
        if (destPort === "*" || destPort === String(p.port)) {
          wideOpenNsgs.push({ nsgName: nsg.name, ruleName: rule.name || "(unnamed)", port: p.name });
        }
      }
    }
  }
  if (facts.nsgs.length > 0) {
    out.push(finding({
      externalId: "azure-nsg-open-to-world",
      title: wideOpenNsgs.length === 0
        ? "No network security groups expose SSH/RDP to the internet"
        : `${wideOpenNsgs.length} NSG rule(s) expose SSH or RDP to the internet`,
      severity: wideOpenNsgs.length === 0 ? "info" : "critical",
      message: wideOpenNsgs.length === 0
        ? `Checked ${facts.nsgs.length} network security group(s) — none allow SSH/RDP from the internet.`
        : wideOpenNsgs.slice(0, 10).map(g => `${g.nsgName} (${g.ruleName}): ${g.port} open to the internet`).join("; "),
      raw: wideOpenNsgs,
    }));
  }

  if (facts.diagnosticSettingsCount != null) {
    out.push(finding({
      externalId: "azure-activity-log-export",
      title: facts.diagnosticSettingsCount === 0 ? "No Activity Log export configured" : `${facts.diagnosticSettingsCount} Activity Log diagnostic setting(s) configured`,
      severity: facts.diagnosticSettingsCount === 0 ? "high" : "info",
      message: facts.diagnosticSettingsCount === 0
        ? "This subscription's Activity Log has no diagnostic setting exporting it for longer-term retention or analysis."
        : "This subscription's Activity Log is being exported by at least one diagnostic setting.",
      raw: { diagnosticSettingsCount: facts.diagnosticSettingsCount },
    }));
  }

  return out;
}

// ── dispatch ─────────────────────────────────────────────────────────
export const CLOUD_PROVIDERS = {
  aws: { kind: "token", fetchPosture: fetchAwsPosture, mapPostureToFindings: mapAwsPostureToFindings },
  azure: { kind: "token", fetchPosture: fetchAzurePosture, mapPostureToFindings: mapAzurePostureToFindings },
};
