// statePrivacyByState.js
// Per-state deltas from the common-obligation template in statePrivacy.js.
//
// WHY THIS IS A SEPARATE, DELIBERATELY SPARSE FILE
// --------------------------------------------------
// statePrivacy.js's own header explains why the 18 obligations are scored as
// one shared template rather than ~20 separate laws: the roster is legally
// contested, the landscape changes every legislative session, and full
// applicability turns on thresholds the assessment doesn't collect.
//
// This file does NOT abandon that caution. It adds ONE more layer of honesty
// on top of it: for a business that tells us which state's law it wants
// assessed against, we can be more specific than the shared template WITHOUT
// pretending to know all ~20 laws in that kind of depth.
//
// So: a state is either
//   modeled: "deep"    — individually reviewed. We know its statute, its
//                         real, well-established deltas from the template
//                         (not every nuance — only the ones confirmed
//                         stable and commonly cited), and we say so.
//   modeled: "generic" — on the roster, but not individually reviewed here.
//                         Assessed with the shared template, and the UI must
//                         say plainly that it's generic, not that it's this
//                         state's law specifically.
//
// Never flip a "generic" entry to look "deep" without actually doing the
// legal homework — that's the exact fabrication this product exists to avoid.
//
// Sources: state statutes as cited per entry. `asOf` per entry, not just at
// the top of the file, because these get reviewed and updated independently.

export const STATE_LAW_PROFILES = {
  "California": {
    modeled: "deep",
    statute: "California Consumer Privacy Act, as amended by the California Privacy Rights Act (CCPA/CPRA)",
    citation: "Cal. Civ. Code § 1798.100 et seq.; Cal. Code Regs. tit. 11, § 7000 et seq.",
    effectiveDate: "2020-01-01 (CCPA); 2023-01-01 (CPRA amendments)",
    thresholdNote: "$25M+ annual gross revenue, OR buys/sells/shares personal information of 100,000+ consumers or households, OR derives 50%+ of annual revenue from selling or sharing personal information.",
    curePeriod: false,
    privateRightOfAction: "Limited — breaches caused by a failure of reasonable security only.",
    universalOptOutRequired: true,
    rightToCorrect: true,
    dataProtectionAssessmentRequired: true,
    asOf: "2026-07",
    note: "This is the state the common-obligation template was built from — every SP-# obligation applies here as written.",
  },
  "Virginia": {
    modeled: "deep",
    statute: "Virginia Consumer Data Protection Act (VCDPA)",
    citation: "Va. Code § 59.1-575 et seq.",
    effectiveDate: "2023-01-01",
    thresholdNote: "Controls/processes personal data of 100,000+ Virginia residents, or 25,000+ residents AND derives over 50% of gross revenue from selling personal data.",
    curePeriod: true,
    privateRightOfAction: "None — Attorney General enforcement only.",
    universalOptOutRequired: true,
    rightToCorrect: true,
    dataProtectionAssessmentRequired: true,
    asOf: "2026-07",
    note: "One of the few remaining laws that kept its cure period rather than sunsetting it.",
  },
  "Colorado": {
    modeled: "deep",
    statute: "Colorado Privacy Act (CPA)",
    citation: "Colo. Rev. Stat. § 6-1-1301 et seq.",
    effectiveDate: "2023-07-01",
    thresholdNote: "Conducts business in Colorado and controls/processes data of 100,000+ residents, or 25,000+ residents and derives revenue from selling personal data.",
    curePeriod: false,
    privateRightOfAction: "None — Attorney General and district attorneys only.",
    universalOptOutRequired: true,
    rightToCorrect: true,
    dataProtectionAssessmentRequired: true,
    asOf: "2026-07",
    note: "The first state to mandate honoring universal opt-out signals; its cure period sunset January 1, 2025.",
  },
  "Connecticut": {
    modeled: "deep",
    statute: "Connecticut Data Privacy Act (CTDPA)",
    citation: "Conn. Gen. Stat. § 42-515 et seq.",
    effectiveDate: "2023-07-01",
    thresholdNote: "100,000+ CT residents (excluding data processed solely for payment transactions), or 25,000+ residents and 25%+ of gross revenue from selling personal data — a lower revenue share than most states.",
    curePeriod: false,
    privateRightOfAction: "None — Attorney General only.",
    universalOptOutRequired: true,
    rightToCorrect: true,
    dataProtectionAssessmentRequired: true,
    asOf: "2026-07",
    note: "Added protections specific to a known minor's data; general cure period sunset December 31, 2024.",
  },
  "Utah": {
    modeled: "deep",
    statute: "Utah Consumer Privacy Act (UCPA)",
    citation: "Utah Code § 13-61-101 et seq.",
    effectiveDate: "2023-12-31",
    thresholdNote: "$25M+ annual revenue AND controls/processes data of 100,000+ residents, or 25,000+ residents and derives 50%+ revenue from selling personal data.",
    curePeriod: true,
    privateRightOfAction: "None — Attorney General only.",
    universalOptOutRequired: false,
    rightToCorrect: false,
    dataProtectionAssessmentRequired: false,
    asOf: "2026-07",
    note: "Generally regarded as the lightest-touch comprehensive law — no right to correct, no universal opt-out duty, no data protection assessment requirement, and (unlike most peers) its cure period does not sunset.",
  },
  "Texas": {
    modeled: "deep",
    statute: "Texas Data Privacy and Security Act (TDPSA)",
    citation: "Tex. Bus. & Com. Code § 541.001 et seq.",
    effectiveDate: "2024-07-01",
    thresholdNote: "No revenue threshold. Applies to any entity conducting business in Texas that processes or sells personal data and is not a small business under SBA size standards — a materially lower bar than states with a revenue floor.",
    curePeriod: true,
    privateRightOfAction: "None — Attorney General only.",
    universalOptOutRequired: true,
    rightToCorrect: true,
    dataProtectionAssessmentRequired: true,
    asOf: "2026-07",
    note: "The missing revenue threshold is what catches businesses that assume they're too small.",
  },
  "Florida": {
    modeled: "deep",
    statute: "Florida Digital Bill of Rights (FDBR)",
    citation: "Fla. Stat. § 501.701 et seq.",
    effectiveDate: "2024-07-01",
    thresholdNote: "Far narrower than every other state on this list: $1B+ global gross annual revenue, AND at least one of — derives 50%+ revenue from digital advertising, operates an app store with 250,000+ apps, or operates a smart-speaker/voice-assistant service. This is why Florida's inclusion in a \"comprehensive law\" count is disputed.",
    curePeriod: true,
    privateRightOfAction: "None — Attorney General only.",
    universalOptOutRequired: true,
    rightToCorrect: true,
    dataProtectionAssessmentRequired: false,
    asOf: "2026-07",
    note: "Because the threshold is so high, most SMBs this product serves are not in scope even if they operate in Florida — flag that rather than scoring 18 obligations that almost certainly don't apply.",
  },
  "Maryland": {
    modeled: "deep",
    statute: "Maryland Online Data Privacy Act (MODPA)",
    citation: "Md. Code, Com. Law § 14-4601 et seq.",
    effectiveDate: "2025-10-01",
    thresholdNote: "Controls/processes data of 35,000+ Maryland residents, or 10,000+ residents and derives over 20% of gross revenue from selling personal data — no separate general revenue floor.",
    curePeriod: false,
    privateRightOfAction: "None — Attorney General only.",
    universalOptOutRequired: true,
    rightToCorrect: true,
    dataProtectionAssessmentRequired: true,
    sensitiveDataSaleBanned: true,
    asOf: "2026-07",
    note: "Among the strictest on data minimisation, and the only state on this list that bans the sale of sensitive personal information outright rather than requiring an opt-out.",
  },
  "Rhode Island": {
    modeled: "deep",
    statute: "Rhode Island Data Transparency and Privacy Protection Act (RIDTPPA)",
    citation: "R.I. Gen. Laws § 6-48.1-1 et seq.",
    effectiveDate: "2026-01-01",
    thresholdNote: "Controls/processes data of 35,000+ Rhode Island residents, or 10,000+ residents if 20%+ of gross revenue comes from selling personal data — notably low compared to most states.",
    curePeriod: true,
    privateRightOfAction: "None — Attorney General only.",
    universalOptOutRequired: true,
    rightToCorrect: true,
    dataProtectionAssessmentRequired: true,
    asOf: "2026-07",
    note: "Also requires publicly naming the categories of third parties personal data is sold to — a specific transparency duty beyond the shared template's general notice obligation (SP-1).",
  },
};

/** States on the roster we haven't individually reviewed yet — assessed with
 *  the shared template, and the UI must say so rather than implying
 *  state-specific precision we don't have. */
export const GENERIC_MODEL_STATES = [
  "Oregon", "Montana", "Iowa", "Delaware", "Indiana", "Tennessee",
  "New Jersey", "New Hampshire", "Nebraska", "Kentucky", "Minnesota",
];

/** Every state this module can accept as a selection, deep or generic. */
export const SELECTABLE_STATES = [
  ...Object.keys(STATE_LAW_PROFILES),
  ...GENERIC_MODEL_STATES,
].sort();

export function stateProfile(state) {
  const p = STATE_LAW_PROFILES[state];
  return p ? { ...p, state } : null;
}
