// directoryAdapters.js
// Per-provider connectors for directoryRoutes.js: pull security-posture facts
// (MFA coverage, privileged accounts, stale accounts, policy gaps) from a
// client's own Microsoft 365/Entra ID, Google Workspace, Okta, or Zoom tenant.
//
// SCOPE BOUNDARY (read this before adding a provider or a scope): every
// scope requested below is READ-ONLY. This file must never request a
// write/management scope (e.g. Graph's RoleManagement.ReadWrite.*, Admin
// SDK's non-readonly variants, or an Okta token with anything beyond read
// access). That's not a style preference — it's what keeps a pull-based
// connector consistent with the "AI advises, humans act" boundary CLAUDE.md
// documents for the monitoring agent: ShieldAI never gets a channel that can
// change anything in a client's directory, only read it.
//
// Severity is computed HERE, deterministically, from facts the vendor API
// actually returned — never inferred by the AI layer and never upgraded
// past what the data supports. Mirrors the "real data over fabrication"
// rule already applied in integrationAdapters.js/cveService.js: where a
// signal isn't reliably available from a single low-cost API call (e.g.
// Okta's per-tenant privileged-role list without an expensive per-user
// N+1 call), the adapter says so in the finding rather than guessing.
//
// CONFIDENCE NOTE: field names below are sourced from each vendor's public
// API docs as of this writing, not verified against a live tenant of any of
// the three. Same caveat integrationAdapters.js already carries for its five
// vendors — verify against a real tenant before trusting blindly.

import { assertSafeExternalHost } from "./outboundUrlSafety.js";

const CANON_SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);
function sev(s) {
  const v = String(s || "").toLowerCase().trim();
  return CANON_SEVERITIES.has(v) ? v : "info";
}

function finding({ externalId, title, severity, host = null, cve = null, message, raw }) {
  return { externalId, title, severity: sev(severity), category: "identity", host, cve, message, raw };
}

// ── Microsoft 365 / Entra ID (Microsoft Graph) ──────────────────────
// Source: learn.microsoft.com Graph API reference. Read-only scopes only.
export const M365_SCOPES = ["Directory.Read.All", "Policy.Read.All", "Reports.Read.All"];

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function graphGet(accessToken, path) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Graph API ${path} failed: ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

// `/reports/authenticationMethods/userRegistrationDetails` is the single
// cheapest Graph call that carries both MFA registration state AND an
// isAdmin flag per user in one page — avoids an N+1 per-user call. CA
// policies are a separate list call. Both need Reports.Read.All /
// Policy.Read.All granted and consented by a tenant admin.
export async function fetchM365Posture({ accessToken }) {
  const [registrations, caPolicies] = await Promise.all([
    graphGet(accessToken, "/reports/authenticationMethods/userRegistrationDetails?$top=999"),
    graphGet(accessToken, "/identity/conditionalAccess/policies").catch(() => ({ value: [] })), // some tenants withhold CA read even with Policy.Read.All if not P1/P2 licensed
  ]);
  return {
    users: registrations.value || [],
    conditionalAccessPolicies: caPolicies.value || [],
  };
}

export function mapM365PostureToFindings(facts) {
  const users = facts.users || [];
  const total = users.length;
  const mfaRegistered = users.filter(u => u.isMfaRegistered).length;
  const admins = users.filter(u => u.isAdmin);
  const adminsWithoutMfa = admins.filter(u => !u.isMfaRegistered);
  const enabledCaPolicies = (facts.conditionalAccessPolicies || []).filter(p => p.state === "enabled");

  const out = [];

  if (total > 0) {
    const pct = Math.round((mfaRegistered / total) * 100);
    out.push(finding({
      externalId: "m365-mfa-coverage",
      title: `MFA registered for ${mfaRegistered} of ${total} users (${pct}%)`,
      severity: pct === 0 ? "critical" : pct < 90 ? "high" : "info",
      message: `${total - mfaRegistered} user(s) have no MFA method registered.`,
      raw: { total, mfaRegistered, pct },
    }));
  }

  if (adminsWithoutMfa.length > 0) {
    out.push(finding({
      externalId: "m365-admin-mfa-gap",
      title: `${adminsWithoutMfa.length} privileged account(s) without MFA`,
      severity: "critical",
      message: adminsWithoutMfa.slice(0, 10).map(u => u.userPrincipalName).join(", "),
      raw: adminsWithoutMfa,
    }));
  }

  out.push(finding({
    externalId: "m365-conditional-access",
    title: enabledCaPolicies.length === 0
      ? "No Conditional Access policies enabled"
      : `${enabledCaPolicies.length} Conditional Access polic${enabledCaPolicies.length === 1 ? "y" : "ies"} enabled`,
    severity: enabledCaPolicies.length === 0 ? "high" : "info",
    message: enabledCaPolicies.length === 0
      ? "No sign-in risk, device, or location-based access policies are enforced."
      : enabledCaPolicies.map(p => p.displayName).join(", "),
    raw: facts.conditionalAccessPolicies,
  }));

  return out;
}

// ── Google Workspace (Admin SDK Directory API) ──────────────────────
// Source: developers.google.com/admin-sdk/directory. Read-only scopes only.
// Google Workspace has no direct equivalent of Entra ID's Conditional
// Access; org-wide 2-Step Verification enforcement (isEnforcedIn2Sv) is the
// closest analogous "policy gap" signal and is used here instead — this is
// a deliberate substitution, not a missing feature.
export const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
];

async function listAllWorkspaceUsers(accessToken) {
  const users = [];
  let pageToken = null;
  do {
    const url = new URL("https://admin.googleapis.com/admin/directory/v1/users");
    url.searchParams.set("customer", "my_customer");
    url.searchParams.set("maxResults", "500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Admin SDK users.list failed: ${res.status} ${await res.text().catch(() => "")}`);
    const body = await res.json();
    users.push(...(body.users || []));
    pageToken = body.nextPageToken || null;
  } while (pageToken);
  return users;
}

// Meet safety settings — best-effort, unlike the stable, well-documented
// Directory API user-listing call above. Google's admin API surface for
// per-tenant Meet safety configuration (host controls, external-participant
// restrictions, and similar) has moved around and isn't confidently
// documented as of this writing. This call degrades honestly to `null` on
// ANY failure (wrong path, missing scope, surface moved again) rather than
// guessing — same discipline the Okta admin-coverage gap already uses in
// this file. Verify against a real tenant before trusting the endpoint
// path itself.
async function fetchGoogleMeetSafetySettings(accessToken) {
  try {
    const res = await fetch("https://admin.googleapis.com/admin/directory/v1/customer/my_customer/policies/meet", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchGoogleWorkspacePosture({ accessToken }) {
  const [users, meetSettings] = await Promise.all([
    listAllWorkspaceUsers(accessToken),
    fetchGoogleMeetSafetySettings(accessToken),
  ]);
  return { users, meetSettings };
}

export function mapGoogleWorkspacePostureToFindings(facts) {
  const users = (facts.users || []).filter(u => !u.suspended);
  const total = users.length;
  const enrolled = users.filter(u => u.isEnrolledIn2Sv).length;
  const enforced = users.filter(u => u.isEnforcedIn2Sv).length;
  const admins = users.filter(u => u.isAdmin || u.isDelegatedAdmin);
  const adminsWithout2Sv = admins.filter(u => !u.isEnrolledIn2Sv);
  const STALE_DAYS = 90;
  const staleCutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  const stale = users.filter(u => u.lastLoginTime && new Date(u.lastLoginTime).getTime() < staleCutoff);

  const out = [];

  if (total > 0) {
    const pct = Math.round((enforced / total) * 100);
    out.push(finding({
      externalId: "gws-2sv-enforcement",
      title: `2-Step Verification enforced for ${enforced} of ${total} users (${pct}%)`,
      severity: pct === 0 ? "critical" : pct < 90 ? "high" : "info",
      message: `${enrolled} of ${total} users have 2SV enrolled; ${enforced} have it org-enforced.`,
      raw: { total, enrolled, enforced, pct },
    }));
  }

  if (adminsWithout2Sv.length > 0) {
    out.push(finding({
      externalId: "gws-admin-2sv-gap",
      title: `${adminsWithout2Sv.length} admin account(s) without 2-Step Verification`,
      severity: "critical",
      message: adminsWithout2Sv.slice(0, 10).map(u => u.primaryEmail).join(", "),
      raw: adminsWithout2Sv,
    }));
  }

  if (stale.length > 0) {
    out.push(finding({
      externalId: "gws-stale-accounts",
      title: `${stale.length} account(s) inactive ${STALE_DAYS}+ days`,
      severity: "medium",
      message: stale.slice(0, 10).map(u => u.primaryEmail).join(", "),
      raw: stale,
    }));
  }

  // Meet safety: honest either way. A successful read isn't parsed into a
  // specific pass/fail claim yet (the field shape isn't confirmed against a
  // live tenant), so it's surfaced as raw for visibility rather than
  // invented; a failed read says so explicitly instead of silently omitting it.
  if (facts.meetSettings) {
    out.push(finding({
      externalId: "gws-meet-safety",
      title: "Meet safety settings retrieved",
      severity: "info",
      message: "Meet safety configuration was retrieved but isn't parsed into specific pass/fail findings yet — shown for visibility while the exact settings surface is confirmed against a live tenant. Review Meet safety settings directly in the Admin console in the meantime.",
      raw: facts.meetSettings,
    }));
  } else {
    out.push(finding({
      externalId: "gws-meet-safety-unavailable",
      title: "Meet safety settings not available",
      severity: "info",
      message: "Could not retrieve Meet safety configuration for this tenant — this may need a different Admin SDK scope, or Google's API surface for this may have changed since this adapter was written. Review Meet safety settings directly in the Admin console.",
      raw: null,
    }));
  }

  return out;
}

// ── Okta ─────────────────────────────────────────────────────────────
// Source: developer.okta.com API reference. Uses a customer-supplied
// read-only API token (SSWS), not OAuth — see directoryRoutes.js's connect
// flow. CONFIDENCE/SCALE NOTE: a precise privileged-admin-account count
// needs either Okta's IGA role-assignment API or an N+1 per-user roles
// call, neither of which is cheap or reliably available on every Okta
// plan tier. Rather than fabricate that number from an unreliable
// approximation, this adapter reports what a single cheap call set can
// support honestly (MFA enrollment policy presence, stale accounts) and
// says so explicitly for admin coverage instead of guessing.
export async function fetchOktaPosture({ apiToken, oktaDomain }) {
  // Re-checked on every sync, not just at connect time — a connection's
  // stored domain could otherwise be revalidated once and then reused
  // indefinitely against a host that later resolves somewhere private.
  await assertSafeExternalHost(`https://${oktaDomain}`);
  const base = `https://${oktaDomain}`;
  const headers = { Authorization: `SSWS ${apiToken}`, Accept: "application/json" };

  const [usersRes, policiesRes] = await Promise.all([
    fetch(`${base}/api/v1/users?limit=200`, { headers }),
    fetch(`${base}/api/v1/policies?type=MFA_ENROLL`, { headers }),
  ]);
  if (!usersRes.ok) throw new Error(`Okta users list failed: ${usersRes.status} ${await usersRes.text().catch(() => "")}`);
  if (!policiesRes.ok) throw new Error(`Okta policies list failed: ${policiesRes.status} ${await policiesRes.text().catch(() => "")}`);

  return { users: await usersRes.json(), mfaPolicies: await policiesRes.json() };
}

export function mapOktaPostureToFindings(facts) {
  const users = (facts.users || []).filter(u => u.status === "ACTIVE");
  const total = users.length;
  const STALE_DAYS = 90;
  const staleCutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  const stale = users.filter(u => u.lastLogin && new Date(u.lastLogin).getTime() < staleCutoff);

  const activeMfaPolicies = (facts.mfaPolicies || []).filter(p => p.status === "ACTIVE");
  const enforcingPolicy = activeMfaPolicies.find(p =>
    (p.settings?.factors ? Object.values(p.settings.factors).some(f => f?.enroll?.self === "REQUIRED") : false)
  );

  const out = [];

  out.push(finding({
    externalId: "okta-mfa-enroll-policy",
    title: enforcingPolicy
      ? `MFA enrollment required by policy "${enforcingPolicy.name}"`
      : "No active MFA enrollment policy requires a factor",
    severity: enforcingPolicy ? "info" : "critical",
    message: enforcingPolicy
      ? "At least one active policy requires MFA enrollment for the groups it applies to."
      : "No ACTIVE MFA_ENROLL policy found that requires a factor — MFA may be optional org-wide. Verify policy group assignment covers all users.",
    raw: facts.mfaPolicies,
  }));

  if (total > 0 && stale.length > 0) {
    out.push(finding({
      externalId: "okta-stale-accounts",
      title: `${stale.length} of ${total} active account(s) inactive ${STALE_DAYS}+ days`,
      severity: "medium",
      message: stale.slice(0, 10).map(u => u.profile?.login).filter(Boolean).join(", "),
      raw: stale,
    }));
  }

  out.push(finding({
    externalId: "okta-admin-coverage-unavailable",
    title: "Privileged account count not available",
    severity: "info",
    message: "A precise Okta admin/privileged-role count isn't included in this pass — it requires an API call this connector doesn't make yet (see code comment). Review admin role assignments directly in the Okta admin console.",
    raw: null,
  }));

  return out;
}

// ── Zoom ─────────────────────────────────────────────────────────────
// Source: marketplace.zoom.us API reference. Read-only scope only. Zoom has
// been migrating from broad "classic" scopes (account:read:admin) toward
// granular ones (e.g. account:read:list_settings:admin) — this uses the
// classic scope for broad compatibility with existing Marketplace apps as
// of this writing; verify current guidance when registering the app.
export const ZOOM_SCOPES = ["account:read:admin"];

export async function fetchZoomPosture({ accessToken }) {
  const res = await fetch("https://api.zoom.us/v2/accounts/me/settings", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Zoom account settings failed: ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

// CONFIDENCE NOTE: field paths below (in_meeting.*, schedule_meeting.*) are
// sourced from Zoom's published Account Settings API docs, not verified
// against a live account — Zoom's settings schema has shifted across API
// versions before. Every access is optional-chained so a renamed/missing
// field degrades to an "unknown" — style finding rather than throwing.
export function mapZoomPostureToFindings(facts) {
  const inMeeting = facts.in_meeting || {};
  const schedule = facts.schedule_meeting || {};
  const out = [];

  const passcodeRequired = schedule.require_password_for_scheduling_new_meetings ?? inMeeting.require_password_for_scheduling_new_meetings ?? null;
  out.push(finding({
    externalId: "zoom-passcode-required",
    title: passcodeRequired === null ? "Passcode requirement not determinable" : passcodeRequired ? "Meeting passcodes required" : "Meeting passcodes not required",
    severity: passcodeRequired === false ? "high" : "info",
    message: passcodeRequired === null
      ? "Could not read this setting from the Zoom account settings API."
      : passcodeRequired
        ? "New meetings require a passcode by default."
        : "New meetings can be scheduled without a passcode, increasing the risk of uninvited join (\"Zoombombing\").",
    raw: { passcodeRequired },
  }));

  const waitingRoom = inMeeting.waiting_room ?? null;
  out.push(finding({
    externalId: "zoom-waiting-room",
    title: waitingRoom === null ? "Waiting room setting not determinable" : waitingRoom ? "Waiting room enabled" : "Waiting room not enabled",
    severity: waitingRoom === false ? "high" : "info",
    message: waitingRoom === null
      ? "Could not read this setting from the Zoom account settings API."
      : waitingRoom
        ? "Hosts must admit participants before they can join."
        : "Participants can join meetings without host approval.",
    raw: { waitingRoom },
  }));

  const e2ee = inMeeting.end_to_end_encrypted_meetings ?? null;
  out.push(finding({
    externalId: "zoom-encryption",
    title: e2ee === null ? "Encryption setting not determinable" : e2ee ? "End-to-end encryption available" : "End-to-end encryption not enabled",
    severity: e2ee === false ? "medium" : "info",
    message: e2ee === null
      ? "Could not read this setting from the Zoom account settings API."
      : e2ee
        ? "Meetings can be hosted with end-to-end encryption."
        : "End-to-end encryption isn't enabled account-wide; meetings default to standard (transport) encryption only.",
    raw: { e2ee },
  }));

  return out;
}

// ── dispatch ─────────────────────────────────────────────────────────
export const DIRECTORY_PROVIDERS = {
  m365: { scopes: M365_SCOPES, fetchPosture: fetchM365Posture, mapPostureToFindings: mapM365PostureToFindings, kind: "oauth" },
  google_workspace: { scopes: GOOGLE_WORKSPACE_SCOPES, fetchPosture: fetchGoogleWorkspacePosture, mapPostureToFindings: mapGoogleWorkspacePostureToFindings, kind: "oauth" },
  okta: { scopes: null, fetchPosture: fetchOktaPosture, mapPostureToFindings: mapOktaPostureToFindings, kind: "token" },
  zoom: { scopes: ZOOM_SCOPES, fetchPosture: fetchZoomPosture, mapPostureToFindings: mapZoomPostureToFindings, kind: "oauth" },
};
