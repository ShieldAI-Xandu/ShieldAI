// gdpr.js
// EU General Data Protection Regulation — Regulation (EU) 2016/679.
//
// WHY THIS IS BEING PROMOTED FROM AI-ASSISTED TO CONTROL-MAPPED
// ---------------------------------------------------------------
// GDPR was the last framework in the registry still handled as an AI gap
// analysis: we held the name and let a model write prose about it. That was
// honest — frameworks.js labelled it "ai-assisted" and the UI said so — but
// it was also the weakest thing we shipped, and the pattern for fixing it
// was already established twice (hipaaSecurityRule.js and ftcSafeguards.js
// were both promoted the same way). GDPR's obligations are enumerable, they
// are stable, and the Articles are public. There is no good reason for a
// model to be paraphrasing them at runtime.
//
// WHAT MAKES GDPR DIFFERENT FROM THE SECURITY FRAMEWORKS
// ---------------------------------------------------------
// Same structural problem statePrivacy.js has, and it is handled the same
// way: this is a LEGAL obligation, not a security control set. We can tell a
// business it has no process for honouring an erasure request. We cannot
// tell it whether GDPR applies to it — Article 3 turns on whether it offers
// goods or services to people in the EU/EEA or monitors their behaviour,
// which is a legal question with fines attached (up to 4% of global annual
// turnover, Article 83(5)). Applicability output here is a PROMPT TO GET
// ADVICE, never a determination. `legalReviewRequired` is set on the
// registry entry for exactly this reason.
//
// THE B2B TRAP — READ THIS BEFORE REUSING statePrivacy.js's LOGIC
// -----------------------------------------------------------------
// statePrivacy.js vetoes its whole assessment when a client answers "None —
// we're B2B and hold no consumer data", because most US state laws carve out
// B2B contact data. GDPR does NOT have that carve-out. A business contact's
// name and work email is personal data under Article 4(1), and so is every
// employee record. Copying that veto here would tell a B2B company its GDPR
// obligations are moot, which is wrong in the flattering direction — the
// worst kind of wrong. So that answer does not suppress anything here; the
// scoping question that actually matters is Article 3 territorial scope,
// which is what the intake asks.
//
// CONTROLLER VS PROCESSOR
// -------------------------
// A handful of obligations genuinely sit with the controller (Articles 13,
// 14 and 35). When the client tells us they are only a processor, those are
// marked not applicable with the reason stated rather than scored as gaps.
// When we don't know, we assess as a controller — the broader set — and say
// so, the same conservative-when-unclear rule PCI's SAQ and CMMC's level
// suggestion already follow.
//
// COPYRIGHT: EU legislation. EUR-Lex permits reuse of Official Journal
// material with acknowledgement of source (Decision 2011/833/EU). We cite
// Article numbers and state what each covers in our own words; we do not
// reproduce the Regulation's text.
//
// Sources:
//   Regulation (EU) 2016/679 — https://eur-lex.europa.eu/eli/reg/2016/679/oj
//   EDPB guidelines          — https://www.edpb.europa.eu/our-work-tools/general-guidance/guidelines-recommendations-best-practices_en

export const GDPR_META = {
  id: "gdpr",
  name: "GDPR",
  shortName: "GDPR",
  fullName: "EU General Data Protection Regulation (Regulation (EU) 2016/679)",
  authority: "European Parliament and Council; enforced by national supervisory authorities and coordinated by the EDPB",
  citation: "Regulation (EU) 2016/679",
  version: "In force since 25 May 2018",
  url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
  depth: "control-mapped",
  summary:
    "The EU's data protection regulation. Applies by what you do and who you do it to, not by where you're incorporated — a US business with EU customers is usually in scope.",
  whoMustComply:
    "Controllers and processors established in the EU/EEA, and — via Article 3(2) — those outside it who offer goods or services to people in the EU/EEA or monitor their behaviour. The extraterritorial reach is wider than most SMBs expect, and a website that takes EU orders is the common case.",
  penalty:
    "Two tiers under Article 83: up to €10m or 2% of worldwide annual turnover, whichever is higher, for most controller/processor duties; up to €20m or 4% for breaches of the principles, lawful basis, data subject rights, and transfer rules.",
  criticalNote:
    "There is no such thing as being 'GDPR certified.' Article 42 provides for certification schemes, but no general-purpose GDPR certification exists that makes a business compliant. Compliance is a continuing state you evidence, not a badge you obtain.",
  publicDomain: false,
  reuseNote:
    "EU legislation reproduced under EUR-Lex's reuse policy (Decision 2011/833/EU). Article identifiers cited; all descriptions are ours.",
};

// ── Obligation areas ──────────────────────────────────────────
export const GDPR_AREAS = [
  { id: "Lawfulness", name: "Lawfulness and principles", why: "Whether you are allowed to process the data at all, and on what basis." },
  { id: "Transparency", name: "Transparency", why: "What you have to tell people, when, and how plainly." },
  { id: "Data subject rights", name: "Data subject rights", why: "What individuals can demand of you, and your duty to deliver it on a deadline." },
  { id: "Security", name: "Security of processing", why: "Article 32's four named measures — the part that overlaps most with the rest of this assessment." },
  { id: "Breach response", name: "Breach response", why: "The 72-hour clock, and when the individuals themselves must be told." },
  { id: "Accountability", name: "Accountability", why: "Being able to demonstrate compliance, not merely assert it." },
  { id: "Third parties", name: "Processors and transfers", why: "Who else touches the data, under what contract, and in which country." },
];

// ── The obligations ───────────────────────────────────────────
// `evidence` names checklist question ids from securityChecklist.js.
// `role: "controller"` marks the obligations that genuinely don't fall on a
// pure processor — see the header note.
export const GDPR_OBLIGATIONS = [
  // ── Lawfulness ──
  {
    id: "GDPR-1", area: "Lawfulness", name: "Lawful basis for every purpose",
    covers:
      "Identify and record which of the six lawful bases covers each processing purpose before you start. 'We've always done it' is not one of them, and legitimate interests requires a documented balancing test you can produce on request.",
    citation: "Article 6",
    evidence: ["documentedPolicies", "personalDataCategories"],
  },
  {
    id: "GDPR-2", area: "Lawfulness", name: "Consent that meets the standard",
    covers:
      "Where you rely on consent it must be freely given, specific, informed and unambiguous — an affirmative act, not a pre-ticked box — and withdrawing it must be as easy as giving it. Consent obtained before 2018 under a weaker standard does not carry over.",
    citation: "Article 7; Recital 32",
    evidence: ["privacyNotice", "consumerRights"],
  },
  {
    id: "GDPR-3", area: "Lawfulness", name: "Special category data",
    covers:
      "Health, biometric, genetic, racial or ethnic origin, political opinions, religious beliefs, trade union membership, and sex life or orientation are prohibited from processing unless an Article 9(2) condition applies on top of your Article 6 basis.",
    citation: "Article 9",
    evidence: ["personalDataCategories", "encryptionAtRest"],
  },
  {
    id: "GDPR-4", area: "Lawfulness", name: "Purpose limitation and minimisation",
    covers:
      "Collect for specified, explicit, legitimate purposes and no more data than those purposes need. Reusing data for a new, incompatible purpose needs its own basis.",
    citation: "Article 5(1)(b)-(c)",
    evidence: ["personalDataCategories", "dataInventory"],
  },
  {
    id: "GDPR-5", area: "Lawfulness", name: "Storage limitation",
    covers:
      "Keep personal data in identifiable form no longer than the purpose requires, with defined retention periods and actual deletion at the end of them. Indefinite retention is the single most common finding in this area.",
    citation: "Article 5(1)(e)",
    evidence: ["dataRetention", "mediaDisposal"],
  },

  // ── Transparency ──
  {
    id: "GDPR-6", area: "Transparency", name: "Information when you collect from the person",
    covers:
      "At the point of collection, tell the person who you are, why you're processing, on what lawful basis, who receives the data, how long you keep it, their rights, and whether you transfer it outside the EU/EEA.",
    citation: "Article 13",
    evidence: ["privacyNotice"],
    role: "controller",
  },
  {
    id: "GDPR-7", area: "Transparency", name: "Information when the data came from elsewhere",
    covers:
      "Where you obtained data indirectly — a data broker, a partner, public sources — the same information is owed, plus the categories of data and its source, generally within a month.",
    citation: "Article 14",
    evidence: ["privacyNotice", "dataInventory"],
    role: "controller",
  },
  {
    id: "GDPR-8", area: "Transparency", name: "Concise, intelligible and accessible",
    covers:
      "The information above has to be in clear plain language, easy to find, and free. A dense legal page nobody can parse fails Article 12 even when every required element is technically present.",
    citation: "Article 12(1)",
    evidence: ["privacyNotice"],
  },

  // ── Data subject rights ──
  {
    id: "GDPR-9", area: "Data subject rights", name: "Right of access",
    covers:
      "On request, confirm whether you process their data, supply a copy, and explain the purposes, recipients, retention and source. You cannot charge for the first copy.",
    citation: "Article 15",
    evidence: ["consumerRights", "dataInventory"],
  },
  {
    id: "GDPR-10", area: "Data subject rights", name: "Right to rectification",
    covers:
      "Correct inaccurate data without undue delay, and complete incomplete data — including telling recipients you disclosed it to, unless that proves impossible.",
    citation: "Articles 16, 19",
    evidence: ["consumerRights"],
  },
  {
    id: "GDPR-11", area: "Data subject rights", name: "Right to erasure",
    covers:
      "Delete on request where one of the Article 17(1) grounds applies, and pass the request to anyone you shared the data with. The operational trap is the second half: most businesses can delete their own copy and have no mechanism to tell their processors to do the same.",
    citation: "Articles 17, 19",
    evidence: ["consumerRights", "dataInventory", "vendorInventory"],
  },
  {
    id: "GDPR-12", area: "Data subject rights", name: "Right to restriction and to object",
    covers:
      "Suspend processing while a dispute is resolved, and stop on objection unless you show compelling legitimate grounds. For direct marketing the objection is absolute — there is no balancing test to win.",
    citation: "Articles 18, 21",
    evidence: ["consumerRights", "dataSaleSharing"],
  },
  {
    id: "GDPR-13", area: "Data subject rights", name: "Right to data portability",
    covers:
      "Where processing rests on consent or contract and is automated, provide the data in a structured, commonly used, machine-readable format, and transmit it to another controller where technically feasible.",
    citation: "Article 20",
    evidence: ["consumerRights"],
  },
  {
    id: "GDPR-14", area: "Data subject rights", name: "Automated decisions and profiling",
    covers:
      "Decisions made solely by automated means with legal or similarly significant effects need a specific basis, meaningful information about the logic, and a route to human review.",
    citation: "Article 22",
    evidence: ["consumerRights", "personalDataCategories"],
  },
  {
    id: "GDPR-15", area: "Data subject rights", name: "One month to respond",
    covers:
      "Requests are answered without undue delay and within one month, extendable by two further months for complex cases if you tell the person why inside the first month. Missing the clock is itself the infringement, even if you eventually comply.",
    citation: "Article 12(3)-(4)",
    evidence: ["consumerRights", "privacyRequestVolume"],
  },

  // ── Security of processing ──
  {
    id: "GDPR-16", area: "Security", name: "Encryption and pseudonymisation",
    covers:
      "Article 32 names these explicitly as measures to consider. Encryption is also what turns a breach into a non-notifiable one under Article 34(3)(a) — the single highest-leverage control in this framework.",
    citation: "Article 32(1)(a)",
    evidence: ["encryptionAtRest", "encryptionInTransit"],
  },
  {
    id: "GDPR-17", area: "Security", name: "Ongoing confidentiality, integrity, availability and resilience",
    covers:
      "The systems processing personal data have to stay secure in operation, not just at design time — access control, authentication, monitoring, and the organisational measures around them.",
    citation: "Article 32(1)(b)",
    evidence: ["mfa", "accessReviews", "privilegedAccess", "monitoring", "training"],
  },
  {
    id: "GDPR-18", area: "Security", name: "Restore availability after an incident",
    covers:
      "You must be able to restore access to personal data in a timely manner after a physical or technical incident. Untested backups do not satisfy this — the obligation is about restoration, not about copies existing.",
    citation: "Article 32(1)(c)",
    evidence: ["backups", "disasterRecovery"],
  },
  {
    id: "GDPR-19", area: "Security", name: "Regularly test and evaluate effectiveness",
    covers:
      "A process for regularly testing, assessing and evaluating whether your measures actually work. This is the article that makes a one-off security project insufficient.",
    citation: "Article 32(1)(d)",
    evidence: ["priorAudit", "vulnManagement", "riskAssessmentCadence"],
  },

  // ── Breach response ──
  {
    id: "GDPR-20", area: "Breach response", name: "Notify the supervisory authority within 72 hours",
    covers:
      "Report a personal data breach to your lead supervisory authority within 72 hours of becoming aware, unless it's unlikely to risk people's rights. The clock starts at awareness, not at conclusion of the investigation — a partial notification on time beats a complete one late.",
    citation: "Article 33",
    evidence: ["incidentResponse", "responseSupport", "monitoring"],
  },
  {
    id: "GDPR-21", area: "Breach response", name: "Tell the affected individuals when risk is high",
    covers:
      "Where a breach is likely to result in a high risk to individuals, communicate it to them without undue delay, in plain language. Effective encryption of the affected data is an explicit exemption.",
    citation: "Article 34",
    evidence: ["incidentResponse"],
  },

  // ── Accountability ──
  {
    id: "GDPR-22", area: "Accountability", name: "Demonstrable accountability",
    covers:
      "Article 5(2) shifts the burden: you must be able to demonstrate compliance, not merely assert it. In practice that means written policies, evidence they are followed, and a named owner.",
    citation: "Articles 5(2), 24",
    evidence: ["documentedPolicies", "policyReviewCadence", "securityOwnership"],
  },
  {
    id: "GDPR-23", area: "Accountability", name: "Records of processing activities",
    covers:
      "Maintain a ROPA covering purposes, categories of data and recipients, transfers, retention and security measures. The under-250-employee exemption is narrower than it looks — it falls away for processing that is not occasional, or that involves special categories.",
    citation: "Article 30",
    evidence: ["dataInventory"],
  },
  {
    id: "GDPR-24", area: "Accountability", name: "Data protection by design and by default",
    covers:
      "Build protection in at design time and default to the least privacy-intrusive setting, rather than bolting it on and leaving the permissive option as the default.",
    citation: "Article 25",
    evidence: ["changeManagement", "documentedPolicies"],
  },
  {
    id: "GDPR-25", area: "Accountability", name: "Data protection impact assessment",
    covers:
      "A DPIA is required before high-risk processing — large-scale special category data, systematic monitoring of public areas, or systematic automated evaluation with significant effects.",
    citation: "Article 35",
    evidence: ["riskAssessmentCadence", "personalDataCategories"],
    role: "controller",
  },
  {
    id: "GDPR-26", area: "Accountability", name: "Data protection officer where required",
    covers:
      "A DPO is mandatory for public authorities, for large-scale regular and systematic monitoring, and for large-scale special category processing. Where one isn't required, someone should still own this — Article 24 doesn't allow it to be nobody's job.",
    citation: "Articles 37-39",
    evidence: ["securityOwnership"],
  },

  // ── Processors and transfers ──
  {
    id: "GDPR-27", area: "Third parties", name: "Processor contracts",
    covers:
      "Every processor needs a written contract carrying the mandatory Article 28(3) terms — documented instructions, confidentiality, security, sub-processor consent, assistance with rights and breaches, deletion or return at the end, and audit rights. A standard vendor MSA rarely contains all eight.",
    citation: "Article 28(3)",
    evidence: ["vendorContracts", "vendorDueDiligence"],
  },
  {
    id: "GDPR-28", area: "Third parties", name: "Use only processors offering sufficient guarantees",
    covers:
      "Diligence before you sign, not just paper after. You remain liable for your processors' failures, which is why this sits with the controller rather than with procurement.",
    citation: "Article 28(1)",
    evidence: ["vendorDueDiligence", "vendorInventory"],
  },
  {
    id: "GDPR-29", area: "Third parties", name: "International transfers",
    covers:
      "Moving personal data outside the EU/EEA needs an adequacy decision, appropriate safeguards such as the 2021 Standard Contractual Clauses, or a narrow Article 49 derogation. Post-Schrems II this also means a transfer impact assessment for the destination country — using a US cloud region is a transfer.",
    citation: "Articles 44-49",
    evidence: ["vendorInventory", "vendorContracts"],
  },
];

// ── Assessment ────────────────────────────────────────────────
const STATUS = { MET: "met", PARTIAL: "partial", GAP: "gap", UNKNOWN: "unknown", NOT_APPLICABLE: "not-applicable" };

function scoreObligation(o, answers) {
  const scores = (o.evidence || [])
    .map(id => answers[id]?.score)
    .filter(s => typeof s === "number");
  if (scores.length === 0) return { ...o, status: STATUS.UNKNOWN, score: null };
  const s = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return { ...o, score: s, status: s >= 80 ? STATUS.MET : s >= 45 ? STATUS.PARTIAL : STATUS.GAP };
}

/**
 * GDPR readiness.
 *
 * `euDataSubjects` — whether the client offers goods/services to, or monitors,
 * people in the EU/EEA. `false` returns an honest "may not apply" rather than
 * a fabricated score; `null`/absent assesses anyway, because Article 3's reach
 * surprises people and under-scoping is the expensive mistake.
 *
 * `role` — "controller", "processor", or "both". A pure processor doesn't
 * carry the Article 13/14 transparency duties or the Article 35 DPIA, so
 * those are marked not applicable with the reason kept, rather than counted
 * as gaps.
 */
export function assessGdpr(checklistAnswers = {}, { euDataSubjects = null, role = null } = {}) {
  if (euDataSubjects === false) {
    return {
      framework: GDPR_META,
      depth: "control-mapped",
      applicable: false,
      applicabilityNote:
        "You told us you don't offer goods or services to people in the EU/EEA and don't monitor their behaviour, so GDPR may not apply. We're not scoring you against it rather than showing you a wall of gaps you'd never be fined for.",
      confirmFirst:
        "Confirm this before relying on it. Article 3(2) catches more businesses than expected: a website that ships to the EU, accepts payment in euros, offers a language version for an EU market, or runs analytics/ad tracking that profiles EU visitors can all bring you in scope, with no EU entity or office involved.",
      criticalNote: GDPR_META.criticalNote,
      disclaimer:
        "Whether GDPR applies to you is a legal question with fines attached, and this assessment does not answer it. Nothing here is legal advice.",
    };
  }

  const isProcessorOnly = role === "processor";

  const areas = GDPR_AREAS.map(a => {
    const obligations = GDPR_OBLIGATIONS
      .filter(o => o.area === a.id)
      .map(o => {
        if (isProcessorOnly && o.role === "controller") {
          return {
            ...o,
            status: STATUS.NOT_APPLICABLE,
            score: null,
            applicable: false,
            exclusionReason: `Falls on the controller, not the processor. You told us you act only as a processor — ${o.citation} sits with the controller who decides the purposes and means.`,
          };
        }
        return scoreObligation(o, checklistAnswers);
      });
    const scored = obligations.filter(o => o.status !== STATUS.UNKNOWN && o.status !== STATUS.NOT_APPLICABLE);
    const avg = scored.length ? Math.round(scored.reduce((s, o) => s + o.score, 0) / scored.length) : null;
    return {
      ...a,
      obligations,
      assessed: scored.length,
      met: scored.filter(o => o.status === STATUS.MET).length,
      score: avg,
      status: avg === null ? STATUS.UNKNOWN : avg >= 80 ? STATUS.MET : avg >= 45 ? STATUS.PARTIAL : STATUS.GAP,
    };
  });

  const all = areas.flatMap(a => a.obligations);
  const scored = all.filter(o => o.status !== STATUS.UNKNOWN && o.status !== STATUS.NOT_APPLICABLE);
  const gaps = scored.filter(o => o.status === STATUS.GAP);
  const met = scored.filter(o => o.status === STATUS.MET);
  const notApplicable = all.filter(o => o.status === STATUS.NOT_APPLICABLE);

  return {
    framework: GDPR_META,
    depth: "control-mapped",
    applicable: true,
    role: role || "assumed-controller",
    roleNote: isProcessorOnly
      ? `Assessed as a processor: ${notApplicable.length} controller-only obligations are marked not applicable rather than scored against you. Note that a processor still carries Articles 28, 30(2), 32 and 33(2) in its own right.`
      : role === "both"
        ? "Assessed as both controller and processor — the full obligation set applies."
        : "No controller/processor answer on file, so this assesses the full controller obligation set. That's the broader reading, and the conservative one: under-scoping GDPR is the expensive direction to be wrong in.",
    areas,
    summary: {
      total: all.length,
      areas: GDPR_AREAS.length,
      assessed: scored.length,
      met: met.length,
      partial: scored.filter(o => o.status === STATUS.PARTIAL).length,
      gaps: gaps.length,
      unknown: all.length - scored.length - notApplicable.length,
      notApplicable: notApplicable.length,
      compliancePct: scored.length ? Math.round((met.length / scored.length) * 100) : null,
    },
    topGaps: gaps.slice(0, 5).map(g => ({ id: g.id, area: g.area, name: g.name, citation: g.citation })),
    weakestAreas: areas
      .filter(a => a.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map(a => ({ id: a.id, name: a.name, score: a.score })),
    b2bNote:
      "B2B does not exempt you. A business contact's name and work email is personal data under Article 4(1), and so is every employee record you hold — GDPR has no B2B carve-out equivalent to the one in several US state privacy laws.",
    methodology:
      `Each of the ${GDPR_OBLIGATIONS.length} obligations is assessed from your assessment answers using a fixed mapping to the Article it comes from — not by an AI's interpretation. Obligations with no corresponding assessment question are reported as "not yet assessed" rather than assumed met.`,
    criticalNote: GDPR_META.criticalNote,
    disclaimer:
      "This is a readiness gap analysis against the GDPR's obligations. It is not legal advice, not a determination that GDPR applies to you, and not a certification — no general-purpose GDPR certification exists. Article 3 scope, Article 6 lawful basis, and international transfer mechanisms in particular are legal judgements that need a qualified adviser, not a security questionnaire.",
  };
}

/**
 * What we'd need to know to say whether GDPR applies — surfaced as questions
 * for the client to take to counsel, never answered here. Mirrors
 * statePrivacy.js's applicabilityPrompt() for the same reason.
 */
export function applicabilityPrompt() {
  return {
    question: "Does GDPR apply to my business?",
    weDoNotDecide:
      "We don't answer this, and you should be wary of any tool that does. Article 3 is a legal test and the penalty for getting it wrong is assessed as a percentage of global turnover.",
    whatDrivesIt: [
      "Do you have an establishment in the EU/EEA? If so, GDPR applies to processing in the context of its activities regardless of where the processing happens (Article 3(1)).",
      "Do you offer goods or services to people in the EU/EEA — including free ones? Shipping there, pricing in euros, or offering an EU-market language version are the usual indicators (Article 3(2)(a)).",
      "Do you monitor the behaviour of people in the EU/EEA? Analytics, ad retargeting, and profiling of EU visitors count (Article 3(2)(b)).",
      "Do you act as a processor for a controller who is in scope? Article 28 duties reach you through their contract even if Article 3 does not reach you directly.",
    ],
    ifInScope:
      "If any of those are yes, you likely need an Article 27 EU representative as well, unless the processing is occasional and low-risk.",
    getAdvice:
      "A privacy solicitor or an experienced DPO settles this in an hour. Do that before building against the answer.",
  };
}

/** Obligations in a given area — for drilling in from an area score. */
export function obligationsInArea(areaId) {
  return GDPR_OBLIGATIONS.filter(o => o.area === areaId);
}
