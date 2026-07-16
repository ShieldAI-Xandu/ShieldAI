// cveService.js
// ShieldAI vulnerability-intelligence service.
//
// Queries the REAL NIST National Vulnerability Database (NVD) CVE API 2.0 —
// the canonical, machine-readable source for CVE records published by MITRE
// and enriched (CVSS severity, CPE) by NIST. We use NVD rather than scraping
// cve.org because NVD exposes a documented JSON API and adds severity scoring.
//
// IMPORTANT HONESTY NOTES (by design, not omission):
//  - A CVE lookup maps SOFTWARE + VERSION -> known vulnerabilities. It cannot
//    "scan" a website or infer risk from a URL alone. We feed it the software
//    a client actually reports (via the monitoring agent's inventory or an
//    assessment field). No software list -> no fabricated CVEs.
//  - CNSS (Committee on National Security Systems) is NOT a vulnerability
//    database and has no query API; it publishes policy/instruction documents
//    for U.S. national-security systems. We expose it as a reference link only.
//
// Resilience: results are cached; NVD outages or rate-limits degrade
// gracefully (we return cached/empty rather than throwing into the app).

const NVD_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0";

// Optional free API key (https://nvd.nist.gov/developers/request-an-api-key).
// Without a key NVD requires ~6s between requests; with one, ~0.6s.
const NVD_API_KEY = process.env.NVD_API_KEY || "";
const MIN_INTERVAL_MS = NVD_API_KEY ? 700 : 6500;

// ── Authoritative reference links (shown in the UI) ───────────────
export const SECURITY_REFERENCES = [
  { id: "cve",     name: "CVE — Common Vulnerabilities and Exposures", url: "https://www.cve.org",
    org: "MITRE", purpose: "The canonical public catalog of disclosed security vulnerabilities." },
  { id: "nvd",     name: "NVD — National Vulnerability Database", url: "https://nvd.nist.gov",
    org: "NIST", purpose: "CVE records enriched with CVSS severity scores and affected-product data. ShieldAI queries this live." },
  { id: "attack",  name: "MITRE ATT&CK", url: "https://attack.mitre.org",
    org: "MITRE", purpose: "Knowledge base of real-world adversary tactics and techniques." },
  { id: "mitre",   name: "MITRE", url: "https://www.mitre.org",
    org: "MITRE", purpose: "Operator of the CVE program and ATT&CK framework." },
  { id: "nist_csf", name: "NIST Cybersecurity Framework", url: "https://www.nist.gov/cyberframework",
    org: "NIST", purpose: "The framework ShieldAI's deterministic posture score is built on." },
  { id: "cnss",    name: "CNSS — Committee on National Security Systems", url: "https://www.cnss.gov",
    org: "CNSS", purpose: "Policy and instructions (e.g. CNSSI-1253) for U.S. national-security systems. Reference framework — not a live database." },
];

// ── Service status ────────────────────────────────────────────────
// Whether NVD is keyed, and what that costs us in latency. The key is optional
// but the difference is large: without one, NVD demands ~6s between requests,
// so a 12-item software inventory takes ~78s instead of ~8s.
export function cveServiceStatus() {
  return {
    id: "nvd",
    name: "NVD — National Vulnerability Database",
    purpose: "Live CVE matching against reported software versions.",
    configured: !!NVD_API_KEY,
    required: false,
    envVar: "NVD_API_KEY",
    keyUrl: "https://nvd.nist.gov/developers/request-an-api-key",
    minIntervalMs: MIN_INTERVAL_MS,
    // What a full inventory refresh actually costs the client, in wall time.
    worstCaseRefreshSec: Math.round((MIN_INTERVAL_MS * 12) / 100) / 10,
    impact: NVD_API_KEY
      ? "Keyed — lookups run at roughly one every 0.7s."
      : "Unkeyed — NVD throttles us to one lookup every ~6.5s. CVE refreshes are slow but still accurate.",
    degradesTo: "Without a key the service still works; it's only slower. It never returns fabricated CVEs.",
    cacheEntries: cache.size,
    cacheTtlHours: CACHE_TTL_MS / 3600000,
  };
}

// Live reachability probe. A key being present doesn't prove the service
// answers — this actually calls NVD with a trivial query and reports what
// happened. Used by the admin status panel so "operational" means something.
export async function probeCve() {
  const t0 = Date.now();
  try {
    const params = new URLSearchParams({ cveId: "CVE-2021-44228" }); // Log4Shell — stable, always present
    const json = await nvdFetch(params);
    const found = (json.vulnerabilities || []).length > 0;
    return {
      reachable: true,
      ok: found,
      latencyMs: Date.now() - t0,
      detail: found ? "NVD responded with a known CVE record." : "NVD responded but returned no data.",
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      reachable: false,
      ok: false,
      latencyMs: Date.now() - t0,
      detail: `Could not reach NVD: ${err.message || err}`,
      checkedAt: new Date().toISOString(),
    };
  }
}

// ── Simple in-memory cache + rate limiter ─────────────────────────
const cache = new Map();            // key -> { at, data }
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let lastRequestAt = 0;
let queue = Promise.resolve();      // serialize NVD calls to honor rate limit

function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  return null;
}
function cacheSet(key, data) { cache.set(key, { at: Date.now(), data }); }

// Serialize + space out requests so we never trip NVD's rate limit.
function schedule(fn) {
  const run = queue.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  // keep the chain alive even if one call rejects
  queue = run.catch(() => {});
  return run;
}

// Normalize one NVD vulnerability record into a compact, safe shape.
function normalize(v) {
  const cve = v.cve || {};
  const desc = (cve.descriptions || []).find(d => d.lang === "en")?.value
    || (cve.descriptions || [])[0]?.value || "";
  const m = cve.metrics || {};
  const metric = (m.cvssMetricV31 || m.cvssMetricV30 || m.cvssMetricV2 || [])[0];
  const cvss = metric?.cvssData || {};
  return {
    id: cve.id,
    description: desc.length > 280 ? desc.slice(0, 277) + "…" : desc,
    severity: cvss.baseSeverity || metric?.baseSeverity || "UNKNOWN",
    score: cvss.baseScore ?? null,
    published: cve.published || null,
    url: cve.id ? `https://www.cve.org/CVERecord?id=${cve.id}` : null,
  };
}

async function nvdFetch(params) {
  const url = `${NVD_BASE}?${params.toString()}`;
  const headers = NVD_API_KEY ? { apiKey: NVD_API_KEY } : {};
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`NVD ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Search CVEs by free-text keyword (e.g. "Apache 2.4.49", "WordPress 6.1").
// Returns up to `limit` normalized records, most severe first.
export async function searchByKeyword(keyword, { limit = 5, severity = null } = {}) {
  const kw = String(keyword || "").trim();
  if (!kw) return { source: "nvd", keyword: kw, results: [], degraded: false };

  const cacheKey = `kw:${kw}:${limit}:${severity || ""}`;
  const cached = cacheGet(cacheKey);
  if (cached) return { ...cached, cached: true };

  const params = new URLSearchParams({ keywordSearch: kw, resultsPerPage: String(Math.min(limit * 4, 50)) });
  if (severity) params.set("cvssV3Severity", String(severity).toUpperCase());

  try {
    const json = await schedule(() => nvdFetch(params));
    let results = (json.vulnerabilities || []).map(normalize)
      .filter(r => r.id)
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
      .slice(0, limit);
    const out = { source: "nvd", keyword: kw, total: json.totalResults ?? results.length, results, degraded: false };
    cacheSet(cacheKey, out);
    return out;
  } catch (err) {
    // Graceful degradation: never throw into the request path.
    return { source: "nvd", keyword: kw, results: [], degraded: true, error: String(err.message || err) };
  }
}

// Given a list of software descriptors (strings like "WordPress 6.1",
// "OpenSSL 3.0.1"), return the consolidated CVE exposure. Honors rate limits
// by querying sequentially through the shared scheduler.
export async function exposureForSoftware(softwareList, { perItem = 3 } = {}) {
  const items = (Array.isArray(softwareList) ? softwareList : [])
    .map(s => String(s || "").trim()).filter(Boolean).slice(0, 12); // cap to be polite
  const findings = [];
  let degraded = false;
  for (const sw of items) {
    const r = await searchByKeyword(sw, { limit: perItem });
    if (r.degraded) degraded = true;
    findings.push({ software: sw, cves: r.results, total: r.total ?? r.results.length });
  }
  // Flat, severity-sorted rollup for quick display
  const all = findings.flatMap(f => f.cves.map(c => ({ ...c, software: f.software })));
  all.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const counts = all.reduce((acc, c) => { const k = (c.severity || "UNKNOWN").toUpperCase(); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  return { bySoftware: findings, top: all.slice(0, 10), counts, degraded, queriedAt: new Date().toISOString() };
}

// ── DB-backed exposure snapshot (so Mastermind reads cached, not live) ──
//
// Live NVD lookups are rate-limited (~6s each without a key), so we never run
// them inside a synchronous snapshot. Instead we refresh a per-client exposure
// record into db.data.cveExposure and the snapshot reads that. Refresh can be
// triggered on a schedule, after an agent report, or on demand.

export async function refreshClientExposure(db, userId) {
  const software = clientSoftwareDescriptors(db, userId);
  db.data.cveExposure ||= {};
  if (software.length === 0) {
    db.data.cveExposure[userId] = { software: [], counts: {}, top: [], degraded: false, refreshedAt: new Date().toISOString(), empty: true };
    await db.write();
    return db.data.cveExposure[userId];
  }
  const exposure = await exposureForSoftware(software);
  db.data.cveExposure[userId] = {
    software,
    counts: exposure.counts,
    top: exposure.top,
    degraded: exposure.degraded,
    refreshedAt: exposure.queriedAt,
    empty: false,
  };
  await db.write();
  return db.data.cveExposure[userId];
}

// Synchronous read of the cached exposure for a user (safe inside snapshots).
export function cachedExposure(db, userId) {
  return (db.data.cveExposure || {})[userId] || null;
}

// Pull the software descriptors a client has reported, from (a) their agents'
// latest report inventory and (b) an optional assessment techStack field.
// Best-effort and defensive about shapes — returns a de-duplicated string list.
export function clientSoftwareDescriptors(db, userId) {
  const out = new Set();

  // Latest report per agent for this user (inventory lives in agentReports).
  const reports = (db.data.agentReports || []).filter(r => r.ownerUserId === userId);
  const latestByAgent = {};
  for (const r of reports) {
    const cur = latestByAgent[r.agentId];
    if (!cur || new Date(r.receivedAt) > new Date(cur.receivedAt)) latestByAgent[r.agentId] = r;
  }
  for (const a of (db.data.agents || [])) {
    if (a.ownerUserId !== userId) continue;
    const rep = latestByAgent[a.id]?.report;
    if (a.os && rep?.host?.osVersion) out.add(`${a.os} ${rep.host.osVersion}`);
    const inv = rep?.inventory || {};
    const list = inv.software || inv.products || inv.packages || [];
    for (const pkg of (Array.isArray(list) ? list : [])) {
      if (typeof pkg === "string") out.add(pkg);
      else if (pkg && pkg.name) out.add(pkg.version ? `${pkg.name} ${pkg.version}` : pkg.name);
    }
  }

  // From the most recent assessment's techStack (if the client provided one)
  const assessments = (db.data.assessments || []).filter(a => a.userId === userId);
  const latest = assessments[assessments.length - 1];
  const stack = latest?.techStack || latest?.technologies || [];
  for (const s of (Array.isArray(stack) ? stack : [])) {
    if (typeof s === "string") out.add(s);
    else if (s && s.name) out.add(s.version ? `${s.name} ${s.version}` : s.name);
  }

  return [...out];
}
