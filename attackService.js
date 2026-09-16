// attackService.js
// NOT YET IMPLEMENTED. Placeholder so a MITRE ATT&CK technique mapping
// already appears in threatIntelSources.js / the admin threat-intel status
// page as a planned source, without needing to touch that plumbing again
// once this is built.
//
// MITRE ATT&CK is a free, no-key knowledge base of real-world adversary
// tactics and techniques (https://attack.mitre.org). It's already listed as
// a plain reference link in cveService.js's SECURITY_REFERENCES — this is
// about something bigger: actually mapping a client's matched CVEs/findings
// to specific ATT&CK techniques, so a finding reads as "here's how an
// attacker would actually use this" rather than just a CVE id and a score.
//
// THIS IS THE LARGEST LIFT OF THE THREE STUBS — say so plainly rather than
// implying it's the same size of task as EPSS/OSV:
//   - There is no direct "CVE -> ATT&CK technique" feed to just query.
//     MITRE publishes the ATT&CK knowledge base as a STIX 2.1 data bundle
//     (https://github.com/mitre-attack/attack-stix-data), not a lookup API.
//   - A real mapping needs an intermediate step — e.g. CVE -> CWE (NVD
//     records already carry CWE ids) -> a curated CWE-to-technique
//     correlation, since there's no universally agreed-upon direct mapping.
//     That correlation is a research/curation task, not just an API
//     integration.
//
// TO COMPLETE THIS:
//   1. Download and parse the STIX bundle into a local technique index
//      (id, name, tactic, description) — this can be a build-time/periodic
//      refresh rather than a live per-request fetch, since ATT&CK changes
//      infrequently (a few releases a year).
//   2. Build or source a CWE -> technique correlation (research task, not
//      pure engineering — there's no single canonical source for this).
//   3. In cveService.js's exposureForSoftware(), use each CVE's CWE (would
//      need to start capturing that from NVD's response — normalize()
//      currently discards it) to attach candidate `attackTechniques: [...]`
//      alongside the `kev`/`epss` fields.
//   4. Flip `configured`/`implemented` to `true` below.

export function attackServiceStatus() {
  return {
    id: "attack",
    name: "MITRE ATT&CK technique mapping",
    purpose: "Maps matched CVEs to real-world adversary tactics/techniques, via CWE as an intermediate step.",
    configured: false,
    required: false,
    implemented: false,
    envVar: null,
    keyUrl: "https://attack.mitre.org",
    impact: "Would turn a bare CVE id into a 'here's the attacker technique this maps to' narrative. The largest of the three planned sources to build — needs a CWE-to-technique correlation, not just an API call.",
    degradesTo: "Not wired up yet — ATT&CK is still available as a reference link only (see SECURITY_REFERENCES in cveService.js).",
    cacheEntries: 0,
    cacheTtlHours: null,
    blockerText: null,
    advisoryText: "Not yet implemented — see this file's header comment for the integration checklist (the largest of the three planned sources).",
  };
}

export async function probeAttack() {
  return {
    reachable: false, ok: false, latencyMs: 0,
    detail: "Not yet implemented.", checkedAt: new Date().toISOString(),
  };
}
