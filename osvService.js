// osvService.js
// NOT YET IMPLEMENTED. Placeholder so OSV already appears in
// threatIntelSources.js / the admin threat-intel status page as a planned
// source, without needing to touch that plumbing again once this is built.
//
// OSV (Open Source Vulnerabilities, https://osv.dev) is a free, no-key API
// focused on open-source PACKAGE vulnerabilities, keyed by ecosystem +
// package name + version (e.g. "npm" / "lodash" / "4.17.15") — not NVD's
// free-text product search. It's the natural fit if/when this app adds
// SBOM or dependency-manifest scanning, not a drop-in replacement for the
// existing software-inventory matching in cveService.js.
//
// TO COMPLETE THIS:
//   1. PREREQUISITE this app doesn't have yet: a real ecosystem+package+
//      version input. clientSoftwareDescriptors() in cveService.js returns
//      free-text strings like "OpenSSL 3.0.1" — that's enough for NVD's
//      keyword search but NOT enough for OSV's structured query. This needs
//      an actual package manifest/SBOM source (e.g. parsed from an agent's
//      inventory report, or an uploaded package-lock/requirements file)
//      before OSV can return anything meaningful. Don't wire this expecting
//      it to be a same-size task as kevService.js — the data prerequisite
//      is the real work here.
//   2. Once there's a real package list: POST batches to
//      https://api.osv.dev/v1/querybatch (no key), normalize results into
//      the same {id, description, severity, score, ...} shape
//      cveService.js's normalize() produces so the UI doesn't need two
//      different CVE record shapes.
//   3. Decide how OSV results merge with NVD results for the same CVE id
//      (OSV and NVD can both know about the same CVE) rather than showing
//      duplicates.
//   4. Flip `configured`/`implemented` to `true` below.

export function osvServiceStatus() {
  return {
    id: "osv",
    name: "OSV — Open Source Vulnerabilities",
    purpose: "Package-ecosystem vulnerability database (npm, PyPI, Go, etc.) for open-source dependency exposure.",
    configured: false,
    required: false,
    implemented: false,
    envVar: null,
    keyUrl: "https://osv.dev/",
    impact: "Would add open-source package/dependency vulnerability matching (npm, PyPI, Go, etc.) — most useful once this app collects real package manifests, not just free-text software names.",
    degradesTo: "Not wired up yet — no dependency-level vulnerability matching.",
    cacheEntries: 0,
    cacheTtlHours: null,
    blockerText: null,
    advisoryText: "Not yet implemented — see this file's header comment for the integration checklist (needs a real package/ecosystem input first).",
  };
}

export async function probeOsv() {
  return {
    reachable: false, ok: false, latencyMs: 0,
    detail: "Not yet implemented.", checkedAt: new Date().toISOString(),
  };
}
