// extendedChecklist.js
// The paid-tier "Extended Assessment" — additional questions offered once a
// client's plan includes the `extendedAssessment` capability (Growth+; see
// tiers.js). Deliberately a SEPARATE file from securityChecklist.js: the base
// 13 scoring / 22 evidence questions are a closed, load-bearing set (see that
// file's own header) referenced by name throughout riskEngine.js and this
// codebase's tests. These questions never touch that array.
//
// WHY THESE EXIST
// ----------------
// Several newer features — cloudRoutes.js's cloud-posture connections,
// cveService.js's software/CVE matching, the attack-surface and trust-page
// views — get no real signal from the assessment today. Nothing asks which
// cloud provider a client uses, which specific EDR/backup/email-security/WAF
// product they run (the base checklist only captures a maturity TIER, never a
// product), how deep MFA enforcement actually goes, or for a structured
// software inventory. These questions close that gap.
//
// SCORING
// -------
// Unlike the base checklist's evidence-only (scoring:false) questions, some of
// these ARE allowed to influence the posture score — the user's explicit
// choice for this feature. But they must never retroactively change a
// client's score before they complete this section: riskEngine.js keeps
// SCORING_CHECKLIST completely untouched and instead computes these
// separately, blending the result into only the NIST functions they touch.
// An assessment with no answers here takes the exact same code path as
// before this file existed. See riskEngine.js's scoreFromExtendedChecklist().
//
// SHAPE
// -----
// Mirrors frameworkIntake.js's pattern (this is a topic-scoped, conditionally
// visible question set, not securityChecklist.js's flatter shape):
// `appliesWhen` gates a follow-up question on an earlier answer, exactly like
// frameworkIntake.js's PCI/CMMC intakes do.

export const EXTENDED_SCORING_CHECKLIST = [
  {
    id: "mfaDepth",
    nistFunction: "Protect",
    factor: "mfaDepth",
    question: "Beyond requiring MFA, how is it enforced?",
    options: [
      { label: "Risk-based / conditional access (device trust, location, impossible-travel blocks)", score: 100 },
      { label: "Enforced the same way for every login, no risk signals considered", score: 60 },
      { label: "Enforced on some systems but not centrally managed", score: 35 },
      { label: "Not sure / no MFA policy beyond what's already answered", score: 15 },
    ],
  },
  {
    id: "cloudPosture",
    nistFunction: "Identify",
    factor: "cloudPosture",
    question: "For the cloud provider(s) you use, do you have visibility into your own cloud security configuration (IAM, storage, network)?",
    // appliesWhen compares against the STORED answer, which is always the
    // option's label (matching securityChecklist.js's convention — see
    // toExtendedEvidence() below, which accepts a label for a choice
    // question) — not its `value`. Must list the cloudProviders question's
    // actual labels here, not "aws"/"azure"/etc.
    appliesWhen: { cloudProviders: ["AWS", "Microsoft Azure", "Google Cloud", "More than one of the above"] },
    options: [
      { label: "Yes — connected a live read-only posture scan", score: 100 },
      { label: "We review it manually sometimes", score: 55 },
      { label: "No visibility beyond the provider's default dashboard", score: 30 },
      { label: "Not sure", score: 15 },
    ],
  },
];

export const EXTENDED_EVIDENCE_CHECKLIST = [
  {
    id: "cloudProviders",
    scoring: false,
    section: "Cloud & Infrastructure",
    question: "Which cloud provider(s) does your business run on?",
    options: [
      { label: "AWS", value: "aws" },
      { label: "Microsoft Azure", value: "azure" },
      { label: "Google Cloud", value: "gcp" },
      { label: "More than one of the above", value: "mixed" },
      { label: "None — on-premises or no meaningful cloud footprint", value: "none" },
      { label: "Other / not sure", value: "other" },
    ],
    // No numeric score — this is a routing question that gates whether the
    // cloudPosture scoring question above becomes visible, not a maturity
    // signal on its own.
  },
  {
    id: "edrProduct",
    scoring: false,
    section: "Security Tooling",
    question: "What's the specific product/vendor for your endpoint protection (EDR/antivirus)?",
    help: "Pairs with the base checklist's endpoint question — this names the actual product so it can be checked against known vulnerabilities.",
    freeText: true,
    suggestions: ["CrowdStrike Falcon", "SentinelOne", "Microsoft Defender for Endpoint", "Sophos Intercept X", "None / not sure"],
  },
  {
    id: "backupProduct",
    scoring: false,
    section: "Security Tooling",
    question: "What's the specific product/vendor for your backup solution?",
    freeText: true,
    suggestions: ["Veeam", "Datto", "Acronis", "Cloud provider native (e.g. AWS Backup)", "None / not sure"],
  },
  {
    id: "emailSecurityProduct",
    scoring: false,
    section: "Security Tooling",
    question: "What's the specific product/vendor for your email security?",
    freeText: true,
    suggestions: ["Proofpoint", "Mimecast", "Microsoft Defender for Office 365", "Google Workspace native", "None / not sure"],
  },
  {
    id: "wafProduct",
    scoring: false,
    section: "Security Tooling",
    question: "Do you use a web application firewall or CDN security layer in front of any public-facing systems?",
    help: "Not asked in the base checklist — a real gap for any business with a public website or API.",
    freeText: true,
    suggestions: ["Cloudflare", "AWS WAF", "Akamai", "None"],
  },
  {
    id: "softwareInventory",
    scoring: false,
    section: "Cloud & Infrastructure",
    question: "List the core business applications, CRM/ERP, and primary cloud workloads you run (name and version where you know it).",
    help: "Feeds the same Technology Stack field used for CVE matching in Threat Intelligence — a structured prompt for the same data Edit Assessment's free-text tags already collect.",
    freeText: true,
    multi: true,
  },
];

// A free-text answer this long is not a product name or a short list — cap
// it the same way every other free-text field in this codebase does
// (supportRoutes.js's ticket bodies, complianceCalendarRoutes.js's notes,
// etc.), so one saved answer can't grow db.json unboundedly.
export const EXTENDED_FREE_TEXT_MAX = 2000;

/** Ids of the freeText questions — extendedAssessmentRoutes.js uses this to
 * know which incoming answers to length-cap before storing. */
export const EXTENDED_FREE_TEXT_IDS = new Set(
  EXTENDED_EVIDENCE_CHECKLIST.filter(q => q.freeText).map(q => q.id)
);

/**
 * Which extended questions to show, given answers so far. Honors
 * `appliesWhen` the same way frameworkIntake.js's visibleQuestions() does —
 * a business with no cloud footprint is never asked the cloud-posture
 * scoring question.
 */
export function visibleExtendedQuestions(answers = {}) {
  const all = [...EXTENDED_SCORING_CHECKLIST, ...EXTENDED_EVIDENCE_CHECKLIST];
  return all.filter(q => {
    if (!q.appliesWhen) return true;
    return Object.entries(q.appliesWhen).every(([key, allowed]) => allowed.includes(answers[key]));
  });
}

/**
 * Normalize raw extended answers into the shape a scoring/evidence consumer
 * reads: { [id]: { label, score } } for choice questions, { [id]: { value } }
 * for free-text ones. Mirrors securityChecklist.js's toEvidence().
 */
export function toExtendedEvidence(answers = {}) {
  const out = {};
  const scoring = new Map(EXTENDED_SCORING_CHECKLIST.map(q => [q.id, q]));
  const evidence = new Map(EXTENDED_EVIDENCE_CHECKLIST.map(q => [q.id, q]));

  for (const [id, raw] of Object.entries(answers)) {
    if (raw === undefined || raw === null || raw === "") continue;
    const scoringQ = scoring.get(id);
    if (scoringQ) {
      const opt = scoringQ.options.find(o => o.label === raw);
      if (opt) out[id] = { label: opt.label, score: opt.score };
      continue;
    }
    const evidenceQ = evidence.get(id);
    if (!evidenceQ) continue;
    if (evidenceQ.freeText) {
      out[id] = { value: raw };
    } else {
      const opt = evidenceQ.options?.find(o => o.value === raw || o.label === raw);
      out[id] = opt ? { label: opt.label, value: opt.value } : { value: raw };
    }
  }
  return out;
}
