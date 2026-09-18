// demoIntel.js
// Threat intelligence for the demo sandbox.
//
// THE RULE THIS FILE EXISTS TO ENFORCE
// ------------------------------------
// The demo must feel like the real product, but it must never assert a security
// fact that is false. Those two goals only conflict if you let a model invent
// the data — so we don't.
//
//   CVEs   → REAL. The demo companies run fixed, plausible software stacks, and
//            we query the live NVD API for them exactly as a real client does.
//            An investor can copy any CVE ID out of the demo and look it up at
//            nvd.nist.gov, and it will be there, saying what we said it says.
//            This is a stronger demo than any invented data, and it can't
//            embarrass us in diligence.
//
//   Breach → CANNED. HIBP can only answer for domains verified in our dashboard,
//            and the demo companies are fictional, so a live query is impossible
//            by construction. We serve a fixed, realistic dataset instead —
//            built from breach names that really exist, attached to a fictional
//            domain. It is clearly marked `simulated: true` in the payload so no
//            downstream code can mistake it for a live result.
//
// Neither path asks an LLM to make up a vulnerability, a CVE number, a CVSS
// score, or a breach. That's the line: presentation is demo, security facts are
// real or explicitly simulated.

import { exposureForSoftware, DEMO_STACKS } from "./cveService.js";

// Demo company software stacks live in cveService.js (single source of truth,
// and it avoids an import cycle since the CVE path needs them too).
export { DEMO_STACKS };

// Fallback for any demo company without an explicit stack.
const DEFAULT_STACK = ["Windows Server 2019", "OpenSSL 1.1.1", "Apache 2.4.49"];

export function demoStackFor(companyName) {
  return DEMO_STACKS[companyName] || DEFAULT_STACK;
}

// ── Real CVE exposure for a demo company ──────────────────────
// Uses the same code path as production: same NVD client, same rate limiter,
// same cache, same normalization. The only difference is where the software
// list comes from.
export async function demoCveExposure(companyName) {
  const software = demoStackFor(companyName);
  const exposure = await exposureForSoftware(software);
  return {
    ...exposure,
    software,
    // Honest about what's demo and what isn't: the COMPANY is fictional, the
    // VULNERABILITIES are real records from NIST.
    demo: true,
    dataSource: "nvd-live",
    note: "Fictional company, real vulnerability data — these CVE records are live from the NIST National Vulnerability Database.",
  };
}

// ── Canned breach exposure ────────────────────────────────────
// Real breach names (these incidents genuinely happened and are in HIBP's
// corpus), attached to a fictional domain and fictional account counts. We
// never claim these specific accounts were breached — the demo company
// doesn't exist.
//
// Keyed by each demo company's own companyName, same as DEMO_STACKS in
// cveService.js — one seeded client account per company, so each gets its
// own snapshot consistent with its own posture story rather than all three
// sharing one. Domains match the fictional employee email domains already
// used for that company's seeded training learners.
const DEMO_BREACHES = {
  // Modest IT maturity — a small, credible exposure, not zero.
  "Meridian Dental Group": {
    domain: "meridiandental.example",
    statusLevel: "Moderate risk",
    breachedAccounts: 5,
    distinctBreaches: 3,
    breaches: ["LinkedIn", "Dropbox", "Canva"],
    sampleAccounts: ["front.desk", "billing"],
  },
  // Well-resourced, security-conscious firm — a small, modest exposure is the
  // credible story, not zero (a flawless "no intel" reading looks fabricated)
  // and not the dramatic "high alert" reading a weaker company would show.
  "Lakeside Financial Advisors": {
    domain: "lakesidefinancial.example",
    statusLevel: "Low risk",
    breachedAccounts: 2,
    distinctBreaches: 2,
    breaches: ["LinkedIn", "Adobe"],
    sampleAccounts: ["m.ortiz", "reception"],
  },
  // Weakest posture — the "real gaps" company: a larger, more elevated
  // exposure consistent with its weaker overall security story.
  "Apex Manufacturing": {
    domain: "apexmfg.example",
    statusLevel: "Elevated risk",
    breachedAccounts: 9,
    distinctBreaches: 4,
    breaches: ["LinkedIn", "Adobe", "Canva", "MyFitnessPal"],
    sampleAccounts: ["d.holt", "operations"],
  },
};

export function demoDarkwebExposure(companyName) {
  const base = DEMO_BREACHES[companyName] || {
    domain: "example.example",
    statusLevel: "No intel",
    breachedAccounts: 0,
    distinctBreaches: 0,
    breaches: [],
    sampleAccounts: [],
  };

  return {
    source: "hibp",
    ...base,
    monitored: true,
    configured: true,
    checkedAt: new Date().toISOString(),
    // Load-bearing flag: any code or UI that surfaces this MUST be able to tell
    // it apart from a live HIBP result. Never remove it to make a screenshot
    // look cleaner.
    demo: true,
    simulated: true,
    dataSource: "demo-fixture",
    note: "Simulated breach data for a fictional company. Real breach monitoring requires a verified domain.",
  };
}

// ── Attack-surface discovery ────────────────────────────────────
// Same rule as breach data above: crt.sh can only answer for domains that
// actually have certificate-transparency log entries, and the demo
// companies' .example domains never will (by construction — .example is
// reserved and never issued real certificates). A live query is impossible,
// so this is a fixed, plausible fixture, clearly flagged simulated: true.
// Reuses each company's real DEMO_STACKS entry as the "discovered" software
// banner, so the CVEs an investor sees on the attack-surface card are the
// exact same real, live-NVD-queried CVEs already shown on the CVE Exposure
// card — one consistent story, not two disconnected fixtures.
const DEMO_SURFACES = {
  "Meridian Dental Group": {
    domain: "meridiandental.example",
    subdomains: ["www.meridiandental.example", "portal.meridiandental.example", "mail.meridiandental.example"],
    liveHost: "www.meridiandental.example",
  },
  "Lakeside Financial Advisors": {
    domain: "lakesidefinancial.example",
    subdomains: ["www.lakesidefinancial.example", "vpn.lakesidefinancial.example", "portal.lakesidefinancial.example"],
    liveHost: "vpn.lakesidefinancial.example",
  },
  "Apex Manufacturing": {
    domain: "apexmfg.example",
    subdomains: ["www.apexmfg.example", "erp.apexmfg.example", "ftp.apexmfg.example"],
    liveHost: "erp.apexmfg.example",
  },
};

export function demoAttackSurface(companyName, domainOverride) {
  const fixture = DEMO_SURFACES[companyName] || {
    domain: domainOverride || "example.example",
    subdomains: [`www.${domainOverride || "example.example"}`],
    liveHost: domainOverride || "example.example",
  };
  const banner = demoStackFor(companyName)[0] || null;
  return {
    domain: fixture.domain,
    subdomains: fixture.subdomains,
    liveHosts: [{ host: fixture.liveHost, scheme: "https", live: true, statusCode: 200, server: banner, poweredBy: null }],
    discoveredSoftware: banner ? [banner] : [],
    degraded: false,
    checkedAt: new Date().toISOString(),
    // Load-bearing, same as demoDarkwebExposure — never strip these so a
    // simulated result can't be mistaken for a live crt.sh/HTTP probe.
    demo: true,
    simulated: true,
    dataSource: "demo-fixture",
    note: "Simulated external recon for a fictional company. Real attack-surface discovery requires a verified domain.",
  };
}

// ── Domain records for demo companies ─────────────────────────
// The demo shows the domain workflow in its FINISHED state — verified and
// monitored — because that's what a prospect wants to see. The workflow itself
// is still fully clickable in the sandbox.
export function demoDomainRecord(userId, companyName) {
  const b = DEMO_BREACHES[companyName];
  const now = new Date().toISOString();
  return {
    id: `demo-domain-${userId}`,
    userId,
    domain: b?.domain || "example.example",
    ownership: "verified",
    verificationToken: "demo-token-not-a-real-secret",
    ownershipVerifiedAt: now,
    lastCheckedAt: now,
    lastCheckError: null,
    hibpStatus: "verified",
    hibpNote: "Demo fixture — verified for the sandbox.",
    hibpUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
    demo: true,
    history: [
      { at: now, event: "submitted", detail: b?.domain || "example.example" },
      { at: now, event: "ownership_verified", detail: b?.domain || "example.example" },
      { at: now, event: "hibp_verified", detail: "Demo fixture" },
    ],
  };
}
