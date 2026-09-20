// nist800172.js
// NIST SP 800-172 — Enhanced Security Requirements for Protecting Controlled
// Unclassified Information: A Supplement to NIST Special Publication 800-171.
//
// WHAT THIS IS, AND WHY IT'S SEPARATE FROM nist800171.js
// --------------------------------------------------------
// 800-171's 110 requirements protect CUI against ordinary threats. 800-172
// adds 35 ENHANCED requirements on top, aimed specifically at Advanced
// Persistent Threats (APTs) — nation-state-level adversaries with the
// resources to defeat baseline controls. This is CMMC Level 3's layer (see
// cmmc.js): Level 2 is 800-171's 110; Level 3 is those 110 plus a subset of
// these 35, selected per programme by the government, never self-determined.
//
// WHICH VERSION — same question nist800171.js answers for its own revision
// -------------------------------------------------------------------------
// This module tracks the ORIGINAL SP 800-172 (2021), not Rev 3 (2025, still
// in draft/final-draft as of this writing). CMMC's Program Rule (32 CFR Part
// 170) and cmmc.js's own Level 3 definition reference "NIST SP 800-172," not
// a numbered revision — the same reasoning nist800171.js applies to stay on
// Rev 2 rather than Rev 3 for CMMC purposes. If/when DoD's CMMC rule moves to
// a specific 800-172 revision, this module updates with it.
//
// EVIDENCE MAPPING IS DELIBERATELY SPARSE
// -----------------------------------------
// These are APT-grade requirements — dual authorization, cyber deception,
// threat hunting, supply-chain risk analytics, moving-target defense. A
// 35-question SMB baseline checklist (securityChecklist.js) cannot honestly
// assess most of them; roughly 40% get a real evidence mapping here, and the
// rest are reported "not yet assessed" rather than stretched onto a checklist
// question that doesn't actually speak to them. Same principle CIS's
// cisControls.js and NIST 800-53's nist80053.js already document for their
// own coarser-grained controls.
//
// COPYRIGHT: none. NIST publications are US Government works in the public
// domain — same as nist800171.js. Requirement text below is quoted directly
// from NIST's own published CSV (linked below), not paraphrased or recalled.
//
// Sources:
//   NIST SP 800-172 (final) — https://csrc.nist.gov/pubs/sp/800/172/final
//   Enhanced Security Requirements CSV — https://csrc.nist.gov/files/pubs/sp/800/172/final/docs/sp800-172-enhanced-security-reqs.csv

export const NIST800172_META = {
  id: "nist-800-172",
  name: "NIST 800-172",
  shortName: "NIST 800-172",
  fullName: "NIST SP 800-172 — Enhanced Security Requirements for Protecting CUI",
  authority: "National Institute of Standards and Technology",
  version: "Final (Feb 2021)",
  url: "https://csrc.nist.gov/pubs/sp/800/172/final",
  depth: "control-mapped",
  summary:
    "35 enhanced requirements layered on top of NIST SP 800-171, aimed at protecting CUI against Advanced Persistent Threats — the layer CMMC Level 3 adds to Level 2's 110 controls.",
  whoMustComply:
    "Contractors on the DoD's highest-priority programmes, where CMMC Level 3 applies. Which enhanced requirements actually apply to a given programme is selected by the government (DCMA DIBCAC) — not self-determined, and not every organization handling CUI needs this layer.",
  publicDomain: true,
};

// ── The 10 families with enhanced requirements ─────────────────
// Only 10 of 800-171's 14 families gained enhanced requirements (Audit &
// Accountability, Maintenance, Media Protection, and Physical Protection did
// not) — this is the real distribution from NIST's own published list, not
// an oversight.
export const NIST800172_FAMILIES = [
  { id: "AC", prefix: "3.1", name: "Access Control", count: 3, nistFunctions: ["Protect"] },
  { id: "AT", prefix: "3.2", name: "Awareness and Training", count: 2, nistFunctions: ["Protect"] },
  { id: "CM", prefix: "3.4", name: "Configuration Management", count: 3, nistFunctions: ["Protect", "Identify"] },
  { id: "IA", prefix: "3.5", name: "Identification and Authentication", count: 3, nistFunctions: ["Protect"] },
  { id: "IR", prefix: "3.6", name: "Incident Response", count: 2, nistFunctions: ["Respond"] },
  { id: "PS", prefix: "3.9", name: "Personnel Security", count: 2, nistFunctions: ["Protect"] },
  { id: "RA", prefix: "3.11", name: "Risk Assessment", count: 7, nistFunctions: ["Identify"] },
  { id: "CA", prefix: "3.12", name: "Security Assessment", count: 1, nistFunctions: ["Identify", "Govern"] },
  { id: "SC", prefix: "3.13", name: "System and Communications Protection", count: 5, nistFunctions: ["Protect"] },
  { id: "SI", prefix: "3.14", name: "System and Information Integrity", count: 7, nistFunctions: ["Detect", "Protect"] },
];

// ── The 35 enhanced requirements ────────────────────────────────
// Requirement text quoted verbatim from NIST's published CSV (see header).
// `evidence` left empty where no securityChecklist.js question honestly
// speaks to the requirement — see header note.
export const NIST800172_CONTROLS = [
  // ── 3.1e Access Control (3) ──
  { id: "3.1.1e", family: "AC", covers: "Employ dual authorization to execute critical or sensitive system and organizational operations.", evidence: [] },
  { id: "3.1.2e", family: "AC", covers: "Restrict access to systems and system components to only those information resources that are owned, provisioned, or issued by the organization.", evidence: [] },
  { id: "3.1.3e", family: "AC", covers: "Employ organization-defined secure information transfer solutions to control information flows between security domains on connected systems.", evidence: [] },

  // ── 3.2e Awareness and Training (2) ──
  { id: "3.2.1e", family: "AT", covers: "Provide awareness training focused on recognizing and responding to threats from social engineering, advanced persistent threat actors, breaches, and suspicious behaviors; update the training when there are significant changes to the threat.", evidence: ["training"] },
  { id: "3.2.2e", family: "AT", covers: "Include practical exercises in awareness training that are aligned with current threat scenarios and provide feedback to individuals involved in the training and their supervisors.", evidence: ["training"] },

  // ── 3.4e Configuration Management (3) ──
  { id: "3.4.1e", family: "CM", covers: "Establish and maintain an authoritative source and repository to provide a trusted source and accountability for approved and implemented system components.", evidence: ["dataInventory"] },
  { id: "3.4.2e", family: "CM", covers: "Employ automated mechanisms to detect misconfigured or unauthorized system components; after detection, remove or quarantine the components to facilitate patching, re-configuration, or other mitigations.", evidence: ["monitoring"] },
  { id: "3.4.3e", family: "CM", covers: "Employ automated discovery and management tools to maintain an up-to-date, complete, accurate, and readily available inventory of system components.", evidence: ["dataInventory"] },

  // ── 3.5e Identification and Authentication (3) ──
  { id: "3.5.1e", family: "IA", covers: "Identify and authenticate organization-defined systems and system components before establishing a network connection using bidirectional authentication that is cryptographically based and replay resistant.", evidence: [] },
  { id: "3.5.2e", family: "IA", covers: "Employ automated mechanisms for the generation, protection, rotation, and management of passwords for systems and system components that do not support multifactor authentication or complex account management.", evidence: ["passwordPolicy"] },
  { id: "3.5.3e", family: "IA", covers: "Employ automated or manual/procedural mechanisms to prohibit system components from connecting to organizational systems unless the components are known, authenticated, in a properly configured state, or in a trust profile.", evidence: ["endpoint"] },

  // ── 3.6e Incident Response (2) ──
  { id: "3.6.1e", family: "IR", covers: "Establish and maintain a security operations center capability that operates on an organization-defined time period.", evidence: ["monitoring"] },
  { id: "3.6.2e", family: "IR", covers: "Establish and maintain a cyber incident response team that can be deployed by the organization within an organization-defined time period.", evidence: ["responseSupport"] },

  // ── 3.9e Personnel Security (2) ──
  { id: "3.9.1e", family: "PS", covers: "Conduct enhanced personnel screening for individuals and reassess individual positions and access to CUI at an organization-defined frequency.", evidence: [] },
  { id: "3.9.2e", family: "PS", covers: "Ensure that organizational systems are protected if adverse information develops or is obtained about individuals with access to CUI.", evidence: ["offboarding"] },

  // ── 3.11e Risk Assessment (7) ──
  { id: "3.11.1e", family: "RA", covers: "Employ organization-defined sources of threat intelligence as part of a risk assessment to guide and inform the development of organizational systems, security architectures, selection of security solutions, monitoring, threat hunting, and response and recovery activities.", evidence: [] },
  { id: "3.11.2e", family: "RA", covers: "Conduct cyber threat hunting activities to search for indicators of compromise in organizational systems and detect, track, and disrupt threats that evade existing controls.", evidence: [] },
  { id: "3.11.3e", family: "RA", covers: "Employ advanced automation and analytics capabilities in support of analysts to predict and identify risks to organizations, systems, and system components.", evidence: [] },
  { id: "3.11.4e", family: "RA", covers: "Document or reference in the system security plan the security solution selected, the rationale for the security solution, and the risk determination.", evidence: ["documentedPolicies"] },
  { id: "3.11.5e", family: "RA", covers: "Assess the effectiveness of security solutions at an organization-defined frequency to address anticipated risk to organizational systems and the organization based on current and accumulated threat intelligence.", evidence: ["riskAssessmentCadence"] },
  { id: "3.11.6e", family: "RA", covers: "Assess, respond to, and monitor supply chain risks associated with organizational systems and system components.", evidence: ["vendorDueDiligence"] },
  { id: "3.11.7e", family: "RA", covers: "Develop a plan for managing supply chain risks associated with organizational systems and system components; update the plan at an organization-defined frequency.", evidence: ["vendorDueDiligence"] },

  // ── 3.12e Security Assessment (1) ──
  { id: "3.12.1e", family: "CA", covers: "Conduct penetration testing at an organization-defined frequency, leveraging automated scanning tools and ad hoc tests using subject matter experts.", evidence: ["priorAudit"] },

  // ── 3.13e System and Communications Protection (5) ──
  { id: "3.13.1e", family: "SC", covers: "Create diversity in organization-defined system components to reduce the extent of malicious code propagation.", evidence: [] },
  { id: "3.13.2e", family: "SC", covers: "Implement changes to organizational systems and system components to introduce a degree of unpredictability into operations.", evidence: [] },
  { id: "3.13.3e", family: "SC", covers: "Employ organization-defined technical and procedural means to confuse and mislead adversaries.", evidence: [] },
  { id: "3.13.4e", family: "SC", covers: "Employ physical and/or logical isolation techniques in organizational systems and system components.", evidence: [] },
  { id: "3.13.5e", family: "SC", covers: "Distribute and relocate organization-defined system functions or resources at an organization-defined frequency.", evidence: [] },

  // ── 3.14e System and Information Integrity (7) ──
  { id: "3.14.1e", family: "SI", covers: "Verify the integrity of organization-defined security critical or essential software using root of trust mechanisms or cryptographic signatures.", evidence: [] },
  { id: "3.14.2e", family: "SI", covers: "Monitor organizational systems and system components on an ongoing basis for anomalous or suspicious behavior.", evidence: ["monitoring"] },
  { id: "3.14.3e", family: "SI", covers: "Ensure that organization-defined systems and system components are included in the scope of the specified enhanced security requirements or are segregated in purpose-specific networks.", evidence: [] },
  { id: "3.14.4e", family: "SI", covers: "Refresh organization-defined systems and system components from a known, trusted state at an organization-defined frequency.", evidence: [] },
  { id: "3.14.5e", family: "SI", covers: "Conduct reviews of persistent organizational storage locations at an organization-defined frequency and remove CUI that is no longer needed.", evidence: ["dataRetention"] },
  { id: "3.14.6e", family: "SI", covers: "Use threat indicator information and effective mitigations obtained from organization-defined external organizations to guide and inform intrusion detection and threat hunting.", evidence: [] },
  { id: "3.14.7e", family: "SI", covers: "Verify the correctness of organization-defined security critical or essential software, firmware, and hardware components using organization-defined verification methods or techniques.", evidence: [] },
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

/**
 * Gap analysis against all 35 enhanced requirements. This does NOT determine
 * which of the 35 apply to a given programme — that's the government's call
 * (see CMMC_META in cmmc.js) — it assesses all of them so a client can see
 * where they'd stand on each, same "suggestion, not determination" posture
 * PCI's SAQ and CMMC's own level suggestion already take.
 */
export function assessNist800172(checklistAnswers = {}) {
  const families = NIST800172_FAMILIES.map(f => {
    const controls = NIST800172_CONTROLS
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
    framework: NIST800172_META,
    depth: "control-mapped",
    families,
    summary: {
      total: NIST800172_CONTROLS.length,
      families: NIST800172_FAMILIES.length,
      assessed: scored.length,
      met: met.length,
      partial: scored.filter(c => c.status === STATUS.PARTIAL).length,
      gaps: gaps.length,
      unknown: all.length - scored.length,
      coveragePct: scored.length ? Math.round((met.length / scored.length) * 100) : null,
    },
    topGaps: gaps.slice(0, 5).map(g => ({ id: g.id, family: g.family, covers: g.covers })),
    methodology:
      "Each of the 35 enhanced requirements is assessed from your assessment answers using a fixed mapping — not by an AI's interpretation. Requirements with no corresponding assessment question are reported as 'not yet assessed' rather than assumed implemented; most of these require APT-specific capabilities (threat hunting, cyber deception, supply-chain analytics) that a general security assessment cannot honestly speak to.",
    disclaimer:
      "This assesses all 35 enhanced requirements for gap-analysis purposes. It does not determine which apply to your programme — that selection is made by the government (DCMA DIBCAC) as part of CMMC Level 3, not self-determined.",
  };
}

/** Requirements in a given family — mirrors nist800171.js's controlsInFamily(). */
export function controlsInFamily(familyId) {
  return NIST800172_CONTROLS.filter(c => c.family === familyId);
}
