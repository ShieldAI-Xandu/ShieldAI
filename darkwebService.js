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

// Pull a domain from a client's record / assessment. Best-effort, defensive.
export function clientDomain(db, userId) {
  const user = (db.data.users || []).find(u => u.id === userId);
  // Prefer an explicit website/domain field; fall back to the email domain.
  const assessments = (db.data.assessments || []).filter(a => a.userId === userId);
  const latest = assessments[assessments.length - 1];
  const fromAssessment = latest?.data?.company?.website || latest?.data?.company?.domain
    || latest?.company?.website || latest?.company?.domain || null;
  const raw = user?.companyDomain || user?.website || fromAssessment || null;
  let domain = raw;
  if (domain) {
    domain = String(domain).trim().toLowerCase()
      .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  }
  // Fall back to the email's domain if nothing else is available.
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

// DB-backed snapshot, parallel to the CVE one, so Mastermind reads cached data.
export async function refreshClientDarkweb(db, userId) {
  const domain = clientDomain(db, userId);
  const exposure = await domainExposure(domain);
  db.data.darkwebExposure ||= {};
  db.data.darkwebExposure[userId] = { ...exposure, refreshedAt: new Date().toISOString() };
  await db.write();
  return db.data.darkwebExposure[userId];
}

export function cachedDarkweb(db, userId) {
  return (db.data.darkwebExposure || {})[userId] || null;
}
