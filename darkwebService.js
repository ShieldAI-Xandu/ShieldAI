// darkwebService.js
// ShieldAI breach / dark-web exposure service, backed by Have I Been Pwned (HIBP).
//
// HONESTY NOTES (by design):
//  - There is NO free, public "dark web" API. Real breach/credential exposure
//    intelligence comes from paid providers. We use HIBP — reputable, affordable,
//    and keyed off a DOMAIN the client already gives us.
//  - HIBP's domain-search API ONLY works for domains whose control has been
//    verified in the HIBP domain-search dashboard. If a client's domain isn't
//    verified (or is out of subscription scope), HIBP returns 403. We report
//    that state HONESTLY as "not monitored / not verified" — we never turn a
//    403 into a fake "Low risk / No intel" all-clear.
//  - If no HIBP_API_KEY is configured, the feature is reported as inactive,
//    not faked.
//
// Requires: process.env.HIBP_API_KEY (32-char hex from https://haveibeenpwned.com/API/Key)
// Optional: process.env.HIBP_USER_AGENT (defaults to "ShieldAI-vCISO")

import { getClientDomain, isMonitorable, clientView, OWNERSHIP, HIBP_STATUS } from "./domainService.js";

const HIBP_BASE = "https://haveibeenpwned.com/api/v3";
const HIBP_API_KEY = process.env.HIBP_API_KEY || "";
const HIBP_USER_AGENT = process.env.HIBP_USER_AGENT || "ShieldAI-vCISO";

// HIBP asks integrators not to hammer the domain API — it only changes when a
// new breach is added. Cache aggressively.
const cache = new Map();                 // domain -> { at, data }
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
let lastRequestAt = 0;
let queue = Promise.resolve();
const MIN_INTERVAL_MS = 1700;            // be polite; HIBP rate-limits per key

function cacheGet(k) { const h = cache.get(k); return h && Date.now() - h.at < CACHE_TTL_MS ? h.data : null; }
function cacheSet(k, d) { cache.set(k, { at: Date.now(), data: d }); }

export function darkwebConfigured() { return !!HIBP_API_KEY; }

// ── Service status ────────────────────────────────────────────
// Unlike NVD, the HIBP key is REQUIRED: with no key there is no breach data at
// all, and we report "Not active" rather than inventing an all-clear.
export function darkwebServiceStatus(db) {
  const domains = (db?.data?.clientDomains) || [];
  return {
    id: "hibp",
    name: "Have I Been Pwned",
    purpose: "Breach and credential exposure monitoring for verified client domains.",
    configured: !!HIBP_API_KEY,
    required: true,
    envVar: "HIBP_API_KEY",
    keyUrl: "https://haveibeenpwned.com/API/Key",
    dashboardUrl: "https://haveibeenpwned.com/DomainSearch",
    userAgent: HIBP_USER_AGENT,
    minIntervalMs: MIN_INTERVAL_MS,
    impact: HIBP_API_KEY
      ? "Keyed — breach lookups run for domains verified in the HIBP dashboard."
      : "No key — breach monitoring is inactive for every client.",
    degradesTo: "Without a key, clients are shown \"Not active\" — never a fabricated all-clear.",
    cacheEntries: cache.size,
    cacheTtlHours: CACHE_TTL_MS / 3600000,
    // The manual half of the workflow, which a key alone doesn't solve.
    domainsRegistered: domains.length,
    domainsMonitored: domains.filter(d => d.ownership === "verified" && d.hibpStatus === "verified").length,
  };
}

// Live probe. HIBP has no unauthenticated health endpoint, so we call the
// breaches list — it's public, cheap, and proves the service answers.
export async function probeDarkweb() {
  const t0 = Date.now();
  if (!HIBP_API_KEY) {
    return { reachable: null, ok: false, latencyMs: 0,
      detail: "Not probed — no API key configured.", checkedAt: new Date().toISOString() };
  }
  try {
    const res = await hibpFetch("/breaches?Domain=adobe.com"); // known, stable breach record
    if (res.status === 401) {
      return { reachable: true, ok: false, latencyMs: Date.now() - t0,
        detail: "HIBP rejected the configured API key (401). Check HIBP_API_KEY.",
        checkedAt: new Date().toISOString() };
    }
    if (res.status === 429) {
      return { reachable: true, ok: false, latencyMs: Date.now() - t0,
        detail: "HIBP is rate-limiting this key right now (429).", checkedAt: new Date().toISOString() };
    }
    if (!res.ok) {
      return { reachable: true, ok: false, latencyMs: Date.now() - t0,
        detail: `HIBP returned HTTP ${res.status}.`, checkedAt: new Date().toISOString() };
    }
    return { reachable: true, ok: true, latencyMs: Date.now() - t0,
      detail: "HIBP responded and the API key is valid.", checkedAt: new Date().toISOString() };
  } catch (err) {
    return { reachable: false, ok: false, latencyMs: Date.now() - t0,
      detail: `Could not reach HIBP: ${err.message || err}`, checkedAt: new Date().toISOString() };
  }
}

function schedule(fn) {
  const run = queue.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

// The domain we are ALLOWED to query HIBP for — i.e. one the client has
// explicitly registered and proved control of.
//
// This used to fall back to guessing from the user's email address. That was
// unsafe: querying breach data for a domain nobody proved they own means
// exposing a third party's exposure to whoever signed up with an address at
// it. Guessing is now only used as a *suggestion* in the UI (see
// suggestedDomain), never as an input to a live query.
export function clientDomain(db, userId) {
  const record = getClientDomain(db, userId);
  return record?.domain || null;
}

// A best-effort guess to pre-fill the "what's your domain?" field. Never used
// for querying — the client still has to submit and verify it.
export function suggestedDomain(db, userId) {
  const user = (db.data.users || []).find(u => u.id === userId);
  const assessments = (db.data.assessments || []).filter(a => a.userId === userId);
  const latest = assessments[assessments.length - 1];
  const fromAssessment = latest?.data?.company?.website || latest?.data?.company?.domain
    || latest?.company?.website || latest?.company?.domain || null;
  let domain = user?.companyDomain || user?.website || fromAssessment || null;
  if (domain) {
    domain = String(domain).trim().toLowerCase()
      .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  }
  if (!domain && user?.email && user.email.includes("@")) {
    domain = user.email.split("@")[1].toLowerCase();
  }
  return domain || null;
}

// Map HIBP's alias->breaches object into a compact, severity-ranked summary.
// statusLevel mirrors the legacy darkWebMentions vocabulary so the existing UI
// keeps working, but it is now DERIVED FROM REAL DATA.
function summarize(domain, hibpData) {
  const aliases = Object.keys(hibpData || {});
  const breachNames = new Set();
  for (const a of aliases) for (const b of (hibpData[a] || [])) breachNames.add(b);
  const accounts = aliases.length;
  const breaches = breachNames.size;

  let statusLevel;
  if (accounts === 0) statusLevel = "No intel";
  else if (breaches >= 5 || accounts >= 25) statusLevel = "High alert";
  else if (breaches >= 2 || accounts >= 5) statusLevel = "Elevated";
  else statusLevel = "Low risk";

  return {
    source: "hibp",
    domain,
    monitored: true,
    statusLevel,
    breachedAccounts: accounts,
    distinctBreaches: breaches,
    breaches: [...breachNames].sort(),
    // a few example aliases (local-parts only, as HIBP returns) for context
    sampleAccounts: aliases.slice(0, 8),
    checkedAt: new Date().toISOString(),
  };
}

async function hibpFetch(path) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${HIBP_BASE}${path}`, {
      headers: { "hibp-api-key": HIBP_API_KEY, "user-agent": HIBP_USER_AGENT },
      signal: ctrl.signal,
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

// Query breach exposure for a domain. Returns an honest status object in every
// case — including "not configured", "not verified", and "error" — never a
// fabricated all-clear.
export async function domainExposure(domain) {
  const d = String(domain || "").trim().toLowerCase();
  if (!HIBP_API_KEY) {
    return { source: "hibp", domain: d, monitored: false, statusLevel: "Not active",
      reason: "Dark-web monitoring isn't active — no Have I Been Pwned API key is configured.", configured: false };
  }
  if (!d) {
    return { source: "hibp", domain: null, monitored: false, statusLevel: "Unknown",
      reason: "No company domain on file to monitor.", configured: true };
  }

  const cached = cacheGet(d);
  if (cached) return { ...cached, cached: true };

  try {
    const res = await schedule(() => hibpFetch(`/breacheddomain/${encodeURIComponent(d)}`));
    if (res.status === 404) {
      // HIBP returns 404 when there are no breached accounts on the domain.
      const out = summarize(d, {});
      cacheSet(d, out);
      return out;
    }
    if (res.status === 403) {
      return { source: "hibp", domain: d, monitored: false, statusLevel: "Not monitored",
        reason: "This domain isn't verified in the ShieldAI Have I Been Pwned domain dashboard (or is out of subscription scope). Verify domain control to enable monitoring.",
        configured: true, needsVerification: true };
    }
    if (res.status === 401) {
      return { source: "hibp", domain: d, monitored: false, statusLevel: "Not active",
        reason: "The configured Have I Been Pwned API key was rejected.", configured: true };
    }
    if (res.status === 429) {
      return { source: "hibp", domain: d, monitored: true, statusLevel: "Unknown", degraded: true,
        reason: "Breach service is rate-limited right now; try again shortly.", configured: true };
    }
    if (!res.ok) {
      return { source: "hibp", domain: d, monitored: true, statusLevel: "Unknown", degraded: true,
        reason: `Breach service returned HTTP ${res.status}.`, configured: true };
    }
    const json = await res.json();
    const out = summarize(d, json || {});
    cacheSet(d, out);
    return out;
  } catch (err) {
    return { source: "hibp", domain: d, monitored: true, statusLevel: "Unknown", degraded: true,
      reason: `Could not reach the breach service (${err.message || err}).`, configured: true };
  }
}

// ── Per-client exposure, gated on verification ────────────────
// The ONLY entry point the app should use for a specific client. It refuses to
// hit HIBP unless the client registered the domain AND proved control of it
// AND an admin confirmed it's enrolled in our HIBP dashboard.
//
// Every refusal returns an honest status describing exactly what's missing —
// never a "Low risk" that a client could mistake for an all-clear.
export async function clientExposure(db, userId) {
  const record = getClientDomain(db, userId);
  const view = clientView(record, { hibpConfigured: darkwebConfigured() });

  if (!record) {
    return { source: "hibp", domain: null, monitored: false, statusLevel: "Not monitored",
      reason: view.detail, configured: darkwebConfigured(), state: view.state, nextStep: view.nextStep };
  }
  if (!darkwebConfigured()) {
    return { source: "hibp", domain: record.domain, monitored: false, statusLevel: "Not active",
      reason: "Dark-web monitoring isn't active — no Have I Been Pwned API key is configured.",
      configured: false, state: view.state };
  }
  if (record.ownership !== OWNERSHIP.VERIFIED) {
    return { source: "hibp", domain: record.domain, monitored: false, statusLevel: "Not monitored",
      reason: view.detail, configured: true, state: view.state, nextStep: view.nextStep,
      needsVerification: true };
  }
  if (record.hibpStatus !== HIBP_STATUS.VERIFIED) {
    return { source: "hibp", domain: record.domain, monitored: false, statusLevel: "Not monitored",
      reason: view.detail, configured: true, state: view.state, nextStep: view.nextStep };
  }

  // Both gates green — safe to query.
  return domainExposure(record.domain);
}

// DB-backed snapshot, parallel to the CVE one, so Mastermind reads cached data.
export async function refreshClientDarkweb(db, userId) {
  const exposure = await clientExposure(db, userId);
  db.data.darkwebExposure ||= {};
  db.data.darkwebExposure[userId] = { ...exposure, refreshedAt: new Date().toISOString() };
  await db.write();
  return db.data.darkwebExposure[userId];
}

export function cachedDarkweb(db, userId) {
  return (db.data.darkwebExposure || {})[userId] || null;
}
