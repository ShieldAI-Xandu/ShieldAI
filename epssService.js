// epssService.js
// NOT YET IMPLEMENTED. Placeholder so EPSS already appears in
// threatIntelSources.js / the admin threat-intel status page as a planned
// source, without needing to touch that plumbing again once this is built.
//
// EPSS (Exploit Prediction Scoring System, FIRST.org) scores every CVE 0-100%
// for the probability it gets exploited in the next 30 days. Free, no API
// key. Pairs with CVSS severity for a "likely x severe" ranking instead of
// severity alone — complements, doesn't duplicate, the CISA KEV integration
// in kevService.js (KEV is a confirmed-exploited YES/NO list; EPSS is a
// probability estimate that covers CVEs KEV hasn't listed yet).
//
// TO COMPLETE THIS:
//   1. Bulk-cache the daily EPSS score set, the same way kevService.js
//      bulk-caches the KEV catalog rather than querying per-CVE — either the
//      REST API (https://api.first.org/data/v1/epss, supports ?cve=<id>
//      lookups but is meant for small batches) or the daily bulk CSV
//      (https://epss.empiricalsecurity.com/epss_scores-current.csv.gz) for
//      full coverage. Mirror kevService.js's ensureFresh()/in-flight-promise
//      shape.
//   2. In cveService.js's exposureForSoftware(), add an `epss: {score,
//      percentile}` field next to the `kev` field in the same enrichment
//      step (see that file's own comment for exactly where).
//   3. Flip `configured`/`implemented` to `true` below and remove this
//      header's "NOT YET IMPLEMENTED" framing.
//   4. Add threatIntelSources.js's `epss` entry's real statusFn/probeFn —
//      already wired, just swap these stub exports for real ones.

export function epssServiceStatus() {
  return {
    id: "epss",
    name: "EPSS — Exploit Prediction Scoring System",
    purpose: "Probability score (0-100%) that a CVE gets exploited in the next 30 days, from FIRST.org.",
    configured: false,
    required: false,
    implemented: false,
    envVar: null, // no key needed, once built
    keyUrl: "https://www.first.org/epss/",
    impact: "Would add a 0-100% exploitation-likelihood score next to each matched CVE, for prioritizing beyond CVSS severity alone.",
    degradesTo: "Not wired up yet — CVE matches show CVSS severity and CISA KEV status only.",
    cacheEntries: 0,
    cacheTtlHours: null,
    blockerText: null,
    advisoryText: "Not yet implemented — see this file's header comment for the integration checklist.",
  };
}

export async function probeEpss() {
  return {
    reachable: false, ok: false, latencyMs: 0,
    detail: "Not yet implemented.", checkedAt: new Date().toISOString(),
  };
}
