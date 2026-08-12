// cisControls.js
// CIS Critical Security Controls v8.1 — the 18 controls, with the lowest
// Implementation Group at which each control's safeguards begin to apply.
//
// CIS v8.1 contains 153 Safeguards across 18 Controls, prioritized into three
// cumulative Implementation Groups:
//   IG1 — "Essential cyber hygiene" (56 safeguards). The baseline every
//         organization should implement; aimed at small/medium businesses with
//         limited IT and security resources.
//   IG2 — Includes IG1, adds safeguards for organizations with dedicated IT
//         staff, multiple departments, sensitive data, or regulatory exposure.
//   IG3 — Includes IG1 + IG2; the full 153 safeguards, for organizations
//         defending highly sensitive/regulated data against targeted attacks.
//
// `minIG` = the lowest IG that contains safeguards for that control.
//
// Source: Center for Internet Security, CIS Controls v8.1.

export const CIS_VERSION = "v8.1";

export const CIS_IMPLEMENTATION_GROUPS = {
  IG1: {
    id: "IG1",
    name: "Implementation Group 1",
    tagline: "Essential cyber hygiene",
    safeguards: 56,
    description:
      "The foundational baseline every organization should implement. Designed for small to medium businesses with limited IT and security expertise, protecting low-sensitivity data, with limited tolerance for downtime. Defends against the most common, non-targeted attacks.",
  },
  IG2: {
    id: "IG2",
    name: "Implementation Group 2",
    tagline: "Includes IG1, adds risk-based safeguards",
    safeguards: 130,
    description:
      "Builds on IG1 for organizations with staff dedicated to IT and security, multiple departments with differing risk profiles, and sensitive client or enterprise data. Adds centralized logging, EDR, segmentation, formal IR testing, and phishing simulations.",
  },
  IG3: {
    id: "IG3",
    name: "Implementation Group 3",
    tagline: "Full set — all 153 safeguards",
    safeguards: 153,
    description:
      "Includes IG1 and IG2 plus advanced safeguards for organizations with specialized security experts defending highly sensitive, regulated data against targeted attacks and zero-days. Adds threat hunting, application allowlisting, DLP, and red-team exercises.",
  },
};

// The 18 CIS Controls v8.1, in priority order (Control 1 first because you
// cannot secure what you don't know exists; Control 18 last because it
// validates everything else).
// `evidence` maps each control to the SECURITY_CHECKLIST question id(s) that
// give real, deterministic evidence for it — same evidence-mapping
// convention hipaaSecurityRule.js/soc2.js/ftcSafeguards.js already use, and
// what makes assessCis() below a genuine control-mapped assessment rather
// than the AI's interpretation. cisControls.js only enumerates CIS's 18
// top-level Controls (not the underlying 153 individual Safeguards — no
// safeguard-level breakdown exists in this codebase), so evidence is mapped
// at that coarser grain; a control with no clean checklist match is left
// with sparse evidence deliberately rather than stretching a mapping thin,
// consistent with this codebase's "real data over fabrication" rule.
export const CIS_CONTROLS = [
  { num: 1,  id: "cis-1",  name: "Inventory and Control of Enterprise Assets",
    summary: "Actively manage (inventory, track, correct) all enterprise assets connected to the infrastructure — end-user devices, network devices, IoT, and servers — physically, virtually, remotely, and in the cloud.",
    minIG: "IG1", evidence: ["dataInventory"] },
  { num: 2,  id: "cis-2",  name: "Inventory and Control of Software Assets",
    summary: "Actively manage all software (operating systems and applications) so only authorized software is installed and can execute; unauthorized software is found and prevented.",
    minIG: "IG1", evidence: ["endpoint"] },
  { num: 3,  id: "cis-3",  name: "Data Protection",
    summary: "Identify, classify, securely handle, retain, and dispose of data. Covers data inventory, access control lists, encryption at rest and in transit, and secure disposal.",
    minIG: "IG1", evidence: ["dataInventory", "encryptionAtRest", "encryptionInTransit", "dataRetention", "mediaDisposal"] },
  { num: 4,  id: "cis-4",  name: "Secure Configuration of Enterprise Assets and Software",
    summary: "Establish and maintain secure (hardened) baseline configurations for assets and software, including end-user devices, servers, network devices, mobile, and cloud workloads.",
    minIG: "IG1", evidence: ["endpoint", "changeManagement"] },
  { num: 5,  id: "cis-5",  name: "Account Management",
    summary: "Use processes and tools to assign and manage authorization to credentials for user, administrator, and service accounts across enterprise assets and software.",
    minIG: "IG1", evidence: ["offboarding", "passwordPolicy"] },
  { num: 6,  id: "cis-6",  name: "Access Control Management",
    summary: "Create, assign, manage, and revoke access credentials and privileges for accounts. Includes least privilege, MFA, and centralized access control.",
    minIG: "IG1", evidence: ["mfa", "privilegedAccess", "accessReviews"] },
  { num: 7,  id: "cis-7",  name: "Continuous Vulnerability Management",
    summary: "Continuously assess and track vulnerabilities on all enterprise assets, and remediate or minimize the window of opportunity for attackers.",
    minIG: "IG1", evidence: ["vulnManagement"] },
  { num: 8,  id: "cis-8",  name: "Audit Log Management",
    summary: "Collect, alert on, review, and retain audit logs of events that could help detect, understand, or recover from an attack. Centralized aggregation is added at IG2/IG3.",
    minIG: "IG1", evidence: ["monitoring"] },
  { num: 9,  id: "cis-9",  name: "Email and Web Browser Protections",
    summary: "Improve protections and detections of threats from email and web vectors — supported/updated browsers and clients, DNS filtering, URL filtering, and anti-phishing gateway protections.",
    minIG: "IG1", evidence: ["emailSecurity"] },
  { num: 10, id: "cis-10", name: "Malware Defenses",
    summary: "Prevent or control the installation, spread, and execution of malicious applications, code, or scripts on enterprise assets. Behavior-based and EDR detection added at IG2/IG3.",
    minIG: "IG1", evidence: ["endpoint"] },
  { num: 11, id: "cis-11", name: "Data Recovery",
    summary: "Establish and maintain data recovery practices sufficient to restore in-scope assets to a pre-incident, trusted state. Includes documented backups, ransomware-protected (offline/immutable) copies, and tested restores.",
    minIG: "IG1", evidence: ["backups"] },
  { num: 12, id: "cis-12", name: "Network Infrastructure Management",
    summary: "Establish, implement, and actively manage network devices to prevent attackers from exploiting vulnerable network services and access points. Includes up-to-date architecture diagrams and secure management.",
    minIG: "IG1", evidence: ["changeManagement"] },
  { num: 13, id: "cis-13", name: "Network Monitoring and Defense",
    summary: "Operate processes and tooling to establish and maintain comprehensive network monitoring and defense against threats across the enterprise's infrastructure and user base. Largely IG2/IG3 (SIEM, NAC, IDS).",
    minIG: "IG2", evidence: ["monitoring"] },
  { num: 14, id: "cis-14", name: "Security Awareness and Skills Training",
    summary: "Establish and maintain a security awareness program so the workforce is security-conscious and properly skilled to reduce cybersecurity risks. Phishing simulation and role-based training added at IG2/IG3.",
    minIG: "IG1", evidence: ["training"] },
  { num: 15, id: "cis-15", name: "Service Provider Management",
    summary: "Evaluate service providers who hold sensitive data or are responsible for critical IT platforms, to ensure they are protecting those platforms and data appropriately.",
    minIG: "IG1", evidence: ["vendorInventory", "vendorDueDiligence", "vendorContracts"] },
  { num: 16, id: "cis-16", name: "Application Software Security",
    summary: "Manage the security life cycle of in-house developed, hosted, or acquired software to prevent, detect, and remediate security weaknesses before they affect the enterprise. Largely IG2/IG3.",
    minIG: "IG2", evidence: ["changeManagement", "vulnManagement"] },
  { num: 17, id: "cis-17", name: "Incident Response Management",
    summary: "Establish a program to develop and maintain incident response capability (policies, plans, procedures, defined roles, training, communications) to prepare, detect, and quickly respond to attacks.",
    minIG: "IG1", evidence: ["incidentResponse", "responseSupport"] },
  { num: 18, id: "cis-18", name: "Penetration Testing",
    summary: "Test the effectiveness and resiliency of enterprise assets by identifying and exploiting weaknesses in controls (people, processes, technology) and simulating an attacker's objectives. IG2/IG3 only.",
    minIG: "IG2", evidence: ["priorAudit"] },
];

// Return the controls whose safeguards apply at a given Implementation Group.
// IGs are cumulative, so IG2 includes IG1's controls, and IG3 includes all.
export function controlsForIG(ig) {
  const order = { IG1: 1, IG2: 2, IG3: 3 };
  const target = order[ig] || 1;
  return CIS_CONTROLS.filter(c => (order[c.minIG] || 1) <= target);
}

// Build a compact prompt block describing CIS Controls v8.1 for the chosen IG,
// for use in the AI compliance-mapping generation step.
export function buildCISPromptBlock(ig = "IG1") {
  const group = CIS_IMPLEMENTATION_GROUPS[ig] || CIS_IMPLEMENTATION_GROUPS.IG1;
  const applicable = controlsForIG(ig);
  const lines = applicable.map(c => `${c.num}. ${c.name} — ${c.summary}`);
  return [
    `CIS Critical Security Controls ${CIS_VERSION} — target Implementation Group: ${group.id} (${group.tagline}, ${group.safeguards} safeguards).`,
    `${group.description}`,
    ``,
    `Assess the business against these ${applicable.length} applicable CIS Controls and produce a gap analysis:`,
    ...lines,
  ].join("\n");
}

const STATUS = { MET: "met", PARTIAL: "partial", GAP: "gap", UNKNOWN: "unknown" };

// A real, computed, control-mapped gap analysis — same evidence-averaging
// pattern hipaaSecurityRule.js/soc2.js/ftcSafeguards.js use, and what makes
// this file's `assess` (registered in frameworks.js) legitimate rather than
// an AI's interpretation dressed up as one. `ig` defaults to IG1 (the
// baseline every organization should implement — the same default
// buildCISPromptBlock above already uses) since there's no dedicated
// Implementation-Group intake step wired up yet; a client's real IG choice
// from the initial assessment wizard isn't threaded through to this
// function today — picking IG1 by default is the conservative, honest
// choice rather than assuming a broader scope than confirmed.
export function assessCis(checklistAnswers = {}, { ig = "IG1" } = {}) {
  const applicable = controlsForIG(ig);

  const controls = applicable.map(c => {
    const scores = (c.evidence || [])
      .map(id => checklistAnswers[id]?.score)
      .filter(s => typeof s === "number");

    let status, score = null;
    if (scores.length === 0) {
      status = STATUS.UNKNOWN;
    } else {
      score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      status = score >= 80 ? STATUS.MET : score >= 45 ? STATUS.PARTIAL : STATUS.GAP;
    }

    return {
      id: c.id, number: c.num, name: c.name, summary: c.summary,
      status, score, evidenceFrom: c.evidence, minIG: c.minIG,
    };
  });

  const scored = controls.filter(c => c.status !== STATUS.UNKNOWN);
  const met = scored.filter(c => c.status === STATUS.MET).length;
  const gaps = controls.filter(c => c.status === STATUS.GAP);
  const group = CIS_IMPLEMENTATION_GROUPS[ig] || CIS_IMPLEMENTATION_GROUPS.IG1;

  return {
    framework: { id: "cis", name: `CIS Controls ${CIS_VERSION}`, version: CIS_VERSION },
    depth: "control-mapped",
    implementationGroup: group,
    elements: controls,
    summary: {
      total: controls.length,
      assessed: scored.length,
      met,
      partial: scored.filter(c => c.status === STATUS.PARTIAL).length,
      gaps: gaps.length,
      unknown: controls.length - scored.length,
      coveragePct: scored.length ? Math.round((met / scored.length) * 100) : null,
    },
    topGaps: gaps.slice(0, 5).map(g => ({ id: g.id, number: g.number, name: g.name, summary: g.summary })),
    methodology:
      `Each of the ${controls.length} CIS Controls applicable at ${group.id} is assessed from your assessment answers using a fixed mapping to that Control's real definition — not by an AI's interpretation. This tracks the 18 top-level Controls, not the underlying ${group.safeguards} individual Safeguards (no safeguard-level breakdown is implemented); Controls with no clean corresponding assessment question are reported as "not yet assessed" rather than assumed compliant.`,
    disclaimer:
      "This is a gap analysis against CIS Controls v8.1's 18 top-level Controls, not a formal CIS assessment or certification — CIS Controls has no certification program. Have a qualified assessor review your program before relying on it for a client or insurer requirement.",
  };
}

export default CIS_CONTROLS;
