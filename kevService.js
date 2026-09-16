// kevService.js
// CISA's Known Exploited Vulnerabilities (KEV) catalog — the authoritative,
// free, no-key-required list of CVEs CISA has confirmed are under active
// exploitation. This is the single highest-value prioritization signal on
// top of raw CVSS severity: a CRITICAL CVE nobody is exploiting and a
// MEDIUM one that's actively being used against real targets are very
// different problems, and CVSS alone doesn't distinguish them.
//
// Unlike NVD (queried per-keyword) the whole catalog is one JSON file
// (~1,300 entries, updated a few times a week) — bulk-cache it in memory
// rather than making a network call per CVE. Same graceful-degradation
// contract as cveService.js: a fetch failure never throws into the request
// path, and a stale cache is kept rather than cleared so a transient CISA
// outage doesn't erase what was already known.
//
// Requires: nothing. No API key, no registration.

const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — KEV doesn't change often

let catalogByCveId = new Map();
let lastFetchedAt = 0;
let lastError = null;
let inFlight = null;

// Pure — exported so tests can feed it a small fixture payload without a
// network call, rather than reaching into the module's private cache state.
export function parseKevFeed(rawJson) {
  const map = new Map();
  for (const v of (rawJson?.vulnerabilities || [])) {
    if (!v?.cveID) continue;
    map.set(v.cveID, {
      cveId: v.cveID,
      vendorProject: v.vendorProject || null,
      product: v.product || null,
      vulnerabilityName: v.vulnerabilityName || null,
      dateAdded: v.dateAdded || null,
      shortDescription: v.shortDescription || null,
      requiredAction: v.requiredAction || null,
      dueDate: v.dueDate || null,
      knownRansomwareCampaignUse: v.knownRansomwareCampaignUse === "Known",
    });
  }
  return map;
}

async function fetchKevFeed() {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(KEV_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`CISA KEV ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function ensureFresh() {
  if (catalogByCveId.size > 0 && Date.now() - lastFetchedAt < CACHE_TTL_MS) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const json = await fetchKevFeed();
      catalogByCveId = parseKevFeed(json);
      lastFetchedAt = Date.now();
      lastError = null;
    } catch (err) {
      // Keep whatever's already cached — a CISA outage shouldn't erase
      // known-exploited flags that were already correct.
      lastError = String(err.message || err);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// The one function everything else calls. Cheap after the first call in a
// given TTL window (a Map lookup) — only the first call after a cold start
// or TTL expiry pays the real fetch cost.
export async function isKnownExploited(cveId) {
  if (!cveId) return null;
  await ensureFresh();
  return catalogByCveId.get(cveId) || null;
}

// ── Service status ────────────────────────────────────────────
export function kevServiceStatus() {
  return {
    id: "kev",
    name: "CISA KEV — Known Exploited Vulnerabilities",
    purpose: "Flags which of a client's matched CVEs are confirmed to be under active exploitation, with the federal remediation due date.",
    configured: true, // no key required
    required: false,
    implemented: true,
    envVar: null,
    keyUrl: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
    impact: catalogByCveId.size > 0
      ? `Loaded — ${catalogByCveId.size} known-exploited CVEs cross-referenced against matches.`
      : "Not yet loaded — the catalog is fetched lazily on first use.",
    degradesTo: "CVE matches still show CVSS severity as usual — just without the actively-exploited flag until the catalog is reachable.",
    cacheEntries: catalogByCveId.size,
    cacheTtlHours: CACHE_TTL_MS / 3600000,
    lastFetchedAt: lastFetchedAt ? new Date(lastFetchedAt).toISOString() : null,
    lastError,
    blockerText: null, // KEV is never a hard blocker — it only enriches, never gates
    advisoryText: lastError ? `Last CISA KEV catalog refresh failed: ${lastError} — showing cached/stale data.` : null,
  };
}

// Live reachability probe — actually fetches the feed (there's no cheap
// HEAD-only health check CISA documents), same shape as probeCve()/probeDarkweb().
export async function probeKev() {
  const t0 = Date.now();
  try {
    const json = await fetchKevFeed();
    const count = Array.isArray(json?.vulnerabilities) ? json.vulnerabilities.length : 0;
    return {
      reachable: true, ok: count > 0, latencyMs: Date.now() - t0,
      detail: count > 0 ? `CISA responded with ${count} catalog entries.` : "CISA responded but the catalog was empty.",
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      reachable: false, ok: false, latencyMs: Date.now() - t0,
      detail: `Could not reach CISA KEV: ${err.message || err}`,
      checkedAt: new Date().toISOString(),
    };
  }
}
