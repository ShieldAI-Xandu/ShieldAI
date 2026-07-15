// complianceFrameworks.js
// ShieldAI compliance framework crosswalk.
//
// WHY THIS EXISTS
// ---------------
// securityChecklist.js asks 13 questions. Those same answers are evidence for
// requirements across many frameworks — MFA satisfies a HIPAA requirement, a
// SOC 2 criterion, an ISO 27001 control, a PCI requirement, and a CMMC
// practice all at once. This module is the crosswalk: assess once, report
// against every framework.
//
// DESIGN RULES
// ------------
// 1. Compliance status is DERIVED from real assessment answers via
//    riskEngine's scoring options — never guessed, never AI-generated.
// 2. A control is compliant when its answer scores at or above the framework's
//    threshold for that requirement. Partial answers read as "partial".
// 3. Unanswered = "unknown", never "compliant". Silence is not proof.
//
// The citations below are the widely published clause/requirement identifiers
// for each framework. They are mappings for working purposes — an auditor
// still signs off on the real thing.

import { SECURITY_CHECKLIST } from "./securityChecklist.js";

// Status of a single control against a framework requirement.
export const STATUS = {
  COMPLIANT: "compliant",
  PARTIAL: "partial",
  GAP: "gap",
  UNKNOWN: "unknown",
};

/**
 * The crosswalk.
 *
 * Each framework lists requirements. Each requirement maps to one or more
 * checklist control ids, plus `minScore`: the answer score (0–100, as defined
 * in securityChecklist.js options) needed to consider it satisfied.
 */
export const FRAMEWORKS = {
  "nist-csf": {
    id: "nist-csf",
    name: "NIST Cybersecurity Framework 2.0",
    short: "NIST CSF",
    description: "The framework ShieldAI scores natively. Organised by the six core functions.",
    requirements: [
      { id: "GV.PO", name: "Policy", section: "Govern", minScore: 60,
        text: "Organizational cybersecurity policy is established and communicated.",
        controls: ["documentedPolicies"] },
      { id: "GV.RM", name: "Risk Management Strategy", section: "Govern", minScore: 60,
        text: "Risk management processes are established and managed.",
        controls: ["itManagement", "priorAudit"] },
      { id: "ID.AM", name: "Asset Management", section: "Identify", minScore: 60,
        text: "Data, personnel, devices, and systems are identified and managed.",
        controls: ["dataInventory"] },
      { id: "ID.RA", name: "Risk Assessment", section: "Identify", minScore: 60,
        text: "The organization understands cybersecurity risk to operations and assets.",
        controls: ["priorAudit"] },
      { id: "PR.AA", name: "Identity Management & Access Control", section: "Protect", minScore: 70,
        text: "Access to assets is limited to authorized users and processes.",
        controls: ["mfa"] },
      { id: "PR.AT", name: "Awareness & Training", section: "Protect", minScore: 60,
        text: "Personnel are provided cybersecurity awareness education.",
        controls: ["training"] },
      { id: "PR.PS", name: "Platform Security", section: "Protect", minScore: 60,
        text: "Hardware and software are managed to reduce risk.",
        controls: ["endpoint", "emailSecurity"] },
      { id: "DE.CM", name: "Continuous Monitoring", section: "Detect", minScore: 60,
        text: "Assets are monitored to find anomalies and adverse events.",
        controls: ["monitoring"] },
      { id: "RS.MA", name: "Incident Management", section: "Respond", minScore: 60,
        text: "Responses to detected incidents are managed.",
        controls: ["incidentResponse", "responseSupport"] },
      { id: "RC.RP", name: "Recovery Plan Execution", section: "Recover", minScore: 70,
        text: "Recovery processes are executed to restore systems affected by incidents.",
        controls: ["backups", "disasterRecovery"] },
    ],
  },

  hipaa: {
    id: "hipaa",
    name: "HIPAA Security Rule",
    short: "HIPAA",
    description: "US healthcare. Safeguards for electronic protected health information (ePHI).",
    requirements: [
      { id: "164.308(a)(1)", name: "Security Management Process", section: "Administrative", minScore: 60,
        text: "Implement policies to prevent, detect, contain, and correct security violations.",
        controls: ["priorAudit", "documentedPolicies"] },
      { id: "164.308(a)(2)", name: "Assigned Security Responsibility", section: "Administrative", minScore: 60,
        text: "Identify the security official responsible for policies and procedures.",
        controls: ["itManagement"] },
      { id: "164.308(a)(5)", name: "Security Awareness and Training", section: "Administrative", minScore: 60,
        text: "Implement a security awareness and training program for all workforce members.",
        controls: ["training"] },
      { id: "164.308(a)(6)", name: "Security Incident Procedures", section: "Administrative", minScore: 60,
        text: "Implement policies to address security incidents.",
        controls: ["incidentResponse", "responseSupport"] },
      { id: "164.308(a)(7)", name: "Contingency Plan", section: "Administrative", minScore: 70,
        text: "Establish data backup, disaster recovery, and emergency mode operation plans.",
        controls: ["backups", "disasterRecovery"] },
      { id: "164.310(d)(1)", name: "Device and Media Controls", section: "Physical", minScore: 60,
        text: "Govern receipt and removal of hardware and media containing ePHI.",
        controls: ["dataInventory", "endpoint"] },
      { id: "164.312(a)(1)", name: "Access Control", section: "Technical", minScore: 70,
        text: "Allow access only to persons or programs granted access rights.",
        controls: ["mfa"] },
      { id: "164.312(b)", name: "Audit Controls", section: "Technical", minScore: 60,
        text: "Record and examine activity in systems containing ePHI.",
        controls: ["monitoring"] },
      { id: "164.312(e)(1)", name: "Transmission Security", section: "Technical", minScore: 60,
        text: "Guard against unauthorized access to ePHI transmitted over networks.",
        controls: ["emailSecurity"] },
    ],
  },

  "soc2": {
    id: "soc2",
    name: "SOC 2 (Trust Services Criteria)",
    short: "SOC 2",
    description: "Common Criteria for service organizations. Security is the baseline TSC.",
    requirements: [
      { id: "CC1.1", name: "Control Environment", section: "Common Criteria", minScore: 60,
        text: "Demonstrates commitment to integrity and ethical values, with defined responsibility.",
        controls: ["itManagement", "documentedPolicies"] },
      { id: "CC2.2", name: "Communication of Objectives", section: "Common Criteria", minScore: 60,
        text: "Internally communicates information, including security objectives and responsibilities.",
        controls: ["training", "documentedPolicies"] },
      { id: "CC3.2", name: "Risk Identification", section: "Common Criteria", minScore: 60,
        text: "Identifies and analyzes risks to the achievement of objectives.",
        controls: ["priorAudit", "dataInventory"] },
      { id: "CC6.1", name: "Logical Access — Security", section: "Common Criteria", minScore: 70,
        text: "Implements logical access controls to protect against unauthorized access.",
        controls: ["mfa"] },
      { id: "CC6.6", name: "Boundary Protection", section: "Common Criteria", minScore: 60,
        text: "Restricts access from outside system boundaries.",
        controls: ["emailSecurity", "endpoint"] },
      { id: "CC6.8", name: "Malicious Software Prevention", section: "Common Criteria", minScore: 60,
        text: "Prevents or detects and acts upon the introduction of unauthorized software.",
        controls: ["endpoint"] },
      { id: "CC7.2", name: "System Monitoring", section: "Common Criteria", minScore: 60,
        text: "Monitors system components for anomalies indicative of malicious acts.",
        controls: ["monitoring"] },
      { id: "CC7.3", name: "Incident Evaluation", section: "Common Criteria", minScore: 60,
        text: "Evaluates security events to determine whether they constitute incidents.",
        controls: ["incidentResponse", "monitoring"] },
      { id: "CC7.4", name: "Incident Response", section: "Common Criteria", minScore: 60,
        text: "Responds to identified security incidents through a defined program.",
        controls: ["incidentResponse", "responseSupport"] },
      { id: "A1.2", name: "Availability — Recovery", section: "Availability", minScore: 70,
        text: "Authorizes, designs, and tests recovery infrastructure and backup processes.",
        controls: ["backups", "disasterRecovery"] },
    ],
  },

  "iso-27001": {
    id: "iso-27001",
    name: "ISO/IEC 27001:2022 (Annex A)",
    short: "ISO 27001",
    description: "International standard for information security management systems.",
    requirements: [
      { id: "A.5.1", name: "Policies for Information Security", section: "Organizational", minScore: 60,
        text: "Information security policy and topic-specific policies are defined and approved.",
        controls: ["documentedPolicies"] },
      { id: "A.5.9", name: "Inventory of Information & Assets", section: "Organizational", minScore: 60,
        text: "An inventory of information and other associated assets is developed and maintained.",
        controls: ["dataInventory"] },
      { id: "A.5.24", name: "Incident Management Planning", section: "Organizational", minScore: 60,
        text: "Plan and prepare for managing information security incidents.",
        controls: ["incidentResponse", "responseSupport"] },
      { id: "A.5.30", name: "ICT Readiness for Continuity", section: "Organizational", minScore: 70,
        text: "ICT readiness is planned, implemented, and tested for business continuity.",
        controls: ["disasterRecovery", "backups"] },
      { id: "A.6.3", name: "Awareness, Education and Training", section: "People", minScore: 60,
        text: "Personnel receive appropriate awareness education and training.",
        controls: ["training"] },
      { id: "A.8.2", name: "Privileged Access Rights", section: "Technological", minScore: 70,
        text: "The allocation and use of privileged access rights is restricted and managed.",
        controls: ["mfa"] },
      { id: "A.8.7", name: "Protection Against Malware", section: "Technological", minScore: 60,
        text: "Protection against malware is implemented and supported by user awareness.",
        controls: ["endpoint"] },
      { id: "A.8.13", name: "Information Backup", section: "Technological", minScore: 70,
        text: "Backup copies are maintained and regularly tested.",
        controls: ["backups"] },
      { id: "A.8.16", name: "Monitoring Activities", section: "Technological", minScore: 60,
        text: "Networks, systems, and applications are monitored for anomalous behaviour.",
        controls: ["monitoring"] },
      { id: "A.8.23", name: "Web/Email Filtering", section: "Technological", minScore: 60,
        text: "Access to external sites and email content is managed to reduce malicious content.",
        controls: ["emailSecurity"] },
    ],
  },

  "pci-dss": {
    id: "pci-dss",
    name: "PCI DSS v4.0",
    short: "PCI DSS",
    description: "Payment card data security. Applies to anyone storing or processing card data.",
    requirements: [
      { id: "Req 3", name: "Protect Stored Account Data", section: "Protect", minScore: 60,
        text: "Account data storage is kept to a minimum and protected.",
        controls: ["dataInventory"] },
      { id: "Req 5", name: "Protect Against Malicious Software", section: "Maintain", minScore: 60,
        text: "Anti-malware is deployed, maintained, and monitored on all applicable systems.",
        controls: ["endpoint"] },
      { id: "Req 7", name: "Restrict Access by Business Need", section: "Access", minScore: 70,
        text: "Access to system components and data is restricted to those who need it.",
        controls: ["mfa"] },
      { id: "Req 8", name: "Identify Users & Authenticate Access", section: "Access", minScore: 70,
        text: "Multi-factor authentication is implemented for access to the cardholder data environment.",
        controls: ["mfa"] },
      { id: "Req 10", name: "Log and Monitor All Access", section: "Monitor", minScore: 60,
        text: "Audit logs are implemented and reviewed to detect anomalies.",
        controls: ["monitoring"] },
      { id: "Req 12.6", name: "Security Awareness Education", section: "Policy", minScore: 60,
        text: "A formal security awareness program is implemented for all personnel.",
        controls: ["training"] },
      { id: "Req 12.10", name: "Incident Response Readiness", section: "Policy", minScore: 60,
        text: "An incident response plan exists and is ready to be activated.",
        controls: ["incidentResponse", "responseSupport"] },
      { id: "Req 12.1", name: "Information Security Policy", section: "Policy", minScore: 60,
        text: "An overall information security policy is established and maintained.",
        controls: ["documentedPolicies"] },
    ],
  },

  cmmc: {
    id: "cmmc",
    name: "CMMC 2.0 Level 1–2",
    short: "CMMC",
    description: "US defense supply chain. Protects Federal Contract Information and CUI.",
    requirements: [
      { id: "AC.L1-3.1.1", name: "Authorized Access Control", section: "Access Control", minScore: 70,
        text: "Limit system access to authorized users, processes, and devices.",
        controls: ["mfa"] },
      { id: "IA.L2-3.5.3", name: "Multifactor Authentication", section: "Identification & Auth", minScore: 70,
        text: "Use multifactor authentication for local and network access to privileged accounts.",
        controls: ["mfa"] },
      { id: "AT.L2-3.2.1", name: "Role-Based Risk Awareness", section: "Awareness & Training", minScore: 60,
        text: "Ensure personnel are aware of security risks associated with their activities.",
        controls: ["training"] },
      { id: "AU.L2-3.3.1", name: "System Auditing", section: "Audit & Accountability", minScore: 60,
        text: "Create and retain system audit logs enabling monitoring and investigation.",
        controls: ["monitoring"] },
      { id: "IR.L2-3.6.1", name: "Incident Handling", section: "Incident Response", minScore: 60,
        text: "Establish an operational incident-handling capability.",
        controls: ["incidentResponse", "responseSupport"] },
      { id: "MP.L2-3.8.9", name: "Protect Backups", section: "Media Protection", minScore: 70,
        text: "Protect the confidentiality of backup CUI at storage locations.",
        controls: ["backups"] },
      { id: "SI.L1-3.14.2", name: "Malicious Code Protection", section: "System Integrity", minScore: 60,
        text: "Provide protection from malicious code at designated locations.",
        controls: ["endpoint"] },
      { id: "SI.L1-3.14.5", name: "System & File Scanning", section: "System Integrity", minScore: 60,
        text: "Perform periodic scans and real-time scans of files from external sources.",
        controls: ["endpoint", "emailSecurity"] },
      { id: "CA.L2-3.12.1", name: "Security Control Assessment", section: "Assessment", minScore: 60,
        text: "Periodically assess security controls to determine effectiveness.",
        controls: ["priorAudit"] },
      { id: "RE.L2-3.8.9", name: "Recovery Planning", section: "Recovery", minScore: 70,
        text: "Regularly perform and test data backups and recovery.",
        controls: ["disasterRecovery", "backups"] },
    ],
  },
};

export function listFrameworkIds() { return Object.keys(FRAMEWORKS); }
export function getFrameworkDef(id) { return FRAMEWORKS[id] || null; }

/** Score of an answer label for a control (null if unanswered/invalid). */
function scoreForAnswer(controlId, label) {
  const q = SECURITY_CHECKLIST.find(x => x.id === controlId);
  if (!q || !label) return null;
  const opt = q.options.find(o => o.label === label);
  return opt ? opt.score : null;
}

function controlMeta(controlId) {
  const q = SECURITY_CHECKLIST.find(x => x.id === controlId);
  if (!q) return null;
  return {
    id: q.id, question: q.question, nistFunction: q.nistFunction,
    factor: q.factor, options: q.options,
    best: [...q.options].sort((a, b) => b.score - a.score)[0],
  };
}

/**
 * Evaluate one requirement against a client's checklist answers.
 * Status is derived purely from answer scores — no AI, no guessing.
 */
export function evaluateRequirement(req, checklist = {}) {
  const controls = req.controls.map(cid => {
    const meta = controlMeta(cid);
    const answer = checklist[cid] ?? null;
    const score = scoreForAnswer(cid, answer);
    return {
      controlId: cid,
      question: meta?.question || cid,
      nistFunction: meta?.nistFunction || null,
      answer,
      score,
      answered: score !== null,
      meets: score !== null && score >= req.minScore,
      bestAnswer: meta?.best?.label || null,
      options: meta?.options || [],
    };
  });

  const answered = controls.filter(c => c.answered);
  let status;
  if (answered.length === 0) status = STATUS.UNKNOWN;
  else if (controls.every(c => c.meets)) status = STATUS.COMPLIANT;
  else if (controls.some(c => c.meets)) status = STATUS.PARTIAL;
  else status = STATUS.GAP;

  // Average score across the requirement's controls (answered only).
  const avg = answered.length
    ? Math.round(answered.reduce((s, c) => s + c.score, 0) / answered.length)
    : 0;

  return {
    id: req.id, name: req.name, section: req.section, text: req.text,
    minScore: req.minScore, status, score: avg, controls,
    failingControls: controls.filter(c => !c.meets).map(c => c.controlId),
  };
}

/**
 * Full framework report for a client's checklist answers.
 * This is the control-by-control walkthrough data.
 */
export function evaluateFramework(frameworkId, checklist = {}) {
  const def = getFrameworkDef(frameworkId);
  if (!def) return null;

  const requirements = def.requirements.map(r => evaluateRequirement(r, checklist));
  const counts = requirements.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
  const total = requirements.length;
  const compliant = counts[STATUS.COMPLIANT] || 0;

  // Sections roll up for the walkthrough UI.
  const sections = {};
  for (const r of requirements) {
    (sections[r.section] ||= []).push(r);
  }

  return {
    framework: { id: def.id, name: def.name, short: def.short, description: def.description },
    summary: {
      total,
      compliant,
      partial: counts[STATUS.PARTIAL] || 0,
      gap: counts[STATUS.GAP] || 0,
      unknown: counts[STATUS.UNKNOWN] || 0,
      compliancePct: total ? Math.round((compliant / total) * 100) : 0,
      // Readiness counts partial credit — a fairer "how close are we" number.
      readinessPct: total
        ? Math.round(((compliant + (counts[STATUS.PARTIAL] || 0) * 0.5) / total) * 100)
        : 0,
    },
    sectionNames: Object.keys(sections),
    requirements,
  };
}

/** Evaluate every framework at once — powers the multi-framework overview. */
export function evaluateAllFrameworks(checklist = {}) {
  return listFrameworkIds().map(id => {
    const r = evaluateFramework(id, checklist);
    return {
      id, name: r.framework.name, short: r.framework.short,
      ...r.summary,
    };
  });
}

/**
 * Deterministic remediation facts for a failing requirement.
 * Mastermind narrates these — it does not invent them.
 */
export function remediationContext(frameworkId, requirementId, checklist = {}) {
  const def = getFrameworkDef(frameworkId);
  if (!def) return null;
  const req = def.requirements.find(r => r.id === requirementId);
  if (!req) return null;

  const evaln = evaluateRequirement(req, checklist);
  return {
    framework: def.name,
    requirement: { id: req.id, name: req.name, text: req.text, section: req.section },
    status: evaln.status,
    minScore: req.minScore,
    controls: evaln.controls.map(c => ({
      controlId: c.controlId,
      question: c.question,
      currentAnswer: c.answer,
      currentScore: c.score,
      meets: c.meets,
      requiredAnswer: c.bestAnswer,
      allOptions: c.options.map(o => ({ label: o.label, score: o.score })),
    })),
  };
}
