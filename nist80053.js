// nist80053.js
// NIST SP 800-53 Rev 5 — Security and Privacy Controls, all three FIPS 199
// impact baselines: Low (149 controls), Moderate (287), High (370).
//
// WHY ALL THREE, NOT JUST LOW
// -----------------------------
// The full Rev 5 catalogue is 1,189 controls across 20 families — a menu, not
// a meal. FIPS 199 categorises a system as Low, Moderate, or High impact, and
// SP 800-53B then names which controls that baseline requires. An SMB running
// email, a CRM, and a website is typically Low; a federal contractor or
// FedRAMP-track SaaS vendor is typically Moderate; a small number of
// high-value or national-security-adjacent systems are High. Baselines are
// CUMULATIVE — every Low control is in Moderate, every Moderate control is in
// High — so this file models one control list with a `baselines` membership
// tag per control, not three separate/forked lists that could drift apart.
//
// WHERE THESE CONTROL IDS AND TITLES CAME FROM
// -----------------------------------------------
// Not from recall. Control IDs for each baseline are extracted from NIST's
// own OSCAL baseline profiles:
//   Low       — NIST_SP-800-53_rev5_LOW-baseline_profile.json
//   Moderate  — NIST_SP-800-53_rev5_MODERATE-baseline_profile.json
//   High      — NIST_SP-800-53_rev5_HIGH-baseline_profile.json
// Titles (and, during authoring, statement text used to ground each
// `evidence` mapping) are resolved against NIST's official OSCAL catalogue —
// NIST_SP-800-53_rev5_catalog.json. Baseline membership was verified
// mechanically (control-id-for-id) before this file was written: Low ⊂
// Moderate ⊂ High, 149/287/370 controls respectively, matching NIST's
// published counts exactly. Several widely-cited blogs disagree on these
// numbers — we verify against the source, not against consensus.
//
// EVIDENCE MAPPING GETS SPARSER AS THE BASELINE GROWS
// ------------------------------------------------------
// securityChecklist.js has 35 questions. Low's 149 controls already stretch
// that thin (see mappingFidelity below); Moderate's additional 138 and High's
// additional 83 are progressively more specialized (developer-security
// requirements, physical/environmental depth, supply-chain tamper resistance,
// audit-trail correlation) that a general SMB assessment often has no
// genuine signal for. Those controls report "not yet assessed" rather than
// being stretched onto a loosely-related question — consistent with every
// other deep module in this codebase.
//
// COPYRIGHT: none. NIST publications are US Government works in the public
// domain. Control IDs and titles are reproduced directly; every evidence
// mapping is ours.
//
// Sources:
//   SP 800-53 Rev 5   — https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final
//   SP 800-53B        — https://csrc.nist.gov/pubs/sp/800/53/b/upd1/final
//   OSCAL content     — https://github.com/usnistgov/oscal-content

export const NIST80053_META = {
  id: "nist-800-53",
  name: "NIST 800-53",
  shortName: "NIST 800-53",
  fullName: "NIST SP 800-53 Rev 5 — Security and Privacy Controls",
  authority: "National Institute of Standards and Technology",
  version: "Rev 5.2.0",
  url: "https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final",
  depth: "control-mapped",
  summary:
    "The canonical US control catalogue — the source most other frameworks derive from. All three FIPS 199 impact baselines are assessed: Low (149 controls), Moderate (287), and High (370).",
  whoMustComply:
    "Mandatory for federal agencies and their information systems under FISMA. For everyone else it is voluntary but foundational: 800-171, CMMC, and FedRAMP all trace back to this catalogue, so work done here is rarely wasted.",
  enforcement:
    "FISMA for federal agencies; contractual for systems operated on an agency's behalf, or for FedRAMP-track cloud services (which target Moderate or High). For private-sector SMBs there is no enforcement — the value is that it is the most complete, most widely-referenced control set in existence, and it is free.",
  baselineNote:
    "FIPS 199 decides your baseline, not preference. Low means a security breach would have limited adverse effect; Moderate means serious; High means severe or catastrophic. Most SMB systems are Low. Federal contractors and FedRAMP-track cloud services are typically Moderate. A small number of high-value or national-security-adjacent systems are High — those need a real assessor regardless of what this gap analysis shows.",
  relationshipNote:
    "If you already did 800-171, much of this is familiar: 800-171's 110 CUI requirements were derived from this catalogue's Moderate baseline. Doing 800-53 first makes 800-171 substantially easier, and vice versa.",
  publicDomain: true,
};

export const NIST80053_BASELINES = {
  low: { controls: 149, assessed: true, note: "Limited adverse effect from a breach. Most SMB systems." },
  moderate: { controls: 287, assessed: true, note: "Serious adverse effect. Where federal contractors and FedRAMP live." },
  high: { controls: 370, assessed: true, note: "Severe or catastrophic adverse effect. A small number of high-value or national-security-adjacent systems." },
  catalogueTotal: 1189,
};

// ── The 18 families with baseline controls ────────────────────
// The full catalogue has 20. PM (Program Management) and PT (PII Processing
// and Transparency) carry no baseline controls at any of the three impact
// levels — PM is assessed organisation-wide rather than per-system, and PT
// applies via the separate privacy baseline. Their absence here is NIST's,
// not an omission of ours; verified against all three OSCAL profiles, not
// just Low.
export const NIST80053_FAMILIES = [
  { id: "AC", name: "Access Control", counts: { low: 11, moderate: 39, high: 46 } },
  { id: "AT", name: "Awareness and Training", counts: { low: 5, moderate: 6, high: 6 } },
  { id: "AU", name: "Audit and Accountability", counts: { low: 10, moderate: 16, high: 25 } },
  { id: "CA", name: "Assessment, Authorization, and Monitoring", counts: { low: 8, moderate: 10, high: 14 } },
  { id: "CM", name: "Configuration Management", counts: { low: 9, moderate: 24, high: 32 } },
  { id: "CP", name: "Contingency Planning", counts: { low: 6, moderate: 23, high: 35 } },
  { id: "IA", name: "Identification and Authentication", counts: { low: 16, moderate: 24, high: 26 } },
  { id: "IR", name: "Incident Response", counts: { low: 7, moderate: 13, high: 18 } },
  { id: "MA", name: "Maintenance", counts: { low: 4, moderate: 9, high: 12 } },
  { id: "MP", name: "Media Protection", counts: { low: 4, moderate: 7, high: 10 } },
  { id: "PE", name: "Physical and Environmental Protection", counts: { low: 10, moderate: 18, high: 25 } },
  { id: "PL", name: "Planning", counts: { low: 6, moderate: 7, high: 7 } },
  { id: "PS", name: "Personnel Security", counts: { low: 9, moderate: 9, high: 10 } },
  { id: "RA", name: "Risk Assessment", counts: { low: 8, moderate: 10, high: 11 } },
  { id: "SA", name: "System and Services Acquisition", counts: { low: 9, moderate: 17, high: 21 } },
  { id: "SC", name: "System and Communications Protection", counts: { low: 10, moderate: 25, high: 30 } },
  { id: "SI", name: "System and Information Integrity", counts: { low: 6, moderate: 18, high: 28 } },
  { id: "SR", name: "Supply Chain Risk Management", counts: { low: 11, moderate: 12, high: 14 } },
];

// ── All 370 controls across the three baselines ────────────────
// `id` and `title` are NIST's, verbatim from the OSCAL catalogue. `evidence`
// is ours: the checklist questions that speak to this control. `baselines`
// is cumulative membership — a Low control carries all three; a
// Moderate-only-and-up control carries ["moderate","high"]; a High-only
// control carries ["high"].
//
// A control with no evidence mapping reports "not yet assessed" rather than
// having a stretched mapping forced onto it — see the header note on why
// this grows more common as the baseline grows.
export const NIST80053_CONTROLS = [
  // ── AC (46) ──
  { id: "AC-1", family: "AC", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "AC-2", family: "AC", title: "Account Management", evidence: ["accessReviews", "offboarding"], baselines: ["low", "moderate", "high"] },
  { id: "AC-2(1)", family: "AC", title: "Automated System Account Management", evidence: ["accessReviews", "offboarding"], baselines: ["moderate", "high"] },
  { id: "AC-2(2)", family: "AC", title: "Automated Temporary and Emergency Account Management", evidence: ["accessReviews", "offboarding"], baselines: ["moderate", "high"] },
  { id: "AC-2(3)", family: "AC", title: "Disable Accounts", evidence: ["offboarding"], baselines: ["moderate", "high"] },
  { id: "AC-2(4)", family: "AC", title: "Automated Audit Actions", evidence: ["monitoring", "accessReviews"], baselines: ["moderate", "high"] },
  { id: "AC-2(5)", family: "AC", title: "Inactivity Logout", evidence: ["accessReviews"], baselines: ["moderate", "high"] },
  { id: "AC-2(11)", family: "AC", title: "Usage Conditions", evidence: [], baselines: ["high"] },
  { id: "AC-2(12)", family: "AC", title: "Account Monitoring for Atypical Usage", evidence: ["monitoring", "accessReviews"], baselines: ["high"] },
  { id: "AC-2(13)", family: "AC", title: "Disable Accounts for High-risk Individuals", evidence: ["offboarding"], baselines: ["moderate", "high"] },
  { id: "AC-3", family: "AC", title: "Access Enforcement", evidence: ["mfa", "privilegedAccess"], baselines: ["low", "moderate", "high"] },
  { id: "AC-4", family: "AC", title: "Information Flow Enforcement", evidence: ["dataInventory"], baselines: ["moderate", "high"] },
  { id: "AC-4(4)", family: "AC", title: "Flow Control of Encrypted Information", evidence: [], baselines: ["high"] },
  { id: "AC-5", family: "AC", title: "Separation of Duties", evidence: ["privilegedAccess", "documentedPolicies"], baselines: ["moderate", "high"] },
  { id: "AC-6", family: "AC", title: "Least Privilege", evidence: ["privilegedAccess"], baselines: ["moderate", "high"] },
  { id: "AC-6(1)", family: "AC", title: "Authorize Access to Security Functions", evidence: ["privilegedAccess"], baselines: ["moderate", "high"] },
  { id: "AC-6(2)", family: "AC", title: "Non-privileged Access for Nonsecurity Functions", evidence: ["privilegedAccess"], baselines: ["moderate", "high"] },
  { id: "AC-6(3)", family: "AC", title: "Network Access to Privileged Commands", evidence: ["privilegedAccess"], baselines: ["high"] },
  { id: "AC-6(5)", family: "AC", title: "Privileged Accounts", evidence: ["privilegedAccess"], baselines: ["moderate", "high"] },
  { id: "AC-6(7)", family: "AC", title: "Review of User Privileges", evidence: ["accessReviews", "privilegedAccess"], baselines: ["moderate", "high"] },
  { id: "AC-6(9)", family: "AC", title: "Log Use of Privileged Functions", evidence: ["monitoring", "privilegedAccess"], baselines: ["moderate", "high"] },
  { id: "AC-6(10)", family: "AC", title: "Prohibit Non-privileged Users from Executing Privileged Functions", evidence: ["privilegedAccess"], baselines: ["moderate", "high"] },
  { id: "AC-7", family: "AC", title: "Unsuccessful Logon Attempts", evidence: ["passwordPolicy"], baselines: ["low", "moderate", "high"] },
  { id: "AC-8", family: "AC", title: "System Use Notification", evidence: ["documentedPolicies"], baselines: ["low", "moderate", "high"] },
  { id: "AC-10", family: "AC", title: "Concurrent Session Control", evidence: [], baselines: ["high"] },
  { id: "AC-11", family: "AC", title: "Device Lock", evidence: [], baselines: ["moderate", "high"] },
  { id: "AC-11(1)", family: "AC", title: "Pattern-hiding Displays", evidence: [], baselines: ["moderate", "high"] },
  { id: "AC-12", family: "AC", title: "Session Termination", evidence: [], baselines: ["moderate", "high"] },
  { id: "AC-14", family: "AC", title: "Permitted Actions Without Identification or Authentication", evidence: ["mfa", "privilegedAccess", "accessReviews"], baselines: ["low", "moderate", "high"] },
  { id: "AC-17", family: "AC", title: "Remote Access", evidence: ["mfa", "encryptionInTransit"], baselines: ["low", "moderate", "high"] },
  { id: "AC-17(1)", family: "AC", title: "Monitoring and Control", evidence: ["monitoring"], baselines: ["moderate", "high"] },
  { id: "AC-17(2)", family: "AC", title: "Protection of Confidentiality and Integrity Using Encryption", evidence: ["encryptionInTransit"], baselines: ["moderate", "high"] },
  { id: "AC-17(3)", family: "AC", title: "Managed Access Control Points", evidence: ["itManagement"], baselines: ["moderate", "high"] },
  { id: "AC-17(4)", family: "AC", title: "Privileged Commands and Access", evidence: ["privilegedAccess"], baselines: ["moderate", "high"] },
  { id: "AC-18", family: "AC", title: "Wireless Access", evidence: ["encryptionInTransit"], baselines: ["low", "moderate", "high"] },
  { id: "AC-18(1)", family: "AC", title: "Authentication and Encryption", evidence: ["encryptionInTransit"], baselines: ["moderate", "high"] },
  { id: "AC-18(3)", family: "AC", title: "Disable Wireless Networking", evidence: [], baselines: ["moderate", "high"] },
  { id: "AC-18(4)", family: "AC", title: "Restrict Configurations by Users", evidence: [], baselines: ["high"] },
  { id: "AC-18(5)", family: "AC", title: "Antennas and Transmission Power Levels", evidence: [], baselines: ["high"] },
  { id: "AC-19", family: "AC", title: "Access Control for Mobile Devices", evidence: ["endpoint", "encryptionAtRest"], baselines: ["low", "moderate", "high"] },
  { id: "AC-19(5)", family: "AC", title: "Full Device or Container-based Encryption", evidence: ["encryptionAtRest"], baselines: ["moderate", "high"] },
  { id: "AC-20", family: "AC", title: "Use of External Systems", evidence: ["vendorDueDiligence"], baselines: ["low", "moderate", "high"] },
  { id: "AC-20(1)", family: "AC", title: "Limits on Authorized Use", evidence: ["vendorDueDiligence"], baselines: ["moderate", "high"] },
  { id: "AC-20(2)", family: "AC", title: "Portable Storage Devices — Restricted Use", evidence: [], baselines: ["moderate", "high"] },
  { id: "AC-21", family: "AC", title: "Information Sharing", evidence: [], baselines: ["moderate", "high"] },
  { id: "AC-22", family: "AC", title: "Publicly Accessible Content", evidence: ["dataInventory"], baselines: ["low", "moderate", "high"] },

  // ── AT (6) ──
  { id: "AT-1", family: "AT", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "AT-2", family: "AT", title: "Literacy Training and Awareness", evidence: ["training"], baselines: ["low", "moderate", "high"] },
  { id: "AT-2(2)", family: "AT", title: "Insider Threat", evidence: ["training"], baselines: ["low", "moderate", "high"] },
  { id: "AT-2(3)", family: "AT", title: "Social Engineering and Mining", evidence: ["training"], baselines: ["moderate", "high"] },
  { id: "AT-3", family: "AT", title: "Role-based Training", evidence: ["training"], baselines: ["low", "moderate", "high"] },
  { id: "AT-4", family: "AT", title: "Training Records", evidence: ["training"], baselines: ["low", "moderate", "high"] },

  // ── AU (25) ──
  { id: "AU-1", family: "AU", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "AU-2", family: "AU", title: "Event Logging", evidence: ["monitoring"], baselines: ["low", "moderate", "high"] },
  { id: "AU-3", family: "AU", title: "Content of Audit Records", evidence: ["monitoring"], baselines: ["low", "moderate", "high"] },
  { id: "AU-3(1)", family: "AU", title: "Additional Audit Information", evidence: ["monitoring"], baselines: ["moderate", "high"] },
  { id: "AU-4", family: "AU", title: "Audit Log Storage Capacity", evidence: ["monitoring"], baselines: ["low", "moderate", "high"] },
  { id: "AU-5", family: "AU", title: "Response to Audit Logging Process Failures", evidence: ["monitoring"], baselines: ["low", "moderate", "high"] },
  { id: "AU-5(1)", family: "AU", title: "Storage Capacity Warning", evidence: ["monitoring"], baselines: ["high"] },
  { id: "AU-5(2)", family: "AU", title: "Real-time Alerts", evidence: ["monitoring"], baselines: ["high"] },
  { id: "AU-6", family: "AU", title: "Audit Record Review, Analysis, and Reporting", evidence: ["monitoring"], baselines: ["low", "moderate", "high"] },
  { id: "AU-6(1)", family: "AU", title: "Automated Process Integration", evidence: ["monitoring"], baselines: ["moderate", "high"] },
  { id: "AU-6(3)", family: "AU", title: "Correlate Audit Record Repositories", evidence: ["monitoring"], baselines: ["moderate", "high"] },
  { id: "AU-6(5)", family: "AU", title: "Integrated Analysis of Audit Records", evidence: ["monitoring"], baselines: ["high"] },
  { id: "AU-6(6)", family: "AU", title: "Correlation with Physical Monitoring", evidence: ["monitoring", "physicalSecurity"], baselines: ["high"] },
  { id: "AU-7", family: "AU", title: "Audit Record Reduction and Report Generation", evidence: ["monitoring"], baselines: ["moderate", "high"] },
  { id: "AU-7(1)", family: "AU", title: "Automatic Processing", evidence: ["monitoring"], baselines: ["moderate", "high"] },
  { id: "AU-8", family: "AU", title: "Time Stamps", evidence: ["monitoring"], baselines: ["low", "moderate", "high"] },
  { id: "AU-9", family: "AU", title: "Protection of Audit Information", evidence: ["monitoring"], baselines: ["low", "moderate", "high"] },
  { id: "AU-9(2)", family: "AU", title: "Store on Separate Physical Systems or Components", evidence: [], baselines: ["high"] },
  { id: "AU-9(3)", family: "AU", title: "Cryptographic Protection", evidence: ["monitoring"], baselines: ["high"] },
  { id: "AU-9(4)", family: "AU", title: "Access by Subset of Privileged Users", evidence: ["privilegedAccess", "monitoring"], baselines: ["moderate", "high"] },
  { id: "AU-10", family: "AU", title: "Non-repudiation", evidence: [], baselines: ["high"] },
  { id: "AU-11", family: "AU", title: "Audit Record Retention", evidence: ["dataRetention"], baselines: ["low", "moderate", "high"] },
  { id: "AU-12", family: "AU", title: "Audit Record Generation", evidence: ["monitoring"], baselines: ["low", "moderate", "high"] },
  { id: "AU-12(1)", family: "AU", title: "System-wide and Time-correlated Audit Trail", evidence: ["monitoring"], baselines: ["high"] },
  { id: "AU-12(3)", family: "AU", title: "Changes by Authorized Individuals", evidence: ["privilegedAccess"], baselines: ["high"] },

  // ── CA (14) ──
  { id: "CA-1", family: "CA", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "CA-2", family: "CA", title: "Control Assessments", evidence: ["priorAudit", "riskAssessmentCadence"], baselines: ["low", "moderate", "high"] },
  { id: "CA-2(1)", family: "CA", title: "Independent Assessors", evidence: ["priorAudit"], baselines: ["moderate", "high"] },
  { id: "CA-2(2)", family: "CA", title: "Specialized Assessments", evidence: ["priorAudit"], baselines: ["high"] },
  { id: "CA-3", family: "CA", title: "Information Exchange", evidence: ["priorAudit", "riskAssessmentCadence"], baselines: ["low", "moderate", "high"] },
  { id: "CA-3(6)", family: "CA", title: "Transfer Authorizations", evidence: [], baselines: ["high"] },
  { id: "CA-5", family: "CA", title: "Plan of Action and Milestones", evidence: ["priorAudit", "riskAssessmentCadence"], baselines: ["low", "moderate", "high"] },
  { id: "CA-6", family: "CA", title: "Authorization", evidence: ["priorAudit", "riskAssessmentCadence"], baselines: ["low", "moderate", "high"] },
  { id: "CA-7", family: "CA", title: "Continuous Monitoring", evidence: ["monitoring", "riskAssessmentCadence"], baselines: ["low", "moderate", "high"] },
  { id: "CA-7(1)", family: "CA", title: "Independent Assessment", evidence: ["monitoring", "riskAssessmentCadence"], baselines: ["moderate", "high"] },
  { id: "CA-7(4)", family: "CA", title: "Risk Monitoring", evidence: ["vulnManagement"], baselines: ["low", "moderate", "high"] },
  { id: "CA-8", family: "CA", title: "Penetration Testing", evidence: ["priorAudit"], baselines: ["high"] },
  { id: "CA-8(1)", family: "CA", title: "Independent Penetration Testing Agent or Team", evidence: ["priorAudit"], baselines: ["high"] },
  { id: "CA-9", family: "CA", title: "Internal System Connections", evidence: ["dataInventory"], baselines: ["low", "moderate", "high"] },

  // ── CM (32) ──
  { id: "CM-1", family: "CM", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "CM-2", family: "CM", title: "Baseline Configuration", evidence: ["changeManagement", "vulnManagement"], baselines: ["low", "moderate", "high"] },
  { id: "CM-2(2)", family: "CM", title: "Automation Support for Accuracy and Currency", evidence: ["dataInventory", "itManagement"], baselines: ["moderate", "high"] },
  { id: "CM-2(3)", family: "CM", title: "Retention of Previous Configurations", evidence: ["changeManagement"], baselines: ["moderate", "high"] },
  { id: "CM-2(7)", family: "CM", title: "Configure Systems and Components for High-risk Areas", evidence: [], baselines: ["moderate", "high"] },
  { id: "CM-3", family: "CM", title: "Configuration Change Control", evidence: ["changeManagement"], baselines: ["moderate", "high"] },
  { id: "CM-3(1)", family: "CM", title: "Automated Documentation, Notification, and Prohibition of Changes", evidence: ["changeManagement"], baselines: ["high"] },
  { id: "CM-3(2)", family: "CM", title: "Testing, Validation, and Documentation of Changes", evidence: ["changeManagement"], baselines: ["moderate", "high"] },
  { id: "CM-3(4)", family: "CM", title: "Security and Privacy Representatives", evidence: [], baselines: ["moderate", "high"] },
  { id: "CM-3(6)", family: "CM", title: "Cryptography Management", evidence: ["encryptionAtRest"], baselines: ["high"] },
  { id: "CM-4", family: "CM", title: "Impact Analyses", evidence: ["changeManagement", "vulnManagement"], baselines: ["low", "moderate", "high"] },
  { id: "CM-4(1)", family: "CM", title: "Separate Test Environments", evidence: ["changeManagement"], baselines: ["high"] },
  { id: "CM-4(2)", family: "CM", title: "Verification of Controls", evidence: ["changeManagement"], baselines: ["moderate", "high"] },
  { id: "CM-5", family: "CM", title: "Access Restrictions for Change", evidence: ["changeManagement", "vulnManagement"], baselines: ["low", "moderate", "high"] },
  { id: "CM-5(1)", family: "CM", title: "Automated Access Enforcement and Audit Records", evidence: ["privilegedAccess", "monitoring"], baselines: ["high"] },
  { id: "CM-6", family: "CM", title: "Configuration Settings", evidence: ["changeManagement", "vulnManagement"], baselines: ["low", "moderate", "high"] },
  { id: "CM-6(1)", family: "CM", title: "Automated Management, Application, and Verification", evidence: ["itManagement"], baselines: ["high"] },
  { id: "CM-6(2)", family: "CM", title: "Respond to Unauthorized Changes", evidence: ["monitoring", "changeManagement"], baselines: ["high"] },
  { id: "CM-7", family: "CM", title: "Least Functionality", evidence: ["changeManagement", "vulnManagement"], baselines: ["low", "moderate", "high"] },
  { id: "CM-7(1)", family: "CM", title: "Periodic Review", evidence: ["itManagement", "changeManagement"], baselines: ["moderate", "high"] },
  { id: "CM-7(2)", family: "CM", title: "Prevent Program Execution", evidence: ["endpoint"], baselines: ["moderate", "high"] },
  { id: "CM-7(5)", family: "CM", title: "Authorized Software — Allow-by-exception", evidence: ["endpoint", "changeManagement"], baselines: ["moderate", "high"] },
  { id: "CM-8", family: "CM", title: "System Component Inventory", evidence: ["dataInventory"], baselines: ["low", "moderate", "high"] },
  { id: "CM-8(1)", family: "CM", title: "Updates During Installation and Removal", evidence: ["dataInventory"], baselines: ["moderate", "high"] },
  { id: "CM-8(2)", family: "CM", title: "Automated Maintenance", evidence: ["dataInventory"], baselines: ["high"] },
  { id: "CM-8(3)", family: "CM", title: "Automated Unauthorized Component Detection", evidence: ["monitoring", "dataInventory"], baselines: ["moderate", "high"] },
  { id: "CM-8(4)", family: "CM", title: "Accountability Information", evidence: ["dataInventory"], baselines: ["high"] },
  { id: "CM-9", family: "CM", title: "Configuration Management Plan", evidence: ["documentedPolicies", "changeManagement"], baselines: ["moderate", "high"] },
  { id: "CM-10", family: "CM", title: "Software Usage Restrictions", evidence: ["documentedPolicies"], baselines: ["low", "moderate", "high"] },
  { id: "CM-11", family: "CM", title: "User-installed Software", evidence: ["changeManagement"], baselines: ["low", "moderate", "high"] },
  { id: "CM-12", family: "CM", title: "Information Location", evidence: ["dataInventory"], baselines: ["moderate", "high"] },
  { id: "CM-12(1)", family: "CM", title: "Automated Tools to Support Information Location", evidence: ["dataInventory"], baselines: ["moderate", "high"] },

  // ── CP (35) ──
  { id: "CP-1", family: "CP", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "CP-2", family: "CP", title: "Contingency Plan", evidence: ["backups", "disasterRecovery"], baselines: ["low", "moderate", "high"] },
  { id: "CP-2(1)", family: "CP", title: "Coordinate with Related Plans", evidence: ["disasterRecovery"], baselines: ["moderate", "high"] },
  { id: "CP-2(2)", family: "CP", title: "Capacity Planning", evidence: [], baselines: ["high"] },
  { id: "CP-2(3)", family: "CP", title: "Resume Mission and Business Functions", evidence: ["disasterRecovery"], baselines: ["moderate", "high"] },
  { id: "CP-2(5)", family: "CP", title: "Continue Mission and Business Functions", evidence: ["disasterRecovery"], baselines: ["high"] },
  { id: "CP-2(8)", family: "CP", title: "Identify Critical Assets", evidence: ["dataInventory"], baselines: ["moderate", "high"] },
  { id: "CP-3", family: "CP", title: "Contingency Training", evidence: ["backups", "disasterRecovery"], baselines: ["low", "moderate", "high"] },
  { id: "CP-3(1)", family: "CP", title: "Simulated Events", evidence: [], baselines: ["high"] },
  { id: "CP-4", family: "CP", title: "Contingency Plan Testing", evidence: ["backups", "disasterRecovery"], baselines: ["low", "moderate", "high"] },
  { id: "CP-4(1)", family: "CP", title: "Coordinate with Related Plans", evidence: ["disasterRecovery"], baselines: ["moderate", "high"] },
  { id: "CP-4(2)", family: "CP", title: "Alternate Processing Site", evidence: ["disasterRecovery"], baselines: ["high"] },
  { id: "CP-6", family: "CP", title: "Alternate Storage Site", evidence: ["backups"], baselines: ["moderate", "high"] },
  { id: "CP-6(1)", family: "CP", title: "Separation from Primary Site", evidence: ["backups"], baselines: ["moderate", "high"] },
  { id: "CP-6(2)", family: "CP", title: "Recovery Time and Recovery Point Objectives", evidence: ["disasterRecovery"], baselines: ["high"] },
  { id: "CP-6(3)", family: "CP", title: "Accessibility", evidence: [], baselines: ["moderate", "high"] },
  { id: "CP-7", family: "CP", title: "Alternate Processing Site", evidence: ["disasterRecovery"], baselines: ["moderate", "high"] },
  { id: "CP-7(1)", family: "CP", title: "Separation from Primary Site", evidence: ["disasterRecovery"], baselines: ["moderate", "high"] },
  { id: "CP-7(2)", family: "CP", title: "Accessibility", evidence: [], baselines: ["moderate", "high"] },
  { id: "CP-7(3)", family: "CP", title: "Priority of Service", evidence: [], baselines: ["moderate", "high"] },
  { id: "CP-7(4)", family: "CP", title: "Preparation for Use", evidence: ["disasterRecovery"], baselines: ["high"] },
  { id: "CP-8", family: "CP", title: "Telecommunications Services", evidence: [], baselines: ["moderate", "high"] },
  { id: "CP-8(1)", family: "CP", title: "Priority of Service Provisions", evidence: [], baselines: ["moderate", "high"] },
  { id: "CP-8(2)", family: "CP", title: "Single Points of Failure", evidence: [], baselines: ["moderate", "high"] },
  { id: "CP-8(3)", family: "CP", title: "Separation of Primary and Alternate Providers", evidence: [], baselines: ["high"] },
  { id: "CP-8(4)", family: "CP", title: "Provider Contingency Plan", evidence: ["vendorDueDiligence"], baselines: ["high"] },
  { id: "CP-9", family: "CP", title: "System Backup", evidence: ["backups"], baselines: ["low", "moderate", "high"] },
  { id: "CP-9(1)", family: "CP", title: "Testing for Reliability and Integrity", evidence: ["backups"], baselines: ["moderate", "high"] },
  { id: "CP-9(2)", family: "CP", title: "Test Restoration Using Sampling", evidence: ["backups"], baselines: ["high"] },
  { id: "CP-9(3)", family: "CP", title: "Separate Storage for Critical Information", evidence: ["backups"], baselines: ["high"] },
  { id: "CP-9(5)", family: "CP", title: "Transfer to Alternate Storage Site", evidence: ["backups"], baselines: ["high"] },
  { id: "CP-9(8)", family: "CP", title: "Cryptographic Protection", evidence: ["encryptionAtRest", "backups"], baselines: ["moderate", "high"] },
  { id: "CP-10", family: "CP", title: "System Recovery and Reconstitution", evidence: ["disasterRecovery"], baselines: ["low", "moderate", "high"] },
  { id: "CP-10(2)", family: "CP", title: "Transaction Recovery", evidence: ["disasterRecovery"], baselines: ["moderate", "high"] },
  { id: "CP-10(4)", family: "CP", title: "Restore Within Time Period", evidence: ["disasterRecovery"], baselines: ["high"] },

  // ── IA (26) ──
  { id: "IA-1", family: "IA", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "IA-2", family: "IA", title: "Identification and Authentication (Organizational Users)", evidence: ["mfa", "passwordPolicy"], baselines: ["low", "moderate", "high"] },
  { id: "IA-2(1)", family: "IA", title: "Multi-factor Authentication to Privileged Accounts", evidence: ["mfa"], baselines: ["low", "moderate", "high"] },
  { id: "IA-2(2)", family: "IA", title: "Multi-factor Authentication to Non-privileged Accounts", evidence: ["mfa"], baselines: ["low", "moderate", "high"] },
  { id: "IA-2(5)", family: "IA", title: "Individual Authentication with Group Authentication", evidence: [], baselines: ["high"] },
  { id: "IA-2(8)", family: "IA", title: "Access to Accounts — Replay Resistant", evidence: ["mfa"], baselines: ["low", "moderate", "high"] },
  { id: "IA-2(12)", family: "IA", title: "Acceptance of PIV Credentials", evidence: ["mfa"], baselines: ["low", "moderate", "high"] },
  { id: "IA-3", family: "IA", title: "Device Identification and Authentication", evidence: [], baselines: ["moderate", "high"] },
  { id: "IA-4", family: "IA", title: "Identifier Management", evidence: ["mfa", "passwordPolicy"], baselines: ["low", "moderate", "high"] },
  { id: "IA-4(4)", family: "IA", title: "Identify User Status", evidence: [], baselines: ["moderate", "high"] },
  { id: "IA-5", family: "IA", title: "Authenticator Management", evidence: ["passwordPolicy"], baselines: ["low", "moderate", "high"] },
  { id: "IA-5(1)", family: "IA", title: "Password-based Authentication", evidence: ["passwordPolicy"], baselines: ["low", "moderate", "high"] },
  { id: "IA-5(2)", family: "IA", title: "Public Key-based Authentication", evidence: [], baselines: ["moderate", "high"] },
  { id: "IA-5(6)", family: "IA", title: "Protection of Authenticators", evidence: ["passwordPolicy"], baselines: ["moderate", "high"] },
  { id: "IA-6", family: "IA", title: "Authentication Feedback", evidence: ["mfa", "passwordPolicy"], baselines: ["low", "moderate", "high"] },
  { id: "IA-7", family: "IA", title: "Cryptographic Module Authentication", evidence: ["mfa", "passwordPolicy"], baselines: ["low", "moderate", "high"] },
  { id: "IA-8", family: "IA", title: "Identification and Authentication (Non-organizational Users)", evidence: ["mfa", "passwordPolicy"], baselines: ["low", "moderate", "high"] },
  { id: "IA-8(1)", family: "IA", title: "Acceptance of PIV Credentials from Other Agencies", evidence: ["mfa", "passwordPolicy"], baselines: ["low", "moderate", "high"] },
  { id: "IA-8(2)", family: "IA", title: "Acceptance of External Authenticators", evidence: ["mfa", "passwordPolicy"], baselines: ["low", "moderate", "high"] },
  { id: "IA-8(4)", family: "IA", title: "Use of Defined Profiles", evidence: ["mfa", "passwordPolicy"], baselines: ["low", "moderate", "high"] },
  { id: "IA-11", family: "IA", title: "Re-authentication", evidence: ["mfa", "passwordPolicy"], baselines: ["low", "moderate", "high"] },
  { id: "IA-12", family: "IA", title: "Identity Proofing", evidence: [], baselines: ["moderate", "high"] },
  { id: "IA-12(2)", family: "IA", title: "Identity Evidence", evidence: [], baselines: ["moderate", "high"] },
  { id: "IA-12(3)", family: "IA", title: "Identity Evidence Validation and Verification", evidence: [], baselines: ["moderate", "high"] },
  { id: "IA-12(4)", family: "IA", title: "In-person Validation and Verification", evidence: [], baselines: ["high"] },
  { id: "IA-12(5)", family: "IA", title: "Address Confirmation", evidence: [], baselines: ["moderate", "high"] },

  // ── IR (18) ──
  { id: "IR-1", family: "IR", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "IR-2", family: "IR", title: "Incident Response Training", evidence: ["incidentResponse", "responseSupport"], baselines: ["low", "moderate", "high"] },
  { id: "IR-2(1)", family: "IR", title: "Simulated Events", evidence: ["training"], baselines: ["high"] },
  { id: "IR-2(2)", family: "IR", title: "Automated Training Environments", evidence: ["training"], baselines: ["high"] },
  { id: "IR-3", family: "IR", title: "Incident Response Testing", evidence: ["incidentResponse"], baselines: ["moderate", "high"] },
  { id: "IR-3(2)", family: "IR", title: "Coordination with Related Plans", evidence: ["incidentResponse"], baselines: ["moderate", "high"] },
  { id: "IR-4", family: "IR", title: "Incident Handling", evidence: ["incidentResponse", "responseSupport"], baselines: ["low", "moderate", "high"] },
  { id: "IR-4(1)", family: "IR", title: "Automated Incident Handling Processes", evidence: ["incidentResponse", "monitoring"], baselines: ["moderate", "high"] },
  { id: "IR-4(4)", family: "IR", title: "Information Correlation", evidence: ["incidentResponse"], baselines: ["high"] },
  { id: "IR-4(11)", family: "IR", title: "Integrated Incident Response Team", evidence: ["responseSupport"], baselines: ["high"] },
  { id: "IR-5", family: "IR", title: "Incident Monitoring", evidence: ["incidentResponse", "responseSupport"], baselines: ["low", "moderate", "high"] },
  { id: "IR-5(1)", family: "IR", title: "Automated Tracking, Data Collection, and Analysis", evidence: ["incidentResponse"], baselines: ["high"] },
  { id: "IR-6", family: "IR", title: "Incident Reporting", evidence: ["incidentResponse"], baselines: ["low", "moderate", "high"] },
  { id: "IR-6(1)", family: "IR", title: "Automated Reporting", evidence: ["incidentResponse"], baselines: ["moderate", "high"] },
  { id: "IR-6(3)", family: "IR", title: "Supply Chain Coordination", evidence: ["vendorDueDiligence"], baselines: ["moderate", "high"] },
  { id: "IR-7", family: "IR", title: "Incident Response Assistance", evidence: ["incidentResponse", "responseSupport"], baselines: ["low", "moderate", "high"] },
  { id: "IR-7(1)", family: "IR", title: "Automation Support for Availability of Information and Support", evidence: ["responseSupport"], baselines: ["moderate", "high"] },
  { id: "IR-8", family: "IR", title: "Incident Response Plan", evidence: ["incidentResponse"], baselines: ["low", "moderate", "high"] },

  // ── MA (12) ──
  { id: "MA-1", family: "MA", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "MA-2", family: "MA", title: "Controlled Maintenance", evidence: ["itManagement", "changeManagement"], baselines: ["low", "moderate", "high"] },
  { id: "MA-2(2)", family: "MA", title: "Automated Maintenance Activities", evidence: ["itManagement"], baselines: ["high"] },
  { id: "MA-3", family: "MA", title: "Maintenance Tools", evidence: ["itManagement"], baselines: ["moderate", "high"] },
  { id: "MA-3(1)", family: "MA", title: "Inspect Tools", evidence: [], baselines: ["moderate", "high"] },
  { id: "MA-3(2)", family: "MA", title: "Inspect Media", evidence: ["endpoint"], baselines: ["moderate", "high"] },
  { id: "MA-3(3)", family: "MA", title: "Prevent Unauthorized Removal", evidence: ["mediaDisposal"], baselines: ["moderate", "high"] },
  { id: "MA-4", family: "MA", title: "Nonlocal Maintenance", evidence: ["itManagement", "changeManagement"], baselines: ["low", "moderate", "high"] },
  { id: "MA-4(3)", family: "MA", title: "Comparable Security and Sanitization", evidence: [], baselines: ["high"] },
  { id: "MA-5", family: "MA", title: "Maintenance Personnel", evidence: ["itManagement", "changeManagement"], baselines: ["low", "moderate", "high"] },
  { id: "MA-5(1)", family: "MA", title: "Individuals Without Appropriate Access", evidence: [], baselines: ["high"] },
  { id: "MA-6", family: "MA", title: "Timely Maintenance", evidence: ["itManagement"], baselines: ["moderate", "high"] },

  // ── MP (10) ──
  { id: "MP-1", family: "MP", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "MP-2", family: "MP", title: "Media Access", evidence: ["mediaDisposal", "encryptionAtRest"], baselines: ["low", "moderate", "high"] },
  { id: "MP-3", family: "MP", title: "Media Marking", evidence: ["dataInventory"], baselines: ["moderate", "high"] },
  { id: "MP-4", family: "MP", title: "Media Storage", evidence: ["encryptionAtRest", "mediaDisposal"], baselines: ["moderate", "high"] },
  { id: "MP-5", family: "MP", title: "Media Transport", evidence: ["encryptionInTransit", "mediaDisposal"], baselines: ["moderate", "high"] },
  { id: "MP-6", family: "MP", title: "Media Sanitization", evidence: ["mediaDisposal"], baselines: ["low", "moderate", "high"] },
  { id: "MP-6(1)", family: "MP", title: "Review, Approve, Track, Document, and Verify", evidence: ["mediaDisposal"], baselines: ["high"] },
  { id: "MP-6(2)", family: "MP", title: "Equipment Testing", evidence: ["mediaDisposal"], baselines: ["high"] },
  { id: "MP-6(3)", family: "MP", title: "Nondestructive Techniques", evidence: ["mediaDisposal"], baselines: ["high"] },
  { id: "MP-7", family: "MP", title: "Media Use", evidence: ["mediaDisposal"], baselines: ["low", "moderate", "high"] },

  // ── PE (25) ──
  { id: "PE-1", family: "PE", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "PE-2", family: "PE", title: "Physical Access Authorizations", evidence: ["physicalSecurity"], baselines: ["low", "moderate", "high"] },
  { id: "PE-3", family: "PE", title: "Physical Access Control", evidence: ["physicalSecurity"], baselines: ["low", "moderate", "high"] },
  { id: "PE-3(1)", family: "PE", title: "System Access", evidence: ["physicalSecurity"], baselines: ["high"] },
  { id: "PE-4", family: "PE", title: "Access Control for Transmission", evidence: ["physicalSecurity"], baselines: ["moderate", "high"] },
  { id: "PE-5", family: "PE", title: "Access Control for Output Devices", evidence: ["physicalSecurity"], baselines: ["moderate", "high"] },
  { id: "PE-6", family: "PE", title: "Monitoring Physical Access", evidence: ["physicalSecurity"], baselines: ["low", "moderate", "high"] },
  { id: "PE-6(1)", family: "PE", title: "Intrusion Alarms and Surveillance Equipment", evidence: ["physicalSecurity"], baselines: ["moderate", "high"] },
  { id: "PE-6(4)", family: "PE", title: "Monitoring Physical Access to Systems", evidence: ["physicalSecurity"], baselines: ["high"] },
  { id: "PE-8", family: "PE", title: "Visitor Access Records", evidence: ["physicalSecurity"], baselines: ["low", "moderate", "high"] },
  { id: "PE-8(1)", family: "PE", title: "Automated Records Maintenance and Review", evidence: ["physicalSecurity"], baselines: ["high"] },
  { id: "PE-9", family: "PE", title: "Power Equipment and Cabling", evidence: ["physicalSecurity"], baselines: ["moderate", "high"] },
  { id: "PE-10", family: "PE", title: "Emergency Shutoff", evidence: ["physicalSecurity"], baselines: ["moderate", "high"] },
  { id: "PE-11", family: "PE", title: "Emergency Power", evidence: ["physicalSecurity"], baselines: ["moderate", "high"] },
  { id: "PE-11(1)", family: "PE", title: "Alternate Power Supply — Minimal Operational Capability", evidence: [], baselines: ["high"] },
  { id: "PE-12", family: "PE", title: "Emergency Lighting", evidence: ["physicalSecurity"], baselines: ["low", "moderate", "high"] },
  { id: "PE-13", family: "PE", title: "Fire Protection", evidence: ["physicalSecurity"], baselines: ["low", "moderate", "high"] },
  { id: "PE-13(1)", family: "PE", title: "Detection Systems — Automatic Activation and Notification", evidence: ["physicalSecurity"], baselines: ["moderate", "high"] },
  { id: "PE-13(2)", family: "PE", title: "Suppression Systems — Automatic Activation and Notification", evidence: ["physicalSecurity"], baselines: ["high"] },
  { id: "PE-14", family: "PE", title: "Environmental Controls", evidence: ["physicalSecurity"], baselines: ["low", "moderate", "high"] },
  { id: "PE-15", family: "PE", title: "Water Damage Protection", evidence: ["physicalSecurity"], baselines: ["low", "moderate", "high"] },
  { id: "PE-15(1)", family: "PE", title: "Automation Support", evidence: ["physicalSecurity"], baselines: ["high"] },
  { id: "PE-16", family: "PE", title: "Delivery and Removal", evidence: ["physicalSecurity"], baselines: ["low", "moderate", "high"] },
  { id: "PE-17", family: "PE", title: "Alternate Work Site", evidence: ["physicalSecurity"], baselines: ["moderate", "high"] },
  { id: "PE-18", family: "PE", title: "Location of System Components", evidence: ["physicalSecurity"], baselines: ["high"] },

  // ── PL (7) ──
  { id: "PL-1", family: "PL", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "PL-2", family: "PL", title: "System Security and Privacy Plans", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "PL-4", family: "PL", title: "Rules of Behavior", evidence: ["documentedPolicies", "training"], baselines: ["low", "moderate", "high"] },
  { id: "PL-4(1)", family: "PL", title: "Social Media and External Site/Application Usage Restrictions", evidence: ["documentedPolicies"], baselines: ["low", "moderate", "high"] },
  { id: "PL-8", family: "PL", title: "Security and Privacy Architectures", evidence: ["documentedPolicies"], baselines: ["moderate", "high"] },
  { id: "PL-10", family: "PL", title: "Baseline Selection", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "PL-11", family: "PL", title: "Baseline Tailoring", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },

  // ── PS (10) ──
  { id: "PS-1", family: "PS", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "PS-2", family: "PS", title: "Position Risk Designation", evidence: ["offboarding", "securityOwnership"], baselines: ["low", "moderate", "high"] },
  { id: "PS-3", family: "PS", title: "Personnel Screening", evidence: ["offboarding", "securityOwnership"], baselines: ["low", "moderate", "high"] },
  { id: "PS-4", family: "PS", title: "Personnel Termination", evidence: ["offboarding"], baselines: ["low", "moderate", "high"] },
  { id: "PS-4(2)", family: "PS", title: "Automated Actions", evidence: ["offboarding"], baselines: ["high"] },
  { id: "PS-5", family: "PS", title: "Personnel Transfer", evidence: ["offboarding"], baselines: ["low", "moderate", "high"] },
  { id: "PS-6", family: "PS", title: "Access Agreements", evidence: ["offboarding", "securityOwnership"], baselines: ["low", "moderate", "high"] },
  { id: "PS-7", family: "PS", title: "External Personnel Security", evidence: ["vendorDueDiligence"], baselines: ["low", "moderate", "high"] },
  { id: "PS-8", family: "PS", title: "Personnel Sanctions", evidence: ["offboarding", "securityOwnership"], baselines: ["low", "moderate", "high"] },
  { id: "PS-9", family: "PS", title: "Position Descriptions", evidence: ["offboarding", "securityOwnership"], baselines: ["low", "moderate", "high"] },

  // ── RA (11) ──
  { id: "RA-1", family: "RA", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "RA-2", family: "RA", title: "Security Categorization", evidence: ["riskAssessmentCadence", "vulnManagement"], baselines: ["low", "moderate", "high"] },
  { id: "RA-3", family: "RA", title: "Risk Assessment", evidence: ["riskAssessmentCadence"], baselines: ["low", "moderate", "high"] },
  { id: "RA-3(1)", family: "RA", title: "Supply Chain Risk Assessment", evidence: ["vendorInventory"], baselines: ["low", "moderate", "high"] },
  { id: "RA-5", family: "RA", title: "Vulnerability Monitoring and Scanning", evidence: ["vulnManagement"], baselines: ["low", "moderate", "high"] },
  { id: "RA-5(2)", family: "RA", title: "Update Vulnerabilities to Be Scanned", evidence: ["vulnManagement"], baselines: ["low", "moderate", "high"] },
  { id: "RA-5(4)", family: "RA", title: "Discoverable Information", evidence: ["vulnManagement"], baselines: ["high"] },
  { id: "RA-5(5)", family: "RA", title: "Privileged Access", evidence: ["vulnManagement", "privilegedAccess"], baselines: ["moderate", "high"] },
  { id: "RA-5(11)", family: "RA", title: "Public Disclosure Program", evidence: ["vulnManagement"], baselines: ["low", "moderate", "high"] },
  { id: "RA-7", family: "RA", title: "Risk Response", evidence: ["riskAssessmentCadence", "vulnManagement"], baselines: ["low", "moderate", "high"] },
  { id: "RA-9", family: "RA", title: "Criticality Analysis", evidence: ["riskAssessmentCadence"], baselines: ["moderate", "high"] },

  // ── SA (21) ──
  { id: "SA-1", family: "SA", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "SA-2", family: "SA", title: "Allocation of Resources", evidence: ["vendorDueDiligence", "vendorContracts"], baselines: ["low", "moderate", "high"] },
  { id: "SA-3", family: "SA", title: "System Development Life Cycle", evidence: ["vendorDueDiligence", "vendorContracts"], baselines: ["low", "moderate", "high"] },
  { id: "SA-4", family: "SA", title: "Acquisition Process", evidence: ["vendorContracts"], baselines: ["low", "moderate", "high"] },
  { id: "SA-4(1)", family: "SA", title: "Functional Properties of Controls", evidence: ["vendorContracts"], baselines: ["moderate", "high"] },
  { id: "SA-4(2)", family: "SA", title: "Design and Implementation Information for Controls", evidence: ["vendorContracts"], baselines: ["moderate", "high"] },
  { id: "SA-4(5)", family: "SA", title: "System, Component, and Service Configurations", evidence: ["vendorContracts"], baselines: ["high"] },
  { id: "SA-4(9)", family: "SA", title: "Functions, Ports, Protocols, and Services in Use", evidence: ["vendorContracts"], baselines: ["moderate", "high"] },
  { id: "SA-4(10)", family: "SA", title: "Use of Approved PIV Products", evidence: ["vendorDueDiligence"], baselines: ["low", "moderate", "high"] },
  { id: "SA-5", family: "SA", title: "System Documentation", evidence: ["vendorDueDiligence", "vendorContracts"], baselines: ["low", "moderate", "high"] },
  { id: "SA-8", family: "SA", title: "Security and Privacy Engineering Principles", evidence: ["vendorDueDiligence", "vendorContracts"], baselines: ["low", "moderate", "high"] },
  { id: "SA-9", family: "SA", title: "External System Services", evidence: ["vendorDueDiligence", "vendorContracts"], baselines: ["low", "moderate", "high"] },
  { id: "SA-9(2)", family: "SA", title: "Identification of Functions, Ports, Protocols, and Services", evidence: ["vendorDueDiligence"], baselines: ["moderate", "high"] },
  { id: "SA-10", family: "SA", title: "Developer Configuration Management", evidence: ["vendorDueDiligence"], baselines: ["moderate", "high"] },
  { id: "SA-11", family: "SA", title: "Developer Testing and Evaluation", evidence: ["vendorDueDiligence"], baselines: ["moderate", "high"] },
  { id: "SA-15", family: "SA", title: "Development Process, Standards, and Tools", evidence: ["vendorDueDiligence"], baselines: ["moderate", "high"] },
  { id: "SA-15(3)", family: "SA", title: "Criticality Analysis", evidence: ["riskAssessmentCadence"], baselines: ["moderate", "high"] },
  { id: "SA-16", family: "SA", title: "Developer-provided Training", evidence: [], baselines: ["high"] },
  { id: "SA-17", family: "SA", title: "Developer Security and Privacy Architecture and Design", evidence: ["vendorDueDiligence"], baselines: ["high"] },
  { id: "SA-21", family: "SA", title: "Developer Screening", evidence: ["vendorDueDiligence"], baselines: ["high"] },
  { id: "SA-22", family: "SA", title: "Unsupported System Components", evidence: ["vendorDueDiligence", "vendorContracts"], baselines: ["low", "moderate", "high"] },

  // ── SC (30) ──
  { id: "SC-1", family: "SC", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "SC-2", family: "SC", title: "Separation of System and User Functionality", evidence: [], baselines: ["moderate", "high"] },
  { id: "SC-3", family: "SC", title: "Security Function Isolation", evidence: [], baselines: ["high"] },
  { id: "SC-4", family: "SC", title: "Information in Shared System Resources", evidence: [], baselines: ["moderate", "high"] },
  { id: "SC-5", family: "SC", title: "Denial-of-service Protection", evidence: ["encryptionInTransit", "endpoint"], baselines: ["low", "moderate", "high"] },
  { id: "SC-7", family: "SC", title: "Boundary Protection", evidence: ["endpoint"], baselines: ["low", "moderate", "high"] },
  { id: "SC-7(3)", family: "SC", title: "Access Points", evidence: ["itManagement"], baselines: ["moderate", "high"] },
  { id: "SC-7(4)", family: "SC", title: "External Telecommunications Services", evidence: ["itManagement"], baselines: ["moderate", "high"] },
  { id: "SC-7(5)", family: "SC", title: "Deny by Default — Allow by Exception", evidence: ["itManagement"], baselines: ["moderate", "high"] },
  { id: "SC-7(7)", family: "SC", title: "Split Tunneling for Remote Devices", evidence: ["endpoint"], baselines: ["moderate", "high"] },
  { id: "SC-7(8)", family: "SC", title: "Route Traffic to Authenticated Proxy Servers", evidence: [], baselines: ["moderate", "high"] },
  { id: "SC-7(18)", family: "SC", title: "Fail Secure", evidence: [], baselines: ["high"] },
  { id: "SC-7(21)", family: "SC", title: "Isolation of System Components", evidence: [], baselines: ["high"] },
  { id: "SC-8", family: "SC", title: "Transmission Confidentiality and Integrity", evidence: ["encryptionInTransit"], baselines: ["moderate", "high"] },
  { id: "SC-8(1)", family: "SC", title: "Cryptographic Protection", evidence: ["encryptionInTransit"], baselines: ["moderate", "high"] },
  { id: "SC-10", family: "SC", title: "Network Disconnect", evidence: [], baselines: ["moderate", "high"] },
  { id: "SC-12", family: "SC", title: "Cryptographic Key Establishment and Management", evidence: ["encryptionInTransit", "endpoint"], baselines: ["low", "moderate", "high"] },
  { id: "SC-12(1)", family: "SC", title: "Availability", evidence: [], baselines: ["high"] },
  { id: "SC-13", family: "SC", title: "Cryptographic Protection", evidence: ["encryptionAtRest", "encryptionInTransit"], baselines: ["low", "moderate", "high"] },
  { id: "SC-15", family: "SC", title: "Collaborative Computing Devices and Applications", evidence: ["encryptionInTransit", "endpoint"], baselines: ["low", "moderate", "high"] },
  { id: "SC-17", family: "SC", title: "Public Key Infrastructure Certificates", evidence: [], baselines: ["moderate", "high"] },
  { id: "SC-18", family: "SC", title: "Mobile Code", evidence: ["endpoint"], baselines: ["moderate", "high"] },
  { id: "SC-20", family: "SC", title: "Secure Name/Address Resolution Service (Authoritative Source)", evidence: ["encryptionInTransit"], baselines: ["low", "moderate", "high"] },
  { id: "SC-21", family: "SC", title: "Secure Name/Address Resolution Service (Recursive or Caching Resolver)", evidence: ["encryptionInTransit"], baselines: ["low", "moderate", "high"] },
  { id: "SC-22", family: "SC", title: "Architecture and Provisioning for Name/Address Resolution Service", evidence: ["encryptionInTransit", "endpoint"], baselines: ["low", "moderate", "high"] },
  { id: "SC-23", family: "SC", title: "Session Authenticity", evidence: [], baselines: ["moderate", "high"] },
  { id: "SC-24", family: "SC", title: "Fail in Known State", evidence: [], baselines: ["high"] },
  { id: "SC-28", family: "SC", title: "Protection of Information at Rest", evidence: ["encryptionAtRest"], baselines: ["moderate", "high"] },
  { id: "SC-28(1)", family: "SC", title: "Cryptographic Protection", evidence: ["encryptionAtRest"], baselines: ["moderate", "high"] },
  { id: "SC-39", family: "SC", title: "Process Isolation", evidence: ["encryptionInTransit", "endpoint"], baselines: ["low", "moderate", "high"] },

  // ── SI (28) ──
  { id: "SI-1", family: "SI", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "SI-2", family: "SI", title: "Flaw Remediation", evidence: ["vulnManagement"], baselines: ["low", "moderate", "high"] },
  { id: "SI-2(2)", family: "SI", title: "Automated Flaw Remediation Status", evidence: ["vulnManagement"], baselines: ["moderate", "high"] },
  { id: "SI-3", family: "SI", title: "Malicious Code Protection", evidence: ["endpoint"], baselines: ["low", "moderate", "high"] },
  { id: "SI-4", family: "SI", title: "System Monitoring", evidence: ["monitoring"], baselines: ["low", "moderate", "high"] },
  { id: "SI-4(2)", family: "SI", title: "Automated Tools and Mechanisms for Real-time Analysis", evidence: ["monitoring"], baselines: ["moderate", "high"] },
  { id: "SI-4(4)", family: "SI", title: "Inbound and Outbound Communications Traffic", evidence: ["monitoring"], baselines: ["moderate", "high"] },
  { id: "SI-4(5)", family: "SI", title: "System-generated Alerts", evidence: ["monitoring"], baselines: ["moderate", "high"] },
  { id: "SI-4(10)", family: "SI", title: "Visibility of Encrypted Communications", evidence: ["monitoring"], baselines: ["high"] },
  { id: "SI-4(12)", family: "SI", title: "Automated Organization-generated Alerts", evidence: ["monitoring"], baselines: ["high"] },
  { id: "SI-4(14)", family: "SI", title: "Wireless Intrusion Detection", evidence: ["monitoring"], baselines: ["high"] },
  { id: "SI-4(20)", family: "SI", title: "Privileged Users", evidence: ["monitoring", "privilegedAccess"], baselines: ["high"] },
  { id: "SI-4(22)", family: "SI", title: "Unauthorized Network Services", evidence: ["monitoring"], baselines: ["high"] },
  { id: "SI-5", family: "SI", title: "Security Alerts, Advisories, and Directives", evidence: ["endpoint", "emailSecurity", "vulnManagement"], baselines: ["low", "moderate", "high"] },
  { id: "SI-5(1)", family: "SI", title: "Automated Alerts and Advisories", evidence: ["vulnManagement"], baselines: ["high"] },
  { id: "SI-6", family: "SI", title: "Security and Privacy Function Verification", evidence: [], baselines: ["high"] },
  { id: "SI-7", family: "SI", title: "Software, Firmware, and Information Integrity", evidence: ["endpoint"], baselines: ["moderate", "high"] },
  { id: "SI-7(1)", family: "SI", title: "Integrity Checks", evidence: ["endpoint"], baselines: ["moderate", "high"] },
  { id: "SI-7(2)", family: "SI", title: "Automated Notifications of Integrity Violations", evidence: ["endpoint"], baselines: ["high"] },
  { id: "SI-7(5)", family: "SI", title: "Automated Response to Integrity Violations", evidence: ["endpoint"], baselines: ["high"] },
  { id: "SI-7(7)", family: "SI", title: "Integration of Detection and Response", evidence: ["monitoring", "incidentResponse"], baselines: ["moderate", "high"] },
  { id: "SI-7(15)", family: "SI", title: "Code Authentication", evidence: [], baselines: ["high"] },
  { id: "SI-8", family: "SI", title: "Spam Protection", evidence: ["emailSecurity"], baselines: ["moderate", "high"] },
  { id: "SI-8(2)", family: "SI", title: "Automatic Updates", evidence: ["emailSecurity"], baselines: ["moderate", "high"] },
  { id: "SI-10", family: "SI", title: "Information Input Validation", evidence: [], baselines: ["moderate", "high"] },
  { id: "SI-11", family: "SI", title: "Error Handling", evidence: [], baselines: ["moderate", "high"] },
  { id: "SI-12", family: "SI", title: "Information Management and Retention", evidence: ["endpoint", "emailSecurity", "vulnManagement"], baselines: ["low", "moderate", "high"] },
  { id: "SI-16", family: "SI", title: "Memory Protection", evidence: ["endpoint"], baselines: ["moderate", "high"] },

  // ── SR (14) ──
  { id: "SR-1", family: "SR", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"], baselines: ["low", "moderate", "high"] },
  { id: "SR-2", family: "SR", title: "Supply Chain Risk Management Plan", evidence: ["vendorInventory"], baselines: ["low", "moderate", "high"] },
  { id: "SR-2(1)", family: "SR", title: "Establish SCRM Team", evidence: ["vendorInventory", "vendorDueDiligence", "vendorContracts"], baselines: ["low", "moderate", "high"] },
  { id: "SR-3", family: "SR", title: "Supply Chain Controls and Processes", evidence: ["vendorInventory"], baselines: ["low", "moderate", "high"] },
  { id: "SR-5", family: "SR", title: "Acquisition Strategies, Tools, and Methods", evidence: ["vendorContracts"], baselines: ["low", "moderate", "high"] },
  { id: "SR-6", family: "SR", title: "Supplier Assessments and Reviews", evidence: ["vendorDueDiligence"], baselines: ["moderate", "high"] },
  { id: "SR-8", family: "SR", title: "Notification Agreements", evidence: ["vendorContracts"], baselines: ["low", "moderate", "high"] },
  { id: "SR-9", family: "SR", title: "Tamper Resistance and Detection", evidence: [], baselines: ["high"] },
  { id: "SR-9(1)", family: "SR", title: "Multiple Stages of System Development Life Cycle", evidence: [], baselines: ["high"] },
  { id: "SR-10", family: "SR", title: "Inspection of Systems or Components", evidence: ["vendorInventory", "vendorDueDiligence", "vendorContracts"], baselines: ["low", "moderate", "high"] },
  { id: "SR-11", family: "SR", title: "Component Authenticity", evidence: ["vendorDueDiligence"], baselines: ["low", "moderate", "high"] },
  { id: "SR-11(1)", family: "SR", title: "Anti-counterfeit Training", evidence: ["vendorInventory", "vendorDueDiligence", "vendorContracts"], baselines: ["low", "moderate", "high"] },
  { id: "SR-11(2)", family: "SR", title: "Configuration Control for Component Service and Repair", evidence: ["vendorInventory", "vendorDueDiligence", "vendorContracts"], baselines: ["low", "moderate", "high"] },
  { id: "SR-12", family: "SR", title: "Component Disposal", evidence: ["mediaDisposal"], baselines: ["low", "moderate", "high"] },
];

// ── Assessment ────────────────────────────────────────────────
const STATUS = { MET: "met", PARTIAL: "partial", GAP: "gap", UNKNOWN: "unknown" };

function scoreControl(c, answers) {
  const scores = (c.evidence || [])
    .map(id => answers[id]?.score)
    .filter(s => typeof s === "number");
  if (scores.length === 0) return { ...c, status: STATUS.UNKNOWN, score: null };
  const s = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return { ...c, score: s, status: s >= 80 ? STATUS.MET : s >= 45 ? STATUS.PARTIAL : STATUS.GAP };
}

const BASELINE_LABEL = { low: "Low", moderate: "Moderate", high: "High" };

/**
 * `baseline` selects which FIPS 199 impact level to assess against — "low"
 * (default, the conservative choice when a client hasn't told us otherwise),
 * "moderate", or "high". Baselines are cumulative, so moderate includes
 * everything low does, and high includes everything moderate does.
 */
export function assessNist80053(checklistAnswers = {}, { baseline = "low" } = {}) {
  const bl = NIST80053_BASELINES[baseline] ? baseline : "low";
  const controlsInBaseline = NIST80053_CONTROLS.filter(c => c.baselines.includes(bl));

  const families = NIST80053_FAMILIES.map(f => {
    const controls = controlsInBaseline
      .filter(c => c.family === f.id)
      .map(c => scoreControl(c, checklistAnswers));
    if (!controls.length) return null;
    const scored = controls.filter(c => c.status !== STATUS.UNKNOWN);
    const avg = scored.length ? Math.round(scored.reduce((a, c) => a + c.score, 0) / scored.length) : null;
    return {
      id: f.id, name: f.name,
      controls,
      assessed: scored.length,
      met: scored.filter(c => c.status === STATUS.MET).length,
      score: avg,
      status: avg === null ? STATUS.UNKNOWN : avg >= 80 ? STATUS.MET : avg >= 45 ? STATUS.PARTIAL : STATUS.GAP,
    };
  }).filter(Boolean);

  const all = families.flatMap(f => f.controls);
  const scored = all.filter(c => c.status !== STATUS.UNKNOWN);
  const gaps = scored.filter(c => c.status === STATUS.GAP);
  const met = scored.filter(c => c.status === STATUS.MET);

  return {
    framework: NIST80053_META,
    depth: "control-mapped",
    baseline: BASELINE_LABEL[bl],
    baselineNote: NIST80053_META.baselineNote,
    relationshipNote: NIST80053_META.relationshipNote,
    baselines: NIST80053_BASELINES,
    families,
    summary: {
      total: controlsInBaseline.length,
      families: families.length,
      assessed: scored.length,
      met: met.length,
      partial: scored.filter(c => c.status === STATUS.PARTIAL).length,
      gaps: gaps.length,
      unknown: all.length - scored.length,
      // Percentage of ASSESSED controls that are met — never a percentage of
      // the full baseline, which would imply we assessed controls we didn't.
      coveragePct: scored.length ? Math.round((met.length / scored.length) * 100) : null,
    },
    topGaps: gaps.slice(0, 5).map(g => ({ id: g.id, family: g.family, title: g.title })),
    weakestFamilies: families
      .filter(f => f.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map(f => ({ id: f.id, name: f.name, score: f.score })),

    // Honesty about our own resolution. An SMB assessment of 35 questions
    // cannot distinguish AU-2 from AU-3 — both are answered by "do you have
    // logging?" — and that gets MORE true, not less, as the baseline grows:
    // Moderate and High add specialized developer-security, physical-depth,
    // and supply-chain-tamper requirements a general assessment often has no
    // signal for at all. We say that plainly rather than dressing coarse or
    // absent signal up as control-by-control rigour.
    mappingFidelity: {
      level: "family-informed",
      what:
        `Each of the ${controlsInBaseline.length} controls in the ${BASELINE_LABEL[bl]} baseline maps to specific assessment answers where a genuine one exists, and the result is computed — not written by an AI. Our assessment has 35 questions; ${BASELINE_LABEL[bl]} has ${controlsInBaseline.length} controls, so several controls within a family share the same evidence, and controls with no genuine match report "not yet assessed" rather than a stretched mapping.`,
      soWhat:
        "Read family scores as reliable and individual control scores as indicative. This is a gap analysis to find where to look, not a control-by-control audit. A real 800-53 assessment tests each control against your System Security Plan.",
    },

    requiredArtifacts: [
      {
        id: "ssp",
        name: "System Security Plan (SSP)",
        control: "PL-2",
        why: "Defines the system boundary and documents how each control is implemented. PL-2 is in every baseline — you cannot be compliant without one, and no assessor can test you without one.",
      },
      {
        id: "poam",
        name: "Plan of Action and Milestones (POA&M)",
        control: "CA-5",
        why: "Tracks each unimplemented control with an owner and a date. Also in every baseline. Having gaps is expected; not tracking them is the finding.",
      },
      {
        id: "categorization",
        name: "FIPS 199 Security Categorization",
        control: "RA-2",
        why: "Determines which baseline is even the right target. Do this first — everything else depends on the answer.",
      },
    ],

    methodology:
      `The ${controlsInBaseline.length} controls of the SP 800-53B ${BASELINE_LABEL[bl]} baseline, extracted from NIST's official OSCAL profile, each mapped to your assessment answers by a fixed rule. Controls with no answering evidence report 'not yet assessed' rather than being assumed implemented.`,
    disclaimer:
      `This is a gap analysis against the NIST SP 800-53 Rev 5 ${BASELINE_LABEL[bl]} baseline. It is not an ATO, not a FedRAMP authorization, not a FISMA assessment, and not an assessor's opinion. Confirm your impact level via FIPS 199 before relying on this baseline being the right target.`,
  };
}

/** Controls in a given family, across all baselines — for drilling in from a family score. */
export function controlsInFamily(familyId) {
  return NIST80053_CONTROLS.filter(c => c.family === familyId);
}

/** The baseline-selection question, answered honestly when a client asks. */
export function baselineGuidance() {
  return {
    question: "Which baseline do I need?",
    answer:
      "FIPS 199 decides it, based on the worst-case impact of a confidentiality, integrity, or availability breach. Limited adverse effect is Low; serious is Moderate; severe or catastrophic is High. A typical SMB running business email and a CRM is Low. Federal contractors and FedRAMP-track cloud services are typically Moderate. A contract will usually name the baseline for you if one applies.",
    weAssess: "All three: Low (149 controls), Moderate (287), and High (370).",
  };
}
