// statePrivacy.js
// US State Consumer Privacy Laws — CCPA/CPRA and the state-by-state patchwork.
//
// WHY THIS FILE IS SHAPED DIFFERENTLY FROM EVERY OTHER FRAMEWORK
// ---------------------------------------------------------------
// Every other framework we ship has a fixed control list. ISO has 93 Annex A
// controls; 800-171 has 110 requirements; 800-53 Low has 149. Enumerate them
// once, cite them, done.
//
// This is not that. Two problems make it structurally different:
//
// 1. IT IS NOT ONE FRAMEWORK. It is ~20 statutes that mostly rhyme. They share
//    a template (notice, rights, opt-out, contracts, minimisation, assessments)
//    but differ on thresholds, on whether a cure period exists, on universal
//    opt-out signals, and on what counts as "sensitive". There is no canonical
//    control list to enumerate because there is no canonical law.
//
// 2. THE ROSTER CHANGES EVERY LEGISLATIVE SESSION. Three laws took effect on
//    1 January 2026 alone. Published sources actively disagree on the count
//    right now — 19, 20, 23, and 24 all appear in reputable trackers within
//    the same few months — because they variously count "in effect" vs
//    "enacted but not yet effective", and disagree on whether Florida's
//    narrower Digital Bill of Rights belongs in the list.
//
// So we do NOT hardcode a state count and present it as fact. We do two things:
//
//   THE OBLIGATIONS are the assessed part. Those are stable — the template has
//   barely moved since Virginia in 2021, and a business that can honour a
//   deletion request and post an accurate notice is in decent shape in every
//   state that has a law. That is what we score.
//
//   THE ROSTER is reference data with an explicit `asOf` date and a pointer to
//   the IAPP tracker, which is the resource that is actually maintained. We
//   state plainly that it goes stale. A stale list presented as current is the
//   kind of fabricated certainty this product exists to avoid — and here it
//   would be worse than useless, because applicability is a legal question with
//   fines attached.
//
// WHAT THIS IS NOT
// ----------------
// Not legal advice, and the gap between "security control" and "legal
// obligation" is real. We can tell a business it has no process for honouring
// deletion requests. We cannot tell it whether the Rhode Island law applies to
// it — that depends on resident counts, revenue, and data-sale volumes that no
// security assessment asks about, and getting it wrong has a dollar cost.
// Applicability output is a PROMPT TO GET ADVICE, never a determination.
//
// COPYRIGHT: none. US state statutes are public domain (Banks v. Manchester).
// Section citations and our own descriptions.
//
// Sources:
//   CCPA/CPRA        — Cal. Civ. Code § 1798.100 et seq.
//   CPPA regulations — Cal. Code Regs. tit. 11, § 7000 et seq.
//   IAPP tracker     — https://iapp.org/resources/article/us-state-privacy-legislation-tracker/

export const STATE_PRIVACY_META = {
  id: "state-privacy",
  name: "State Privacy Laws",
  shortName: "State Privacy",
  fullName: "US State Consumer Privacy Laws (CCPA/CPRA and the state patchwork)",
  authority: "State legislatures and attorneys general; the California Privacy Protection Agency (CPPA) in California",
  version: "Common-obligation model — roster current as of July 2026",
  url: "https://iapp.org/resources/article/us-state-privacy-legislation-tracker/",
  depth: "control-mapped",
  summary:
    "Roughly twenty states now have comprehensive consumer privacy laws, and they mostly rhyme. We assess the obligations they share — notice, consumer rights, opt-out, vendor contracts, data minimisation — rather than pretending a single national standard exists.",
  whoMustComply:
    "Businesses meeting a state's applicability threshold — typically 100,000 residents' personal data, or a lower bar plus revenue from selling data. Thresholds vary: Texas has no revenue threshold at all, Rhode Island's is notably low. Increasingly this reaches ordinary SMBs, particularly e-commerce and anyone running ad tech.",
  enforcement:
    "State attorneys general, plus the CPPA in California. Penalties are per-violation and now routinely reach seven figures; several states have eliminated the cure period that once made a first mistake fixable. California's CCPA carries a limited private right of action for breaches caused by inadequate security.",
  volatilityNote:
    "This landscape moves every legislative session. Three new laws took effect on 1 January 2026, and reputable trackers currently disagree on the total — depending on whether you count laws in effect or merely enacted, and whether Florida's narrower statute qualifies. Treat our roster as a dated snapshot and verify against the IAPP tracker before relying on it.",
  scopeNote:
    "Comprehensive consumer privacy statutes only. Sector-specific laws (Washington's My Health My Data, Illinois's BIPA for biometrics, state breach-notification statutes) are separate obligations we do not assess here.",
  publicDomain: true,
};

// ── The roster — reference data, explicitly dated ─────────────
// NOT scored. NOT used to determine applicability. This exists so the product
// can answer "which states have laws?" without inventing an answer, and so the
// UI can show the client how fast this is moving.
export const STATE_ROSTER = {
  asOf: "2026-07",
  inEffectApprox: 20,
  countIsContested: true,
  countNote:
    "Published trackers report 19, 20, 23, and 24 within the same few months of 2026. The disagreement is real and definitional, not sloppiness: some count only laws currently in force, others include enacted-but-not-yet-effective laws, and they split on whether Florida's Digital Bill of Rights — which has a much narrower scope — belongs in a comprehensive-law list. We say 'roughly twenty in effect' and point at the tracker rather than pick a number to sound authoritative.",
  authoritativeSource: "https://iapp.org/resources/article/us-state-privacy-legislation-tracker/",
  sourceNote:
    "The IAPP US State Privacy Legislation Tracker is the resource privacy teams actually use, and it is maintained. Ours is not — check theirs before making a decision.",
  notableVariations: [
    { state: "California", why: "CCPA/CPRA is the strictest and the only one with even a limited private right of action. Enforced by a dedicated agency (the CPPA), not just the AG." },
    { state: "Texas", why: "No revenue threshold — applicability turns on processing/selling personal data, not company size. Catches businesses that assume they're too small." },
    { state: "Maryland", why: "Among the strictest on data minimisation; bans the sale of sensitive personal information outright." },
    { state: "Rhode Island", why: "Notably low applicability threshold — effective 1 January 2026." },
    { state: "Utah", why: "Generally regarded as the lightest-touch of the comprehensive laws." },
    { state: "Florida", why: "Digital Bill of Rights is much narrower than the others, which is why the national count is disputed." },
  ],
  trend:
    "No new comprehensive laws were enacted in 2025, but laws passed earlier keep coming into force, and 2026 has seen fresh legislative activity. The federal preemption that would end the patchwork (the American Privacy Rights Act) expired without a vote.",
};

// ── The obligations we actually assess ────────────────────────
// These are the common denominators across the state template. A business that
// satisfies these is in reasonable shape in most states with a law — which is
// a genuinely useful thing to know, and is as far as an honest assessment can
// go without state-specific legal analysis.
//
// `evidence` maps to the Privacy section of securityChecklist.js, plus general
// security questions where a law explicitly requires security (every one of
// them does — "reasonable security" is a universal element).
export const STATE_PRIVACY_OBLIGATIONS = [
  {
    id: "SP-1",
    area: "Transparency",
    name: "Privacy notice",
    covers:
      "Publish a notice stating what personal information you collect, the purposes, whether you sell or share it, and how consumers exercise their rights. Every state law requires this; it is the cheapest obligation to meet and the most commonly cited in enforcement.",
    citation: "Cal. Civ. Code § 1798.130(a)(5); analogous provisions in each state statute",
    evidence: ["privacyNotice"],
  },
  {
    id: "SP-2",
    area: "Transparency",
    name: "Notice at collection",
    covers:
      "Tell consumers what you're collecting at or before the point of collection — not only in a policy they never open. California is explicit; most states imply it through the notice requirement.",
    citation: "Cal. Civ. Code § 1798.100(a)",
    evidence: ["privacyNotice", "personalDataCategories"],
  },
  {
    id: "SP-3",
    area: "Consumer rights",
    name: "Right to know / access",
    covers:
      "On a verified request, tell the consumer what you hold about them, where it came from, why you have it, and who you disclosed it to. Response deadlines cluster at 45 days with a permitted extension.",
    citation: "Cal. Civ. Code §§ 1798.100, 1798.110",
    evidence: ["consumerRights", "dataInventory"],
  },
  {
    id: "SP-4",
    area: "Consumer rights",
    name: "Right to delete",
    covers:
      "Delete personal information on verified request, subject to enumerated exceptions, and pass the request on to your service providers. The operational trap is the second half — most businesses can delete their own copy and have no mechanism to tell vendors to do the same.",
    citation: "Cal. Civ. Code § 1798.105",
    evidence: ["consumerRights", "dataInventory", "vendorInventory"],
  },
  {
    id: "SP-5",
    area: "Consumer rights",
    name: "Right to correct",
    covers:
      "Correct inaccurate personal information on request. Added by CPRA and near-universal in the newer state laws.",
    citation: "Cal. Civ. Code § 1798.106",
    evidence: ["consumerRights"],
  },
  {
    id: "SP-6",
    area: "Consumer rights",
    name: "Right to opt out of sale/sharing",
    covers:
      "Let consumers stop the sale or sharing of their data, and stop targeted advertising. 'Sale' is defined far more broadly than money changing hands — running standard ad-tech or analytics tags usually qualifies, which is what catches businesses that are certain they don't sell data.",
    citation: "Cal. Civ. Code § 1798.120",
    evidence: ["dataSaleSharing"],
  },
  {
    id: "SP-7",
    area: "Consumer rights",
    name: "Universal opt-out mechanism (GPC)",
    covers:
      "Honour browser-level opt-out signals such as Global Privacy Control automatically. Required in roughly a dozen states and a current focus of coordinated enforcement — because it's machine-testable, regulators can check it at scale without opening an investigation.",
    citation: "Cal. Code Regs. tit. 11, § 7025",
    evidence: ["dataSaleSharing"],
  },
  {
    id: "SP-8",
    area: "Consumer rights",
    name: "Non-discrimination",
    covers:
      "Don't penalise consumers for exercising rights — no degraded service or worse pricing, except where a difference is reasonably related to the data's value in a disclosed loyalty programme.",
    citation: "Cal. Civ. Code § 1798.125",
    evidence: ["consumerRights"],
  },
  {
    id: "SP-9",
    area: "Operations",
    name: "Verified request handling",
    covers:
      "Verify who is asking before you act, respond within the statutory deadline, and keep a record of what you did. Two designated intake methods in California. Missing a deadline is an independent violation regardless of whether you would have granted the request.",
    citation: "Cal. Civ. Code § 1798.130; Cal. Code Regs. tit. 11, §§ 7060–7063",
    evidence: ["consumerRights", "privacyRequestVolume"],
  },
  {
    id: "SP-10",
    area: "Operations",
    name: "Request metrics and records",
    covers:
      "Keep records of requests received and how they were resolved. Businesses over the California volume threshold must publish these metrics annually. Even below it, the record is your evidence of compliance.",
    citation: "Cal. Code Regs. tit. 11, § 7102",
    evidence: ["privacyRequestVolume"],
  },
  {
    id: "SP-11",
    area: "Data governance",
    name: "Data minimisation and purpose limitation",
    covers:
      "Collect only what is reasonably necessary for the disclosed purpose, and don't repurpose it later without notice. Maryland is the strict outlier; the direction of travel across all states is toward tighter minimisation.",
    citation: "Cal. Civ. Code § 1798.100(c)",
    evidence: ["personalDataCategories", "dataInventory"],
  },
  {
    id: "SP-12",
    area: "Data governance",
    name: "Retention limits and disclosure",
    covers:
      "Don't keep personal information longer than necessary, and disclose your retention period — or the criteria for it — in your notice. 'We keep everything forever' is not a retention policy, and saying nothing is itself a violation in California.",
    citation: "Cal. Civ. Code § 1798.100(a)(3)",
    evidence: ["dataRetention", "privacyNotice"],
  },
  {
    id: "SP-13",
    area: "Data governance",
    name: "Sensitive data limits",
    covers:
      "Sensitive categories — health, precise geolocation, biometrics, government ID, race, religion — carry extra duties: opt-in consent in some states, a right to limit use in California, an outright sale ban in Maryland.",
    citation: "Cal. Civ. Code § 1798.121",
    evidence: ["personalDataCategories", "dataSaleSharing"],
  },
  {
    id: "SP-14",
    area: "Data governance",
    name: "Reasonable security",
    covers:
      "Implement security proportionate to the data. Universal across the state laws, and the hinge for liability: California's private right of action attaches to breaches caused by a failure of reasonable security, which is how a privacy law becomes a security problem.",
    citation: "Cal. Civ. Code § 1798.150(a)(1)",
    evidence: ["mfa", "encryptionAtRest", "encryptionInTransit", "endpoint", "monitoring"],
  },
  {
    id: "SP-15",
    area: "Third parties",
    name: "Service provider contracts",
    covers:
      "Every vendor touching personal information needs contract terms limiting their use of it. Without them, a disclosure to that vendor may legally be a 'sale' — triggering opt-out duties you didn't know you had. This is the single most common structural gap.",
    citation: "Cal. Civ. Code § 1798.100(d); Cal. Code Regs. tit. 11, § 7051",
    evidence: ["vendorContracts", "vendorInventory"],
  },
  {
    id: "SP-16",
    area: "Third parties",
    name: "Vendor oversight",
    covers:
      "Know who your vendors are, what they hold, and be able to pass deletion and opt-out requests through to them. You remain responsible for their handling of data you gave them.",
    citation: "Cal. Code Regs. tit. 11, § 7051(c)",
    evidence: ["vendorInventory", "vendorDueDiligence"],
  },
  {
    id: "SP-17",
    area: "Accountability",
    name: "Data protection assessments",
    covers:
      "Document a risk assessment before high-risk processing — selling data, targeted advertising, sensitive data, profiling with legal effects. Required in most non-California states; California's regulations impose an analogous risk-assessment duty. Must be produced to the AG on demand.",
    citation: "Va. Code § 59.1-580; Colo. Rev. Stat. § 6-1-1309; analogous provisions elsewhere",
    evidence: ["riskAssessmentCadence", "dataInventory"],
  },
  {
    id: "SP-18",
    area: "Accountability",
    name: "Accountable owner and training",
    covers:
      "Someone must own privacy compliance, and staff handling requests must know how to recognise and route one. Rarely a named statutory element, universally the reason programmes fail — a request that dies in a shared inbox is a missed deadline.",
    citation: "Cal. Code Regs. tit. 11, § 7100 (records); general accountability principles",
    evidence: ["securityOwnership", "training", "documentedPolicies"],
  },
];

export const STATE_PRIVACY_AREAS = [
  { id: "Transparency", name: "Transparency", why: "What you tell consumers, and when." },
  { id: "Consumer rights", name: "Consumer rights", why: "What consumers can ask you to do, and your duty to comply." },
  { id: "Operations", name: "Operations", why: "The machinery that makes rights real — intake, verification, deadlines, records." },
  { id: "Data governance", name: "Data governance", why: "What you collect, how long you hold it, and how well you protect it." },
  { id: "Third parties", name: "Third parties", why: "Vendors, service providers, and the contracts that keep a disclosure from becoming a sale." },
  { id: "Accountability", name: "Accountability", why: "Assessments, ownership, and the evidence you'd show a regulator." },
];

// ── Applicability — a prompt to get advice, never a determination ──
// This deliberately does not return "yes, CCPA applies to you". Applicability
// turns on resident counts, revenue, and data-sale volume by state — none of
// which our assessment asks, and all of which carry a fine if you get them
// wrong. The honest output is: here's what would make you in scope, go find out.
export function applicabilityPrompt(evidence = {}) {
  const cats = evidence.personalDataCategories;
  const sells = evidence.dataSaleSharing;

  const noConsumerData = cats && cats.score === 0;
  const sensitive = cats && cats.score >= 100;
  const sellsOrUnsure = sells && sells.score <= 25;

  return {
    determined: false,
    why:
      "We do not determine whether a state privacy law applies to you, because that turns on facts a security assessment doesn't collect: how many residents of each state you hold data on, your annual revenue, and what share of it comes from selling personal information. Those thresholds differ by state — Texas has no revenue threshold at all — and being wrong about them is expensive.",
    signals: [
      noConsumerData
        ? { level: "low", note: "You indicated you hold no consumer personal data. If that's accurate and you're strictly B2B, these laws may not reach you — but note that several states treat some B2B contact data and employee data as in scope, and California explicitly does." }
        : { level: "check", note: "You collect consumer personal information, which is the threshold question. Whether you cross a specific state's bar depends on volume and revenue." },
      sensitive
        ? { level: "elevated", note: "You indicated sensitive categories — health, biometric, precise geolocation, or government ID. These carry heightened duties in every state that has a law, and lower thresholds in several. This is the profile most likely to be in scope and least likely to know it." }
        : null,
      sellsOrUnsure
        ? { level: "elevated", note: "You sell or share personal data, or run ad tech without having verified what it does. 'Sale' is defined broadly enough that standard advertising and analytics tags usually qualify. This is the most common way a business is in scope while believing it isn't." }
        : null,
    ].filter(Boolean),
    whatToDo:
      "Count the residents whose data you hold, by state. Check your revenue against each state's threshold. Audit what your advertising and analytics tools actually transmit. Then take that to counsel — this is a legal determination, not a security finding.",
    tracker: STATE_ROSTER.authoritativeSource,
  };
}

// ── Assessment ────────────────────────────────────────────────
const STATUS = { MET: "met", PARTIAL: "partial", GAP: "gap", UNKNOWN: "unknown" };

function scoreObligation(o, answers) {
  const scores = (o.evidence || [])
    .map(id => answers[id]?.score)
    .filter(s => typeof s === "number");
  if (scores.length === 0) return { ...o, status: STATUS.UNKNOWN, score: null };
  const s = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return { ...o, score: s, status: s >= 80 ? STATUS.MET : s >= 45 ? STATUS.PARTIAL : STATUS.GAP };
}

export function assessStatePrivacy(checklistAnswers = {}) {
  // A business holding no consumer data isn't "compliant" — the questions are
  // largely moot. Saying "100% met" there would be a lie in the flattering
  // direction, which is the worst kind.
  const noConsumerData = checklistAnswers.personalDataCategories?.score === 0;

  const areas = STATE_PRIVACY_AREAS.map(a => {
    const obligations = STATE_PRIVACY_OBLIGATIONS
      .filter(o => o.area === a.id)
      .map(o => scoreObligation(o, checklistAnswers));
    const scored = obligations.filter(o => o.status !== STATUS.UNKNOWN);
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
  const scored = all.filter(o => o.status !== STATUS.UNKNOWN);
  const gaps = scored.filter(o => o.status === STATUS.GAP);
  const met = scored.filter(o => o.status === STATUS.MET);

  return {
    framework: STATE_PRIVACY_META,
    depth: "control-mapped",
    model: "common-obligation",
    modelNote:
      "We assess the obligations the state laws share, not any single state's statute. Roughly twenty states have comprehensive laws and they follow a common template — so a business that meets these is in reasonable shape in most of them. Where a state diverges sharply (California's private right of action, Maryland's minimisation, Texas's missing revenue threshold), we flag it rather than average it away.",
    volatilityNote: STATE_PRIVACY_META.volatilityNote,
    scopeNote: STATE_PRIVACY_META.scopeNote,
    roster: STATE_ROSTER,
    applicability: applicabilityPrompt(checklistAnswers),
    noConsumerData,
    noConsumerDataNote: noConsumerData
      ? "You indicated you hold no consumer personal information. We're not scoring these obligations, because a percentage would imply we'd decided they apply to you — and applicability is a legal question we don't answer. Two cautions: several states treat some B2B contact data as in scope, and California explicitly covers employee data. If either could describe you, take it to counsel rather than relying on this."
      : null,
    areas,
    summary: {
      total: STATE_PRIVACY_OBLIGATIONS.length,
      areas: STATE_PRIVACY_AREAS.length,
      assessed: scored.length,
      met: met.length,
      partial: scored.filter(o => o.status === STATUS.PARTIAL).length,
      gaps: gaps.length,
      unknown: all.length - scored.length,
      // A business holding no consumer data reports null, not 0%.
      //
      // We already set noConsumerData and refuse to determine applicability —
      // but then scored them 0% with 18 gaps anyway, which is the same lie in
      // the other direction. "You fail 18 privacy obligations" is a claim; the
      // truth is that these obligations may not reach them at all, and we say
      // elsewhere that we can't decide that. A B2B manufacturer opening this
      // report should see "not applicable — verify with counsel", not a wall of
      // red for consumer rights they'll never receive a request about.
      coveragePct: noConsumerData ? null : (scored.length ? Math.round((met.length / scored.length) * 100) : null),
    },
    topGaps: gaps.slice(0, 5).map(g => ({ id: g.id, area: g.area, name: g.name, covers: g.covers })),
    weakestAreas: areas
      .filter(a => a.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map(a => ({ id: a.id, name: a.name, score: a.score })),

    methodology:
      "Eighteen obligations common to the US state consumer privacy laws, each mapped to your assessment answers by a fixed rule and computed — not written by an AI. Obligations with no answering evidence report 'not yet assessed' rather than being assumed met.",
    disclaimer:
      "This is a gap analysis against the common obligations of US state consumer privacy laws. It is not legal advice, not a determination that any particular law applies to you, and not a substitute for counsel. Privacy compliance is a legal question with statutory penalties; the state roster here is a dated snapshot and the landscape changes every legislative session.",
    legalReviewRequired: true,
  };
}

export function obligationsInArea(areaId) {
  return STATE_PRIVACY_OBLIGATIONS.filter(o => o.area === areaId);
}
