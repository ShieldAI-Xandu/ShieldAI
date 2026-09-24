// attackSurfaceService.js
// ShieldAI vCISO external attack-surface discovery — subdomain enumeration via
// public certificate-transparency logs, plus lightweight HTTP header
// probing of whatever's actually live.
//
// SCOPE, BY DESIGN (not a partial build):
//  - Passive/lightweight reconnaissance ONLY. Certificate-transparency-log
//    lookups are public records anyone can already query; an HTTP HEAD/GET
//    is exactly what a browser visiting the site would do. No port
//    scanning, no vulnerability probing of live services, nothing that
//    reaches beyond what a normal web request already does.
//  - Only ever runs against a domain the client has proven ownership of
//    (see clientAttackSurface's gate) — this makes live outbound
//    connections to the target's infrastructure, unlike a pure DNS lookup,
//    so it's held to the same authorization bar as the rest of this
//    codebase's external checks, not a looser one.
//  - Discovered software (from HTTP Server/X-Powered-By headers) feeds
//    straight into the existing NVD CVE engine via
//    cveService.clientSoftwareDescriptors() — this is what turns "we found
//    a subdomain" into real, actionable data instead of a list of names.
//
// Resilience: same conventions as cveService.js/darkwebService.js — cached,
// rate-limited, timed out, never throws into the request path.

import { listClientDomains, OWNERSHIP } from "./domainService.js";
import { safeFetch } from "./outboundUrlSafety.js";

const CRTSH_BASE = "https://crt.sh/";
// crt.sh is a free community service with no SLA and can be slow — a longer
// timeout than the 12s used for NVD/HIBP is deliberate, not an oversight.
const CRTSH_TIMEOUT_MS = 15000;
const HTTP_PROBE_TIMEOUT_MS = 6000;
const MAX_SUBDOMAINS_RETURNED = 40;
const MAX_HOSTS_PROBED = 15;

const cache = new Map();                  // domain -> { at, data }
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;  // 24h — matches the email-security scan's cadence
let lastCrtshRequestAt = 0;
let crtshQueue = Promise.resolve();
const CRTSH_MIN_INTERVAL_MS = 2000; // be polite to a free community service

function cacheGet(key) {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < CACHE_TTL_MS ? hit.data : null;
}
function cacheSet(key, data) { cache.set(key, { at: Date.now(), data }); }

function scheduleCrtsh(fn) {
  const run = crtshQueue.then(async () => {
    const wait = Math.max(0, CRTSH_MIN_INTERVAL_MS - (Date.now() - lastCrtshRequestAt));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastCrtshRequestAt = Date.now();
    return fn();
  });
  crtshQueue = run.catch(() => {});
  return run;
}

// ── Service status (for the admin threat-intel panel) ────────────
export function attackSurfaceServiceStatus() {
  return {
    id: "attackSurface",
    name: "crt.sh (Certificate Transparency)",
    purpose: "Subdomain discovery + HTTP banner probing for verified client domains.",
    configured: true, // no API key — crt.sh is free and unauthenticated
    required: false,
    envVar: null,
    keyUrl: null,
    minIntervalMs: CRTSH_MIN_INTERVAL_MS,
    impact: "Always available — crt.sh needs no key.",
    degradesTo: "A crt.sh outage returns a degraded result, never a fabricated empty-surface all-clear.",
    cacheEntries: cache.size,
    cacheTtlHours: CACHE_TTL_MS / 3600000,
    implemented: true,
    blockerText: null,
    advisoryText: null,
  };
}

export async function probeAttackSurface() {
  const t0 = Date.now();
  try {
    // Routed through scheduleCrtsh, same as every real scan — otherwise an
    // admin-panel probe landing mid-scan could double up on crt.sh well
    // under CRTSH_MIN_INTERVAL_MS, the exact "be polite" contract this
    // module documents for every other call site.
    const json = await scheduleCrtsh(() => crtshFetch("example.com"));
    const ok = Array.isArray(json) && json.length > 0;
    return { reachable: true, ok, latencyMs: Date.now() - t0,
      detail: ok ? "crt.sh responded with certificate records." : "crt.sh responded but returned no data.",
      checkedAt: new Date().toISOString() };
  } catch (err) {
    return { reachable: false, ok: false, latencyMs: Date.now() - t0,
      detail: `Could not reach crt.sh: ${err.message || err}`, checkedAt: new Date().toISOString() };
  }
}

async function crtshFetch(domain) {
  const url = `${CRTSH_BASE}?q=${encodeURIComponent(`%.${domain}`)}&output=json`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), CRTSH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`crt.sh ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Certificate common names / SANs -> a deduplicated, sorted subdomain list.
// crt.sh's name_value field can contain several newline-separated names per
// certificate (SANs), and wildcard entries (*.example.com) — both handled.
function extractSubdomains(records, domain) {
  const suffix = `.${domain}`.toLowerCase();
  const out = new Set();
  for (const rec of Array.isArray(records) ? records : []) {
    const names = String(rec?.name_value || "").split("\n");
    for (let name of names) {
      name = name.trim().toLowerCase().replace(/^\*\./, "");
      if (!name || name === domain.toLowerCase()) continue;
      if (name.endsWith(suffix) || name === domain.toLowerCase()) out.add(name);
    }
  }
  return [...out].sort().slice(0, MAX_SUBDOMAINS_RETURNED);
}

// Lightweight HTTP HEAD probe — exactly what a browser visiting the host
// would trigger. Captures only what the server voluntarily announces in its
// response headers; never attempts auth, never sends a body, never retries
// aggressively.
//
// SSRF guard (safeFetch, not a bare fetch): the domain-ownership check
// (DNS TXT record) that gates this whole feature proves the client
// controls the domain's DNS — which is exactly the capability needed to
// point that same domain's A record at 127.0.0.1, 169.254.169.254 (cloud
// metadata), or an internal RFC1918 address. Ownership of the name proves
// nothing about the safety of where it currently resolves, so every host
// here — the apex domain and every crt.sh-discovered subdomain — is
// resolved and IP-validated immediately before connecting, the same guard
// directoryRoutes.js/productivityAdapters.js already use for the
// equivalent "client names a host, server calls it" shape.
async function probeHost(host) {
  for (const scheme of ["https", "http"]) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), HTTP_PROBE_TIMEOUT_MS);
    try {
      const res = await safeFetch(`${scheme}://${host}/`, { method: "HEAD", signal: ctrl.signal });
      clearTimeout(timeout);
      return {
        host, scheme, live: true, statusCode: res.status,
        server: res.headers.get("server") || null,
        poweredBy: res.headers.get("x-powered-by") || null,
      };
    } catch {
      clearTimeout(timeout);
      // try the next scheme — includes hosts that fail the private-IP
      // guard, which is deliberately indistinguishable here from a plain
      // connection failure (never reveal *why* a host didn't respond).
    }
  }
  return { host, scheme: null, live: false, statusCode: null, server: null, poweredBy: null };
}

// Software descriptors derived from HTTP banners, in the same "Name Version"
// string shape cveService.clientSoftwareDescriptors() already produces from
// agent inventory — so this unions straight into the existing NVD pipeline
// with no new CVE-matching code.
function softwareFromHosts(liveHosts) {
  const out = new Set();
  for (const h of liveHosts) {
    if (h.server) out.add(h.server);
    if (h.poweredBy) out.add(h.poweredBy);
  }
  return [...out];
}

// ── Core scan ──────────────────────────────────────────────────
export async function scanAttackSurface(domain) {
  const d = String(domain || "").trim().toLowerCase();
  if (!d) {
    return { domain: null, subdomains: [], liveHosts: [], discoveredSoftware: [], degraded: false,
      reason: "No domain provided." };
  }

  const cached = cacheGet(d);
  if (cached) return { ...cached, cached: true };

  let subdomains = [];
  let degraded = false;
  try {
    const records = await scheduleCrtsh(() => crtshFetch(d));
    subdomains = extractSubdomains(records, d);
  } catch (err) {
    degraded = true;
  }

  // Always include the apex domain itself as a probe candidate, even if CT
  // enumeration failed or found nothing — there's still something to say
  // about the domain's own live host.
  const candidates = [...new Set([d, ...subdomains])].slice(0, MAX_HOSTS_PROBED);
  const probes = await Promise.allSettled(candidates.map(probeHost));
  const liveHosts = probes
    .map(p => (p.status === "fulfilled" ? p.value : null))
    .filter(h => h && h.live);

  const out = {
    domain: d,
    subdomains,
    liveHosts,
    discoveredSoftware: softwareFromHosts(liveHosts),
    degraded,
    checkedAt: new Date().toISOString(),
  };
  if (!degraded) cacheSet(d, out);
  return out;
}

// Merge per-domain scans (a client can have more than one verified domain)
// into one flat result — same idea as darkwebService's mergeExposures, just
// without severity buckets since there's nothing to rank here yet.
function mergeAttackSurfaceResults(results) {
  const degraded = results.some(r => r.degraded);
  return {
    domain: results.map(r => r.domain).join(", "),
    subdomains: [...new Set(results.flatMap(r => r.subdomains || []))].sort(),
    liveHosts: results.flatMap(r => r.liveHosts || []),
    discoveredSoftware: [...new Set(results.flatMap(r => r.discoveredSoftware || []))],
    degraded,
    checkedAt: new Date().toISOString(),
  };
}

// ── Per-client attack surface, gated on domain-ownership verification ──
// The ONLY entry point the app should use. Refuses to make any outbound
// connection to a domain the client hasn't registered and proved control
// of — same authorization principle darkwebService.clientExposure()
// enforces for HIBP, applied here because this feature makes live
// connections to the target's own infrastructure (unlike a pure DNS
// lookup), not because of HIBP-style data sensitivity. Deliberately does
// NOT require the HIBP-specific dashboard enrollment (isMonitorable) —
// that gate is about a different, HIBP-only workflow step.
export async function clientAttackSurface(db, userId, { isDemo = false } = {}) {
  if (isDemo) {
    const user = (db.data.users || []).find(u => u.id === userId);
    const { demoAttackSurface } = await import("./demoIntel.js");
    return demoAttackSurface(user?.companyName);
  }

  const records = listClientDomains(db, userId);
  if (!records.length) {
    return { domain: null, subdomains: [], liveHosts: [], discoveredSoftware: [],
      monitored: false, reason: "No company domain on file. Add your company domain to enable it.",
      state: "none", nextStep: "submit_domain" };
  }

  const verified = records.filter(r => r.ownership === OWNERSHIP.VERIFIED);
  if (!verified.length) {
    return { domain: records.map(r => r.domain).join(", "), subdomains: [], liveHosts: [], discoveredSoftware: [],
      monitored: false,
      reason: "Verify control of your domain (DNS TXT record) to enable attack-surface discovery.",
      state: "pending_verification", nextStep: "verify_domain" };
  }

  const results = await Promise.all(verified.map(r => scanAttackSurface(r.domain)));
  const merged = mergeAttackSurfaceResults(results);
  merged.monitored = true;
  const notYet = records.length - verified.length;
  if (notYet > 0) {
    merged.note = `${notYet} of ${records.length} domain${records.length === 1 ? "" : "s"} on file ` +
      `${notYet === 1 ? "isn't" : "aren't"} verified yet and weren't scanned.`;
  }
  return merged;
}

// ── DB-backed snapshot, parallel to cveExposure/darkwebExposure ──
export async function refreshClientAttackSurface(db, userId, opts = {}) {
  const result = await clientAttackSurface(db, userId, opts);
  db.data.attackSurfaceExposure ||= {};
  db.data.attackSurfaceExposure[userId] = { ...result, refreshedAt: new Date().toISOString() };
  await db.write();
  return db.data.attackSurfaceExposure[userId];
}

export function cachedAttackSurface(db, userId) {
  return (db.data.attackSurfaceExposure || {})[userId] || null;
}
