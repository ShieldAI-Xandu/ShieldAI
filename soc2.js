// soc2.js
// SOC 2 — AICPA Trust Services Criteria (TSP section 100, 2017 criteria with
// 2022 points of focus revision).
//
// SCOPE — Security (CC1–CC9) + Availability (A1)
// ----------------------------------------------
// Security is the mandatory Common Criteria set: every SOC 2 report includes
// it. Availability is the optional category most commonly added, because it
// covers backups, capacity, and disaster recovery — the things a customer's
// procurement team actually asks about.
//
// Not included: Processing Integrity (PI), Confidentiality (C), Privacy (P).
// Those are added when a service organization's specific commitments require
// them, and pretending to assess them for every client would be noise.
//
// COPYRIGHT — why the wording here is ours
// -----------------------------------------
// The Trust Services Criteria are published and copyrighted by the AICPA. We
// reference criterion identifiers (CC6.1, A1.2) and state in our own words what
// each covers. We do not reproduce AICPA's criterion text or its points of
// focus. Same constraint as ISO 27001, and it doesn't reduce the usefulness of
// a gap analysis — the identifiers are what an auditor works from.
//
// WHAT SOC 2 IS, AND WHAT THIS FILE IS NOT
// -----------------------------------------
// SOC 2 is an ATTESTATION performed by a licensed CPA firm. Nothing here
// produces a SOC 2 report, and nothing here makes anyone "SOC 2 compliant" —
// that phrase doesn't really exist. This is readiness: where you stand against
// the criteria before you engage an auditor, which is exactly the question an
// SMB has when a customer first demands a report.
//
// A NOTE ON THE CRITERION COUNT
// ------------------------------
// Published summaries disagree: some count 32 Common Criteria, some 33. The
// difference is entirely CC9 — the sources saying 32 list only CC9.1 and omit
// CC9.2 (vendor and business-partner risk).
//
// CC9.2 exists. AICPA-derived guidance cross-references it directly: a control
// covering tabletop exercises is described as addressing security (CC9.2) as
// well as availability (A1.2 and A1.3), which it could not do if CC9.2 were not
// a criterion. So the enumeration below is 5+3+4+2+3+8+5+1+2 = 33, and with
// Availability's three criteria a Security+Availability engagement covers 36.
//
// We implement 33 and say so, rather than quietly matching whichever total a
// given blog post happens to print.
//
// Reference: https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022

export const SOC2_META = {
  id: "soc2",
  name: "SOC 2",
  shortName: "SOC 2",
  citation: "AICPA Trust Services Criteria (TSP section 100)",
  authority: "American Institute of Certified Public Accountants (AICPA)",
  url: "https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2",
  depth: "control-mapped",
  version: "2017 criteria, revised points of focus (2022)",
  scope: ["security", "availability"],
  summary:
    "The report your customers ask for. An independent CPA firm attests that your controls meet the Trust Services Criteria — most often Security, frequently with Availability added.",
  whoMustComply:
    "Service organizations whose customers demand assurance: SaaS companies, managed service providers, data processors, anyone holding a customer's data as part of delivering a service. It is contract-driven, not law-driven.",
  penalty:
    "No regulator enforces SOC 2. The consequence of not having one is commercial: enterprise deals stall or die in procurement.",
  reportTypes: {
    type1: "Type I — controls are suitably designed at a point in time. Faster and cheaper; often a first step.",
    type2: "Type II — controls operated effectively over a period (typically 3–12 months). What most customers actually want.",
  },
  criticalNote:
    "There is no such thing as being 'SOC 2 certified' or 'SOC 2 compliant.' A licensed CPA firm issues an attestation report about your controls. ShieldAI prepares you for that examination; it does not perform or replace it.",
};

// ── Common Criteria: Security (CC1–CC9) ───────────────────────
// Descriptions are ours. `evidence` names checklist item IDs from
// securityChecklist.js that give deterministic signal.

export const SOC2_SECURITY = [
  {
    id: "CC1", name: "Control Environment",
    theme: "Governance, accountability, and competence — the tone set from the top.",
    cosoNote: "Maps to COSO Principles 1–5.",
    nistFunctions: ["Govern", "Identify"],
    criteria: [
      { id: "CC1.1", name: "Commitment to integrity and ethical values",
        covers: "The organization demonstrates a commitment to integrity and ethics — codes of conduct, and evidence they are actually enforced rather than filed.",
        evidence: ["documentedPolicies"] },
      { id: "CC1.2", name: "Board independence and oversight",
        covers: "Those charged with governance operate independently of management and actively oversee internal control. For a small business this is an owner or advisory board, not a formal audit committee.",
        evidence: ["documentedPolicies"] },
      { id: "CC1.3", name: "Structures, reporting lines, authority",
        covers: "Management establishes organizational structure, reporting lines, and clear authority and responsibility for pursuing objectives.",
        evidence: ["securityOwnership"] },
      { id: "CC1.4", name: "Competence of personnel",
        covers: "Commitment to attracting, developing, and retaining competent people — including security training and consideration of contractors' and providers' competence.",
        evidence: ["training", "itManagement"] },
      { id: "CC1.5", name: "Accountability for internal control",
        covers: "Individuals are held accountable for their internal-control responsibilities, with consequences when they aren't met.",
        evidence: ["documentedPolicies"] },
    ],
  },
  {
    id: "CC2", name: "Communication and Information",
    theme: "The right information reaches the right people, inside and outside.",
    cosoNote: "Maps to COSO Principles 13–15.",
    nistFunctions: ["Govern", "Identify"],
    criteria: [
      { id: "CC2.1", name: "Quality information for internal control",
        covers: "The organization obtains or generates relevant, quality information to support internal control — you cannot control what you don't measure.",
        evidence: ["monitoring", "dataInventory"] },
      { id: "CC2.2", name: "Internal communication",
        covers: "Security objectives and responsibilities are communicated internally, including how to report failures, incidents, and concerns.",
        evidence: ["training", "incidentResponse"] },
      { id: "CC2.3", name: "External communication",
        covers: "Communication with customers, vendors, and other external parties about matters affecting internal control.",
        evidence: ["documentedPolicies", "incidentResponse"] },
    ],
  },
  {
    id: "CC3", name: "Risk Assessment",
    theme: "Identify what could go wrong, including fraud and change.",
    cosoNote: "Maps to COSO Principles 6–9.",
    nistFunctions: ["Identify"],
    criteria: [
      { id: "CC3.1", name: "Objectives specified with sufficient clarity",
        covers: "Objectives are specified clearly enough that risks to them can actually be identified and assessed.",
        evidence: ["documentedPolicies"] },
      { id: "CC3.2", name: "Risk identification and analysis",
        covers: "Risks to objectives are identified across the entity and analyzed as a basis for deciding how to manage them.",
        evidence: ["riskAssessmentCadence"] },
      { id: "CC3.3", name: "Fraud risk consideration",
        covers: "The potential for fraud is explicitly considered when assessing risk — a distinct exercise from assessing external threats.",
        evidence: ["priorAudit"] },
      { id: "CC3.4", name: "Assessment of significant change",
        covers: "Changes that could significantly affect the system of internal control are identified and assessed — new systems, new vendors, growth, acquisition.",
        evidence: ["priorAudit", "documentedPolicies"] },
    ],
  },
  {
    id: "CC4", name: "Monitoring Activities",
    theme: "Check that the controls are actually working, and fix them when they aren't.",
    cosoNote: "Maps to COSO Principles 16–17.",
    nistFunctions: ["Detect", "Identify"],
    criteria: [
      { id: "CC4.1", name: "Ongoing and separate evaluations",
        covers: "Evaluations are performed to determine whether the components of internal control are present and functioning — continuously, periodically, or both.",
        evidence: ["monitoring", "priorAudit"] },
      { id: "CC4.2", name: "Communication of deficiencies",
        covers: "Control deficiencies are evaluated and communicated to those responsible for corrective action, including senior management where warranted.",
        evidence: ["monitoring", "documentedPolicies"] },
    ],
  },
  {
    id: "CC5", name: "Control Activities",
    theme: "Turning policy into actual, operating controls.",
    cosoNote: "Maps to COSO Principles 10–12.",
    nistFunctions: ["Protect"],
    criteria: [
      { id: "CC5.1", name: "Selection and development of control activities",
        covers: "Control activities are selected and developed that contribute to mitigating risks to an acceptable level.",
        evidence: ["documentedPolicies", "endpoint"] },
      { id: "CC5.2", name: "Technology general controls",
        covers: "Control activities over technology are selected and developed to support the achievement of objectives.",
        evidence: ["endpoint", "mfa"] },
      { id: "CC5.3", name: "Deployment through policies and procedures",
        covers: "Control activities are deployed through policies that establish expectations and procedures that put those policies into action.",
        evidence: ["documentedPolicies", "policyReviewCadence"] },
    ],
  },
  {
    id: "CC6", name: "Logical and Physical Access Controls",
    theme: "Who can get in — digitally and physically. The largest series, and where most findings land.",
    nistFunctions: ["Protect"],
    criteria: [
      { id: "CC6.1", name: "Logical access security software and infrastructure",
        covers: "Logical access security measures protect information assets from unauthorized access — the identity and access management foundation.",
        evidence: ["mfa", "privilegedAccess", "accessReviews"] },
      { id: "CC6.2", name: "User registration and authorization",
        covers: "New internal and external users are registered and authorized before being issued credentials, and credentials are removed when access is no longer needed.",
        evidence: ["offboarding", "accessReviews"] },
      { id: "CC6.3", name: "Access modification and removal",
        covers: "Access to data and systems is added, modified, and removed based on roles and least privilege — including timely revocation at termination.",
        evidence: ["accessReviews", "privilegedAccess"] },
      { id: "CC6.4", name: "Physical access restriction",
        covers: "Physical access to facilities and hardware holding information assets is restricted to authorized people.",
        evidence: ["physicalSecurity"] },
      { id: "CC6.5", name: "Secure disposal of assets",
        covers: "Data and software are removed from physical assets before disposal, so retired hardware doesn't leak.",
        evidence: ["mediaDisposal"] },
      { id: "CC6.6", name: "Protection against external threats",
        covers: "Logical access boundaries protect against threats from sources outside the system.",
        evidence: ["endpoint", "emailSecurity"] },
      { id: "CC6.7", name: "Restricted transmission and movement of information",
        covers: "Information in transit and on removable media is restricted to authorized users and protected — in practice, encryption.",
        evidence: ["encryptionInTransit", "encryptionAtRest"] },
      { id: "CC6.8", name: "Prevention and detection of unauthorized software",
        covers: "Controls prevent or detect the introduction of unauthorized or malicious software.",
        evidence: ["endpoint", "changeManagement"] },
    ],
  },
  {
    id: "CC7", name: "System Operations",
    theme: "Running the system: detecting problems and responding to incidents.",
    nistFunctions: ["Detect", "Respond"],
    criteria: [
      { id: "CC7.1", name: "Detection of configuration changes and vulnerabilities",
        covers: "Detection and monitoring procedures identify configuration changes and new vulnerabilities — this is where continuous vulnerability management lives.",
        evidence: ["vulnManagement", "changeManagement"] },
      { id: "CC7.2", name: "Monitoring for anomalies",
        covers: "System components are monitored for anomalies indicative of malicious acts, natural disasters, and errors, and those anomalies are evaluated.",
        evidence: ["monitoring", "endpoint"] },
      { id: "CC7.3", name: "Evaluation of security events",
        covers: "Security events are evaluated to determine whether they amount to a failure to meet objectives — an incident — and acted on accordingly.",
        evidence: ["incidentResponse", "monitoring"] },
      { id: "CC7.4", name: "Incident response",
        covers: "Identified incidents are responded to by executing a defined program: contain, remediate, communicate, and learn.",
        evidence: ["incidentResponse", "responseSupport"] },
      { id: "CC7.5", name: "Recovery from incidents",
        covers: "The organization identifies, develops, and implements activities to recover from identified security incidents.",
        evidence: ["disasterRecovery", "backups"] },
    ],
  },
  {
    id: "CC8", name: "Change Management",
    theme: "Changes are authorized, tested, and documented.",
    nistFunctions: ["Protect"],
    criteria: [
      { id: "CC8.1", name: "Authorized change management process",
        covers: "Changes to infrastructure, data, software, and procedures are authorized, designed, developed, tested, approved, and implemented through a defined process.",
        evidence: ["changeManagement"] },
    ],
  },
  {
    id: "CC9", name: "Risk Mitigation",
    theme: "Business disruption and vendor risk.",
    nistFunctions: ["Identify", "Recover"],
    criteria: [
      { id: "CC9.1", name: "Risk mitigation activities for business disruption",
        covers: "The organization identifies, selects, and develops risk mitigation activities for risks arising from potential business disruptions — including insurance and continuity planning.",
        evidence: ["disasterRecovery", "backups"] },
      { id: "CC9.2", name: "Vendor and business partner risk management",
        covers: "Risks arising from vendors and business partners are assessed and managed — due diligence, contracts, and ongoing review.",
        evidence: ["vendorDueDiligence", "vendorContracts", "vendorInventory"] },
    ],
  },
];

// ── Availability (A1) ─────────────────────────────────────────
export const SOC2_AVAILABILITY = [
  {
    id: "A1", name: "Availability",
    theme: "Systems are available for operation and use as committed — capacity, backups, and recovery.",
    optional: true,
    nistFunctions: ["Recover", "Protect"],
    criteria: [
      { id: "A1.1", name: "Capacity management",
        covers: "Current processing capacity and use are maintained, monitored, and evaluated so demand can be met and additional capacity added before it's needed.",
        evidence: ["monitoring"] },
      { id: "A1.2", name: "Environmental protections, backup, and recovery infrastructure",
        covers: "Environmental protections, software, data backup processes, and recovery infrastructure are authorized, designed, developed, implemented, operated, approved, maintained, and monitored.",
        evidence: ["backups", "disasterRecovery"] },
      { id: "A1.3", name: "Recovery plan testing",
        covers: "Recovery plan procedures supporting system recovery are tested — an untested backup is a hope, not a control.",
        evidence: ["disasterRecovery"] },
    ],
  },
];

export const SOC2_CATEGORIES = {
  security: {
    id: "security", name: "Security", mandatory: true, series: SOC2_SECURITY,
    description: "The Common Criteria (CC1–CC9). Every SOC 2 report includes Security — it is not optional.",
  },
  availability: {
    id: "availability", name: "Availability", mandatory: false, series: SOC2_AVAILABILITY,
    description: "Systems are available as committed. The most commonly added optional category, especially for anything cloud-hosted.",
  },
};

// ── Deterministic readiness assessment ────────────────────────
const STATUS = { MET: "met", PARTIAL: "partial", GAP: "gap", UNKNOWN: "unknown" };

function assessCriterion(c, answers) {
  const scores = (c.evidence || [])
    .map(id => answers[id]?.score)
    .filter(s => typeof s === "number");
  if (scores.length === 0) return { ...c, status: STATUS.UNKNOWN, score: null };
  const score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return { ...c, score, status: score >= 80 ? STATUS.MET : score >= 45 ? STATUS.PARTIAL : STATUS.GAP };
}

/**
 * SOC 2 readiness. `categories` selects which Trust Services Categories are in
 * scope; Security is always included because the criteria require it.
 */
export function assessSoc2(checklistAnswers = {}, { categories = ["security"], reportType = "type2" } = {}) {
  // Security is mandatory — silently including it is correct here, because a
  // SOC 2 without Security isn't a SOC 2.
  const inScope = Array.from(new Set(["security", ...categories]))
    .filter(c => SOC2_CATEGORIES[c]);

  const assessed = inScope.map(catId => {
    const cat = SOC2_CATEGORIES[catId];
    const series = cat.series.map(s => {
      const criteria = s.criteria.map(c => assessCriterion(c, checklistAnswers));
      const scored = criteria.filter(c => c.status !== STATUS.UNKNOWN);
      const avg = scored.length ? Math.round(scored.reduce((a, c) => a + c.score, 0) / scored.length) : null;
      return {
        id: s.id, name: s.name, theme: s.theme, cosoNote: s.cosoNote,
        nistFunctions: s.nistFunctions, criteria,
        score: avg,
        status: avg === null ? STATUS.UNKNOWN : avg >= 80 ? STATUS.MET : avg >= 45 ? STATUS.PARTIAL : STATUS.GAP,
      };
    });
    return { id: cat.id, name: cat.name, mandatory: cat.mandatory, description: cat.description, series };
  });

  const all = assessed.flatMap(c => c.series.flatMap(s => s.criteria));
  const scored = all.filter(c => c.status !== STATUS.UNKNOWN);
  const gaps = scored.filter(c => c.status === STATUS.GAP);

  return {
    framework: SOC2_META,
    depth: "control-mapped",
    reportType,
    reportTypeNote: SOC2_META.reportTypes[reportType] || SOC2_META.reportTypes.type2,
    categoriesInScope: assessed.map(c => c.name),
    categories: assessed,
    summary: {
      criteria: all.length,
      assessed: scored.length,
      met: scored.filter(c => c.status === STATUS.MET).length,
      partial: scored.filter(c => c.status === STATUS.PARTIAL).length,
      gaps: gaps.length,
      unknown: all.length - scored.length,
      readinessPct: scored.length
        ? Math.round((scored.filter(c => c.status === STATUS.MET).length / scored.length) * 100)
        : null,
    },
    topGaps: gaps.slice(0, 5).map(g => ({ id: g.id, name: g.name, covers: g.covers })),
    methodology:
      "Each criterion is assessed from your assessment answers using a fixed mapping to the Trust Services Criteria — not by an AI's interpretation. Criteria with no corresponding assessment question are reported as 'not yet assessed' rather than assumed met.",
    criticalNote: SOC2_META.criticalNote,
    disclaimer:
      "This is a readiness gap analysis against the AICPA Trust Services Criteria. It is not an attestation, does not make you 'SOC 2 compliant' (no such status exists), and does not substitute for an examination by a licensed CPA firm. Criterion identifiers are referenced under fair use; the criteria text itself is AICPA copyright.",
  };
}

// ── SOC 1 — deliberately not implemented ──────────────────────
// Kept here so the reason is recorded where someone would look for it, and so
// the UI can give a genuinely useful answer when a client asks.
//
// SOC 1 audits internal controls over FINANCIAL REPORTING (ICFR) under SSAE 18
// / AT-C 320. It has NO predefined control catalog: the service organization
// defines its own control objectives based on which of its processes affect a
// client's financial statements, and a CPA firm tests those. Two SOC 1 reports
// for two payroll processors can share no controls at all.
//
// So there is nothing to map to. An "AI-assisted SOC 1" would be a model
// inventing plausible financial control objectives for a business it barely
// knows — presented to a CPA firm testing ICFR. That is not a weaker mapping;
// it's fabrication in a domain with real audit consequences.
//
// Telling a client "SOC 1 is not a security report, here's what you actually
// need" is better advice than pretending to assess it.
export const SOC1_GUIDANCE = {
  id: "soc1",
  name: "SOC 1",
  offered: false,
  citation: "SSAE 18 / AT-C section 320",
  whatItIs:
    "An audit of your internal controls over financial reporting (ICFR) — the controls that affect your customers' financial statements. It exists so your customer's auditor can rely on your processes when auditing them.",
  whyNotOffered:
    "SOC 1 has no predefined control catalog. Each service organization defines its own control objectives with its auditor, based on which of its processes touch a client's financials. There is nothing to map to and nothing to assess in advance — so we don't pretend to.",
  whoActuallyNeedsIt:
    "Payroll processors, claims administrators, loan servicers, third-party fund administrators — businesses whose processing directly affects a customer's financial statements.",
  ifAsked:
    "If a customer asks you for 'a SOC report,' clarify which one. Most of the time they want SOC 2 (security). If they genuinely need SOC 1, you need a CPA firm to scope control objectives with you — that's an audit engagement, not something software prepares you for.",
};
