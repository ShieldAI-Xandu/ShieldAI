// cmmc.js
// CMMC 2.0 — Cybersecurity Maturity Model Certification.
// Program rule: 32 CFR Part 170. Acquisition rule: 48 CFR (DFARS).
//
// WHAT CMMC ACTUALLY IS
// ---------------------
// CMMC does not invent controls. It is an *assessment and certification
// programme* layered on top of NIST SP 800-171:
//
//   Level 1  — 17 practices protecting Federal Contract Information (FCI).
//              Annual self-assessment with an executive affirmation.
//   Level 2  — the 110 controls of NIST SP 800-171 Rev 2, near enough line for
//              line. Either self-assessed or assessed by a C3PAO every three
//              years, depending on what the contract says.
//   Level 3  — Level 2 plus a subset of NIST SP 800-172 enhanced requirements,
//              assessed by DCMA DIBCAC. For the highest-priority programmes.
//
// So this module is deliberately thin: it wraps nist800171.js rather than
// duplicating 110 controls. Duplication would mean two copies drifting apart,
// and the whole point of building 800-171 first was that CMMC comes almost free.
//
// THE DEADLINE
// ------------
// CMMC Phase 2 begins 10 November 2026. Assessors evaluate Level 2 against
// Rev 2's 110 controls — not Rev 3. See nist800171.js for why that matters.
//
// COPYRIGHT: none. CMMC is a US Government programme; 32 CFR Part 170 is
// federal regulation and public domain.
//
// Sources:
//   CMMC Program Rule — 32 CFR Part 170
//   DoD CMMC — https://dodcio.defense.gov/CMMC/
//   NIST SP 800-172 — https://csrc.nist.gov/pubs/sp/800/172/final

import {
  NIST800171_META,
  NIST800171_CONTROLS,
  NIST800171_FAMILIES,
  assessNist800171,
} from "./nist800171.js";

export const CMMC_META = {
  id: "cmmc",
  name: "CMMC 2.0",
  shortName: "CMMC",
  fullName: "Cybersecurity Maturity Model Certification 2.0",
  authority: "U.S. Department of Defense",
  citation: "32 CFR Part 170 (Program Rule)",
  url: "https://dodcio.defense.gov/CMMC/",
  depth: "control-mapped",
  summary:
    "The DoD's certification programme for defence contractors. It doesn't add new controls — it puts teeth on NIST SP 800-171 by requiring assessment and, at higher levels, third-party certification.",
  whoMustComply:
    "Contractors and subcontractors in the Defense Industrial Base. Which level applies is written into your contract and depends on whether you handle Federal Contract Information (FCI) or Controlled Unclassified Information (CUI).",
  keyPoint:
    "CMMC is an assessment programme, not a control catalogue. Level 2 is NIST SP 800-171 Rev 2's 110 controls. If you've done the 800-171 work, you've done the CMMC work — what remains is evidence, an SSP, and the assessment itself.",
  deadline:
    "Phase 2 begins 10 November 2026. Level 2 assessments are evaluated against Rev 2's 110 controls.",
  revisionNote:
    "CMMC Level 2 references NIST SP 800-171 **Rev 2**, not Rev 3. The CMMC Final Rule states Rev 3 is not currently applicable, and DoD holds a waiver keeping contractors on Rev 2. Rev 3 is expected to arrive through future rulemaking around late 2026–2027 with a transition period.",
};

// ── The three levels ──────────────────────────────────────────
export const CMMC_LEVELS = {
  1: {
    level: 1,
    name: "Level 1 — Foundational",
    protects: "Federal Contract Information (FCI)",
    practiceCount: 17,
    assessment: "Annual self-assessment, with an annual affirmation by a senior company official.",
    basis: "17 practices corresponding to the basic safeguarding requirements of FAR 52.204-21.",
    whoNeedsIt:
      "Contractors handling FCI but not CUI — information provided by or generated for the government under a contract, not intended for public release.",
    // The 17 Level 1 practices map to a subset of 800-171 controls. Listing the
    // mapped 800-171 IDs rather than restating FAR text.
    controls: [
      "3.1.1", "3.1.2", "3.1.20", "3.1.22",
      "3.5.1", "3.5.2",
      "3.8.3",
      "3.10.1", "3.10.3", "3.10.4", "3.10.5",
      "3.13.1", "3.13.5",
      "3.14.1", "3.14.2", "3.14.4", "3.14.5",
    ],
    note: "These 17 are a subset of the 800-171 control set, so a Level 1 contractor is already part-way to Level 2.",
  },
  2: {
    level: 2,
    name: "Level 2 — Advanced",
    protects: "Controlled Unclassified Information (CUI)",
    practiceCount: 110,
    assessment:
      "Self-assessment or C3PAO third-party assessment every three years, depending on what the contract specifies. Most CUI contracts require C3PAO.",
    basis: "The 110 security requirements of NIST SP 800-171 Rev 2, near enough line for line.",
    whoNeedsIt: "Any contractor handling CUI. This is where the bulk of the Defense Industrial Base sits.",
    controls: null, // all 110 — resolved dynamically
    note: "This is the level that matters for most contractors, and it is exactly the 800-171 assessment.",
  },
  3: {
    level: 3,
    name: "Level 3 — Expert",
    protects: "CUI on the highest-priority programmes",
    practiceCount: null,
    assessment: "Government-led assessment by DCMA DIBCAC every three years.",
    basis: "Level 2's 110 requirements plus a selected subset of NIST SP 800-172 enhanced security requirements.",
    whoNeedsIt: "A small number of contractors on the DoD's highest-priority programmes.",
    controls: null,
    note:
      "We assess the Level 2 foundation. The 800-172 enhanced requirements layered on top are not modelled here — they are selected per programme, and guessing at which apply would be worse than saying so.",
    partialCoverage: true,
  },
};

// ── Level determination ───────────────────────────────────────
// Deliberately conservative in the same way as PCI's SAQ logic: when it's
// unclear, we say so rather than guessing low. Under-scoping CMMC means
// discovering at assessment time that you needed more.
export function suggestCmmcLevel({ handlesCui = null, handlesFci = null, highPriorityProgram = false } = {}) {
  if (highPriorityProgram) {
    return { level: 3, confident: false,
      reason: "Highest-priority programmes are Level 3, assessed by DCMA DIBCAC. Your contracting officer confirms this — it is not self-determined." };
  }
  if (handlesCui === true) {
    return { level: 2, confident: true,
      reason: "Handling CUI puts you at Level 2 — the 110 requirements of NIST SP 800-171 Rev 2." };
  }
  if (handlesCui === false && handlesFci === true) {
    return { level: 1, confident: true,
      reason: "FCI but no CUI puts you at Level 1 — 17 practices, annual self-assessment with senior-official affirmation." };
  }
  if (handlesCui === false && handlesFci === false) {
    return { level: 0, confident: false,
      reason: "If you handle neither FCI nor CUI, CMMC may not apply. Confirm with your contracting officer — CUI flows down through subcontracts and is frequently mishandled or unmarked." };
  }
  return { level: 2, confident: false,
    reason: "We don't know whether you handle CUI, so we're showing Level 2 — the level most of the Defense Industrial Base needs. Your contract determines this; ask your contracting officer if it isn't explicit." };
}

// ── Assessment ────────────────────────────────────────────────
/**
 * Wraps the 800-171 assessment rather than duplicating it. Level 1 filters to
 * its 17 practices; Level 2 is the full 110; Level 3 reports Level 2 coverage
 * and is explicit that the 800-172 layer isn't modelled.
 */
export function assessCmmc(checklistAnswers = {}, { level = null, profile = null } = {}) {
  const suggestion = level
    ? { level, confident: true, reason: "Level specified directly." }
    : suggestCmmcLevel(profile || {});
  const lvl = suggestion.level;

  if (lvl === 0) {
    return {
      framework: CMMC_META,
      depth: "control-mapped",
      applicable: false,
      levelSuggestion: suggestion,
      note: "CMMC may not apply to you. Confirm with your contracting officer before concluding that — CUI flows down through subcontracts and is frequently unmarked.",
      disclaimer: "Scope determination is contractual. This is not advice about what your contract requires.",
    };
  }

  const spec = CMMC_LEVELS[lvl];
  const base = assessNist800171(checklistAnswers);

  // Level 1 assesses only its 17 practices.
  const scopeIds = lvl === 1 ? new Set(spec.controls) : null;
  const families = base.families
    .map(f => {
      const controls = scopeIds ? f.controls.filter(c => scopeIds.has(c.id)) : f.controls;
      if (!controls.length) return null;
      const scored = controls.filter(c => c.status !== "unknown");
      const avg = scored.length ? Math.round(scored.reduce((a, c) => a + c.score, 0) / scored.length) : null;
      return { ...f, controls, assessed: scored.length,
        met: scored.filter(c => c.status === "met").length, score: avg };
    })
    .filter(Boolean);

  const all = families.flatMap(f => f.controls);
  const scored = all.filter(c => c.status !== "unknown");
  const met = scored.filter(c => c.status === "met");
  const gaps = scored.filter(c => c.status === "gap");

  return {
    framework: CMMC_META,
    depth: "control-mapped",
    applicable: true,
    level: {
      ...spec,
      practiceCount: lvl === 1 ? spec.controls.length : NIST800171_CONTROLS.length,
      confident: suggestion.confident,
      reason: suggestion.reason,
    },
    levelSuggestion: suggestion,
    families,
    summary: {
      inScope: all.length,
      assessed: scored.length,
      met: met.length,
      partial: scored.filter(c => c.status === "partial").length,
      gaps: gaps.length,
      unknown: all.length - scored.length,
      coveragePct: scored.length ? Math.round((met.length / scored.length) * 100) : null,
    },
    topGaps: gaps.slice(0, 5).map(g => ({ id: g.id, family: g.family, covers: g.covers })),

    // Reuse the 800-171 module's honesty rather than restating it.
    sprs: base.sprs,
    requiredArtifacts: base.requiredArtifacts,

    level3Note: lvl === 3
      ? "We assess the Level 2 foundation (the 110 requirements of 800-171 Rev 2). The NIST SP 800-172 enhanced requirements that Level 3 adds are selected per programme and are not modelled here — your DCMA DIBCAC assessment covers them."
      : null,

    basisNote: `CMMC Level ${lvl} is built on ${NIST800171_META.fullName}. We assess against those requirements — CMMC adds the assessment and certification regime, not new controls.`,
    revisionNote: CMMC_META.revisionNote,
    deadlineNote: CMMC_META.deadline,
    assessmentNote: spec.assessment,

    methodology:
      "Requirements are assessed from your assessment answers using a fixed mapping to NIST SP 800-171 Rev 2 — not by an AI's interpretation. Requirements with no corresponding assessment question are reported as 'not yet assessed' rather than assumed implemented.",
    disclaimer:
      "This is a gap analysis, not a CMMC assessment and not a certification. Certification at Level 2 generally requires a C3PAO; Level 3 is assessed by DCMA DIBCAC. Your contract determines your level — confirm with your contracting officer.",
  };
}

/** The 17 Level 1 practices, resolved to their 800-171 control detail. */
export function level1Practices() {
  const ids = new Set(CMMC_LEVELS[1].controls);
  return NIST800171_CONTROLS.filter(c => ids.has(c.id));
}
