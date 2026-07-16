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
    id: "soc2",
    name: "SOC 2",
    fullName: "SOC 2 Trust Services Criteria",
    depth: DEPTH.AI_ASSISTED,
    desc: "Contextual gap analysis against the Trust Services Criteria.",
    audience: "Service organizations whose customers demand an attestation.",
    url: "https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2",
    roadmap: "Control-mapped implementation planned — the five Trust Services Criteria and their points of focus.",
  },
  {
    id: "pci-dss",
    name: "PCI DSS",
    fullName: "PCI Data Security Standard v4.0",
    depth: DEPTH.AI_ASSISTED,
    desc: "Contextual gap analysis against the 12 requirements.",
    audience: "Any business that stores, processes, or transmits payment card data.",
    url: "https://www.pcisecuritystandards.org",
    roadmap: "Control-mapped implementation planned: the full 12 requirements, with SAQ scoping so you only see what applies to how you actually take payments.",
  },
  {
    id: "iso27001",
    name: "ISO 27001",
    fullName: "ISO/IEC 27001:2022",
    depth: DEPTH.AI_ASSISTED,
    desc: "Contextual gap analysis against the ISMS clauses and Annex A themes.",
    audience: "Businesses needing international recognition, often for enterprise procurement.",
    url: "https://www.iso.org/standard/27001",
    roadmap: "Control-mapped implementation planned — Annex A's 93 controls and clauses 4–10.",
    note: "ISO's standard text is copyrighted, so we reference control identifiers and titles and write our own guidance. We can't reproduce the standard itself.",
  },
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
    id: "cmmc",
    name: "CMMC 2.0",
    fullName: "Cybersecurity Maturity Model Certification",
    depth: DEPTH.PLANNED,
    desc: "Defense contractors and the DoD supply chain.",
    audience: "Anyone in the defense industrial base.",
  },
  {
    id: "nist-800-171",
    name: "NIST 800-171",
    fullName: "NIST SP 800-171 — Protecting CUI",
    depth: DEPTH.PLANNED,
    desc: "Controlled Unclassified Information in non-federal systems.",
    audience: "Federal contractors and subcontractors.",
  },
  {
    id: "state-privacy",
    name: "State Privacy Laws",
    fullName: "US State Privacy Laws (CCPA/CPRA and successors)",
    depth: DEPTH.PLANNED,
    desc: "The growing patchwork of state consumer-privacy statutes.",
    audience: "Businesses meeting state thresholds — increasingly, most SMBs.",
  },
  {
    id: "hitrust",
    name: "HITRUST CSF",
    fullName: "HITRUST Common Security Framework",
    depth: DEPTH.PLANNED,
    desc: "Certifiable framework common in healthcare supply chains.",
    audience: "Healthcare vendors facing HITRUST requirements from partners.",
  },
];

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
