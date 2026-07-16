// domainService.js
// Manages the company domains ShieldAI monitors for breach exposure, and the
// proof-of-control workflow that has to happen before monitoring can start.
//
// WHY THIS EXISTS
// ---------------
// Have I Been Pwned's domain-search API only returns data for domains whose
// control has been verified inside OUR HIBP dashboard. There is no API to
// enroll a domain programmatically — a human has to add it at
// haveibeenpwned.com/DomainSearch and complete HIBP's own verification.
//
// So this service does NOT claim to verify domains with HIBP. It does two
// honest, useful things instead:
//
//   1. Verifies that the CLIENT actually controls the domain they submitted,
//      via a DNS TXT record we can check ourselves. This is real verification
//      and it protects against a client pointing us at someone else's domain
//      (which would make us query a third party's breach data — a genuine
//      privacy problem, not a hypothetical one).
//
//   2. Tracks where each domain sits in the HIBP enrollment workflow, so the
//      admin queue shows exactly what still needs doing by hand.
//
// The two verifications are deliberately separate and both are shown honestly:
//   · ownership  — the client proved they control the domain (automated here)
//   · hibpStatus — has an admin enrolled + verified it in HIBP (manual there)
//
// Monitoring only produces data when BOTH are done. We never imply otherwise.

import { randomUUID } from "crypto";
import dns from "dns/promises";

// Verification states for client domain ownership (what we can check).
export const OWNERSHIP = {
  PENDING: "pending",     // token issued, TXT record not seen yet
  VERIFIED: "verified",   // TXT record found — client controls this domain
  FAILED: "failed",       // last check couldn't find the record
};

// Where the domain sits in HIBP's (manual, dashboard-side) workflow.
export const HIBP_STATUS = {
  NOT_SUBMITTED: "not_submitted", // nobody has added it to the HIBP dashboard
  SUBMITTED: "submitted",         // added in HIBP, awaiting HIBP's verification
  VERIFIED: "verified",           // HIBP confirmed — monitoring returns real data
  REJECTED: "rejected",           // HIBP verification failed / out of scope
};

const TXT_PREFIX = "shieldai-domain-verification=";

// ── Normalization ─────────────────────────────────────────────
// Accepts what people actually paste: "https://www.Acme.com/about?x=1" etc.
export function normalizeDomain(input) {
  let d = String(input || "").trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^[a-z]+:\/\//, "");  // strip scheme
  d = d.replace(/^www\./, "");        // strip www
  d = d.split("/")[0];                // strip path
  d = d.split("?")[0].split("#")[0];  // strip query/hash
  d = d.split(":")[0];                // strip port
  d = d.replace(/\.$/, "");           // strip trailing dot
  return d || null;
}

// Deliberately strict-ish: must look like a real registrable domain.
// Rejects bare hostnames, IPs, and localhost — none of which HIBP can monitor.
export function isValidDomain(domain) {
  const d = normalizeDomain(domain);
  if (!d) return false;
  if (d.length > 253) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(d)) return false;      // IPv4
  if (!d.includes(".")) return false;                    // needs a TLD
  if (d === "localhost") return false;
  return /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(d);
}

// Free-mail and similar domains must never be monitored: they aren't the
// client's to prove control over, and querying them would expose unrelated
// people's breach data. This is a hard block, not a warning.
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com",
  "mac.com", "protonmail.com", "proton.me", "gmx.com", "mail.com",
  "zoho.com", "yandex.com", "fastmail.com", "hey.com", "tutanota.com",
]);

export function isPublicEmailDomain(domain) {
  return PUBLIC_EMAIL_DOMAINS.has(normalizeDomain(domain) || "");
}

// ── Records ───────────────────────────────────────────────────
function ensure(db) {
  db.data.clientDomains ||= [];
  return db.data.clientDomains;
}

export function getClientDomain(db, userId) {
  return ensure(db).find(d => d.userId === userId) || null;
}

export function listDomains(db, { hibpStatus = null, ownership = null } = {}) {
  let rows = ensure(db);
  if (hibpStatus) rows = rows.filter(r => r.hibpStatus === hibpStatus);
  if (ownership) rows = rows.filter(r => r.ownership === ownership);
  return rows;
}

// Is this domain cleared for live HIBP queries? Both gates must be green.
export function isMonitorable(record) {
  return !!record
    && record.ownership === OWNERSHIP.VERIFIED
    && record.hibpStatus === HIBP_STATUS.VERIFIED;
}

// ── Submit / re-submit a domain ───────────────────────────────
export async function submitDomain(db, userId, rawDomain, actorEmail = "") {
  const domain = normalizeDomain(rawDomain);
  if (!isValidDomain(domain)) {
    throw Object.assign(new Error("That doesn't look like a valid company domain (e.g. acme.com)."), { status: 400 });
  }
  if (isPublicEmailDomain(domain)) {
    throw Object.assign(new Error(
      `"${domain}" is a public email provider, not a company domain. Breach monitoring only works on a domain your company controls.`
    ), { status: 400 });
  }

  const rows = ensure(db);
  const existing = rows.find(r => r.userId === userId);

  // Another client already monitoring this domain would let one company read
  // another's breach exposure. Refuse.
  const takenByOther = rows.find(r => r.domain === domain && r.userId !== userId);
  if (takenByOther) {
    throw Object.assign(new Error(
      "That domain is already registered to another ShieldAI account. Contact support if this is your domain."
    ), { status: 409 });
  }

  const now = new Date().toISOString();
  const token = randomUUID().replace(/-/g, "");

  if (existing) {
    // Changing the domain invalidates all prior proof — both gates reset.
    if (existing.domain !== domain) {
      existing.domain = domain;
      existing.ownership = OWNERSHIP.PENDING;
      existing.verificationToken = token;
      existing.ownershipVerifiedAt = null;
      existing.hibpStatus = HIBP_STATUS.NOT_SUBMITTED;
      existing.hibpNote = "";
      existing.history = [...(existing.history || []), { at: now, event: "domain_changed", detail: domain, by: actorEmail }];
    }
    existing.updatedAt = now;
    await db.write();
    return existing;
  }

  const record = {
    id: randomUUID(),
    userId,
    domain,
    ownership: OWNERSHIP.PENDING,
    verificationToken: token,
    ownershipVerifiedAt: null,
    lastCheckedAt: null,
    lastCheckError: null,
    hibpStatus: HIBP_STATUS.NOT_SUBMITTED,
    hibpNote: "",
    hibpUpdatedAt: null,
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, event: "submitted", detail: domain, by: actorEmail }],
  };
  rows.push(record);
  await db.write();
  return record;
}

// What the client has to publish in DNS.
export function verificationInstructions(record) {
  if (!record) return null;
  return {
    type: "TXT",
    host: "@",
    name: record.domain,
    value: `${TXT_PREFIX}${record.verificationToken}`,
    help: `Add this TXT record at your DNS provider for ${record.domain}, then run the check. ` +
          `DNS changes can take a few minutes to propagate (occasionally up to an hour).`,
  };
}

// ── Ownership verification (real, automated) ──────────────────
export async function checkOwnership(db, userId) {
  const record = getClientDomain(db, userId);
  if (!record) {
    throw Object.assign(new Error("No domain on file. Submit your company domain first."), { status: 404 });
  }

  const expected = `${TXT_PREFIX}${record.verificationToken}`;
  const now = new Date().toISOString();
  record.lastCheckedAt = now;

  try {
    // resolveTxt returns arrays of string chunks per record; join each record.
    const records = await dns.resolveTxt(record.domain);
    const flat = records.map(chunks => chunks.join("").trim());
    const found = flat.some(v => v === expected);

    if (found) {
      const first = record.ownership !== OWNERSHIP.VERIFIED;
      record.ownership = OWNERSHIP.VERIFIED;
      record.ownershipVerifiedAt = now;
      record.lastCheckError = null;
      if (first) {
        record.history = [...(record.history || []), { at: now, event: "ownership_verified", detail: record.domain }];
      }
    } else {
      record.ownership = OWNERSHIP.FAILED;
      record.lastCheckError = flat.length
        ? "Found TXT records for this domain, but none matched the verification value. Check for typos and that the record has finished propagating."
        : "No TXT records found for this domain yet. DNS changes can take a few minutes to propagate.";
    }
  } catch (err) {
    record.ownership = OWNERSHIP.FAILED;
    record.lastCheckError =
      err.code === "ENOTFOUND" || err.code === "ENODATA"
        ? "No TXT records found for this domain yet. DNS changes can take a few minutes to propagate."
        : `DNS lookup failed (${err.code || err.message}).`;
  }

  record.updatedAt = now;
  await db.write();
  return record;
}

// ── HIBP enrollment status (admin-driven, mirrors manual dashboard work) ──
export async function setHibpStatus(db, userId, status, { note = "", actorEmail = "" } = {}) {
  const record = getClientDomain(db, userId);
  if (!record) {
    throw Object.assign(new Error("No domain on file for that client."), { status: 404 });
  }
  if (!Object.values(HIBP_STATUS).includes(status)) {
    throw Object.assign(new Error(`Invalid status. Expected one of: ${Object.values(HIBP_STATUS).join(", ")}`), { status: 400 });
  }
  // Refusing this is the whole point of the ownership gate: marking a domain
  // live in HIBP before the client proved control means we'd start pulling
  // breach data for a domain that may not be theirs.
  if (status === HIBP_STATUS.VERIFIED && record.ownership !== OWNERSHIP.VERIFIED) {
    throw Object.assign(new Error(
      "Can't mark HIBP monitoring active: the client hasn't proved domain ownership yet (DNS TXT check hasn't passed)."
    ), { status: 409 });
  }

  const now = new Date().toISOString();
  record.hibpStatus = status;
  record.hibpNote = note || "";
  record.hibpUpdatedAt = now;
  record.updatedAt = now;
  record.history = [...(record.history || []), { at: now, event: `hibp_${status}`, detail: note || "", by: actorEmail }];
  await db.write();
  return record;
}

// ── Client-facing view ────────────────────────────────────────
// One place that decides what the client is told, so the UI can't drift into
// implying monitoring is live when it isn't.
export function clientView(record, { hibpConfigured = true } = {}) {
  if (!record) {
    return {
      domain: null,
      state: "none",
      headline: "No company domain on file",
      detail: "Add your company domain to enable breach and dark-web exposure monitoring.",
      monitored: false,
      nextStep: "submit_domain",
    };
  }

  const base = { domain: record.domain, submittedAt: record.createdAt };

  if (record.ownership !== OWNERSHIP.VERIFIED) {
    return {
      ...base,
      state: "awaiting_ownership",
      headline: "Domain ownership not verified",
      detail: record.lastCheckError
        || "Publish the DNS TXT record below, then run the check to prove you control this domain.",
      monitored: false,
      nextStep: "verify_dns",
      instructions: verificationInstructions(record),
      lastCheckedAt: record.lastCheckedAt,
    };
  }

  if (!hibpConfigured) {
    return {
      ...base,
      state: "service_inactive",
      headline: "Breach monitoring isn't active yet",
      detail: "Your domain is verified. Breach monitoring is not currently enabled on this ShieldAI deployment.",
      monitored: false,
      nextStep: "contact_shieldai",
      ownershipVerifiedAt: record.ownershipVerifiedAt,
    };
  }

  switch (record.hibpStatus) {
    case HIBP_STATUS.VERIFIED:
      return {
        ...base,
        state: "monitored",
        headline: "Breach monitoring active",
        detail: "We're monitoring this domain for credentials exposed in known data breaches.",
        monitored: true,
        ownershipVerifiedAt: record.ownershipVerifiedAt,
        activeSince: record.hibpUpdatedAt,
      };
    case HIBP_STATUS.SUBMITTED:
      return {
        ...base,
        state: "awaiting_hibp",
        headline: "Monitoring setup in progress",
        detail: "Your domain is verified and enrollment with our breach-intelligence provider is underway. This usually completes within a business day.",
        monitored: false,
        nextStep: "wait",
        ownershipVerifiedAt: record.ownershipVerifiedAt,
      };
    case HIBP_STATUS.REJECTED:
      return {
        ...base,
        state: "rejected",
        headline: "Monitoring couldn't be enabled",
        detail: record.hibpNote || "Our breach-intelligence provider couldn't enable monitoring for this domain. Contact ShieldAI support.",
        monitored: false,
        nextStep: "contact_shieldai",
      };
    default:
      return {
        ...base,
        state: "awaiting_hibp",
        headline: "Monitoring setup pending",
        detail: "Your domain is verified. ShieldAI is enrolling it with our breach-intelligence provider.",
        monitored: false,
        nextStep: "wait",
        ownershipVerifiedAt: record.ownershipVerifiedAt,
      };
  }
}

// ── Admin queue ───────────────────────────────────────────────
// What still needs a human to act, ordered by what's actionable now.
export function adminQueue(db) {
  const users = db.data.users || [];
  const byId = new Map(users.map(u => [u.id, u]));

  const rows = ensure(db).map(r => {
    const u = byId.get(r.userId);
    return {
      ...r,
      companyName: u?.companyName || "(unknown)",
      email: u?.email || "(unknown)",
      monitorable: isMonitorable(r),
      // Ready to be added to the HIBP dashboard right now.
      actionable: r.ownership === OWNERSHIP.VERIFIED && r.hibpStatus === HIBP_STATUS.NOT_SUBMITTED,
    };
  });

  const rank = r =>
    r.actionable ? 0 :
    r.hibpStatus === HIBP_STATUS.SUBMITTED ? 1 :
    r.ownership === OWNERSHIP.PENDING || r.ownership === OWNERSHIP.FAILED ? 2 :
    r.hibpStatus === HIBP_STATUS.REJECTED ? 3 : 4;

  rows.sort((a, b) => rank(a) - rank(b) || String(a.companyName).localeCompare(String(b.companyName)));

  return {
    domains: rows,
    counts: {
      total: rows.length,
      readyToEnroll: rows.filter(r => r.actionable).length,
      awaitingHibp: rows.filter(r => r.hibpStatus === HIBP_STATUS.SUBMITTED).length,
      awaitingClient: rows.filter(r => r.ownership !== OWNERSHIP.VERIFIED).length,
      monitored: rows.filter(r => r.monitorable).length,
    },
  };
}
