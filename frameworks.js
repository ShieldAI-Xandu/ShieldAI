// frameworks.js
// The single registry of every compliance framework ShieldAI offers, and — the
// part that matters — an honest statement of how deeply each one is actually
// implemented.
//
// WHY DEPTH IS A FIRST-CLASS FIELD
// --------------------------------
// It is trivially easy to "support" a framework by putting its name in a list
// and letting a language model write prose about it. Much of this category does
// exactly that and advertises "12+ frameworks." We are not going to claim
// parity on a count that means nothing, because our entire pitch is that we
// don't fabricate security data, and a fabricated compliance mapping is
// fabricated security data.
//
// So every framework declares its depth:
//
//   control-mapped  The framework's real controls are enumerated in code, each
//                   cited to its source and mapped to specific assessment
//                   answers. Gap analysis is COMPUTED. An auditor can trace any
//                   finding back to a control ID and the answer that produced
//                   it. This is the product.
//
//   ai-assisted     We hold the framework's name and scope, and the AI writes a
//                   contextual mapping from the client's profile. Useful, and
//                   honest work — but it is the model's interpretation, not a
//                   control-level assessment, and we say so in the UI.
//
//   planned         Not implemented. Listed so prospects can see the roadmap,
//                   never selectable, never implied to work.
//
// The UI reads this field. It is not decoration.

import { FTC_SAFEGUARDS_META, assessFtcSafeguards } from "./ftcSafeguards.js";
import { SOC2_META, assessSoc2, SOC1_GUIDANCE } from "./soc2.js";
import { PCI_META, assessPciDss, suggestSaq } from "./pciDss.js";
import { ISO27001_META, assessIso27001, new2022Controls } from "./iso27001.js";
import { NIST800171_META, assessNist800171, NIST800171_REV3 } from "./nist800171.js";
import { CMMC_META, assessCmmc, suggestCmmcLevel, level1Practices } from "./cmmc.js";
import { HIPAA_SECURITY_META, assessHipaaSecurity } from "./hipaaSecurityRule.js";
import { CIS_VERSION } from "./cisControls.js";

export const DEPTH = {
  CONTROL_MAPPED: "control-mapped",
  AI_ASSISTED: "ai-assisted",
  PLANNED: "planned",
};

export const DEPTH_LABELS = {
  [DEPTH.CONTROL_MAPPED]: {
    label: "Control-mapped",
    short: "Deep",
    description:
      "Every control is enumerated in our engine, cited to its source, and mapped to your assessment answers. Findings are computed and traceable — not written by an AI.",
    tone: "green",
  },
  [DEPTH.AI_ASSISTED]: {
    label: "AI-assisted mapping",
    short: "AI-assisted",
    description:
      "We generate a contextual gap analysis for this framework from your business profile. It is genuinely useful for orientation, but it is the AI's interpretation rather than a control-level assessment — treat it as a starting point, not an audit.",
    tone: "amber",
  },
  [DEPTH.PLANNED]: {
    label: "Planned",
    short: "Coming",
    description: "On the roadmap. Not yet available — you can't select it, and we won't pretend otherwise.",
    tone: "muted",
  },
};

export const FRAMEWORKS = [
  // ── Control-mapped ────────────────────────────────────────
  {
    id: "nist-csf",
    name: "NIST CSF",
    fullName: "NIST Cybersecurity Framework",
    depth: DEPTH.CONTROL_MAPPED,
    always: true,          // the scoring baseline; can't be deselected
    desc: "The scoring baseline. Every posture score ShieldAI produces is computed against the five functions.",
    audience: "All businesses — the foundation the rest map onto.",
    url: "https://www.nist.gov/cyberframework",
  },
  {
    id: "cis",
    name: `CIS Controls ${CIS_VERSION}`,
    fullName: "CIS Critical Security Controls",
    depth: DEPTH.CONTROL_MAPPED,
    hasIG: true,
    desc: "18 prioritized controls across 153 safeguards, grouped into three Implementation Groups.",
    audience: "Any SMB wanting a prioritized, practical control set.",
    url: "https://www.cisecurity.org/controls",
  },
  {
    id: "hipaa-security",
    name: HIPAA_SECURITY_META.shortName,
    fullName: HIPAA_SECURITY_META.name,
    depth: DEPTH.CONTROL_MAPPED,
    desc: "The full Security Rule: administrative, physical, and technical safeguards, with required vs. addressable called out correctly.",
    audience: HIPAA_SECURITY_META.whoMustComply,
    citation: HIPAA_SECURITY_META.citation,
    url: HIPAA_SECURITY_META.url,
    meta: HIPAA_SECURITY_META,
    assess: assessHipaaSecurity,
    note: "Security Rule only. The Privacy and Breach Notification Rules are separate obligations we don't assess.",
  },
  {
    id: "soc2",
    name: SOC2_META.shortName,
    fullName: "SOC 2 — Trust Services Criteria",
    depth: DEPTH.CONTROL_MAPPED,
    hasCategories: true,   // Security is mandatory; Availability optional
    desc: "Security (CC1–CC9) and Availability (A1), criterion by criterion, mapped to your assessment.",
    audience: SOC2_META.whoMustComply,
    citation: SOC2_META.citation,
    url: SOC2_META.url,
    meta: SOC2_META,
    assess: assessSoc2,
    note: "Readiness, not an attestation. A licensed CPA firm issues the report — there is no such thing as being 'SOC 2 certified'.",
  },
  {
    id: "pci-dss",
    name: PCI_META.shortName,
    fullName: PCI_META.fullName,
    depth: DEPTH.CONTROL_MAPPED,
    desc: "All 12 requirements, scoped to the SAQ you actually file — most small merchants are responsible for a fraction of the standard.",
    audience: PCI_META.whoMustComply,
    citation: PCI_META.version,
    url: PCI_META.url,
    meta: PCI_META,
    assess: assessPciDss,
    helpers: { suggestSaq },
    note: "Scoped by SAQ type. A hosted payment page means ~7 sub-requirements instead of 61 — knowing that is worth more than the gap analysis itself.",
  },
  {
    id: "iso27001",
    name: ISO27001_META.shortName,
    fullName: ISO27001_META.fullName,
    depth: DEPTH.CONTROL_MAPPED,
    desc: "All 93 Annex A controls across 4 themes, plus Clauses 4–10 — the requirements you're actually certified against.",
    audience: ISO27001_META.whoNeedsIt,
    citation: ISO27001_META.version,
    url: ISO27001_META.url,
    meta: ISO27001_META,
    assess: assessIso27001,
    helpers: { new2022Controls },
    note: "Annex A is a reference catalogue, not a checklist — you select controls by risk and justify exclusions in a Statement of Applicability. We score in-scope controls only, never a percentage over all 93.",
  },
  {
    id: "nist-800-171",
    name: NIST800171_META.shortName,
    fullName: NIST800171_META.fullName,
    depth: DEPTH.CONTROL_MAPPED,
    desc: "All 110 requirements across 14 families — the security baseline written into defence contracts.",
    audience: NIST800171_META.whoMustComply,
    citation: NIST800171_META.version,
    url: NIST800171_META.url,
    meta: NIST800171_META,
    assess: assessNist800171,
    helpers: { rev3: NIST800171_REV3 },
    note: "Rev 2, deliberately. Rev 3 is newer but CMMC and DFARS still assess Rev 2 — a contractor measured today is measured against these 110.",
  },
  {
    id: "cmmc",
    name: CMMC_META.shortName,
    fullName: CMMC_META.fullName,
    depth: DEPTH.CONTROL_MAPPED,
    desc: "Levels 1–3, built on the 800-171 requirements CMMC actually assesses.",
    audience: CMMC_META.whoMustComply,
    citation: CMMC_META.citation,
    url: CMMC_META.url,
    meta: CMMC_META,
    assess: assessCmmc,
    helpers: { suggestCmmcLevel, level1Practices },
    note: "CMMC adds no controls of its own — Level 2 is 800-171 Rev 2's 110 requirements. Phase 2 begins 10 November 2026.",
  },
  {
    id: "ftc-safeguards",
    name: FTC_SAFEGUARDS_META.shortName,
    fullName: FTC_SAFEGUARDS_META.name,
    depth: DEPTH.CONTROL_MAPPED,
    desc: "All nine elements of § 314.4, plus the § 314.5 breach-notification duty and the § 314.6 small-entity exemption.",
    audience: FTC_SAFEGUARDS_META.whoMustComply,
    citation: FTC_SAFEGUARDS_META.citation,
    url: FTC_SAFEGUARDS_META.url,
    meta: FTC_SAFEGUARDS_META,
    assess: assessFtcSafeguards,
    note: "Applies to far more businesses than the name suggests — auto dealers, tax preparers, accountants, mortgage brokers.",
  },

  // ── AI-assisted ───────────────────────────────────────────
  // Honest about what these are. Each is a real candidate for promotion to
  // control-mapped; the pattern is established by HIPAA and FTC Safeguards.



  {
    id: "gdpr",
    name: "GDPR",
    fullName: "EU General Data Protection Regulation",
    depth: DEPTH.AI_ASSISTED,
    desc: "Contextual gap analysis against the core data-protection obligations.",
    audience: "Businesses handling personal data of people in the EU/EEA.",
    url: "https://gdpr.eu",
  },

  // ── Planned ───────────────────────────────────────────────
  {
    id: "state-privacy",
    name: "State Privacy Laws",
    fullName: "US State Privacy Laws (CCPA/CPRA and successors)",
    depth: DEPTH.PLANNED,
    desc: "The growing patchwork of state consumer-privacy statutes.",
    audience: "Businesses meeting state thresholds — increasingly, most SMBs.",
  },
  {
    id: "nist-800-53",
    name: "NIST 800-53",
    fullName: "NIST SP 800-53 Rev. 5 — Security and Privacy Controls (Low/Moderate baselines)",
    depth: DEPTH.PLANNED,
    desc: "The foundational US control catalogue. Public domain, and the source 800-171 derives from.",
    audience: "Federal systems, contractors, and anyone wanting the canonical control set behind most US frameworks.",
  },
];

// ── Deliberately not offered ──────────────────────────────────
// SOC 1 audits financial-reporting controls, not security, and has no
// predefined control catalog to assess against. See soc2.js for the full
// reasoning. Exported so the UI can answer the question well when a client
// asks "do you do SOC 1?" — the honest answer is more useful than a fake one.
export const NOT_OFFERED = [
  {
    id: "hitrust",
    name: "HITRUST CSF",
    reason: "licence-prohibited",
    // Recorded so this doesn't get re-litigated in six months. This is not
    // caution — it is what the licence says.
    detail:
      "HITRUST's CSF licence prohibits commercial use and creation of derivative works without express written consent, and defines 'derivative work' to include any software that is based on or incorporates any part of the CSF, in any form in which it may be recast or adapted. A control-mapped implementation is precisely that. Separately, the licence restricts who may be a licensee: security service providers, consultants, and vendors are excluded — which describes ShieldAI. A commercial GRC vendor (SimpleRisk) reached the same conclusion and does not implement HITRUST for this reason.",
    alternative:
      "For healthcare clients, our control-mapped HIPAA Security Rule assessment covers the underlying regulatory obligation. HITRUST certification itself requires a HITRUST-authorised assessor.",
    reviewedOn: "2026-07",
  },SOC1_GUIDANCE];

// ── Helpers ───────────────────────────────────────────────────

export function getFramework(id) {
  return FRAMEWORKS.find(f => f.id === id) || null;
}

/** Frameworks a client can actually select. Planned ones are never selectable. */
export function selectableFrameworks() {
  return FRAMEWORKS.filter(f => f.depth !== DEPTH.PLANNED);
}

export function frameworksByDepth(depth) {
  return FRAMEWORKS.filter(f => f.depth === depth);
}

/** Does this framework have a real, computed assessment function? */
export function isControlMapped(id) {
  const f = getFramework(id);
  return !!(f && f.depth === DEPTH.CONTROL_MAPPED && typeof f.assess === "function");
}

/**
 * Run the control-mapped assessments for the frameworks a client selected.
 * Returns only frameworks we can genuinely assess; the AI-assisted ones are
 * handled by the generator, and planned ones are unreachable by construction.
 */
export function assessSelected(frameworkIds = [], checklistAnswers = {}, opts = {}) {
  const out = {};
  for (const id of frameworkIds) {
    const f = getFramework(id);
    if (f && f.depth === DEPTH.CONTROL_MAPPED && typeof f.assess === "function") {
      out[id] = f.assess(checklistAnswers, opts);
    }
  }
  return out;
}

/** What we can honestly say publicly about framework coverage. */
export function coverageSummary() {
  const mapped = frameworksByDepth(DEPTH.CONTROL_MAPPED);
  const ai = frameworksByDepth(DEPTH.AI_ASSISTED);
  const planned = frameworksByDepth(DEPTH.PLANNED);
  return {
    controlMapped: mapped.length,
    aiAssisted: ai.length,
    planned: planned.length,
    total: mapped.length + ai.length,
    // The claim we can actually defend in a diligence conversation.
    marketingClaim: `${mapped.length} frameworks with full control-level mapping, ${ai.length} with AI-assisted gap analysis, ${planned.length} more on the roadmap.`,
    names: {
      controlMapped: mapped.map(f => f.name),
      aiAssisted: ai.map(f => f.name),
      planned: planned.map(f => f.name),
    },
  };
}
