// ftcSafeguards.js
// FTC Safeguards Rule — 16 CFR Part 314, "Standards for Safeguarding Customer
// Information," as amended (the 2021 final rule, effective June 2023, plus the
// 2023 breach-notification amendment at § 314.5).
//
// WHY THIS FRAMEWORK MATTERS FOR ShieldAI'S SEGMENT
// -------------------------------------------------
// The Rule applies to "financial institutions" under FTC jurisdiction, which is
// far broader than banks: auto dealers, mortgage brokers and lenders, tax
// preparers, accountants, collection agencies, payday lenders, real-estate
// appraisers, and finders. These are small businesses with no security staff,
// a hard federal obligation, and almost no vendor marketing to them. It is the
// clearest example of the SMB compliance gap ShieldAI exists to close.
//
// HOW THIS IS BUILT (and why it isn't AI-generated)
// -------------------------------------------------
// Every element below is a real, enumerated requirement of § 314.4, cited to
// its subsection. Each maps to:
//   · `nistFunctions` — the NIST CSF function(s) it supports, so the existing
//     deterministic posture score carries meaning here rather than being
//     re-derived.
//   · `evidence` — the checklist item IDs (securityChecklist.js) that give us
//     DETERMINISTIC signal about whether the element is met. This is what makes
//     the gap analysis computed rather than a model's opinion.
//
// Descriptions are written in our own words. Regulatory text is US federal law
// and not copyrightable, but paraphrasing keeps it readable for an SMB owner —
// which is the whole point.
//
// Source: https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-314

export const FTC_SAFEGUARDS_META = {
  id: "ftc-safeguards",
  name: "FTC Safeguards Rule",
  shortName: "FTC Safeguards",
  citation: "16 CFR Part 314",
  authority: "Federal Trade Commission",
  statute: "Gramm-Leach-Bliley Act § 501(b)",
  url: "https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-314",
  guidanceUrl: "https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know",
  depth: "control-mapped",
  version: "2021 final rule (eff. June 2023) incl. § 314.5 breach notification",
  summary:
    "A federal requirement that non-bank financial institutions maintain a written information security program. It applies to far more businesses than the name suggests — auto dealers, tax preparers, accountants, mortgage brokers, and collection agencies are all covered.",
  whoMustComply:
    "Businesses significantly engaged in financial activities under FTC jurisdiction: auto dealerships, mortgage lenders and brokers, tax preparers, accountants and bookkeepers, collection agencies, payday lenders, real-estate appraisers, finders, and similar.",
  penalty:
    "Enforced by the FTC under GLBA § 505. Violations can carry civil penalties, and enforcement actions are published publicly.",
};

// ── The small-business exemption ──────────────────────────────
// § 314.6 relieves institutions holding customer information on fewer than
// 5,000 consumers from four specific obligations. Everything else still
// applies. This matters enormously for our segment and is exactly the kind of
// nuance a generic "HIPAA/PCI/SOC2" checkbox tool gets wrong.
export const FTC_SMALL_ENTITY_EXEMPTION = {
  threshold: 5000,
  citation: "16 CFR § 314.6",
  description:
    "If you maintain customer information on fewer than 5,000 consumers, four requirements are relaxed: the written risk assessment, continuous monitoring or annual penetration testing plus biannual vulnerability assessments, the incident response plan, and the annual report to your board. Every other element of the Rule still applies in full.",
  exemptElements: ["314.4(b)(1)", "314.4(d)(2)", "314.4(h)", "314.4(i)"],
  caution:
    "The exemption is narrow and counts consumers, not customers or transactions. Most businesses that think they qualify do not. Confirm the count before relying on it.",
};

// ── The nine elements of § 314.4 ──────────────────────────────
export const FTC_SAFEGUARDS_ELEMENTS = [
  {
    id: "ftc-a",
    citation: "16 CFR § 314.4(a)",
    number: 1,
    name: "Designate a Qualified Individual",
    summary: "Name one person accountable for the security program.",
    description:
      "Designate a single qualified individual responsible for overseeing, implementing, and enforcing your information security program. This person can be an employee, an affiliate, or a service provider — but if you use an outside provider, you keep responsibility for compliance, you must name a senior person internally to direct and oversee them, and you must require the provider to maintain a program that protects you under this Rule.",
    smbNote:
      "This is the element ShieldAI's managed tier directly satisfies: we serve as the Qualified Individual, and you designate a senior person to oversee us.",
    nistFunctions: ["Identify", "Govern"],
    evidence: ["itManagement", "documentedPolicies"],
    required: true,
    exemptUnder5000: false,
  },
  {
    id: "ftc-b",
    citation: "16 CFR § 314.4(b)",
    number: 2,
    name: "Conduct a written risk assessment",
    summary: "Identify and document foreseeable risks to customer information.",
    description:
      "Base your program on a risk assessment that identifies reasonably foreseeable internal and external risks to the security, confidentiality, and integrity of customer information, and evaluates whether your existing safeguards control those risks. It must be written and must state: the criteria you use to evaluate and categorize risks, the criteria for assessing confidentiality, integrity, and availability of your systems, and how identified risks will be mitigated or accepted.",
    smbNote:
      "The written requirement is where most small businesses fail — they have opinions about their risks, not a document. ShieldAI's assessment produces this artifact.",
    nistFunctions: ["Identify"],
    evidence: ["priorAudit", "dataInventory"],
    required: true,
    exemptUnder5000: true,
    exemptionNote: "The requirement that it be written is relaxed under § 314.6, but you must still base your program on a risk assessment.",
  },
  {
    id: "ftc-c",
    citation: "16 CFR § 314.4(c)",
    number: 3,
    name: "Implement safeguards to control identified risks",
    summary: "The eight specific technical and administrative controls.",
    description:
      "Design and implement safeguards that control the risks your assessment identified. The Rule names eight specifically: access controls; an inventory of data, personnel, devices, and systems; encryption of customer information in transit and at rest; secure development practices for apps you build; multi-factor authentication for anyone accessing information systems; secure disposal of customer information no later than two years after last use; change management procedures; and monitoring of authorized users' activity.",
    smbNote:
      "MFA and encryption are the two the FTC has been most active on. The two-year disposal clock surprises almost everyone.",
    nistFunctions: ["Protect", "Detect"],
    evidence: ["mfa", "dataInventory", "endpoint", "monitoring"],
    required: true,
    exemptUnder5000: false,
    subElements: [
      { citation: "§ 314.4(c)(1)", name: "Access controls", evidence: ["mfa"] },
      { citation: "§ 314.4(c)(2)", name: "Data and asset inventory", evidence: ["dataInventory"] },
      { citation: "§ 314.4(c)(3)", name: "Encryption in transit and at rest", evidence: [] },
      { citation: "§ 314.4(c)(4)", name: "Secure development practices", evidence: [] },
      { citation: "§ 314.4(c)(5)", name: "Multi-factor authentication", evidence: ["mfa"] },
      { citation: "§ 314.4(c)(6)", name: "Secure disposal within two years of last use", evidence: ["dataInventory"] },
      { citation: "§ 314.4(c)(7)", name: "Change management", evidence: ["documentedPolicies"] },
      { citation: "§ 314.4(c)(8)", name: "Monitoring of authorized user activity", evidence: ["monitoring"] },
    ],
  },
  {
    id: "ftc-d",
    citation: "16 CFR § 314.4(d)",
    number: 4,
    name: "Regularly test and monitor safeguards",
    summary: "Continuous monitoring, or annual pen test plus biannual vulnerability assessments.",
    description:
      "Regularly test or otherwise monitor how effective your safeguards actually are. You have two routes: implement continuous monitoring of your systems, or perform annual penetration testing plus vulnerability assessments at least every six months and whenever there is a material change to your operations.",
    smbNote:
      "Continuous monitoring is the cheaper route for a small business — this is precisely what ShieldAI's read-only endpoint agent is for.",
    nistFunctions: ["Detect", "Identify"],
    evidence: ["monitoring", "priorAudit"],
    required: true,
    exemptUnder5000: true,
    exemptionNote: "§ 314.6 relaxes the specific continuous-monitoring / pen-test / vulnerability-assessment cadence.",
  },
  {
    id: "ftc-e",
    citation: "16 CFR § 314.4(e)",
    number: 5,
    name: "Train staff and use qualified personnel",
    summary: "Security awareness training, plus qualified people running the program.",
    description:
      "Implement policies and procedures to make sure your people can actually carry out the program: provide security awareness training, use qualified information security personnel (your own or a provider's), keep them current on changing threats and countermeasures, and verify that key personnel are maintaining their knowledge.",
    smbNote:
      "Two distinct obligations get conflated here: training everyone, and having someone qualified. Both are required.",
    nistFunctions: ["Protect", "Identify"],
    evidence: ["training", "itManagement"],
    required: true,
    exemptUnder5000: false,
  },
  {
    id: "ftc-f",
    citation: "16 CFR § 314.4(f)",
    number: 6,
    name: "Oversee service providers",
    summary: "Vet them, contract them to safeguard your data, and keep checking.",
    description:
      "Take reasonable steps to select service providers capable of maintaining appropriate safeguards; require them by contract to implement and maintain those safeguards; and periodically reassess them based on the risk they present and how well their safeguards are actually holding up.",
    smbNote:
      "Your IT provider, your cloud accounting software, your document shredder — all in scope. The contractual requirement is the part most SMBs have never done.",
    nistFunctions: ["Identify", "Govern"],
    evidence: ["itManagement"],
    required: true,
    exemptUnder5000: false,
  },
  {
    id: "ftc-g",
    citation: "16 CFR § 314.4(g)",
    number: 7,
    name: "Keep the program current",
    summary: "Update it as your business, risks, and technology change.",
    description:
      "Evaluate and adjust your information security program in light of your monitoring and testing results, material changes to your operations or business arrangements, the results of risk assessments, and any other circumstances you know or should know may have a material impact on the program.",
    smbNote:
      "This is the element that makes security a program rather than a project. A policy written once and never revisited fails here.",
    nistFunctions: ["Identify", "Govern"],
    evidence: ["documentedPolicies", "priorAudit"],
    required: true,
    exemptUnder5000: false,
  },
  {
    id: "ftc-h",
    citation: "16 CFR § 314.4(h)",
    number: 8,
    name: "Establish a written incident response plan",
    summary: "A documented plan for responding to a security event.",
    description:
      "Maintain a written incident response plan designed to promptly respond to and recover from any security event materially affecting the confidentiality, integrity, or availability of customer information. It must cover: the goals of the plan, internal response processes, clear roles and decision-making authority, internal and external communications and information sharing, remediation of identified weaknesses, documentation and reporting of incidents and response activities, and post-incident evaluation and revision.",
    smbNote:
      "IBM's data puts the value of a tested incident response plan at roughly $232,000 in reduced breach cost — this element pays for the whole program.",
    nistFunctions: ["Respond", "Recover"],
    evidence: ["incidentResponse", "responseSupport"],
    required: true,
    exemptUnder5000: true,
    exemptionNote: "Relaxed under § 314.6 for institutions holding data on fewer than 5,000 consumers.",
  },
  {
    id: "ftc-i",
    citation: "16 CFR § 314.4(i)",
    number: 9,
    name: "Require an annual report from the Qualified Individual",
    summary: "A written report to your board or senior leadership, at least annually.",
    description:
      "Require your Qualified Individual to report in writing, at least annually, to your board of directors or equivalent governing body — or if you have none, to a senior officer responsible for the program. The report must address the overall status of the program and your compliance with this Rule, and material matters such as risk assessment results, risk management and control decisions, service provider arrangements, test results, security events and management's response, and recommendations for change.",
    smbNote:
      "If you have no board, this goes to your owner or senior officer. It is still required, and it must be in writing.",
    nistFunctions: ["Govern", "Identify"],
    evidence: ["documentedPolicies"],
    required: true,
    exemptUnder5000: true,
    exemptionNote: "Relaxed under § 314.6.",
  },
];

// ── § 314.5 — breach notification (added 2023) ────────────────
// Structurally separate from the nine elements, and easy to miss.
export const FTC_BREACH_NOTIFICATION = {
  id: "ftc-notification",
  citation: "16 CFR § 314.5",
  name: "Notify the FTC of a reportable breach",
  summary: "Report to the FTC within 30 days if unencrypted customer information of 500+ consumers is acquired without authorization.",
  description:
    "Notify the FTC as soon as possible, and no later than 30 days after discovery, of any security event involving unauthorized acquisition of unencrypted customer information affecting 500 or more consumers. Notice is filed electronically on the FTC's site and becomes publicly available.",
  effective: "May 13, 2024",
  nistFunctions: ["Respond"],
  evidence: ["incidentResponse"],
  required: true,
};

// ── Deterministic gap analysis ────────────────────────────────
// Scores each element from the client's actual checklist answers. No model is
// asked whether a business complies — the answers they gave decide it, and the
// mapping from answer to element is fixed and inspectable above.
//
// This is what "control-mapped" means, versus a framework where we hand a name
// to an LLM and let it write prose.

const STATUS = {
  MET: "met",
  PARTIAL: "partial",
  GAP: "gap",
  UNKNOWN: "unknown",   // no evidence maps to this element yet
};

export function assessFtcSafeguards(checklistAnswers = {}, { consumerCount = null } = {}) {
  const exempt = typeof consumerCount === "number" && consumerCount < FTC_SMALL_ENTITY_EXEMPTION.threshold;

  const elements = FTC_SAFEGUARDS_ELEMENTS.map(el => {
    const scores = (el.evidence || [])
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
      id: el.id,
      number: el.number,
      citation: el.citation,
      name: el.name,
      summary: el.summary,
      status,
      score,
      // Relaxed ≠ ignorable. We surface it as context, never as a pass.
      relaxedByExemption: exempt && el.exemptUnder5000,
      exemptionNote: exempt && el.exemptUnder5000 ? el.exemptionNote : null,
      evidenceFrom: el.evidence,
      nistFunctions: el.nistFunctions,
      smbNote: el.smbNote,
    };
  });

  const scored = elements.filter(e => e.status !== STATUS.UNKNOWN);
  const met = scored.filter(e => e.status === STATUS.MET).length;
  const gaps = elements.filter(e => e.status === STATUS.GAP);

  return {
    framework: FTC_SAFEGUARDS_META,
    depth: "control-mapped",
    elements,
    breachNotification: FTC_BREACH_NOTIFICATION,
    exemption: exempt
      ? { applies: true, ...FTC_SMALL_ENTITY_EXEMPTION }
      : { applies: false, threshold: FTC_SMALL_ENTITY_EXEMPTION.threshold,
          note: consumerCount === null
            ? "Tell us how many consumers' information you hold to see whether the § 314.6 small-entity exemption applies to you."
            : `You hold data on ${consumerCount} consumers, at or above the ${FTC_SMALL_ENTITY_EXEMPTION.threshold} threshold — the full Rule applies.` },
    summary: {
      total: FTC_SAFEGUARDS_ELEMENTS.length,
      assessed: scored.length,
      met,
      partial: scored.filter(e => e.status === STATUS.PARTIAL).length,
      gaps: gaps.length,
      unknown: elements.length - scored.length,
      // Honest: a percentage over only what we can actually evidence.
      coveragePct: scored.length ? Math.round((met / scored.length) * 100) : null,
    },
    topGaps: gaps.slice(0, 3).map(g => ({ citation: g.citation, name: g.name, summary: g.summary })),
    methodology:
      "Each element is assessed from your assessment answers using a fixed mapping to the Rule's enumerated requirements — not by an AI's interpretation. Elements with no corresponding assessment question are reported as 'not yet assessed' rather than assumed compliant.",
    disclaimer:
      "This is a gap analysis against 16 CFR Part 314, not a legal determination of compliance. Have counsel review your program before relying on it.",
  };
}
