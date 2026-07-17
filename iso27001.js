// iso27001.js
// ISO/IEC 27001:2022 — Information Security Management Systems.
//
// THE THING MOST TOOLS GET WRONG
// -------------------------------
// Annex A's 93 controls are a REFERENCE SET, not a mandatory checklist. You
// don't implement all 93 — you select controls based on your risk assessment,
// and you justify every exclusion in a Statement of Applicability (SoA).
//
// What you must actually satisfy to be certified is Clauses 4–10: the ISMS
// requirements. Annex A is the menu you draw from to treat the risks Clause 6
// makes you identify.
//
// So a tool that scores you "37 of 93 controls implemented, 40% compliant" has
// misunderstood the standard. An organization with 30 applicable controls, all
// implemented, and a well-reasoned SoA is in better shape than one with 93
// half-done. We model both layers and score them separately.
//
// COPYRIGHT — READ BEFORE EDITING
// -------------------------------
// ISO/IEC 27001:2022 is copyrighted by ISO and IEC and sold, not published
// freely. We reference control IDENTIFIERS (A.5.7, A.8.24) and their commonly
// used short titles, and describe what each covers in OUR OWN WORDS. We do NOT
// reproduce the standard's control text, implementation guidance, or clause
// wording. Never paste ISO text into this file.
//
// Control identifiers and titles are widely published in vendor summaries and
// function as factual references. The standard's expression is ISO's property.
//
// Sources (structure corroborated across multiple independent summaries):
//   ISO — https://www.iso.org/standard/27001
//   Annex A: 93 controls / 4 themes — Organizational 37 (A.5.1–5.37),
//   People 8 (A.6.1–6.8), Physical 14 (A.7.1–7.14), Technological 34 (A.8.1–8.34)

export const ISO27001_META = {
  id: "iso27001",
  name: "ISO 27001",
  shortName: "ISO 27001",
  fullName: "ISO/IEC 27001:2022",
  authority: "International Organization for Standardization / International Electrotechnical Commission",
  version: "2022 (third revision; replaced the 2013 version's 114 controls across 14 domains)",
  url: "https://www.iso.org/standard/27001",
  depth: "control-mapped",
  summary:
    "The international standard for an Information Security Management System. Certification is by an accredited body and is recognised globally — often the price of entry for enterprise or international procurement.",
  whoNeedsIt:
    "Businesses selling internationally or into enterprise procurement, where a buyer's vendor-security review asks for certification. Together with SOC 2 it accounts for the large majority of certifications businesses pursue.",
  keyPoint:
    "You are certified against Clauses 4–10, not Annex A. Annex A is a reference catalogue you select from based on your risk assessment — exclusions are legitimate when justified in your Statement of Applicability.",
  transitionNote:
    "The 2022 revision restructured 114 controls in 14 domains into 93 controls across 4 themes, and added 11 genuinely new controls covering threat intelligence, cloud, and data protection.",
  copyrightNote:
    "ISO's standard text is copyrighted and sold by ISO. We reference control identifiers and titles and describe coverage in our own words. To implement ISO 27001 you need the standard itself.",
};

// ── Clauses 4–10 — the actual certification requirements ──────
// This is what an auditor certifies you against. Annex A supports it.
export const ISO27001_CLAUSES = [
  {
    id: "clause-4",
    number: 4,
    name: "Context of the organization",
    covers: "Understanding your organization and its context, the needs and expectations of interested parties, and determining the scope of the ISMS.",
    nistFunctions: ["Identify", "Govern"],
    evidence: ["documentedPolicies", "dataInventory"],
  },
  {
    id: "clause-5",
    number: 5,
    name: "Leadership",
    covers: "Top management demonstrating leadership and commitment, establishing an information security policy, and assigning roles, responsibilities, and authorities.",
    nistFunctions: ["Govern"],
    evidence: ["documentedPolicies", "itManagement"],
  },
  {
    id: "clause-6",
    number: 6,
    name: "Planning",
    covers: "Actions to address risks and opportunities, information security risk assessment and treatment, the Statement of Applicability, and setting security objectives.",
    nistFunctions: ["Identify"],
    evidence: ["priorAudit", "dataInventory"],
    note: "This is where the Statement of Applicability comes from. It's the heart of the standard — get this right and Annex A largely follows.",
  },
  {
    id: "clause-7",
    number: 7,
    name: "Support",
    covers: "Resources, competence, awareness, communication, and documented information needed for the ISMS.",
    nistFunctions: ["Protect", "Govern"],
    evidence: ["training", "documentedPolicies"],
  },
  {
    id: "clause-8",
    number: 8,
    name: "Operation",
    covers: "Operational planning and control, carrying out the risk assessment, and implementing the risk treatment plan.",
    nistFunctions: ["Protect"],
    evidence: ["documentedPolicies", "endpoint"],
  },
  {
    id: "clause-9",
    number: 9,
    name: "Performance evaluation",
    covers: "Monitoring, measurement, analysis and evaluation; internal audit; and management review.",
    nistFunctions: ["Detect", "Govern"],
    evidence: ["monitoring", "priorAudit"],
  },
  {
    id: "clause-10",
    number: 10,
    name: "Improvement",
    covers: "Continual improvement, and handling nonconformity and corrective action.",
    nistFunctions: ["Govern", "Recover"],
    evidence: ["priorAudit", "incidentResponse"],
  },
];

// ── Annex A — the four themes ─────────────────────────────────
export const ISO27001_THEMES = {
  organizational: { id: "organizational", name: "Organizational controls", range: "A.5.1–A.5.37", count: 37,
    description: "Policies, governance, third-party management, and the organizational scaffolding around security." },
  people: { id: "people", name: "People controls", range: "A.6.1–A.6.8", count: 8,
    description: "Screening, terms of employment, awareness, discipline, and what happens when people join, move, and leave." },
  physical: { id: "physical", name: "Physical controls", range: "A.7.1–A.7.14", count: 14,
    description: "Perimeters, entry, equipment, and the tangible environment where information lives." },
  technological: { id: "technological", name: "Technological controls", range: "A.8.1–A.8.34", count: 34,
    description: "The largest theme — endpoints, access, cryptography, networks, development, and monitoring." },
};

// The 11 controls new in the 2022 revision. Worth flagging separately: an
// organization transitioning from 2013 has these as genuinely new work.
const NEW_2022 = new Set([
  "A.5.7", "A.5.23", "A.5.30", "A.7.4", "A.8.9", "A.8.10",
  "A.8.11", "A.8.12", "A.8.16", "A.8.23", "A.8.28",
]);

// ── Annex A controls ──────────────────────────────────────────
// `covers` is our own description of the control's subject matter.
// `evidence` maps to checklist item IDs for deterministic scoring.
export const ISO27001_ANNEX_A = [
  // ── A.5 Organizational (37) ──
  { id: "A.5.1", theme: "organizational", title: "Policies for information security", covers: "A defined set of security policies, approved by management, published, and reviewed at planned intervals.", evidence: ["documentedPolicies"] },
  { id: "A.5.2", theme: "organizational", title: "Information security roles and responsibilities", covers: "Security roles defined and allocated according to organizational needs.", evidence: ["itManagement", "documentedPolicies"] },
  { id: "A.5.3", theme: "organizational", title: "Segregation of duties", covers: "Conflicting duties and areas of responsibility separated to reduce fraud and error.", evidence: ["documentedPolicies"] },
  { id: "A.5.4", theme: "organizational", title: "Management responsibilities", covers: "Management requiring all personnel to apply security in line with established policy.", evidence: ["documentedPolicies", "training"] },
  { id: "A.5.5", theme: "organizational", title: "Contact with authorities", covers: "Maintaining contact with relevant authorities — regulators, law enforcement.", evidence: ["incidentResponse"] },
  { id: "A.5.6", theme: "organizational", title: "Contact with special interest groups", covers: "Contact with security forums and professional associations to stay current.", evidence: [] },
  { id: "A.5.7", theme: "organizational", title: "Threat intelligence", covers: "Collecting and analysing information about threats to produce actionable intelligence.", evidence: ["monitoring"] },
  { id: "A.5.8", theme: "organizational", title: "Information security in project management", covers: "Security integrated into project management regardless of project type.", evidence: ["documentedPolicies"] },
  { id: "A.5.9", theme: "organizational", title: "Inventory of information and other associated assets", covers: "An inventory of information and associated assets, with owners identified.", evidence: ["dataInventory"] },
  { id: "A.5.10", theme: "organizational", title: "Acceptable use of information and other associated assets", covers: "Rules for acceptable use, documented and communicated.", evidence: ["documentedPolicies"] },
  { id: "A.5.11", theme: "organizational", title: "Return of assets", covers: "Personnel returning organizational assets on termination of employment or contract.", evidence: ["documentedPolicies"] },
  { id: "A.5.12", theme: "organizational", title: "Classification of information", covers: "Information classified according to confidentiality, integrity, availability, and stakeholder requirements.", evidence: ["dataInventory"] },
  { id: "A.5.13", theme: "organizational", title: "Labelling of information", covers: "Procedures for labelling information in line with the classification scheme.", evidence: ["dataInventory"] },
  { id: "A.5.14", theme: "organizational", title: "Information transfer", covers: "Rules and agreements for transferring information within and outside the organization.", evidence: ["emailSecurity"] },
  { id: "A.5.15", theme: "organizational", title: "Access control", covers: "Rules controlling physical and logical access based on business and security requirements.", evidence: ["mfa"] },
  { id: "A.5.16", theme: "organizational", title: "Identity management", covers: "The full lifecycle of identities.", evidence: ["mfa"] },
  { id: "A.5.17", theme: "organizational", title: "Authentication information", covers: "Allocation and management of authentication information, including advising users on handling it.", evidence: ["mfa"] },
  { id: "A.5.18", theme: "organizational", title: "Access rights", covers: "Provisioning, review, modification, and removal of access rights in line with policy.", evidence: ["mfa", "documentedPolicies"] },
  { id: "A.5.19", theme: "organizational", title: "Information security in supplier relationships", covers: "Processes to manage the security risks that come with using suppliers.", evidence: ["itManagement"] },
  { id: "A.5.20", theme: "organizational", title: "Addressing information security within supplier agreements", covers: "Security requirements established and agreed with each supplier.", evidence: ["itManagement"] },
  { id: "A.5.21", theme: "organizational", title: "Managing information security in the ICT supply chain", covers: "Managing security risks across the ICT products and services supply chain.", evidence: ["itManagement"] },
  { id: "A.5.22", theme: "organizational", title: "Monitoring, review and change management of supplier services", covers: "Regularly monitoring and reviewing supplier service delivery and changes.", evidence: ["itManagement", "monitoring"] },
  { id: "A.5.23", theme: "organizational", title: "Information security for use of cloud services", covers: "Acquiring, using, managing, and exiting cloud services in line with security requirements.", evidence: ["itManagement"] },
  { id: "A.5.24", theme: "organizational", title: "Information security incident management planning and preparation", covers: "Planning and preparing for incident response by defining processes, roles, and responsibilities.", evidence: ["incidentResponse"] },
  { id: "A.5.25", theme: "organizational", title: "Assessment and decision on information security events", covers: "Assessing security events and deciding whether they are incidents.", evidence: ["incidentResponse", "monitoring"] },
  { id: "A.5.26", theme: "organizational", title: "Response to information security incidents", covers: "Responding to incidents according to documented procedures.", evidence: ["incidentResponse", "responseSupport"] },
  { id: "A.5.27", theme: "organizational", title: "Learning from information security incidents", covers: "Using knowledge from incidents to strengthen controls.", evidence: ["incidentResponse"] },
  { id: "A.5.28", theme: "organizational", title: "Collection of evidence", covers: "Procedures for identifying, collecting, and preserving evidence of security events.", evidence: ["incidentResponse", "monitoring"] },
  { id: "A.5.29", theme: "organizational", title: "Information security during disruption", covers: "Maintaining security at an appropriate level during disruption.", evidence: ["disasterRecovery"] },
  { id: "A.5.30", theme: "organizational", title: "ICT readiness for business continuity", covers: "ICT readiness planned, implemented, maintained, and tested against continuity objectives.", evidence: ["disasterRecovery", "backups"] },
  { id: "A.5.31", theme: "organizational", title: "Legal, statutory, regulatory and contractual requirements", covers: "Identifying and keeping current the legal and contractual security requirements you're subject to.", evidence: ["documentedPolicies"] },
  { id: "A.5.32", theme: "organizational", title: "Intellectual property rights", covers: "Procedures to protect intellectual property rights.", evidence: ["documentedPolicies"] },
  { id: "A.5.33", theme: "organizational", title: "Protection of records", covers: "Records protected from loss, destruction, falsification, and unauthorized access or release.", evidence: ["backups", "dataInventory"] },
  { id: "A.5.34", theme: "organizational", title: "Privacy and protection of PII", covers: "Identifying and meeting requirements for privacy and personally identifiable information.", evidence: ["dataInventory"] },
  { id: "A.5.35", theme: "organizational", title: "Independent review of information security", covers: "Independent review of the security approach at planned intervals or after significant change.", evidence: ["priorAudit"] },
  { id: "A.5.36", theme: "organizational", title: "Compliance with policies, rules and standards for information security", covers: "Regularly reviewing compliance with your own security policies and standards.", evidence: ["priorAudit", "documentedPolicies"] },
  { id: "A.5.37", theme: "organizational", title: "Documented operating procedures", covers: "Operating procedures documented and made available to those who need them.", evidence: ["documentedPolicies"] },

  // ── A.6 People (8) ──
  { id: "A.6.1", theme: "people", title: "Screening", covers: "Background verification on candidates, proportionate to the role and the information they'll access.", evidence: [] },
  { id: "A.6.2", theme: "people", title: "Terms and conditions of employment", covers: "Employment agreements stating security responsibilities.", evidence: ["documentedPolicies"] },
  { id: "A.6.3", theme: "people", title: "Information security awareness, education and training", covers: "Awareness and training appropriate to the role, updated as policies change.", evidence: ["training"] },
  { id: "A.6.4", theme: "people", title: "Disciplinary process", covers: "A formalised, communicated process for acting on security policy violations.", evidence: ["documentedPolicies"] },
  { id: "A.6.5", theme: "people", title: "Responsibilities after termination or change of employment", covers: "Security responsibilities that survive someone leaving or changing role.", evidence: ["documentedPolicies"] },
  { id: "A.6.6", theme: "people", title: "Confidentiality or non-disclosure agreements", covers: "NDAs reflecting the organization's needs, identified, documented, and reviewed.", evidence: ["documentedPolicies"] },
  { id: "A.6.7", theme: "people", title: "Remote working", covers: "Security measures for working outside the organization's premises.", evidence: ["mfa", "endpoint"] },
  { id: "A.6.8", theme: "people", title: "Information security event reporting", covers: "A mechanism for personnel to report observed or suspected security events promptly.", evidence: ["incidentResponse", "training"] },

  // ── A.7 Physical (14) ──
  { id: "A.7.1", theme: "physical", title: "Physical security perimeters", covers: "Perimeters defined and used to protect areas holding information and assets.", evidence: [] },
  { id: "A.7.2", theme: "physical", title: "Physical entry", covers: "Secure areas protected by appropriate entry controls and access points.", evidence: [] },
  { id: "A.7.3", theme: "physical", title: "Securing offices, rooms and facilities", covers: "Physical security designed and implemented for offices, rooms, and facilities.", evidence: [] },
  { id: "A.7.4", theme: "physical", title: "Physical security monitoring", covers: "Premises continuously monitored for unauthorized physical access.", evidence: ["monitoring"] },
  { id: "A.7.5", theme: "physical", title: "Protecting against physical and environmental threats", covers: "Protection against natural disasters and other physical or environmental threats.", evidence: ["disasterRecovery"] },
  { id: "A.7.6", theme: "physical", title: "Working in secure areas", covers: "Security measures for working in secure areas.", evidence: [] },
  { id: "A.7.7", theme: "physical", title: "Clear desk and clear screen", covers: "Rules for papers, removable media, and unattended screens.", evidence: ["documentedPolicies"] },
  { id: "A.7.8", theme: "physical", title: "Equipment siting and protection", covers: "Equipment sited securely and protected.", evidence: [] },
  { id: "A.7.9", theme: "physical", title: "Security of assets off-premises", covers: "Protection for assets used outside the organization's premises.", evidence: ["endpoint"] },
  { id: "A.7.10", theme: "physical", title: "Storage media", covers: "Storage media managed through acquisition, use, transport, and disposal.", evidence: ["dataInventory"] },
  { id: "A.7.11", theme: "physical", title: "Supporting utilities", covers: "Protecting facilities from power failures and other utility disruptions.", evidence: ["disasterRecovery"] },
  { id: "A.7.12", theme: "physical", title: "Cabling security", covers: "Power and telecommunications cabling protected from interception and damage.", evidence: [] },
  { id: "A.7.13", theme: "physical", title: "Equipment maintenance", covers: "Equipment maintained correctly to preserve availability and integrity.", evidence: ["itManagement"] },
  { id: "A.7.14", theme: "physical", title: "Secure disposal or re-use of equipment", covers: "Verifying that sensitive data and licensed software are removed before disposal or re-use.", evidence: ["dataInventory"] },

  // ── A.8 Technological (34) ──
  { id: "A.8.1", theme: "technological", title: "User end point devices", covers: "Protecting information on, processed by, or accessible via user endpoint devices.", evidence: ["endpoint"] },
  { id: "A.8.2", theme: "technological", title: "Privileged access rights", covers: "Restricting and managing the allocation and use of privileged access.", evidence: ["mfa"] },
  { id: "A.8.3", theme: "technological", title: "Information access restriction", covers: "Access to information restricted in line with the access control policy.", evidence: ["mfa"] },
  { id: "A.8.4", theme: "technological", title: "Access to source code", covers: "Read and write access to source code and development tools appropriately managed.", evidence: [] },
  { id: "A.8.5", theme: "technological", title: "Secure authentication", covers: "Authentication technologies and procedures based on access restrictions and policy.", evidence: ["mfa"] },
  { id: "A.8.6", theme: "technological", title: "Capacity management", covers: "Resource use monitored and adjusted against current and expected capacity needs.", evidence: ["monitoring"] },
  { id: "A.8.7", theme: "technological", title: "Protection against malware", covers: "Malware protection implemented and supported by user awareness.", evidence: ["endpoint", "training"] },
  { id: "A.8.8", theme: "technological", title: "Management of technical vulnerabilities", covers: "Obtaining information about technical vulnerabilities, evaluating exposure, and acting.", evidence: ["monitoring", "itManagement"] },
  { id: "A.8.9", theme: "technological", title: "Configuration management", covers: "Establishing, documenting, implementing, monitoring, and reviewing configurations.", evidence: ["itManagement"] },
  { id: "A.8.10", theme: "technological", title: "Information deletion", covers: "Deleting information when no longer required.", evidence: ["dataInventory"] },
  { id: "A.8.11", theme: "technological", title: "Data masking", covers: "Data masking used in line with access control policy and applicable requirements.", evidence: [] },
  { id: "A.8.12", theme: "technological", title: "Data leakage prevention", covers: "Measures applied to systems and networks that process or store sensitive information.", evidence: ["emailSecurity", "endpoint"] },
  { id: "A.8.13", theme: "technological", title: "Information backup", covers: "Backup copies maintained and regularly tested against an agreed backup policy.", evidence: ["backups"] },
  { id: "A.8.14", theme: "technological", title: "Redundancy of information processing facilities", covers: "Facilities implemented with enough redundancy to meet availability requirements.", evidence: ["disasterRecovery"] },
  { id: "A.8.15", theme: "technological", title: "Logging", covers: "Logs recording activities, exceptions, faults, and other relevant events, and protected.", evidence: ["monitoring"] },
  { id: "A.8.16", theme: "technological", title: "Monitoring activities", covers: "Networks, systems, and applications monitored for anomalous behaviour and evaluated.", evidence: ["monitoring"] },
  { id: "A.8.17", theme: "technological", title: "Clock synchronisation", covers: "Clocks synchronised to approved time sources.", evidence: [] },
  { id: "A.8.18", theme: "technological", title: "Use of privileged utility programs", covers: "Restricting and tightly controlling utility programs capable of overriding controls.", evidence: ["mfa"] },
  { id: "A.8.19", theme: "technological", title: "Installation of software on operational systems", covers: "Procedures to securely manage software installation on operational systems.", evidence: ["endpoint", "itManagement"] },
  { id: "A.8.20", theme: "technological", title: "Networks security", covers: "Networks and network devices secured, managed, and controlled.", evidence: ["itManagement"] },
  { id: "A.8.21", theme: "technological", title: "Security of network services", covers: "Security mechanisms, service levels, and requirements identified and included in agreements.", evidence: ["itManagement"] },
  { id: "A.8.22", theme: "technological", title: "Segregation of networks", covers: "Groups of services, users, and systems segregated on networks.", evidence: ["itManagement"] },
  { id: "A.8.23", theme: "technological", title: "Web filtering", covers: "Access to external websites managed to reduce exposure to malicious content.", evidence: ["endpoint", "emailSecurity"] },
  { id: "A.8.24", theme: "technological", title: "Use of cryptography", covers: "Rules for effective use of cryptography, including key management.", evidence: [] },
  { id: "A.8.25", theme: "technological", title: "Secure development life cycle", covers: "Rules for secure development of software and systems.", evidence: [] },
  { id: "A.8.26", theme: "technological", title: "Application security requirements", covers: "Security requirements identified, specified, and approved when developing or acquiring applications.", evidence: [] },
  { id: "A.8.27", theme: "technological", title: "Secure system architecture and engineering principles", covers: "Principles for engineering secure systems established and applied.", evidence: [] },
  { id: "A.8.28", theme: "technological", title: "Secure coding", covers: "Secure coding principles applied to software development.", evidence: [] },
  { id: "A.8.29", theme: "technological", title: "Security testing in development and acceptance", covers: "Security testing processes defined and implemented in the development lifecycle.", evidence: [] },
  { id: "A.8.30", theme: "technological", title: "Outsourced development", covers: "Directing, monitoring, and reviewing outsourced system development.", evidence: ["itManagement"] },
  { id: "A.8.31", theme: "technological", title: "Separation of development, test and production environments", covers: "Development, testing, and production environments separated and secured.", evidence: [] },
  { id: "A.8.32", theme: "technological", title: "Change management", covers: "Changes to information processing facilities and systems subject to change management procedures.", evidence: ["documentedPolicies", "itManagement"] },
  { id: "A.8.33", theme: "technological", title: "Test information", covers: "Test information appropriately selected, protected, and managed.", evidence: [] },
  { id: "A.8.34", theme: "technological", title: "Protection of information systems during audit testing", covers: "Audit tests on operational systems planned and agreed to minimise disruption.", evidence: ["priorAudit"] },
];

// ── Assessment ────────────────────────────────────────────────
// Two layers, scored separately, because they mean different things:
//
//   Clauses 4–10  — what you are actually certified against. Non-negotiable.
//   Annex A       — a reference catalogue. You select from it based on risk and
//                   justify exclusions in your Statement of Applicability.
//
// Reporting "43 of 93 controls = 46% compliant" would be a category error: an
// organization with 30 applicable controls all implemented and a defensible SoA
// is in better shape than one with 93 half-done. We never produce that number.

const STATUS = { MET: "met", PARTIAL: "partial", GAP: "gap", UNKNOWN: "unknown" };

function score(item, answers) {
  const scores = (item.evidence || [])
    .map(id => answers[id]?.score)
    .filter(s => typeof s === "number");
  if (scores.length === 0) return { status: STATUS.UNKNOWN, score: null };
  const s = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return { score: s, status: s >= 80 ? STATUS.MET : s >= 45 ? STATUS.PARTIAL : STATUS.GAP };
}

/**
 * @param {object} checklistAnswers
 * @param {object} opts
 * @param {string[]} opts.applicableControls  control IDs the client's SoA says
 *        apply. Omit for "all 93 considered" — which is the correct starting
 *        point, since Clause 6 requires you to consider every one.
 * @param {object} opts.exclusions  { "A.8.28": "No in-house development" }
 */
export function assessIso27001(checklistAnswers = {}, { applicableControls = null, exclusions = {} } = {}) {
  const applicable = applicableControls
    ? new Set(applicableControls)
    : new Set(ISO27001_ANNEX_A.filter(c => !exclusions[c.id]).map(c => c.id));

  // Clauses — the certification requirements.
  const clauses = ISO27001_CLAUSES.map(cl => ({
    ...cl,
    ...score(cl, checklistAnswers),
  }));
  const clausesScored = clauses.filter(c => c.status !== STATUS.UNKNOWN);

  // Annex A, grouped by theme.
  const themes = Object.values(ISO27001_THEMES).map(theme => {
    const controls = ISO27001_ANNEX_A
      .filter(c => c.theme === theme.id)
      .map(c => {
        const inScope = applicable.has(c.id);
        const excluded = !!exclusions[c.id];
        return {
          ...c,
          new2022: NEW_2022.has(c.id),
          inScope,
          excluded,
          exclusionReason: exclusions[c.id] || null,
          ...(inScope ? score(c, checklistAnswers) : { status: "excluded", score: null }),
        };
      });
    const scored = controls.filter(c => c.inScope && c.status !== STATUS.UNKNOWN);
    const avg = scored.length ? Math.round(scored.reduce((a, c) => a + c.score, 0) / scored.length) : null;
    return {
      ...theme,
      controls,
      inScopeCount: controls.filter(c => c.inScope).length,
      excludedCount: controls.filter(c => c.excluded).length,
      score: avg,
      status: avg === null ? STATUS.UNKNOWN : avg >= 80 ? STATUS.MET : avg >= 45 ? STATUS.PARTIAL : STATUS.GAP,
    };
  });

  const allControls = themes.flatMap(t => t.controls);
  const inScope = allControls.filter(c => c.inScope);
  const scored = inScope.filter(c => c.status !== STATUS.UNKNOWN);
  const gaps = scored.filter(c => c.status === STATUS.GAP);
  const new2022Gaps = gaps.filter(c => c.new2022);

  // Exclusions without a documented reason are an SoA finding in their own
  // right — an auditor will ask, and "we didn't think it applied" isn't an answer.
  const undocumentedExclusions = allControls.filter(c => !c.inScope && !c.exclusionReason);

  return {
    framework: ISO27001_META,
    depth: "control-mapped",

    // The layer that actually gets you certified.
    clauses: {
      items: clauses,
      assessed: clausesScored.length,
      total: clauses.length,
      met: clausesScored.filter(c => c.status === STATUS.MET).length,
      gaps: clausesScored.filter(c => c.status === STATUS.GAP).map(c => ({ number: c.number, name: c.name })),
      note: "Clauses 4–10 are the ISMS requirements you are certified against. Annex A supports them — it does not replace them.",
    },

    themes,
    summary: {
      annexATotal: ISO27001_ANNEX_A.length,
      inScope: inScope.length,
      excluded: allControls.length - inScope.length,
      assessed: scored.length,
      met: scored.filter(c => c.status === STATUS.MET).length,
      partial: scored.filter(c => c.status === STATUS.PARTIAL).length,
      gaps: gaps.length,
      unknown: inScope.length - scored.length,
      // Deliberately expressed over IN-SCOPE controls, never over all 93.
      coveragePct: scored.length
        ? Math.round((scored.filter(c => c.status === STATUS.MET).length / scored.length) * 100)
        : null,
    },
    topGaps: gaps.slice(0, 5).map(g => ({ id: g.id, title: g.title, new2022: g.new2022 })),
    new2022Gaps: new2022Gaps.map(g => ({ id: g.id, title: g.title })),
    new2022Note: new2022Gaps.length
      ? `${new2022Gaps.length} of your gaps are controls introduced in the 2022 revision. If your ISMS was built against ISO 27001:2013, these are new obligations — the 2013 version had no equivalent.`
      : null,

    statementOfApplicability: {
      required: true,
      inScope: inScope.length,
      excluded: allControls.length - inScope.length,
      documentedExclusions: Object.keys(exclusions).length,
      undocumentedExclusions: undocumentedExclusions.map(c => ({ id: c.id, title: c.title })),
      note: "Your Statement of Applicability must list every one of the 93 controls, state whether it applies, and justify each exclusion. Excluding controls is entirely legitimate — a business with no software development reasonably excludes the secure-development controls. Excluding them without a written reason is a finding.",
      warning: undocumentedExclusions.length
        ? `${undocumentedExclusions.length} controls are out of scope with no recorded justification. An auditor will ask about each one.`
        : null,
    },

    scoringNote:
      "We score in-scope controls only, and we do not report a percentage over all 93 — that number would be meaningless. ISO 27001 does not ask you to implement every control; it asks you to select the right ones for your risks and justify the rest.",
    methodology:
      "Clauses and controls are assessed from your assessment answers using a fixed mapping — not by an AI's interpretation. Items with no corresponding assessment question are reported as 'not yet assessed' rather than assumed implemented.",
    copyrightNote: ISO27001_META.copyrightNote,
    disclaimer:
      "This is a gap analysis against the structure of ISO/IEC 27001:2022, not a certification audit and not a substitute for the standard itself. Certification is granted only by an accredited certification body. You will need to purchase the standard from ISO to implement it properly.",
  };
}

/** The 11 controls new in the 2022 revision — useful for 2013 transitions. */
export function new2022Controls() {
  return ISO27001_ANNEX_A.filter(c => NEW_2022.has(c.id)).map(c => ({
    id: c.id, title: c.title, theme: c.theme, covers: c.covers,
  }));
}
