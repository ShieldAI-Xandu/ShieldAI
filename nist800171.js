// nist800171.js
// NIST SP 800-171 — Protecting Controlled Unclassified Information (CUI) in
// Nonfederal Systems and Organizations.
//
// WHICH REVISION — READ THIS FIRST, IT IS COUNTERINTUITIVE
// ---------------------------------------------------------
// Rev 3 is newer. Rev 2 is what binds you.
//
//   Rev 2 (Feb 2020)  110 requirements, 14 families.
//                     NIST deprecated it in May 2025.
//                     **DoD still assesses against it.** The CMMC Final Rule
//                     explicitly states Rev 3 is not currently applicable, and
//                     DoD holds a waiver keeping contractors on Rev 2 for CMMC.
//                     The CMMC Phase 2 deadline of 10 November 2026 is assessed
//                     against these 110 controls.
//
//   Rev 3 (May 2024)  97 requirements, 17 families (adds Planning, System and
//                     Services Acquisition, Supply Chain Risk Management).
//                     Fewer top-level requirements but a HEAVIER assessment
//                     burden: 800-171A Rev 3 has ~422 determination statements,
//                     up roughly a third. Expected to enter DFARS via rulemaking
//                     around late 2026–2027 with a multi-year transition.
//
// So: a defense contractor being assessed today needs Rev 2. Shipping Rev 3
// alone would hand them the wrong control set at the exact moment they're being
// measured. We default to Rev 2, name the reason, and track Rev 3 as coming.
//
// This is also why CMMC Level 2 is cheap to build once this file exists —
// Level 2 is, near enough line for line, these 110 controls.
//
// COPYRIGHT: none. NIST publications are US Government works in the public
// domain. We can describe these controls freely — a welcome change from ISO,
// SOC 2, PCI, and HITRUST.
//
// Sources:
//   NIST SP 800-171 Rev 2 — https://csrc.nist.gov/pubs/sp/800/171/r2/upd1/final
//   NIST SP 800-171 Rev 3 — https://csrc.nist.gov/pubs/sp/800/171/r3/final
//   CMMC Program Rule — 32 CFR Part 170

export const NIST800171_META = {
  id: "nist-800-171",
  name: "NIST 800-171",
  shortName: "NIST 800-171",
  fullName: "NIST SP 800-171 Rev 2 — Protecting Controlled Unclassified Information",
  authority: "National Institute of Standards and Technology",
  version: "Rev 2 (Feb 2020)",
  url: "https://csrc.nist.gov/pubs/sp/800/171/r2/upd1/final",
  depth: "control-mapped",
  summary:
    "The security baseline written into defense contracts. If you handle Controlled Unclassified Information for the DoD — or for any agency that flows DFARS 252.204-7012 down to you — this is contractual, not optional.",
  whoMustComply:
    "Any contractor or subcontractor handling CUI under a DoD contract, and increasingly any federal contract flowing down DFARS 252.204-7012. This reaches deep into the supply chain: a machine shop making a bracket for a prime contractor is in scope.",
  enforcement:
    "Contractual via DFARS 252.204-7012. Self-assessed scores are submitted to the Supplier Performance Risk System (SPRS), and CMMC Level 2 now operationalises the same controls through third-party assessment.",
  revisionNote:
    "We assess Rev 2's 110 controls because that is what CMMC Level 2 and DFARS currently require. NIST deprecated Rev 2 in May 2025 and Rev 3 (97 requirements, 17 families) is the newer publication — but the CMMC Final Rule states Rev 3 is not currently applicable, and DoD holds a waiver keeping contractors on Rev 2. Rev 3 is expected via rulemaking around late 2026–2027 with a transition period.",
  deadlineNote:
    "CMMC Phase 2 begins 10 November 2026. Assessors evaluate against Rev 2's 110 controls. If you handle CUI and haven't self-assessed, that is the work in front of you.",
  publicDomain: true,
};

// ── Rev 3 — tracked, not yet binding ──────────────────────────
export const NIST800171_REV3 = {
  version: "Rev 3 (May 2024)",
  url: "https://csrc.nist.gov/pubs/sp/800/171/r3/final",
  requirements: 97,
  families: 17,
  newFamilies: [
    { id: "PL", name: "Planning", why: "Aligns with the 800-53B moderate baseline." },
    { id: "SA", name: "System and Services Acquisition", why: "Aligns with the 800-53B moderate baseline." },
    { id: "SR", name: "Supply Chain Risk Management", why: "Adds an operational C-SCRM plan requirement with evidence." },
  ],
  status: "published-not-yet-required",
  note:
    "Fewer requirements (97 vs 110) but a heavier assessment burden — 800-171A Rev 3 carries roughly 422 determination statements, about a third more than Rev 2. All 61 previously-'NFO' controls were absorbed into the CUI control set, increasing the governance load. Rev 3 identifiers map directly to 800-53 Rev 5, which simplifies life if you also do FedRAMP or FISMA.",
  guidance:
    "Do not chase Rev 3 at the expense of Rev 2 certification. Assessors are measuring Rev 2 through the November 2026 deadline and beyond. Once you're Rev 2 compliant the move to Rev 3 is incremental — most Rev 3 requirements map to existing Rev 2 controls.",
};

// ── The 14 families ───────────────────────────────────────────
export const NIST800171_FAMILIES = [
  { id: "AC", prefix: "3.1", name: "Access Control", count: 22, nistFunctions: ["Protect"] },
  { id: "AT", prefix: "3.2", name: "Awareness and Training", count: 3, nistFunctions: ["Protect"] },
  { id: "AU", prefix: "3.3", name: "Audit and Accountability", count: 9, nistFunctions: ["Detect"] },
  { id: "CM", prefix: "3.4", name: "Configuration Management", count: 9, nistFunctions: ["Protect", "Identify"] },
  { id: "IA", prefix: "3.5", name: "Identification and Authentication", count: 11, nistFunctions: ["Protect"] },
  { id: "IR", prefix: "3.6", name: "Incident Response", count: 3, nistFunctions: ["Respond"] },
  { id: "MA", prefix: "3.7", name: "Maintenance", count: 6, nistFunctions: ["Protect"] },
  { id: "MP", prefix: "3.8", name: "Media Protection", count: 9, nistFunctions: ["Protect"] },
  { id: "PS", prefix: "3.9", name: "Personnel Security", count: 2, nistFunctions: ["Protect"] },
  { id: "PE", prefix: "3.10", name: "Physical Protection", count: 6, nistFunctions: ["Protect"] },
  { id: "RA", prefix: "3.11", name: "Risk Assessment", count: 3, nistFunctions: ["Identify"] },
  { id: "CA", prefix: "3.12", name: "Security Assessment", count: 4, nistFunctions: ["Identify", "Govern"] },
  { id: "SC", prefix: "3.13", name: "System and Communications Protection", count: 16, nistFunctions: ["Protect"] },
  { id: "SI", prefix: "3.14", name: "System and Information Integrity", count: 7, nistFunctions: ["Detect", "Protect"] },
];

// ── The 110 controls ──────────────────────────────────────────
// A NOTE ON WHAT'S DELIBERATELY ABSENT
// ------------------------------------
// 800-171 divides each family into "Basic" requirements (from FIPS 200) and
// "Derived" requirements (from 800-53's moderate baseline). We do NOT tag that
// split here: the authoritative per-family breakdown is in the standard itself,
// and an unverified flag on a framework people are contractually assessed
// against is worse than no flag. Nothing in the assessment depends on it.
//
// Likewise absent: SPRS point weights (5/3/1 per control). Those drive the
// score a contractor submits to the government. Getting them wrong would
// produce a wrong SPRS score — a contractual representation. If we add them,
// they come from NIST/DoD source documents, not from recall.
export const NIST800171_CONTROLS = [
  // ── 3.1 Access Control (22) ──
  { id: "3.1.1", family: "AC", covers: "Limit system access to authorized users, processes acting on their behalf, and devices.", evidence: ["mfa"] },
  { id: "3.1.2", family: "AC", covers: "Limit system access to the types of transactions and functions authorized users are permitted to execute.", evidence: ["mfa"] },
  { id: "3.1.3", family: "AC", covers: "Control the flow of CUI in accordance with approved authorizations.", evidence: ["dataInventory"] },
  { id: "3.1.4", family: "AC", covers: "Separate the duties of individuals to reduce the risk of malevolent activity without collusion.", evidence: ["documentedPolicies"] },
  { id: "3.1.5", family: "AC", covers: "Employ the principle of least privilege, including for privileged accounts.", evidence: ["mfa"] },
  { id: "3.1.6", family: "AC", covers: "Use non-privileged accounts when accessing non-security functions.", evidence: ["mfa"] },
  { id: "3.1.7", family: "AC", covers: "Prevent non-privileged users from executing privileged functions; capture such attempts in audit logs.", evidence: ["mfa", "monitoring"] },
  { id: "3.1.8", family: "AC", covers: "Limit unsuccessful logon attempts.", evidence: ["mfa"] },
  { id: "3.1.9", family: "AC", covers: "Provide privacy and security notices consistent with applicable CUI rules.", evidence: ["documentedPolicies"] },
  { id: "3.1.10", family: "AC", covers: "Use session lock with pattern-hiding displays after a period of inactivity.", evidence: ["documentedPolicies"] },
  { id: "3.1.11", family: "AC", covers: "Terminate a user session after a defined condition.", evidence: ["documentedPolicies"] },
  { id: "3.1.12", family: "AC", covers: "Monitor and control remote access sessions.", evidence: ["monitoring", "mfa"] },
  { id: "3.1.13", family: "AC", covers: "Employ cryptographic mechanisms to protect the confidentiality of remote access sessions.", evidence: [] },
  { id: "3.1.14", family: "AC", covers: "Route remote access via managed access control points.", evidence: ["itManagement"] },
  { id: "3.1.15", family: "AC", covers: "Authorize remote execution of privileged commands and remote access to security-relevant information.", evidence: ["mfa"] },
  { id: "3.1.16", family: "AC", covers: "Authorize wireless access prior to allowing such connections.", evidence: ["itManagement"] },
  { id: "3.1.17", family: "AC", covers: "Protect wireless access using authentication and encryption.", evidence: ["itManagement"] },
  { id: "3.1.18", family: "AC", covers: "Control connection of mobile devices.", evidence: ["endpoint"] },
  { id: "3.1.19", family: "AC", covers: "Encrypt CUI on mobile devices and mobile computing platforms.", evidence: ["endpoint"] },
  { id: "3.1.20", family: "AC", covers: "Verify and control or limit connections to and use of external systems.", evidence: ["itManagement"] },
  { id: "3.1.21", family: "AC", covers: "Limit use of portable storage devices on external systems.", evidence: ["dataInventory", "endpoint"] },
  { id: "3.1.22", family: "AC", covers: "Control CUI posted or processed on publicly accessible systems.", evidence: ["dataInventory"] },

  // ── 3.2 Awareness and Training (3) ──
  { id: "3.2.1", family: "AT", covers: "Ensure managers, systems administrators, and users are aware of the security risks of their activities and applicable policies.", evidence: ["training"] },
  { id: "3.2.2", family: "AT", covers: "Ensure personnel are trained to carry out their assigned security duties.", evidence: ["training"] },
  { id: "3.2.3", family: "AT", covers: "Provide security awareness training on recognizing and reporting potential indicators of insider threat.", evidence: ["training"] },

  // ── 3.3 Audit and Accountability (9) ──
  { id: "3.3.1", family: "AU", covers: "Create and retain system audit logs sufficient to enable monitoring, analysis, investigation, and reporting of unlawful or unauthorized activity.", evidence: ["monitoring"] },
  { id: "3.3.2", family: "AU", covers: "Ensure actions of individual users can be uniquely traced to those users, so they can be held accountable.", evidence: ["monitoring", "mfa"] },
  { id: "3.3.3", family: "AU", covers: "Review and update logged events.", evidence: ["monitoring"] },
  { id: "3.3.4", family: "AU", covers: "Alert in the event of an audit logging process failure.", evidence: ["monitoring"] },
  { id: "3.3.5", family: "AU", covers: "Correlate audit record review, analysis, and reporting for investigation and response to indications of unlawful or unauthorized activity.", evidence: ["monitoring", "incidentResponse"] },
  { id: "3.3.6", family: "AU", covers: "Provide audit record reduction and report generation to support on-demand analysis and reporting.", evidence: ["monitoring"] },
  { id: "3.3.7", family: "AU", covers: "Provide a system capability comparing and synchronising internal clocks with an authoritative source to generate time stamps for audit records.", evidence: [] },
  { id: "3.3.8", family: "AU", covers: "Protect audit information and logging tools from unauthorized access, modification, and deletion.", evidence: ["monitoring"] },
  { id: "3.3.9", family: "AU", covers: "Limit management of audit logging functionality to a subset of privileged users.", evidence: ["mfa"] },

  // ── 3.4 Configuration Management (9) ──
  { id: "3.4.1", family: "CM", covers: "Establish and maintain baseline configurations and inventories of systems throughout their lifecycle.", evidence: ["dataInventory", "itManagement"] },
  { id: "3.4.2", family: "CM", covers: "Establish and enforce security configuration settings for products employed in systems.", evidence: ["itManagement", "endpoint"] },
  { id: "3.4.3", family: "CM", covers: "Track, review, approve or disapprove, and log changes to systems.", evidence: ["documentedPolicies", "itManagement"] },
  { id: "3.4.4", family: "CM", covers: "Analyze the security impact of changes prior to implementation.", evidence: ["itManagement"] },
  { id: "3.4.5", family: "CM", covers: "Define, document, approve, and enforce physical and logical access restrictions associated with changes.", evidence: ["mfa", "documentedPolicies"] },
  { id: "3.4.6", family: "CM", covers: "Employ the principle of least functionality by configuring systems to provide only essential capabilities.", evidence: ["itManagement"] },
  { id: "3.4.7", family: "CM", covers: "Restrict, disable, or prevent the use of nonessential programs, functions, ports, protocols, and services.", evidence: ["itManagement", "endpoint"] },
  { id: "3.4.8", family: "CM", covers: "Apply deny-by-exception (blacklisting) or permit-by-exception (whitelisting) policy for software execution.", evidence: ["endpoint"] },
  { id: "3.4.9", family: "CM", covers: "Control and monitor user-installed software.", evidence: ["endpoint", "monitoring"] },

  // ── 3.5 Identification and Authentication (11) ──
  { id: "3.5.1", family: "IA", covers: "Identify system users, processes acting on their behalf, and devices.", evidence: ["mfa"] },
  { id: "3.5.2", family: "IA", covers: "Authenticate the identities of users, processes, and devices as a prerequisite to allowing access.", evidence: ["mfa"] },
  { id: "3.5.3", family: "IA", covers: "Use multifactor authentication for local and network access to privileged accounts, and for network access to non-privileged accounts.", evidence: ["mfa"] },
  { id: "3.5.4", family: "IA", covers: "Employ replay-resistant authentication mechanisms for network access to privileged and non-privileged accounts.", evidence: ["mfa"] },
  { id: "3.5.5", family: "IA", covers: "Prevent reuse of identifiers for a defined period.", evidence: ["documentedPolicies"] },
  { id: "3.5.6", family: "IA", covers: "Disable identifiers after a defined period of inactivity.", evidence: ["documentedPolicies"] },
  { id: "3.5.7", family: "IA", covers: "Enforce a minimum password complexity and change of characters when new passwords are created.", evidence: ["mfa", "documentedPolicies"] },
  { id: "3.5.8", family: "IA", covers: "Prohibit password reuse for a specified number of generations.", evidence: ["documentedPolicies"] },
  { id: "3.5.9", family: "IA", covers: "Allow temporary password use for system logons with an immediate change to a permanent password.", evidence: ["documentedPolicies"] },
  { id: "3.5.10", family: "IA", covers: "Store and transmit only cryptographically-protected passwords.", evidence: [] },
  { id: "3.5.11", family: "IA", covers: "Obscure feedback of authentication information.", evidence: [] },

  // ── 3.6 Incident Response (3) ──
  { id: "3.6.1", family: "IR", covers: "Establish an operational incident-handling capability covering preparation, detection, analysis, containment, recovery, and user response.", evidence: ["incidentResponse", "responseSupport"] },
  { id: "3.6.2", family: "IR", covers: "Track, document, and report incidents to designated officials internally and externally.", evidence: ["incidentResponse"] },
  { id: "3.6.3", family: "IR", covers: "Test the organizational incident response capability.", evidence: ["incidentResponse"] },

  // ── 3.7 Maintenance (6) ──
  { id: "3.7.1", family: "MA", covers: "Perform maintenance on organizational systems.", evidence: ["itManagement"] },
  { id: "3.7.2", family: "MA", covers: "Provide controls on the tools, techniques, mechanisms, and personnel used to conduct system maintenance.", evidence: ["itManagement"] },
  { id: "3.7.3", family: "MA", covers: "Ensure equipment removed for off-site maintenance is sanitized of any CUI.", evidence: ["dataInventory"] },
  { id: "3.7.4", family: "MA", covers: "Check media containing diagnostic and test programs for malicious code before use.", evidence: ["endpoint"] },
  { id: "3.7.5", family: "MA", covers: "Require multifactor authentication to establish nonlocal maintenance sessions, and terminate them when complete.", evidence: ["mfa"] },
  { id: "3.7.6", family: "MA", covers: "Supervise the maintenance activities of personnel without required access authorization.", evidence: ["itManagement"] },

  // ── 3.8 Media Protection (9) ──
  { id: "3.8.1", family: "MP", covers: "Protect system media containing CUI, both paper and digital.", evidence: ["dataInventory"] },
  { id: "3.8.2", family: "MP", covers: "Limit access to CUI on system media to authorized users.", evidence: ["dataInventory", "mfa"] },
  { id: "3.8.3", family: "MP", covers: "Sanitize or destroy system media containing CUI before disposal or release for reuse.", evidence: ["dataInventory"] },
  { id: "3.8.4", family: "MP", covers: "Mark media with necessary CUI markings and distribution limitations.", evidence: ["dataInventory"] },
  { id: "3.8.5", family: "MP", covers: "Control access to media containing CUI and maintain accountability during transport outside controlled areas.", evidence: ["dataInventory"] },
  { id: "3.8.6", family: "MP", covers: "Implement cryptographic mechanisms to protect the confidentiality of CUI stored on digital media during transport.", evidence: [] },
  { id: "3.8.7", family: "MP", covers: "Control the use of removable media on system components.", evidence: ["endpoint", "dataInventory"] },
  { id: "3.8.8", family: "MP", covers: "Prohibit the use of portable storage devices when such devices have no identifiable owner.", evidence: ["documentedPolicies"] },
  { id: "3.8.9", family: "MP", covers: "Protect the confidentiality of backup CUI at storage locations.", evidence: ["backups"] },

  // ── 3.9 Personnel Security (2) ──
  { id: "3.9.1", family: "PS", covers: "Screen individuals prior to authorizing access to systems containing CUI.", evidence: [] },
  { id: "3.9.2", family: "PS", covers: "Ensure CUI and systems are protected during and after personnel actions such as terminations and transfers.", evidence: ["documentedPolicies"] },

  // ── 3.10 Physical Protection (6) ──
  { id: "3.10.1", family: "PE", covers: "Limit physical access to systems, equipment, and operating environments to authorized individuals.", evidence: [] },
  { id: "3.10.2", family: "PE", covers: "Protect and monitor the physical facility and support infrastructure.", evidence: ["monitoring"] },
  { id: "3.10.3", family: "PE", covers: "Escort visitors and monitor visitor activity.", evidence: [] },
  { id: "3.10.4", family: "PE", covers: "Maintain audit logs of physical access.", evidence: ["monitoring"] },
  { id: "3.10.5", family: "PE", covers: "Control and manage physical access devices.", evidence: [] },
  { id: "3.10.6", family: "PE", covers: "Enforce safeguarding measures for CUI at alternate work sites.", evidence: ["documentedPolicies", "endpoint"] },

  // ── 3.11 Risk Assessment (3) ──
  { id: "3.11.1", family: "RA", covers: "Periodically assess the risk to operations, assets, and individuals from the operation of systems processing CUI.", evidence: ["priorAudit"] },
  { id: "3.11.2", family: "RA", covers: "Scan for vulnerabilities in systems and applications periodically and when new vulnerabilities are identified.", evidence: ["monitoring"] },
  { id: "3.11.3", family: "RA", covers: "Remediate vulnerabilities in accordance with risk assessments.", evidence: ["monitoring", "itManagement"] },

  // ── 3.12 Security Assessment (4) ──
  { id: "3.12.1", family: "CA", covers: "Periodically assess security controls to determine whether they are effective in their application.", evidence: ["priorAudit"] },
  { id: "3.12.2", family: "CA", covers: "Develop and implement plans of action (POA&Ms) designed to correct deficiencies and reduce or eliminate vulnerabilities.", evidence: ["priorAudit", "documentedPolicies"] },
  { id: "3.12.3", family: "CA", covers: "Monitor security controls on an ongoing basis to ensure their continued effectiveness.", evidence: ["monitoring"] },
  { id: "3.12.4", family: "CA", covers: "Develop, document, and periodically update system security plans (SSPs) describing boundaries, environments, requirements, and relationships.", evidence: ["documentedPolicies"] },

  // ── 3.13 System and Communications Protection (16) ──
  { id: "3.13.1", family: "SC", covers: "Monitor, control, and protect communications at external and key internal boundaries.", evidence: ["itManagement", "monitoring"] },
  { id: "3.13.2", family: "SC", covers: "Employ architectural designs, software development techniques, and systems engineering principles that promote effective security.", evidence: ["documentedPolicies"] },
  { id: "3.13.3", family: "SC", covers: "Separate user functionality from system management functionality.", evidence: ["mfa"] },
  { id: "3.13.4", family: "SC", covers: "Prevent unauthorized and unintended information transfer via shared system resources.", evidence: [] },
  { id: "3.13.5", family: "SC", covers: "Implement subnetworks for publicly accessible components that are physically or logically separated from internal networks.", evidence: ["itManagement"] },
  { id: "3.13.6", family: "SC", covers: "Deny network communications traffic by default and allow by exception.", evidence: ["itManagement"] },
  { id: "3.13.7", family: "SC", covers: "Prevent remote devices from simultaneously connecting to the system and to external networks (split tunneling).", evidence: ["endpoint"] },
  { id: "3.13.8", family: "SC", covers: "Implement cryptographic mechanisms to prevent unauthorized disclosure of CUI during transmission unless otherwise protected.", evidence: ["emailSecurity"] },
  { id: "3.13.9", family: "SC", covers: "Terminate network connections at the end of sessions or after a period of inactivity.", evidence: [] },
  { id: "3.13.10", family: "SC", covers: "Establish and manage cryptographic keys for cryptography employed in systems.", evidence: [] },
  { id: "3.13.11", family: "SC", covers: "Employ FIPS-validated cryptography when used to protect the confidentiality of CUI.", evidence: [] },
  { id: "3.13.12", family: "SC", covers: "Prohibit remote activation of collaborative computing devices and provide indication of use to users present.", evidence: ["documentedPolicies"] },
  { id: "3.13.13", family: "SC", covers: "Control and monitor the use of mobile code.", evidence: ["endpoint"] },
  { id: "3.13.14", family: "SC", covers: "Control and monitor the use of Voice over Internet Protocol technologies.", evidence: ["itManagement"] },
  { id: "3.13.15", family: "SC", covers: "Protect the authenticity of communications sessions.", evidence: [] },
  { id: "3.13.16", family: "SC", covers: "Protect the confidentiality of CUI at rest.", evidence: ["dataInventory"] },

  // ── 3.14 System and Information Integrity (7) ──
  { id: "3.14.1", family: "SI", covers: "Identify, report, and correct system flaws in a timely manner.", evidence: ["monitoring", "itManagement"] },
  { id: "3.14.2", family: "SI", covers: "Provide protection from malicious code at designated locations within systems.", evidence: ["endpoint"] },
  { id: "3.14.3", family: "SI", covers: "Monitor system security alerts and advisories and take action in response.", evidence: ["monitoring"] },
  { id: "3.14.4", family: "SI", covers: "Update malicious code protection mechanisms when new releases are available.", evidence: ["endpoint"] },
  { id: "3.14.5", family: "SI", covers: "Perform periodic scans of systems and real-time scans of files from external sources as they are downloaded, opened, or executed.", evidence: ["endpoint"] },
  { id: "3.14.6", family: "SI", covers: "Monitor systems, including inbound and outbound communications traffic, to detect attacks and indicators of potential attacks.", evidence: ["monitoring"] },
  { id: "3.14.7", family: "SI", covers: "Identify unauthorized use of organizational systems.", evidence: ["monitoring"] },
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

export function assessNist800171(checklistAnswers = {}) {
  const families = NIST800171_FAMILIES.map(f => {
    const controls = NIST800171_CONTROLS
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
    framework: NIST800171_META,
    depth: "control-mapped",
    revision: "Rev 2",
    revisionNote: NIST800171_META.revisionNote,
    deadlineNote: NIST800171_META.deadlineNote,
    rev3: NIST800171_REV3,
    families,
    summary: {
      total: NIST800171_CONTROLS.length,
      families: NIST800171_FAMILIES.length,
      assessed: scored.length,
      met: met.length,
      partial: scored.filter(c => c.status === STATUS.PARTIAL).length,
      gaps: gaps.length,
      unknown: all.length - scored.length,
      coveragePct: scored.length ? Math.round((met.length / scored.length) * 100) : null,
    },
    topGaps: gaps.slice(0, 5).map(g => ({ id: g.id, family: g.family, covers: g.covers })),
    weakestFamilies: families
      .filter(f => f.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map(f => ({ id: f.id, name: f.name, score: f.score })),

    // SPRS — deliberately NOT computed. See below.
    sprs: {
      computed: false,
      why:
        "We do not compute an SPRS score. The DoD scoring methodology assigns each control a weight of 5, 3, or 1 points against a maximum of 110, and the resulting number is submitted to the government as a contractual representation of your security posture. Producing that figure from a general security assessment rather than a control-by-control review against NIST's own methodology would give you a number that is wrong in a place where being wrong has consequences.",
      whatToDo:
        "Use this gap analysis to find and close gaps. When you're ready to submit, score against the DoD Assessment Methodology directly, control by control, with your System Security Plan in hand — or have an assessor do it.",
      reference: "NIST SP 800-171 DoD Assessment Methodology",
    },

    requiredArtifacts: [
      {
        id: "ssp",
        name: "System Security Plan (SSP)",
        control: "3.12.4",
        why: "Describes your system boundary, environment, how each requirement is implemented, and relationships with other systems. Without one you cannot meaningfully self-assess, and an assessor has nothing to test against.",
      },
      {
        id: "poam",
        name: "Plan of Action and Milestones (POA&M)",
        control: "3.12.2",
        why: "Documents each unimplemented requirement, what you'll do about it, and by when. A POA&M is not a failure — it's the expected mechanism for tracking remediation.",
      },
    ],

    methodology:
      "Each of the 110 requirements is assessed from your assessment answers using a fixed mapping — not by an AI's interpretation. Requirements with no corresponding assessment question are reported as 'not yet assessed' rather than assumed implemented.",
    disclaimer:
      "This is a gap analysis against NIST SP 800-171 Rev 2, not a DoD assessment, not an SPRS score, and not a CMMC certification. Your contract determines what you must do; confirm scope with your contracting officer or assessor.",
  };
}

/** Controls in a given family — useful for drilling in from a family score. */
export function controlsInFamily(familyId) {
  return NIST800171_CONTROLS.filter(c => c.family === familyId);
}
