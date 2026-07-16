// hipaaSecurityRule.js
// HIPAA Security Rule — 45 CFR Part 164, Subpart C (§§ 164.302–164.318).
//
// SCOPE — read this before extending the file
// -------------------------------------------
// This covers the SECURITY Rule only: the protection of electronic protected
// health information (ePHI). It is deliberately NOT the Privacy Rule (Subpart
// E), the Breach Notification Rule (Subpart D), or the Enforcement Rule. Those
// are separate obligations, and a tool that blurs them gives dangerous advice.
// We say so explicitly in the output rather than letting a client assume
// "HIPAA compliant" means all of it.
//
// REQUIRED vs ADDRESSABLE — the distinction that gets misused
// -----------------------------------------------------------
// Under § 164.306(d), implementation specifications are either:
//   · Required    — you must implement it. No discretion.
//   · Addressable — you must ASSESS whether it is reasonable and appropriate
//                   for your environment, and then either implement it, or
//                   implement an equivalent alternative, or document why
//                   neither is reasonable and appropriate.
//
// "Addressable" does NOT mean optional. It is the single most commonly
// misunderstood thing in the Security Rule, and it is where small practices get
// hurt in an OCR investigation — they treated addressable as "skip" and have no
// documentation of the assessment. Our output says this every time.
//
// HOW THIS IS BUILT
// -----------------
// Every standard and specification below is real, cited to its subsection, and
// flagged (R) or (A) per the Rule. Each maps to NIST CSF functions and to the
// checklist item IDs that give deterministic evidence. Descriptions are written
// in our own words for an SMB reader; the regulation itself is US federal law.
//
// Source: https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-C

export const HIPAA_SECURITY_META = {
  id: "hipaa-security",
  name: "HIPAA Security Rule",
  shortName: "HIPAA Security",
  citation: "45 CFR Part 164, Subpart C",
  authority: "U.S. Department of Health and Human Services, Office for Civil Rights (OCR)",
  statute: "Health Insurance Portability and Accountability Act of 1996; HITECH Act of 2009",
  url: "https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-C",
  guidanceUrl: "https://www.hhs.gov/hipaa/for-professionals/security/index.html",
  depth: "control-mapped",
  version: "45 CFR Part 164 Subpart C (current)",
  summary:
    "Federal requirements for protecting electronic protected health information (ePHI). Applies to covered entities — providers, health plans, clearinghouses — and to their business associates.",
  whoMustComply:
    "Health care providers who transmit health information electronically, health plans, health care clearinghouses, and any business associate handling ePHI on their behalf (IT providers, billing companies, cloud vendors, shredding services).",
  penalty:
    "Civil penalties from roughly $137 to $2,067,813 per violation category per year, tiered by culpability and adjusted annually for inflation. OCR publishes settlements publicly. Criminal penalties apply for knowing misuse.",
  scopeWarning:
    "This assessment covers the Security Rule (ePHI safeguards) only. The Privacy Rule (45 CFR Part 164 Subpart E), the Breach Notification Rule (Subpart D), and state health-privacy laws are separate obligations not assessed here.",
};

const R = "required";
const A = "addressable";

// ── § 164.308 — Administrative Safeguards ─────────────────────
export const HIPAA_ADMINISTRATIVE = [
  {
    id: "hipaa-308-a-1",
    citation: "45 CFR § 164.308(a)(1)",
    name: "Security Management Process",
    description:
      "Implement policies and procedures to prevent, detect, contain, and correct security violations. This is the foundation standard — everything else builds on it.",
    nistFunctions: ["Identify", "Govern"],
    specs: [
      { id: "308-a-1-ii-A", citation: "§ 164.308(a)(1)(ii)(A)", name: "Risk Analysis", type: R,
        description: "Conduct an accurate and thorough assessment of the potential risks and vulnerabilities to the confidentiality, integrity, and availability of ePHI you hold.",
        evidence: ["priorAudit", "dataInventory"] },
      { id: "308-a-1-ii-B", citation: "§ 164.308(a)(1)(ii)(B)", name: "Risk Management", type: R,
        description: "Implement security measures sufficient to reduce risks and vulnerabilities to a reasonable and appropriate level.",
        evidence: ["documentedPolicies", "endpoint"] },
      { id: "308-a-1-ii-C", citation: "§ 164.308(a)(1)(ii)(C)", name: "Sanction Policy", type: R,
        description: "Apply appropriate sanctions against workforce members who fail to comply with your security policies and procedures.",
        evidence: ["documentedPolicies"] },
      { id: "308-a-1-ii-D", citation: "§ 164.308(a)(1)(ii)(D)", name: "Information System Activity Review", type: R,
        description: "Regularly review records of system activity — audit logs, access reports, security incident tracking.",
        evidence: ["monitoring"] },
    ],
  },
  {
    id: "hipaa-308-a-2",
    citation: "45 CFR § 164.308(a)(2)",
    name: "Assigned Security Responsibility",
    description:
      "Identify the security official responsible for developing and implementing your security policies and procedures. One named person.",
    nistFunctions: ["Govern", "Identify"],
    specs: [
      { id: "308-a-2", citation: "§ 164.308(a)(2)", name: "Assigned Security Responsibility", type: R,
        description: "Name a security official accountable for the program. This standard has no separate implementation specifications — the standard itself is the requirement.",
        evidence: ["itManagement"] },
    ],
  },
  {
    id: "hipaa-308-a-3",
    citation: "45 CFR § 164.308(a)(3)",
    name: "Workforce Security",
    description:
      "Ensure all workforce members have appropriate access to ePHI, and prevent those who shouldn't have access from getting it.",
    nistFunctions: ["Protect"],
    specs: [
      { id: "308-a-3-ii-A", citation: "§ 164.308(a)(3)(ii)(A)", name: "Authorization and/or Supervision", type: A,
        description: "Procedures for authorizing and supervising workforce members who work with ePHI or in locations where it might be accessed.",
        evidence: ["mfa"] },
      { id: "308-a-3-ii-B", citation: "§ 164.308(a)(3)(ii)(B)", name: "Workforce Clearance Procedure", type: A,
        description: "Procedures to determine that a workforce member's access to ePHI is appropriate.",
        evidence: ["documentedPolicies"] },
      { id: "308-a-3-ii-C", citation: "§ 164.308(a)(3)(ii)(C)", name: "Termination Procedures", type: A,
        description: "Procedures for ending access to ePHI when employment ends or access is no longer appropriate.",
        evidence: ["documentedPolicies"] },
    ],
  },
  {
    id: "hipaa-308-a-4",
    citation: "45 CFR § 164.308(a)(4)",
    name: "Information Access Management",
    description:
      "Policies for authorizing access to ePHI consistent with the Privacy Rule's minimum necessary principle.",
    nistFunctions: ["Protect"],
    specs: [
      { id: "308-a-4-ii-A", citation: "§ 164.308(a)(4)(ii)(A)", name: "Isolating Health Care Clearinghouse Functions", type: R,
        description: "If you operate a clearinghouse within a larger organization, protect its ePHI from the rest of the organization.",
        evidence: [], appliesIf: "clearinghouse" },
      { id: "308-a-4-ii-B", citation: "§ 164.308(a)(4)(ii)(B)", name: "Access Authorization", type: A,
        description: "Procedures for granting access to ePHI — through a workstation, transaction, program, or process.",
        evidence: ["mfa"] },
      { id: "308-a-4-ii-C", citation: "§ 164.308(a)(4)(ii)(C)", name: "Access Establishment and Modification", type: A,
        description: "Procedures to establish, document, review, and modify a user's right of access.",
        evidence: ["mfa", "documentedPolicies"] },
    ],
  },
  {
    id: "hipaa-308-a-5",
    citation: "45 CFR § 164.308(a)(5)",
    name: "Security Awareness and Training",
    description:
      "A security awareness and training program for all workforce members, including management.",
    nistFunctions: ["Protect"],
    specs: [
      { id: "308-a-5-ii-A", citation: "§ 164.308(a)(5)(ii)(A)", name: "Security Reminders", type: A,
        description: "Periodic security updates and reminders to the workforce.",
        evidence: ["training"] },
      { id: "308-a-5-ii-B", citation: "§ 164.308(a)(5)(ii)(B)", name: "Protection from Malicious Software", type: A,
        description: "Procedures for guarding against, detecting, and reporting malicious software.",
        evidence: ["endpoint"] },
      { id: "308-a-5-ii-C", citation: "§ 164.308(a)(5)(ii)(C)", name: "Log-in Monitoring", type: A,
        description: "Procedures for monitoring log-in attempts and reporting discrepancies.",
        evidence: ["monitoring"] },
      { id: "308-a-5-ii-D", citation: "§ 164.308(a)(5)(ii)(D)", name: "Password Management", type: A,
        description: "Procedures for creating, changing, and safeguarding passwords.",
        evidence: ["mfa", "documentedPolicies"] },
    ],
  },
  {
    id: "hipaa-308-a-6",
    citation: "45 CFR § 164.308(a)(6)",
    name: "Security Incident Procedures",
    description: "Policies and procedures to address security incidents.",
    nistFunctions: ["Respond", "Detect"],
    specs: [
      { id: "308-a-6-ii", citation: "§ 164.308(a)(6)(ii)", name: "Response and Reporting", type: R,
        description: "Identify and respond to suspected or known security incidents; mitigate their harmful effects to the extent practicable; and document both the incidents and their outcomes.",
        evidence: ["incidentResponse", "responseSupport"] },
    ],
  },
  {
    id: "hipaa-308-a-7",
    citation: "45 CFR § 164.308(a)(7)",
    name: "Contingency Plan",
    description:
      "Policies for responding to an emergency or other occurrence — fire, vandalism, system failure, natural disaster — that damages systems containing ePHI.",
    nistFunctions: ["Recover", "Respond"],
    specs: [
      { id: "308-a-7-ii-A", citation: "§ 164.308(a)(7)(ii)(A)", name: "Data Backup Plan", type: R,
        description: "Establish and implement procedures to create and maintain retrievable exact copies of ePHI.",
        evidence: ["backups"] },
      { id: "308-a-7-ii-B", citation: "§ 164.308(a)(7)(ii)(B)", name: "Disaster Recovery Plan", type: R,
        description: "Establish procedures to restore any loss of data.",
        evidence: ["disasterRecovery"] },
      { id: "308-a-7-ii-C", citation: "§ 164.308(a)(7)(ii)(C)", name: "Emergency Mode Operation Plan", type: R,
        description: "Procedures to continue critical business processes and protect ePHI security while operating in emergency mode.",
        evidence: ["disasterRecovery"] },
      { id: "308-a-7-ii-D", citation: "§ 164.308(a)(7)(ii)(D)", name: "Testing and Revision Procedures", type: A,
        description: "Procedures for periodic testing and revision of contingency plans.",
        evidence: ["disasterRecovery"] },
      { id: "308-a-7-ii-E", citation: "§ 164.308(a)(7)(ii)(E)", name: "Applications and Data Criticality Analysis", type: A,
        description: "Assess the relative criticality of specific applications and data in support of your contingency plan.",
        evidence: ["dataInventory"] },
    ],
  },
  {
    id: "hipaa-308-a-8",
    citation: "45 CFR § 164.308(a)(8)",
    name: "Evaluation",
    description:
      "Perform periodic technical and non-technical evaluation of how well your security policies and procedures meet the Rule — initially against this standard, and thereafter in response to environmental or operational changes.",
    nistFunctions: ["Identify", "Govern"],
    specs: [
      { id: "308-a-8", citation: "§ 164.308(a)(8)", name: "Evaluation", type: R,
        description: "Periodically evaluate your security program against the Rule. No separate implementation specifications.",
        evidence: ["priorAudit"] },
    ],
  },
  {
    id: "hipaa-308-b-1",
    citation: "45 CFR § 164.308(b)(1)",
    name: "Business Associate Contracts and Other Arrangements",
    description:
      "You may only permit a business associate to create, receive, maintain, or transmit ePHI on your behalf if you obtain satisfactory assurances that they will safeguard it.",
    nistFunctions: ["Govern", "Identify"],
    specs: [
      { id: "308-b-3", citation: "§ 164.308(b)(3)", name: "Written Contract or Other Arrangement", type: R,
        description: "Document the satisfactory assurances through a written contract meeting the requirements of § 164.314(a).",
        evidence: ["itManagement", "documentedPolicies"] },
    ],
  },
];

// ── § 164.310 — Physical Safeguards ───────────────────────────
export const HIPAA_PHYSICAL = [
  {
    id: "hipaa-310-a-1",
    citation: "45 CFR § 164.310(a)(1)",
    name: "Facility Access Controls",
    description:
      "Limit physical access to your electronic information systems and the facilities housing them, while making sure properly authorized access is allowed.",
    nistFunctions: ["Protect"],
    specs: [
      { id: "310-a-2-i", citation: "§ 164.310(a)(2)(i)", name: "Contingency Operations", type: A,
        description: "Procedures allowing facility access to restore lost data under your disaster recovery and emergency mode operations plans.",
        evidence: ["disasterRecovery"] },
      { id: "310-a-2-ii", citation: "§ 164.310(a)(2)(ii)", name: "Facility Security Plan", type: A,
        description: "Policies to safeguard the facility and equipment from unauthorized physical access, tampering, and theft.",
        evidence: [] },
      { id: "310-a-2-iii", citation: "§ 164.310(a)(2)(iii)", name: "Access Control and Validation Procedures", type: A,
        description: "Procedures to control and validate a person's access to facilities based on their role or function.",
        evidence: [] },
      { id: "310-a-2-iv", citation: "§ 164.310(a)(2)(iv)", name: "Maintenance Records", type: A,
        description: "Document repairs and modifications to the physical components of a facility related to security.",
        evidence: [] },
    ],
  },
  {
    id: "hipaa-310-b",
    citation: "45 CFR § 164.310(b)",
    name: "Workstation Use",
    description:
      "Specify the proper functions to be performed, the manner of performance, and the physical surroundings of workstations that can access ePHI.",
    nistFunctions: ["Protect"],
    specs: [
      { id: "310-b", citation: "§ 164.310(b)", name: "Workstation Use", type: R,
        description: "Document how workstations may be used and where they may be located. No separate implementation specifications.",
        evidence: ["documentedPolicies"] },
    ],
  },
  {
    id: "hipaa-310-c",
    citation: "45 CFR § 164.310(c)",
    name: "Workstation Security",
    description:
      "Implement physical safeguards for all workstations that access ePHI, restricting access to authorized users.",
    nistFunctions: ["Protect"],
    specs: [
      { id: "310-c", citation: "§ 164.310(c)", name: "Workstation Security", type: R,
        description: "Physically protect workstations from unauthorized access — screen positioning, locked rooms, cable locks. No separate implementation specifications.",
        evidence: ["documentedPolicies"] },
    ],
  },
  {
    id: "hipaa-310-d-1",
    citation: "45 CFR § 164.310(d)(1)",
    name: "Device and Media Controls",
    description:
      "Govern how hardware and electronic media containing ePHI move into, out of, and within your facility.",
    nistFunctions: ["Protect"],
    specs: [
      { id: "310-d-2-i", citation: "§ 164.310(d)(2)(i)", name: "Disposal", type: R,
        description: "Procedures for the final disposition of ePHI and the hardware or media it's stored on.",
        evidence: ["dataInventory"] },
      { id: "310-d-2-ii", citation: "§ 164.310(d)(2)(ii)", name: "Media Re-use", type: R,
        description: "Procedures for removing ePHI from electronic media before it's reused.",
        evidence: ["dataInventory"] },
      { id: "310-d-2-iii", citation: "§ 164.310(d)(2)(iii)", name: "Accountability", type: A,
        description: "Maintain a record of movements of hardware and media and the person responsible.",
        evidence: ["dataInventory"] },
      { id: "310-d-2-iv", citation: "§ 164.310(d)(2)(iv)", name: "Data Backup and Storage", type: A,
        description: "Create a retrievable exact copy of ePHI, when needed, before moving equipment.",
        evidence: ["backups"] },
    ],
  },
];

// ── § 164.312 — Technical Safeguards ──────────────────────────
export const HIPAA_TECHNICAL = [
  {
    id: "hipaa-312-a-1",
    citation: "45 CFR § 164.312(a)(1)",
    name: "Access Control",
    description:
      "Technical policies and procedures that allow access to ePHI only to persons or software programs granted access rights under § 164.308(a)(4).",
    nistFunctions: ["Protect"],
    specs: [
      { id: "312-a-2-i", citation: "§ 164.312(a)(2)(i)", name: "Unique User Identification", type: R,
        description: "Assign a unique name and/or number for identifying and tracking user identity. Shared logins fail this outright.",
        evidence: ["mfa"] },
      { id: "312-a-2-ii", citation: "§ 164.312(a)(2)(ii)", name: "Emergency Access Procedure", type: R,
        description: "Procedures for obtaining necessary ePHI during an emergency.",
        evidence: ["disasterRecovery"] },
      { id: "312-a-2-iii", citation: "§ 164.312(a)(2)(iii)", name: "Automatic Logoff", type: A,
        description: "Electronic procedures that terminate a session after a predetermined time of inactivity.",
        evidence: ["documentedPolicies"] },
      { id: "312-a-2-iv", citation: "§ 164.312(a)(2)(iv)", name: "Encryption and Decryption", type: A,
        description: "A mechanism to encrypt and decrypt ePHI at rest.",
        evidence: [] },
    ],
  },
  {
    id: "hipaa-312-b",
    citation: "45 CFR § 164.312(b)",
    name: "Audit Controls",
    description:
      "Hardware, software, and/or procedural mechanisms that record and examine activity in systems containing or using ePHI.",
    nistFunctions: ["Detect"],
    specs: [
      { id: "312-b", citation: "§ 164.312(b)", name: "Audit Controls", type: R,
        description: "Log and examine system activity. No separate implementation specifications — the standard is the requirement.",
        evidence: ["monitoring"] },
    ],
  },
  {
    id: "hipaa-312-c-1",
    citation: "45 CFR § 164.312(c)(1)",
    name: "Integrity",
    description:
      "Policies and procedures to protect ePHI from improper alteration or destruction.",
    nistFunctions: ["Protect"],
    specs: [
      { id: "312-c-2", citation: "§ 164.312(c)(2)", name: "Mechanism to Authenticate ePHI", type: A,
        description: "Electronic mechanisms to corroborate that ePHI has not been altered or destroyed in an unauthorized manner.",
        evidence: ["backups"] },
    ],
  },
  {
    id: "hipaa-312-d",
    citation: "45 CFR § 164.312(d)",
    name: "Person or Entity Authentication",
    description:
      "Procedures to verify that a person or entity seeking access to ePHI is who they claim to be.",
    nistFunctions: ["Protect"],
    specs: [
      { id: "312-d", citation: "§ 164.312(d)", name: "Person or Entity Authentication", type: R,
        description: "Verify identity before granting access. No separate implementation specifications.",
        evidence: ["mfa"] },
    ],
  },
  {
    id: "hipaa-312-e-1",
    citation: "45 CFR § 164.312(e)(1)",
    name: "Transmission Security",
    description:
      "Technical security measures to guard against unauthorized access to ePHI being transmitted over an electronic network.",
    nistFunctions: ["Protect"],
    specs: [
      { id: "312-e-2-i", citation: "§ 164.312(e)(2)(i)", name: "Integrity Controls", type: A,
        description: "Measures to ensure electronically transmitted ePHI is not improperly modified without detection.",
        evidence: ["emailSecurity"] },
      { id: "312-e-2-ii", citation: "§ 164.312(e)(2)(ii)", name: "Encryption", type: A,
        description: "A mechanism to encrypt ePHI whenever deemed appropriate — in practice, essentially always for anything leaving your network.",
        evidence: ["emailSecurity"] },
    ],
  },
];

export const HIPAA_SAFEGUARD_GROUPS = [
  { id: "administrative", name: "Administrative Safeguards", citation: "§ 164.308", standards: HIPAA_ADMINISTRATIVE,
    description: "The policies, procedures, and people side: risk analysis, workforce management, training, incident response, contingency planning, and business associates." },
  { id: "physical", name: "Physical Safeguards", citation: "§ 164.310", standards: HIPAA_PHYSICAL,
    description: "Protecting the buildings, workstations, and media where ePHI lives." },
  { id: "technical", name: "Technical Safeguards", citation: "§ 164.312", standards: HIPAA_TECHNICAL,
    description: "The technology controls: access control, audit logging, integrity, authentication, and transmission security." },
];

// ── Deterministic gap analysis ────────────────────────────────
const STATUS = { MET: "met", PARTIAL: "partial", GAP: "gap", UNKNOWN: "unknown" };

function assessSpec(spec, answers) {
  const scores = (spec.evidence || [])
    .map(id => answers[id]?.score)
    .filter(s => typeof s === "number");

  if (scores.length === 0) {
    return { ...spec, status: STATUS.UNKNOWN, score: null };
  }
  const score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const status = score >= 80 ? STATUS.MET : score >= 45 ? STATUS.PARTIAL : STATUS.GAP;
  return { ...spec, status, score };
}

export function assessHipaaSecurity(checklistAnswers = {}, { isClearinghouse = false } = {}) {
  const groups = HIPAA_SAFEGUARD_GROUPS.map(group => {
    const standards = group.standards.map(std => {
      const specs = std.specs
        .filter(s => !s.appliesIf || (s.appliesIf === "clearinghouse" && isClearinghouse))
        .map(s => assessSpec(s, checklistAnswers));

      const scored = specs.filter(s => s.status !== STATUS.UNKNOWN);
      const avg = scored.length
        ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length)
        : null;

      return {
        id: std.id, citation: std.citation, name: std.name, description: std.description,
        nistFunctions: std.nistFunctions, specs,
        score: avg,
        status: avg === null ? STATUS.UNKNOWN : avg >= 80 ? STATUS.MET : avg >= 45 ? STATUS.PARTIAL : STATUS.GAP,
      };
    });
    return { id: group.id, name: group.name, citation: group.citation, description: group.description, standards };
  });

  const allSpecs = groups.flatMap(g => g.standards.flatMap(s => s.specs));
  const scored = allSpecs.filter(s => s.status !== STATUS.UNKNOWN);
  const required = allSpecs.filter(s => s.type === R);
  const addressable = allSpecs.filter(s => s.type === A);

  // Required gaps are legally distinct from addressable gaps and must never be
  // presented in one undifferentiated list.
  const requiredGaps = required.filter(s => s.status === STATUS.GAP);
  const addressableGaps = addressable.filter(s => s.status === STATUS.GAP);

  return {
    framework: HIPAA_SECURITY_META,
    depth: "control-mapped",
    groups,
    summary: {
      standards: groups.reduce((n, g) => n + g.standards.length, 0),
      specifications: allSpecs.length,
      required: required.length,
      addressable: addressable.length,
      assessed: scored.length,
      met: scored.filter(s => s.status === STATUS.MET).length,
      partial: scored.filter(s => s.status === STATUS.PARTIAL).length,
      gaps: scored.filter(s => s.status === STATUS.GAP).length,
      unknown: allSpecs.length - scored.length,
      coveragePct: scored.length
        ? Math.round((scored.filter(s => s.status === STATUS.MET).length / scored.length) * 100)
        : null,
    },
    requiredGaps: requiredGaps.map(s => ({ citation: s.citation, name: s.name, description: s.description })),
    addressableGaps: addressableGaps.map(s => ({ citation: s.citation, name: s.name, description: s.description })),
    addressableGuidance:
      "\"Addressable\" does not mean optional. For each addressable specification you must assess whether it is reasonable and appropriate for your environment, then either implement it, implement an equivalent alternative, or document in writing why neither is reasonable and appropriate (§ 164.306(d)(3)). Treating addressable as \"skip\" without that documentation is the most common finding in OCR investigations.",
    methodology:
      "Each standard and implementation specification is assessed from your assessment answers using a fixed mapping to 45 CFR Part 164 Subpart C — not by an AI's interpretation. Specifications with no corresponding assessment question are reported as 'not yet assessed' rather than assumed compliant.",
    scopeWarning: HIPAA_SECURITY_META.scopeWarning,
    disclaimer:
      "This is a gap analysis against the HIPAA Security Rule, not a legal determination of compliance and not a substitute for the risk analysis required by § 164.308(a)(1)(ii)(A). Have counsel or a qualified assessor review your program before relying on it.",
  };
}
