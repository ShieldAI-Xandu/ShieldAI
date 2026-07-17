// nist80053.js
// NIST SP 800-53 Rev 5 — Security and Privacy Controls, LOW baseline.
//
// WHY THE LOW BASELINE AND NOT THE CATALOGUE
// -------------------------------------------
// The full Rev 5 catalogue is 1,189 controls across 20 families. Nobody
// implements the catalogue — it is a menu, not a meal. FIPS 199 categorises a
// system as Low, Moderate, or High impact, and SP 800-53B then names which
// controls that baseline requires: 149 for Low, 287 for Moderate, 370 for High.
//
// We ship Low. An SMB running email, a CRM, and a website is a Low-impact
// system by any honest FIPS 199 reading, and Low is the baseline they could
// plausibly reach. Moderate is where federal contractors and FedRAMP live; if
// a client needs it, they need an assessor, not a self-service tool. Shipping
// 287 controls to a ten-person company would produce a wall of red that
// teaches them nothing.
//
// WHERE THESE 149 CONTROL IDS CAME FROM
// --------------------------------------
// Not from recall. They are extracted from NIST's own OSCAL profile —
// NIST_SP-800-53_rev5_LOW-baseline_profile.json, version 5.2.0 — and the
// titles are resolved against NIST's published catalogue. That matters here
// more than usual: secondary sources disagree about this number (several
// widely-cited blogs say 150), and a framework whose control list is subtly
// wrong is worse than one we don't offer. The profile says 149. We say 149.
//
// COPYRIGHT: none. NIST publications are US Government works in the public
// domain. Control IDs and titles are reproduced directly; the "covers" plain
// language and every evidence mapping are ours.
//
// Sources:
//   SP 800-53 Rev 5   — https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final
//   SP 800-53B        — https://csrc.nist.gov/pubs/sp/800/53/b/upd1/final
//   OSCAL content     — https://github.com/usnistgov/oscal-content

export const NIST80053_META = {
  id: "nist-800-53",
  name: "NIST 800-53",
  shortName: "NIST 800-53",
  fullName: "NIST SP 800-53 Rev 5 — Security and Privacy Controls (Low baseline)",
  authority: "National Institute of Standards and Technology",
  version: "Rev 5.2.0 — Low baseline (SP 800-53B)",
  url: "https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final",
  depth: "control-mapped",
  baseline: "low",
  summary:
    "The canonical US control catalogue — the source most other frameworks derive from. We assess the Low-impact baseline: 149 controls across 18 families.",
  whoMustComply:
    "Mandatory for federal agencies and their information systems under FISMA. For everyone else it is voluntary but foundational: 800-171, CMMC, and FedRAMP all trace back to this catalogue, so work done here is rarely wasted.",
  enforcement:
    "FISMA for federal agencies; contractual for systems operated on an agency's behalf. For private-sector SMBs there is no enforcement — the value is that it is the most complete, most widely-referenced control set in existence, and it is free.",
  baselineNote:
    "FIPS 199 decides your baseline, not preference. Low means a security breach would have limited adverse effect; Moderate means serious; High means severe or catastrophic. Most SMB systems are Low. If you process federal data, or a contract names Moderate, this assessment is not the right instrument — you need the 287-control Moderate baseline and, realistically, an assessor.",
  relationshipNote:
    "If you already did 800-171, much of this is familiar: 800-171's 110 CUI requirements were derived from this catalogue's Moderate baseline. Doing 800-53 Low first makes 800-171 substantially easier, and vice versa.",
  publicDomain: true,
};

// Baselines we do not assess — named so the number is never ambiguous.
export const NIST80053_BASELINES = {
  low: { controls: 149, assessed: true, note: "What we assess. Limited adverse effect from a breach." },
  moderate: { controls: 287, assessed: false, note: "Serious adverse effect. Where federal contractors and FedRAMP live. Not offered — a system at Moderate needs an assessor, not a self-service gap analysis." },
  high: { controls: 370, assessed: false, note: "Severe or catastrophic adverse effect. Not offered." },
  catalogueTotal: 1189,
};

// ── The 18 families in the Low baseline ───────────────────────
// The full catalogue has 20. PM (Program Management) and PT (PII Processing
// and Transparency) carry no Low-baseline controls — PM is assessed
// organisation-wide rather than per-system, and PT applies via the separate
// privacy baseline. Their absence here is NIST's, not an omission of ours.
export const NIST80053_FAMILIES = [
  { id: "AC", name: "Access Control", count: 11 },
  { id: "AT", name: "Awareness and Training", count: 5 },
  { id: "AU", name: "Audit and Accountability", count: 10 },
  { id: "CA", name: "Assessment, Authorization, and Monitoring", count: 8 },
  { id: "CM", name: "Configuration Management", count: 9 },
  { id: "CP", name: "Contingency Planning", count: 6 },
  { id: "IA", name: "Identification and Authentication", count: 16 },
  { id: "IR", name: "Incident Response", count: 7 },
  { id: "MA", name: "Maintenance", count: 4 },
  { id: "MP", name: "Media Protection", count: 4 },
  { id: "PE", name: "Physical and Environmental Protection", count: 10 },
  { id: "PL", name: "Planning", count: 6 },
  { id: "PS", name: "Personnel Security", count: 9 },
  { id: "RA", name: "Risk Assessment", count: 8 },
  { id: "SA", name: "System and Services Acquisition", count: 9 },
  { id: "SC", name: "System and Communications Protection", count: 10 },
  { id: "SI", name: "System and Information Integrity", count: 6 },
  { id: "SR", name: "Supply Chain Risk Management", count: 11 },
];

// ── The 149 Low-baseline controls ─────────────────────────────
// `id` and `title` are NIST's, verbatim from the OSCAL catalogue.
// `evidence` is ours: the checklist questions that speak to this control.
//
// A control with no evidence mapping would silently report "not yet assessed"
// forever, so every control here maps to at least one question. Where the
// mapping is coarse — a family-level default rather than a control-specific
// one — the assessment says so rather than implying control-by-control rigour
// we don't have. See `mappingFidelity` in the assessment output.
export const NIST80053_CONTROLS = [
  // ── AC (11) ──
  { id: "AC-1", family: "AC", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "AC-2", family: "AC", title: "Account Management", evidence: ["accessReviews", "offboarding"] },
  { id: "AC-3", family: "AC", title: "Access Enforcement", evidence: ["mfa", "privilegedAccess"] },
  { id: "AC-7", family: "AC", title: "Unsuccessful Logon Attempts", evidence: ["passwordPolicy"] },
  { id: "AC-8", family: "AC", title: "System Use Notification", evidence: ["documentedPolicies"] },
  { id: "AC-14", family: "AC", title: "Permitted Actions Without Identification or Authentication", evidence: ["mfa", "privilegedAccess", "accessReviews"] },
  { id: "AC-17", family: "AC", title: "Remote Access", evidence: ["mfa", "encryptionInTransit"] },
  { id: "AC-18", family: "AC", title: "Wireless Access", evidence: ["encryptionInTransit"] },
  { id: "AC-19", family: "AC", title: "Access Control for Mobile Devices", evidence: ["endpoint", "encryptionAtRest"] },
  { id: "AC-20", family: "AC", title: "Use of External Systems", evidence: ["vendorDueDiligence"] },
  { id: "AC-22", family: "AC", title: "Publicly Accessible Content", evidence: ["dataInventory"] },

  // ── AT (5) ──
  { id: "AT-1", family: "AT", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "AT-2", family: "AT", title: "Literacy Training and Awareness", evidence: ["training"] },
  { id: "AT-2(2)", family: "AT", title: "Insider Threat", evidence: ["training"] },
  { id: "AT-3", family: "AT", title: "Role-based Training", evidence: ["training"] },
  { id: "AT-4", family: "AT", title: "Training Records", evidence: ["training"] },

  // ── AU (10) ──
  { id: "AU-1", family: "AU", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "AU-2", family: "AU", title: "Event Logging", evidence: ["monitoring"] },
  { id: "AU-3", family: "AU", title: "Content of Audit Records", evidence: ["monitoring"] },
  { id: "AU-4", family: "AU", title: "Audit Log Storage Capacity", evidence: ["monitoring"] },
  { id: "AU-5", family: "AU", title: "Response to Audit Logging Process Failures", evidence: ["monitoring"] },
  { id: "AU-6", family: "AU", title: "Audit Record Review, Analysis, and Reporting", evidence: ["monitoring"] },
  { id: "AU-8", family: "AU", title: "Time Stamps", evidence: ["monitoring"] },
  { id: "AU-9", family: "AU", title: "Protection of Audit Information", evidence: ["monitoring"] },
  { id: "AU-11", family: "AU", title: "Audit Record Retention", evidence: ["dataRetention"] },
  { id: "AU-12", family: "AU", title: "Audit Record Generation", evidence: ["monitoring"] },

  // ── CA (8) ──
  { id: "CA-1", family: "CA", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "CA-2", family: "CA", title: "Control Assessments", evidence: ["priorAudit", "riskAssessmentCadence"] },
  { id: "CA-3", family: "CA", title: "Information Exchange", evidence: ["priorAudit", "riskAssessmentCadence"] },
  { id: "CA-5", family: "CA", title: "Plan of Action and Milestones", evidence: ["priorAudit", "riskAssessmentCadence"] },
  { id: "CA-6", family: "CA", title: "Authorization", evidence: ["priorAudit", "riskAssessmentCadence"] },
  { id: "CA-7", family: "CA", title: "Continuous Monitoring", evidence: ["monitoring", "riskAssessmentCadence"] },
  { id: "CA-7(4)", family: "CA", title: "Risk Monitoring", evidence: ["vulnManagement"] },
  { id: "CA-9", family: "CA", title: "Internal System Connections", evidence: ["dataInventory"] },

  // ── CM (9) ──
  { id: "CM-1", family: "CM", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "CM-2", family: "CM", title: "Baseline Configuration", evidence: ["changeManagement", "vulnManagement"] },
  { id: "CM-4", family: "CM", title: "Impact Analyses", evidence: ["changeManagement", "vulnManagement"] },
  { id: "CM-5", family: "CM", title: "Access Restrictions for Change", evidence: ["changeManagement", "vulnManagement"] },
  { id: "CM-6", family: "CM", title: "Configuration Settings", evidence: ["changeManagement", "vulnManagement"] },
  { id: "CM-7", family: "CM", title: "Least Functionality", evidence: ["changeManagement", "vulnManagement"] },
  { id: "CM-8", family: "CM", title: "System Component Inventory", evidence: ["dataInventory"] },
  { id: "CM-10", family: "CM", title: "Software Usage Restrictions", evidence: ["documentedPolicies"] },
  { id: "CM-11", family: "CM", title: "User-installed Software", evidence: ["changeManagement"] },

  // ── CP (6) ──
  { id: "CP-1", family: "CP", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "CP-2", family: "CP", title: "Contingency Plan", evidence: ["backups", "disasterRecovery"] },
  { id: "CP-3", family: "CP", title: "Contingency Training", evidence: ["backups", "disasterRecovery"] },
  { id: "CP-4", family: "CP", title: "Contingency Plan Testing", evidence: ["backups", "disasterRecovery"] },
  { id: "CP-9", family: "CP", title: "System Backup", evidence: ["backups"] },
  { id: "CP-10", family: "CP", title: "System Recovery and Reconstitution", evidence: ["disasterRecovery"] },

  // ── IA (16) ──
  { id: "IA-1", family: "IA", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "IA-2", family: "IA", title: "Identification and Authentication (Organizational Users)", evidence: ["mfa", "passwordPolicy"] },
  { id: "IA-2(1)", family: "IA", title: "Multi-factor Authentication to Privileged Accounts", evidence: ["mfa"] },
  { id: "IA-2(2)", family: "IA", title: "Multi-factor Authentication to Non-privileged Accounts", evidence: ["mfa"] },
  { id: "IA-2(8)", family: "IA", title: "Access to Accounts — Replay Resistant", evidence: ["mfa"] },
  { id: "IA-2(12)", family: "IA", title: "Acceptance of PIV Credentials", evidence: ["mfa"] },
  { id: "IA-4", family: "IA", title: "Identifier Management", evidence: ["mfa", "passwordPolicy"] },
  { id: "IA-5", family: "IA", title: "Authenticator Management", evidence: ["passwordPolicy"] },
  { id: "IA-5(1)", family: "IA", title: "Password-based Authentication", evidence: ["passwordPolicy"] },
  { id: "IA-6", family: "IA", title: "Authentication Feedback", evidence: ["mfa", "passwordPolicy"] },
  { id: "IA-7", family: "IA", title: "Cryptographic Module Authentication", evidence: ["mfa", "passwordPolicy"] },
  { id: "IA-8", family: "IA", title: "Identification and Authentication (Non-organizational Users)", evidence: ["mfa", "passwordPolicy"] },
  { id: "IA-8(1)", family: "IA", title: "Acceptance of PIV Credentials from Other Agencies", evidence: ["mfa", "passwordPolicy"] },
  { id: "IA-8(2)", family: "IA", title: "Acceptance of External Authenticators", evidence: ["mfa", "passwordPolicy"] },
  { id: "IA-8(4)", family: "IA", title: "Use of Defined Profiles", evidence: ["mfa", "passwordPolicy"] },
  { id: "IA-11", family: "IA", title: "Re-authentication", evidence: ["mfa", "passwordPolicy"] },

  // ── IR (7) ──
  { id: "IR-1", family: "IR", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "IR-2", family: "IR", title: "Incident Response Training", evidence: ["incidentResponse", "responseSupport"] },
  { id: "IR-4", family: "IR", title: "Incident Handling", evidence: ["incidentResponse", "responseSupport"] },
  { id: "IR-5", family: "IR", title: "Incident Monitoring", evidence: ["incidentResponse", "responseSupport"] },
  { id: "IR-6", family: "IR", title: "Incident Reporting", evidence: ["incidentResponse"] },
  { id: "IR-7", family: "IR", title: "Incident Response Assistance", evidence: ["incidentResponse", "responseSupport"] },
  { id: "IR-8", family: "IR", title: "Incident Response Plan", evidence: ["incidentResponse"] },

  // ── MA (4) ──
  { id: "MA-1", family: "MA", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "MA-2", family: "MA", title: "Controlled Maintenance", evidence: ["itManagement", "changeManagement"] },
  { id: "MA-4", family: "MA", title: "Nonlocal Maintenance", evidence: ["itManagement", "changeManagement"] },
  { id: "MA-5", family: "MA", title: "Maintenance Personnel", evidence: ["itManagement", "changeManagement"] },

  // ── MP (4) ──
  { id: "MP-1", family: "MP", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "MP-2", family: "MP", title: "Media Access", evidence: ["mediaDisposal", "encryptionAtRest"] },
  { id: "MP-6", family: "MP", title: "Media Sanitization", evidence: ["mediaDisposal"] },
  { id: "MP-7", family: "MP", title: "Media Use", evidence: ["mediaDisposal"] },

  // ── PE (10) ──
  { id: "PE-1", family: "PE", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "PE-2", family: "PE", title: "Physical Access Authorizations", evidence: ["physicalSecurity"] },
  { id: "PE-3", family: "PE", title: "Physical Access Control", evidence: ["physicalSecurity"] },
  { id: "PE-6", family: "PE", title: "Monitoring Physical Access", evidence: ["physicalSecurity"] },
  { id: "PE-8", family: "PE", title: "Visitor Access Records", evidence: ["physicalSecurity"] },
  { id: "PE-12", family: "PE", title: "Emergency Lighting", evidence: ["physicalSecurity"] },
  { id: "PE-13", family: "PE", title: "Fire Protection", evidence: ["physicalSecurity"] },
  { id: "PE-14", family: "PE", title: "Environmental Controls", evidence: ["physicalSecurity"] },
  { id: "PE-15", family: "PE", title: "Water Damage Protection", evidence: ["physicalSecurity"] },
  { id: "PE-16", family: "PE", title: "Delivery and Removal", evidence: ["physicalSecurity"] },

  // ── PL (6) ──
  { id: "PL-1", family: "PL", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "PL-2", family: "PL", title: "System Security and Privacy Plans", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "PL-4", family: "PL", title: "Rules of Behavior", evidence: ["documentedPolicies", "training"] },
  { id: "PL-4(1)", family: "PL", title: "Social Media and External Site/Application Usage Restrictions", evidence: ["documentedPolicies"] },
  { id: "PL-10", family: "PL", title: "Baseline Selection", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "PL-11", family: "PL", title: "Baseline Tailoring", evidence: ["documentedPolicies", "policyReviewCadence"] },

  // ── PS (9) ──
  { id: "PS-1", family: "PS", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "PS-2", family: "PS", title: "Position Risk Designation", evidence: ["offboarding", "securityOwnership"] },
  { id: "PS-3", family: "PS", title: "Personnel Screening", evidence: ["offboarding", "securityOwnership"] },
  { id: "PS-4", family: "PS", title: "Personnel Termination", evidence: ["offboarding"] },
  { id: "PS-5", family: "PS", title: "Personnel Transfer", evidence: ["offboarding"] },
  { id: "PS-6", family: "PS", title: "Access Agreements", evidence: ["offboarding", "securityOwnership"] },
  { id: "PS-7", family: "PS", title: "External Personnel Security", evidence: ["vendorDueDiligence"] },
  { id: "PS-8", family: "PS", title: "Personnel Sanctions", evidence: ["offboarding", "securityOwnership"] },
  { id: "PS-9", family: "PS", title: "Position Descriptions", evidence: ["offboarding", "securityOwnership"] },

  // ── RA (8) ──
  { id: "RA-1", family: "RA", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "RA-2", family: "RA", title: "Security Categorization", evidence: ["riskAssessmentCadence", "vulnManagement"] },
  { id: "RA-3", family: "RA", title: "Risk Assessment", evidence: ["riskAssessmentCadence"] },
  { id: "RA-3(1)", family: "RA", title: "Supply Chain Risk Assessment", evidence: ["vendorInventory"] },
  { id: "RA-5", family: "RA", title: "Vulnerability Monitoring and Scanning", evidence: ["vulnManagement"] },
  { id: "RA-5(2)", family: "RA", title: "Update Vulnerabilities to Be Scanned", evidence: ["vulnManagement"] },
  { id: "RA-5(11)", family: "RA", title: "Public Disclosure Program", evidence: ["vulnManagement"] },
  { id: "RA-7", family: "RA", title: "Risk Response", evidence: ["riskAssessmentCadence", "vulnManagement"] },

  // ── SA (9) ──
  { id: "SA-1", family: "SA", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "SA-2", family: "SA", title: "Allocation of Resources", evidence: ["vendorDueDiligence", "vendorContracts"] },
  { id: "SA-3", family: "SA", title: "System Development Life Cycle", evidence: ["vendorDueDiligence", "vendorContracts"] },
  { id: "SA-4", family: "SA", title: "Acquisition Process", evidence: ["vendorContracts"] },
  { id: "SA-4(10)", family: "SA", title: "Use of Approved PIV Products", evidence: ["vendorDueDiligence"] },
  { id: "SA-5", family: "SA", title: "System Documentation", evidence: ["vendorDueDiligence", "vendorContracts"] },
  { id: "SA-8", family: "SA", title: "Security and Privacy Engineering Principles", evidence: ["vendorDueDiligence", "vendorContracts"] },
  { id: "SA-9", family: "SA", title: "External System Services", evidence: ["vendorDueDiligence", "vendorContracts"] },
  { id: "SA-22", family: "SA", title: "Unsupported System Components", evidence: ["vendorDueDiligence", "vendorContracts"] },

  // ── SC (10) ──
  { id: "SC-1", family: "SC", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "SC-5", family: "SC", title: "Denial-of-service Protection", evidence: ["encryptionInTransit", "endpoint"] },
  { id: "SC-7", family: "SC", title: "Boundary Protection", evidence: ["endpoint"] },
  { id: "SC-12", family: "SC", title: "Cryptographic Key Establishment and Management", evidence: ["encryptionInTransit", "endpoint"] },
  { id: "SC-13", family: "SC", title: "Cryptographic Protection", evidence: ["encryptionAtRest", "encryptionInTransit"] },
  { id: "SC-15", family: "SC", title: "Collaborative Computing Devices and Applications", evidence: ["encryptionInTransit", "endpoint"] },
  { id: "SC-20", family: "SC", title: "Secure Name/Address Resolution Service (Authoritative Source)", evidence: ["encryptionInTransit"] },
  { id: "SC-21", family: "SC", title: "Secure Name/Address Resolution Service (Recursive or Caching Resolver)", evidence: ["encryptionInTransit"] },
  { id: "SC-22", family: "SC", title: "Architecture and Provisioning for Name/Address Resolution Service", evidence: ["encryptionInTransit", "endpoint"] },
  { id: "SC-39", family: "SC", title: "Process Isolation", evidence: ["encryptionInTransit", "endpoint"] },

  // ── SI (6) ──
  { id: "SI-1", family: "SI", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "SI-2", family: "SI", title: "Flaw Remediation", evidence: ["vulnManagement"] },
  { id: "SI-3", family: "SI", title: "Malicious Code Protection", evidence: ["endpoint"] },
  { id: "SI-4", family: "SI", title: "System Monitoring", evidence: ["monitoring"] },
  { id: "SI-5", family: "SI", title: "Security Alerts, Advisories, and Directives", evidence: ["endpoint", "emailSecurity", "vulnManagement"] },
  { id: "SI-12", family: "SI", title: "Information Management and Retention", evidence: ["endpoint", "emailSecurity", "vulnManagement"] },

  // ── SR (11) ──
  { id: "SR-1", family: "SR", title: "Policy and Procedures", evidence: ["documentedPolicies", "policyReviewCadence"] },
  { id: "SR-2", family: "SR", title: "Supply Chain Risk Management Plan", evidence: ["vendorInventory"] },
  { id: "SR-2(1)", family: "SR", title: "Establish SCRM Team", evidence: ["vendorInventory", "vendorDueDiligence", "vendorContracts"] },
  { id: "SR-3", family: "SR", title: "Supply Chain Controls and Processes", evidence: ["vendorInventory"] },
  { id: "SR-5", family: "SR", title: "Acquisition Strategies, Tools, and Methods", evidence: ["vendorContracts"] },
  { id: "SR-8", family: "SR", title: "Notification Agreements", evidence: ["vendorContracts"] },
  { id: "SR-10", family: "SR", title: "Inspection of Systems or Components", evidence: ["vendorInventory", "vendorDueDiligence", "vendorContracts"] },
  { id: "SR-11", family: "SR", title: "Component Authenticity", evidence: ["vendorDueDiligence"] },
  { id: "SR-11(1)", family: "SR", title: "Anti-counterfeit Training", evidence: ["vendorInventory", "vendorDueDiligence", "vendorContracts"] },
  { id: "SR-11(2)", family: "SR", title: "Configuration Control for Component Service and Repair", evidence: ["vendorInventory", "vendorDueDiligence", "vendorContracts"] },
  { id: "SR-12", family: "SR", title: "Component Disposal", evidence: ["mediaDisposal"] },
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

export function assessNist80053(checklistAnswers = {}) {
  const families = NIST80053_FAMILIES.map(f => {
    const controls = NIST80053_CONTROLS
      .filter(c => c.family === f.id)
      .map(c => scoreControl(c, checklistAnswers));
    const scored = controls.filter(c => c.status !== STATUS.UNKNOWN);
    const avg = scored.length ? Math.round(scored.reduce((a, c) => a + c.score, 0) / scored.length) : null;
    return {
      ...f,
      controls,
      assessed: scored.length,
      met: scored.filter(c => c.status === STATUS.MET).length,
      score: avg,
      status: avg === null ? STATUS.UNKNOWN : avg >= 80 ? STATUS.MET : avg >= 45 ? STATUS.PARTIAL : STATUS.GAP,
    };
  });

  const all = families.flatMap(f => f.controls);
  const scored = all.filter(c => c.status !== STATUS.UNKNOWN);
  const gaps = scored.filter(c => c.status === STATUS.GAP);
  const met = scored.filter(c => c.status === STATUS.MET);

  return {
    framework: NIST80053_META,
    depth: "control-mapped",
    baseline: "Low",
    baselineNote: NIST80053_META.baselineNote,
    relationshipNote: NIST80053_META.relationshipNote,
    baselines: NIST80053_BASELINES,
    families,
    summary: {
      total: NIST80053_CONTROLS.length,
      families: NIST80053_FAMILIES.length,
      assessed: scored.length,
      met: met.length,
      partial: scored.filter(c => c.status === STATUS.PARTIAL).length,
      gaps: gaps.length,
      unknown: all.length - scored.length,
      // Percentage of ASSESSED controls that are met — never a percentage of
      // all 149, which would imply we assessed controls we didn't.
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
    // logging?" We say that plainly rather than dressing coarse signal up as
    // control-by-control rigour.
    mappingFidelity: {
      level: "family-informed",
      what:
        "Each of the 149 controls maps to specific assessment answers, and the result is computed — not written by an AI. But our assessment has 35 questions and this baseline has 149 controls, so several controls within a family share the same evidence. AU-2 (Event Logging) and AU-3 (Content of Audit Records) both resolve from your monitoring answer.",
      soWhat:
        "Read family scores as reliable and individual control scores as indicative. This is a gap analysis to find where to look, not a control-by-control audit. A real 800-53 assessment tests each control against your System Security Plan.",
    },

    requiredArtifacts: [
      {
        id: "ssp",
        name: "System Security Plan (SSP)",
        control: "PL-2",
        why: "Defines the system boundary and documents how each control is implemented. PL-2 is itself in the Low baseline — you cannot be compliant without one, and no assessor can test you without one.",
      },
      {
        id: "poam",
        name: "Plan of Action and Milestones (POA&M)",
        control: "CA-5",
        why: "Tracks each unimplemented control with an owner and a date. Also in the Low baseline. Having gaps is expected; not tracking them is the finding.",
      },
      {
        id: "categorization",
        name: "FIPS 199 Security Categorization",
        control: "RA-2",
        why: "Determines whether Low is even the right baseline. Do this first — everything else depends on the answer, and this assessment assumes Low.",
      },
    ],

    methodology:
      "The 149 controls of the SP 800-53B Low baseline, extracted from NIST's official OSCAL profile (v5.2.0), each mapped to your assessment answers by a fixed rule. Controls with no answering evidence report 'not yet assessed' rather than being assumed implemented.",
    disclaimer:
      "This is a gap analysis against the NIST SP 800-53 Rev 5 Low baseline. It is not an ATO, not a FedRAMP authorization, not a FISMA assessment, and not an assessor's opinion. Confirm your impact level via FIPS 199 before relying on the Low baseline being the right target.",
  };
}

/** Controls in a given family — for drilling in from a family score. */
export function controlsInFamily(familyId) {
  return NIST80053_CONTROLS.filter(c => c.family === familyId);
}

/** The Moderate/High question, answered honestly when a client asks. */
export function baselineGuidance() {
  return {
    question: "Which baseline do I need?",
    answer:
      "FIPS 199 decides it, based on the worst-case impact of a confidentiality, integrity, or availability breach. Limited adverse effect is Low; serious is Moderate; severe or catastrophic is High. A typical SMB running business email and a CRM is Low. If you host federal data, a contract will usually name the baseline for you — and it will usually be Moderate.",
    weAssess: "Low (149 controls).",
    weDoNotAssess:
      "Moderate (287) and High (370). Not because they're hard to enumerate, but because a system at those levels needs a real assessor and an SSP, and a self-service gap analysis would give false comfort in the one place false comfort is expensive.",
  };
}
