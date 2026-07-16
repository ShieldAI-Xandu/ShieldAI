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
// corpus), attached to fictional domains and fictional account counts. We never
// claim these specific accounts were breached — the demo company doesn't exist.
const DEMO_BREACHES = {
  "Meridian Dental Group": {
    domain: "meridiandental.example",
    statusLevel: "Elevated",
    breachedAccounts: 7,
    distinctBreaches: 3,
    breaches: ["Collection1", "LinkedIn", "MyFitnessPal"],
    sampleAccounts: ["billing", "frontdesk", "j.reyes", "scheduling"],
  },
  "Cascade Logistics": {
    domain: "cascadelogistics.example",
    statusLevel: "High alert",
    breachedAccounts: 31,
    distinctBreaches: 6,
    breaches: ["Collection1", "Dropbox", "LinkedIn", "MyFitnessPal", "River City Media", "Zynga"],
    sampleAccounts: ["dispatch", "ops", "m.chen", "warehouse", "hr", "accounts"],
  },
  "Northgate Financial": {
    domain: "northgatefinancial.example",
    statusLevel: "Low risk",
    breachedAccounts: 1,
    distinctBreaches: 1,
    breaches: ["LinkedIn"],
    sampleAccounts: ["info"],
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
