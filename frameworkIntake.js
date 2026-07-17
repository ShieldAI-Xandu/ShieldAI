// frameworkIntake.js
// Per-framework scoping questionnaires.
//
// WHY THESE EXIST
// ---------------
// Several deep modules already accept scoping options — PCI takes a SAQ type,
// ISO takes a Statement of Applicability, SOC 2 takes trust-services
// categories, CMMC takes a level, HIPAA asks whether you're a clearinghouse,
// FTC asks your consumer count. Those options exist because assessing a
// framework outside a client's real scope produces a wall of irrelevant red.
//
// But nothing collected the answers. `suggestSaq()` has been sitting in
// pciDss.js with no caller, so every PCI assessment ran unscoped: 61
// sub-requirements for a merchant whose hosted payment page makes them
// responsible for about seven. That's not a small difference — knowing you're
// SAQ A rather than SAQ D is worth more to a small merchant than the entire
// gap analysis that follows it.
//
// These questionnaires are the missing input.
//
// DESIGN RULES
// ------------
// 1. FEW QUESTIONS. Each one is asked because an answer materially changes what
//    gets assessed. Nothing here is collected because it's interesting.
//
// 2. SCOPING, NOT EVIDENCE. These questions decide WHICH controls apply. The
//    security checklist decides HOW WELL they're met. Mixing the two is how you
//    end up scoring a business on controls that don't apply to it.
//
// 3. A SUGGESTION IS NOT A DETERMINATION. Where a module can infer scope
//    (PCI's SAQ, CMMC's level), we suggest and say who actually decides — the
//    acquirer, the contracting officer. Being confidently wrong about SAQ type
//    means a merchant attests to the wrong document, which is a contractual
//    problem, not a UX one.
//
// 4. SKIPPABLE. Every framework assesses without its intake, using the module's
//    documented default. The intake makes the assessment sharper; its absence
//    never blocks one. `defaultsFor()` returns what you get if you skip.

import { ISO27001_ANNEX_A } from "./iso27001.js";

export const FRAMEWORK_INTAKE = {
  "pci-dss": {
    frameworkId: "pci-dss",
    title: "PCI DSS scoping",
    why: "Your SAQ type decides how much of PCI DSS you're actually responsible for. A hosted payment page can mean roughly 7 sub-requirements instead of 61 — worth five minutes.",
    questions: [
      {
        id: "isServiceProvider",
        question: "Do you store, process, or transmit cardholder data on behalf of other businesses?",
        help: "Service providers (payment gateways, hosting providers handling card data) have only one option: SAQ D.",
        options: [
          { label: "No — we take payments for our own business", value: false },
          { label: "Yes — we handle card data for other businesses", value: true },
        ],
      },
      {
        id: "channel",
        question: "How do you take payments?",
        options: [
          { label: "Online only (e-commerce)", value: "ecommerce" },
          { label: "In person (card present)", value: "card-present" },
          { label: "Phone or mail order", value: "moto" },
          { label: "A mix of channels", value: "mixed" },
        ],
      },
      {
        id: "ecommerceIntegration",
        question: "How is your online payment page built?",
        help: "This is the single biggest lever on PCI scope. A full redirect to your processor keeps card data off your systems entirely.",
        appliesWhen: { channel: ["ecommerce", "mixed"] },
        options: [
          { label: "Customers are redirected to the processor's page", value: "redirect" },
          { label: "An iframe hosted by the processor", value: "iframe" },
          { label: "Our form posts directly to the processor", value: "direct-post" },
          { label: "A JavaScript form on our page (e.g. Stripe Elements)", value: "js-form" },
          { label: "Our server sends card data to their API", value: "api" },
          { label: "Not sure", value: null },
        ],
      },
      {
        id: "terminalType",
        question: "What card terminals do you use?",
        appliesWhen: { channel: ["card-present", "mixed"] },
        options: [
          { label: "P2PE-validated terminals", value: "p2pe" },
          { label: "Standalone IP terminals", value: "ip-standalone" },
          { label: "Integrated point-of-sale", value: "integrated-pos" },
          { label: "Virtual terminal (browser-based)", value: "virtual-terminal" },
          { label: "Dial-up terminals", value: "dial-up" },
          { label: "Not sure", value: null },
        ],
      },
      {
        id: "storesCardDataElectronically",
        question: "Do you store card numbers electronically anywhere after a transaction?",
        help: "Including spreadsheets, CRM notes, ticketing systems, and call recordings. This one answer can move you to SAQ D on its own.",
        options: [
          { label: "No — we never retain card numbers", value: false },
          { label: "Yes", value: true },
          { label: "Not sure", value: true }, // conservative: unsure -> assume yes
        ],
      },
    ],
    // Maps intake answers onto the module's opts. The suggestion is advisory.
    toOpts(answers = {}) {
      return { paymentProfile: answers, saq: null };
    },
    suggestionNote:
      "We suggest an SAQ from your answers. Your acquiring bank determines which SAQ you must actually file — confirm with them before attesting.",
  },

  "soc2": {
    frameworkId: "soc2",
    title: "SOC 2 scoping",
    why: "SOC 2 has five trust-services categories. Security is mandatory; the rest you choose based on what you promise customers. Assessing categories you'll never include in your report wastes your time.",
    questions: [
      {
        id: "categories",
        type: "multi",
        question: "Which trust-services categories will your report cover?",
        help: "Security is always included — it's the common criteria every SOC 2 rests on. Add others only if you make commitments about them.",
        options: [
          { label: "Security (mandatory — always included)", value: "security", locked: true },
          { label: "Availability — you commit to uptime SLAs", value: "availability" },
        ],
        note: "We currently assess Security and Availability. Confidentiality, Processing Integrity, and Privacy are not yet control-mapped — we won't pretend otherwise by listing them here.",
      },
      {
        id: "reportType",
        question: "Type I or Type II?",
        help: "Type I is a point-in-time design opinion. Type II tests operating effectiveness over a period — typically 3–12 months — and is what most customers actually ask for.",
        options: [
          { label: "Type II — controls tested over a period", value: "type2" },
          { label: "Type I — design at a point in time", value: "type1" },
          { label: "Not sure yet", value: "type2" },
        ],
      },
    ],
    toOpts(answers = {}) {
      const cats = Array.isArray(answers.categories) ? answers.categories : ["security"];
      // Security is force-included regardless. "SOC 2 without Security" isn't
      // a thing, and silently honouring a client's deselection would produce a
      // report that cannot exist.
      const categories = [...new Set(["security", ...cats])];
      return { categories, reportType: answers.reportType || "type2" };
    },
  },

  "iso27001": {
    frameworkId: "iso27001",
    title: "ISO 27001 scoping",
    why: "Annex A is a catalogue, not a checklist. You select controls by risk and justify every exclusion in a Statement of Applicability. Scoring you against all 93 regardless would misrepresent how the standard works.",
    questions: [
      {
        id: "hasSoA",
        question: "Do you have a Statement of Applicability yet?",
        help: "The SoA lists which Annex A controls apply to you and why the rest don't. It's a mandatory certification artifact — an auditor asks for it first.",
        options: [
          { label: "Yes — we have a documented SoA", value: true },
          { label: "No — not yet", value: false },
        ],
      },
      {
        id: "excludePhysical",
        question: "Do you operate any physical premises holding information assets?",
        help: "A fully remote business with no server room can justify excluding much of the Physical controls theme — but the justification must be documented, not assumed.",
        appliesWhen: { hasSoA: [false] },
        options: [
          { label: "Yes — we have offices or server rooms", value: false },
          { label: "No — fully remote, everything is cloud-hosted", value: true },
        ],
      },
      {
        id: "developsSoftware",
        question: "Do you develop your own software?",
        help: "Several Annex A controls cover secure development. If you don't write code, they're excludable — with justification.",
        appliesWhen: { hasSoA: [false] },
        options: [
          { label: "Yes", value: true },
          { label: "No — we only use third-party software", value: false },
        ],
      },
    ],
    toOpts(answers = {}) {
      // ISO expects exclusions keyed by CONTROL ID — { "A.8.28": "reason" } —
      // not by theme. Derive the IDs from the module rather than hardcoding a
      // list that silently rots when the catalogue changes.
      const exclusions = {};

      if (answers.excludePhysical === true) {
        const reason =
          "Fully remote — no premises holding information assets. Must be justified in your Statement of Applicability; an auditor will ask.";
        for (const c of ISO27001_ANNEX_A.filter(c => c.theme === "physical")) {
          exclusions[c.id] = reason;
        }
      }

      if (answers.developsSoftware === false) {
        const reason =
          "No in-house software development. Must be justified in your Statement of Applicability.";
        // The development-lifecycle controls specifically. A.8.4 (access to
        // source code) is deliberately NOT excluded: a business that doesn't
        // write software may still hold a repository from a contractor, and
        // excluding it on this answer alone would be a guess.
        for (const id of ["A.8.25", "A.8.28", "A.8.29", "A.8.30", "A.8.31"]) {
          exclusions[id] = reason;
        }
      }

      return { applicableControls: null, exclusions };
    },
    suggestionNote:
      "Exclusions we infer here are a starting point for your Statement of Applicability, not the SoA itself. Every exclusion needs a documented risk-based justification an auditor will read.",
  },

  "cmmc": {
    frameworkId: "cmmc",
    title: "CMMC scoping",
    why: "Your level is set by what data your contracts involve — FCI puts you at Level 1, CUI at Level 2. The difference is 15 practices versus 110.",
    questions: [
      {
        id: "handlesCui",
        question: "Do your contracts involve Controlled Unclassified Information (CUI)?",
        help: "CUI is marked as such, and DFARS 252.204-7012 will appear in the contract. If you're unsure, your contracting officer knows.",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
          { label: "Not sure", value: null },
        ],
      },
      {
        id: "handlesFci",
        question: "Do you handle Federal Contract Information (FCI)?",
        help: "FCI is any information provided by or generated for the government under a contract that isn't public. Almost every federal contractor has it.",
        appliesWhen: { handlesCui: [false, null] },
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
          { label: "Not sure", value: null },
        ],
      },
      {
        id: "highPriorityProgram",
        question: "Has a contracting officer told you this is a highest-priority programme?",
        help: "Level 3 is assessed by DCMA DIBCAC, not a C3PAO. You do not self-determine this — you're told.",
        appliesWhen: { handlesCui: [true] },
        options: [
          { label: "No", value: false },
          { label: "Yes", value: true },
        ],
      },
    ],
    toOpts(answers = {}) {
      return { level: null, profile: answers };
    },
    suggestionNote:
      "We suggest a level from your answers. Your contract and contracting officer determine the actual requirement — CMMC level is not self-selected.",
  },

  "hipaa-security": {
    frameworkId: "hipaa-security",
    title: "HIPAA scoping",
    why: "One question changes which addressable specifications you can reasonably skip.",
    questions: [
      {
        id: "isClearinghouse",
        question: "Are you a healthcare clearinghouse?",
        help: "Clearinghouses process health information into standard formats for other entities. If you're a provider, plan, or business associate, the answer is no.",
        options: [
          { label: "No — we're a provider, plan, or business associate", value: false },
          { label: "Yes — we're a clearinghouse", value: true },
        ],
      },
    ],
    toOpts(answers = {}) {
      return { isClearinghouse: answers.isClearinghouse === true };
    },
  },

  "ftc-safeguards": {
    frameworkId: "ftc-safeguards",
    title: "FTC Safeguards scoping",
    why: "Under 5,000 consumers, several requirements relax — no written risk assessment, no incident response plan, no board reporting. Worth knowing before you build all three.",
    questions: [
      {
        id: "consumerCount",
        question: "Roughly how many consumers' information do you hold?",
        help: "The § 314.6 exemption threshold is 5,000. Count everyone whose information you maintain, not just active customers.",
        options: [
          { label: "Fewer than 5,000", value: 4999 },
          { label: "5,000 or more", value: 5000 },
          { label: "Not sure", value: null },
        ],
      },
    ],
    toOpts(answers = {}) {
      return { consumerCount: answers.consumerCount ?? null };
    },
    suggestionNote:
      "The exemption is narrower than it sounds — it relaxes specific elements, not the Rule. You still need a security programme and a Qualified Individual.",
  },
};

/** Intake definition for a framework, or null if it needs no scoping. */
export function intakeFor(frameworkId) {
  return FRAMEWORK_INTAKE[frameworkId] || null;
}

/** Frameworks that have a scoping questionnaire. */
export function frameworksWithIntake() {
  return Object.keys(FRAMEWORK_INTAKE);
}

/**
 * Which questions to ask, given answers so far. Honours `appliesWhen` so a
 * card-present merchant is never asked about iframe integrations.
 */
export function visibleQuestions(frameworkId, answers = {}) {
  const intake = intakeFor(frameworkId);
  if (!intake) return [];
  return intake.questions.filter(q => {
    if (!q.appliesWhen) return true;
    return Object.entries(q.appliesWhen).every(([key, allowed]) =>
      allowed.includes(answers[key]));
  });
}

/** Convert intake answers to the opts a deep module expects. */
export function toAssessOpts(frameworkId, answers = {}) {
  const intake = intakeFor(frameworkId);
  if (!intake) return {};
  return intake.toOpts(answers);
}

/**
 * What you get if you skip the intake entirely. Stated explicitly, because a
 * client should know what an unscoped assessment assumed about them.
 */
export function defaultsFor(frameworkId) {
  const defaults = {
    "pci-dss": "Unscoped — all 12 requirements assessed as if you store card data. This is the worst case and probably not you.",
    "soc2": "Security category only, Type II. The most common shape.",
    "iso27001": "All 93 Annex A controls in scope, no exclusions. A real SoA will exclude some.",
    "cmmc": "Level inferred from your assessment; defaults to the broader scope when unclear.",
    "hipaa-security": "Assessed as a provider, plan, or business associate — not a clearinghouse.",
    "ftc-safeguards": "No exemption applied — all nine elements assessed in full.",
  };
  return defaults[frameworkId] || "Assessed with the module's documented defaults.";
}

/** Is this intake complete enough to sharpen the assessment? */
export function intakeStatus(frameworkId, answers = {}) {
  const visible = visibleQuestions(frameworkId, answers);
  if (visible.length === 0) return { applicable: false, complete: true, answered: 0, total: 0 };
  const answered = visible.filter(q => answers[q.id] !== undefined).length;
  return {
    applicable: true,
    complete: answered === visible.length,
    answered,
    total: visible.length,
    missing: visible.filter(q => answers[q.id] === undefined).map(q => q.id),
    defaultIfSkipped: defaultsFor(frameworkId),
  };
}
