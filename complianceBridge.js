// complianceBridge.js
// Makes the deep framework registry drive the live compliance workspace.
//
// THE SITUATION THIS FIXES
// ------------------------
// We had two compliance systems that did not know about each other.
//
//   complianceFrameworks.js  — 6 frameworks, ~10 hand-written requirements
//                              each. WIRED INTO THE PRODUCT. This is what
//                              clients actually saw.
//
//   frameworks.js + 11 deep  — PCI's 61 in-scope sub-requirements, ISO's 93
//   modules                    Annex A controls, 800-171's 110, 800-53's 149,
//                              each cited and control-mapped. IMPORTED BY
//                              NOTHING. Not one route called assessSelected().
//
// So the product shipped a 10-requirement view of ISO 27001 while a 93-control
// implementation sat in the repo unreferenced. The marketing claim was true of
// the codebase and false of the running app — which is the one direction that
// matters, and exactly the kind of thing technical diligence surfaces fast.
//
// HOW THE MERGE WORKS
// -------------------
// This module keeps the legacy function signatures byte-for-byte, so
// complianceRoutes.js and App.jsx don't change, and delegates the actual
// assessment to the deep modules. The old 6 frameworks become views onto real
// control-mapped assessments instead of parallel shallow copies.
//
// Each deep module groups its controls differently — HIPAA has `groups`, SOC 2
// has `categories`, ISO has `themes`, PCI has `requirements`, CMMC/800-171/
// 800-53 have `families`, State Privacy has `areas`. normaliseGroups() flattens
// all of them to the { section, requirements[] } shape the UI already renders.
//
// WHAT CHANGES FOR A CLIENT
// -------------------------
// Their ISO report goes from 10 requirements to 93 controls, all cited, all
// traceable to the answer that produced them. Their PCI report gets SAQ scoping.
// Their CMMC report inherits 800-171 Rev 2 properly. Nothing they answered is
// lost — the same checklist feeds both.
//
// ID MAPPING
// ----------
// Two legacy ids differ from the registry: hipaa -> hipaa-security, and
// iso-27001 -> iso27001. LEGACY_ID_MAP handles both directions so old
// bookmarks, stored records, and client-side calls keep working.

import {
  FRAMEWORKS as REGISTRY, getFramework, isControlMapped, DEPTH,
} from "./frameworks.js";
import { SECURITY_CHECKLIST, toEvidence } from "./securityChecklist.js";
import { corroborate, corroborationSummary } from "./agentEvidence.js";

export const STATUS = {
  COMPLIANT: "compliant",
  PARTIAL: "partial",
  GAP: "gap",
  UNKNOWN: "unknown",
};

// Legacy id -> registry id. Anything absent maps to itself.
export const LEGACY_ID_MAP = {
  "hipaa": "hipaa-security",
  "iso-27001": "iso27001",
};
const REVERSE_ID_MAP = Object.fromEntries(Object.entries(LEGACY_ID_MAP).map(([k, v]) => [v, k]));

export const toRegistryId = id => LEGACY_ID_MAP[id] || id;
export const toLegacyId = id => REVERSE_ID_MAP[id] || id;

// Deep modules report met/partial/gap/unknown; the legacy UI expects
// compliant/partial/gap/unknown. Same semantics, different word.
const STATUS_FROM_DEEP = {
  met: STATUS.COMPLIANT,
  partial: STATUS.PARTIAL,
  gap: STATUS.GAP,
  unknown: STATUS.UNKNOWN,
};

/**
 * Every deep module groups its controls, but each calls the grouping something
 * different. Flatten to a common shape without losing the module's own naming —
 * an ISO "theme" and a CMMC "family" are not the same idea and the UI should
 * still be able to say which it is.
 */
function normaliseGroups(result) {
  const candidates = [
    ["themes", "theme"], ["families", "family"], ["groups", "group"],
    ["categories", "category"], ["requirements", "requirement"], ["areas", "area"],
    // FTC Safeguards has no grouping layer — its nine elements are the controls.
    // Wrap them in a synthetic group so the shape stays uniform downstream.
    ["elements", "element"],
  ];
  for (const [key, noun] of candidates) {
    const arr = result?.[key];
    if (Array.isArray(arr) && arr.length && typeof arr[0] === "object") {
      return { key, noun, groups: arr };
    }
  }
  return { key: null, noun: "group", groups: [] };
}

/**
 * The per-control array inside a group, whatever the module calls it.
 *
 * Depth varies by module and there is no way around enumerating it:
 *   HIPAA  group.standards[].specifications[]   (two levels)
 *   SOC 2  category.series[].criteria[]         (two levels)
 *   PCI    requirement.subs[]                   (one level)
 *   ISO    theme.controls[]                     (one level)
 *   FTC    element itself IS the control        (zero levels)
 *
 * Returns a flat control list for any of them.
 */
function controlsOf(group) {
  // One level down.
  for (const k of ["controls", "criteria", "specifications", "subRequirements", "subs", "obligations", "practices", "requirements"]) {
    if (Array.isArray(group?.[k])) return group[k];
  }
  // Two levels down — an intermediate grouping (HIPAA standards, SOC 2 series).
  for (const k of ["standards", "series"]) {
    if (Array.isArray(group?.[k])) {
      const out = [];
      for (const inner of group[k]) {
        for (const ik of ["specifications", "specs", "criteria", "controls", "subs"]) {
          if (Array.isArray(inner?.[ik])) out.push(...inner[ik]);
        }
      }
      if (out.length) return out;
    }
  }
  // The group IS the control (FTC's nine elements).
  if (group?.id && (group.status || group.evidenceFrom || group.evidence)) return [group];
  return [];
}

/** A deep control -> the legacy requirement shape the UI renders. */
function toRequirement(c, group, checklist) {
  // Field naming isn't uniform across modules: FTC uses `evidenceFrom`, PCI
  // sub-requirements use `number` rather than `id`. Normalise rather than
  // forcing eight modules to change and risking their tests.
  const evidenceIds = c.evidence || c.evidenceFrom || [];
  const controlId = c.id || c.number || c.ref || "";

  const controls = evidenceIds.map(cid => {
    const q = SECURITY_CHECKLIST.find(x => x.id === cid);
    const raw = checklist[cid];
    const label = typeof raw === "string" ? raw : raw?.label ?? null;
    const opt = q?.options.find(o => o.label === label);
    const score = opt ? opt.score : null;
    const best = q ? [...q.options].sort((a, b) => b.score - a.score)[0] : null;
    return {
      controlId: cid,
      question: q?.question || cid,
      nistFunction: q?.nistFunction || null,
      answer: label,
      score,
      answered: score !== null,
      meets: score !== null && score >= 80,
      bestAnswer: best?.label || null,
      options: q?.options || [],
    };
  });

  return {
    id: controlId,
    name: c.title || c.name || c.summary || c.covers?.slice(0, 60) || controlId,
    section: group.name || group.id || "General",
    text: c.covers || c.summary || c.title || c.name || "",
    // Deep modules use an 80/45 threshold internally; surfaced so the UI can
    // explain why something is partial rather than just colouring it amber.
    minScore: 80,
    status: STATUS_FROM_DEEP[c.status] || STATUS.UNKNOWN,
    score: typeof c.score === "number" ? c.score : 0,
    controls,
    failingControls: controls.filter(c2 => !c2.meets).map(c2 => c2.controlId),
    citation: c.citation || null,
    required: c.required ?? null,
  };
}

/** Registry entries a client can select, in the legacy list shape. */
export function listFrameworkIds() {
  return REGISTRY.filter(f => f.depth !== DEPTH.PLANNED).map(f => toLegacyId(f.id));
}

export function getFrameworkDef(id) {
  const f = getFramework(toRegistryId(id));
  if (!f) return null;
  return {
    id: toLegacyId(f.id),
    name: f.fullName || f.name,
    short: f.name,
    description: f.desc,
    depth: f.depth,
    audience: f.audience,
    citation: f.citation || null,
    url: f.url || null,
    note: f.note || null,
    legalReviewRequired: f.legalReviewRequired || false,
  };
}

/**
 * Full framework report. Same signature and output shape as the legacy
 * evaluateFramework(), now computed by the deep module.
 *
 * `opts` passes through module-specific scoping — PCI's SAQ, ISO's Statement of
 * Applicability, SOC 2's categories, CMMC's level. Those exist precisely so the
 * assessment reflects the client's real scope rather than a generic wall of
 * controls, and the old path had no way to express them.
 */
export function evaluateFramework(frameworkId, checklist = {}, opts = {}) {
  const rid = toRegistryId(frameworkId);
  const f = getFramework(rid);
  if (!f) return null;

  const def = getFrameworkDef(frameworkId);

  // Not control-mapped (GDPR, or NIST CSF / CIS which score elsewhere):
  // report honestly rather than fabricating a control walkthrough.
  if (!isControlMapped(rid)) {
    return {
      framework: def,
      depth: f.depth,
      summary: {
        total: 0, compliant: 0, partial: 0, gap: 0, unknown: 0, assessed: 0,
        compliancePct: null, readinessPct: null,
      },
      sectionNames: [],
      requirements: [],
      notControlMapped: true,
      why: f.depth === DEPTH.AI_ASSISTED
        ? "This framework has an AI-assisted gap analysis rather than a control-level assessment. It's useful for orientation, but it is the model's interpretation — we won't dress it up as a computed control walkthrough."
        : "This framework is scored through the posture engine rather than a control-by-control walkthrough.",
    };
  }

  const evidence = toEvidence(checklist);
  const result = f.assess(evidence, opts);
  const { noun, groups } = normaliseGroups(result);

  const requirements = [];
  const excluded = [];
  for (const g of groups) {
    for (const c of controlsOf(g)) {
      // Modules mark out-of-scope controls rather than dropping them: ISO
      // flags SoA exclusions, PCI flags sub-requirements outside your SAQ.
      // Counting those as requirements would defeat the entire point of
      // scoping — a remote company would still see 14 physical-security
      // controls it has already justified excluding.
      //
      // They're kept in a separate list because an auditor WILL ask what you
      // excluded and why. Dropping them silently would lose the justification.
      const isExcluded = c.excluded === true || c.inScope === false || c.applicable === false || c.status === "excluded";
      if (isExcluded) {
        excluded.push({
          id: c.id || c.number,
          name: c.title || c.name || "",
          section: g.name || g.id || "General",
          reason: c.exclusionReason || c.scopeReason || c.note || "Out of scope for your profile.",
        });
        continue;
      }
      requirements.push(toRequirement(c, g, checklist));
    }
  }

  const counts = requirements.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
  const total = requirements.length;
  const compliant = counts[STATUS.COMPLIANT] || 0;
  const partial = counts[STATUS.PARTIAL] || 0;
  const assessed = total - (counts[STATUS.UNKNOWN] || 0);

  const sections = {};
  for (const r of requirements) (sections[r.section] ||= []).push(r);

  return {
    framework: def,
    depth: f.depth,
    groupedBy: noun,
    summary: {
      total,
      compliant,
      partial,
      gap: counts[STATUS.GAP] || 0,
      unknown: counts[STATUS.UNKNOWN] || 0,
      assessed,
      // Percentages are over ASSESSED controls, never over the total. Dividing
      // by the total would let an unanswered questionnaire read as "0% compliant"
      // when the truth is "we haven't asked yet" — a different, and much less
      // alarming, statement.
      compliancePct: assessed ? Math.round((compliant / assessed) * 100) : null,
      readinessPct: assessed ? Math.round(((compliant + partial * 0.5) / assessed) * 100) : null,
    },
    sectionNames: Object.keys(sections),
    requirements,
    // What was scoped out, and why. An auditor asks; a client should be able
    // to answer without re-deriving it.
    excluded,
    excludedCount: excluded.length,
    // The deep module's own output, untouched. This is where SAQ scoping,
    // SPRS refusal, mapping fidelity, the state-privacy roster, and every
    // disclaimer live — the UI can surface them, and nothing is invented here.
    detail: result,
  };
}

/** Every selectable framework at once — powers the overview. */
export function evaluateAllFrameworks(checklist = {}, opts = {}) {
  return listFrameworkIds().map(id => {
    const r = evaluateFramework(id, checklist, opts[toRegistryId(id)] || {});
    if (!r) return null;
    return {
      id,
      name: r.framework.name,
      short: r.framework.short,
      depth: r.depth,
      notControlMapped: r.notControlMapped || false,
      ...r.summary,
    };
  }).filter(Boolean);
}

/**
 * Deterministic remediation facts for one failing requirement.
 * Mastermind narrates these — it does not invent them. Same contract as before.
 */
export function remediationContext(frameworkId, requirementId, checklist = {}, opts = {}) {
  const report = evaluateFramework(frameworkId, checklist, opts);
  if (!report || report.notControlMapped) return null;
  const req = report.requirements.find(r => r.id === requirementId);
  if (!req) return null;

  return {
    framework: report.framework.name,
    frameworkId: report.framework.id,
    depth: report.depth,
    requirement: {
      id: req.id, name: req.name, text: req.text,
      section: req.section, citation: req.citation,
    },
    status: req.status,
    minScore: req.minScore,
    controls: req.controls.map(c => ({
      controlId: c.controlId,
      question: c.question,
      currentAnswer: c.answer,
      currentScore: c.score,
      meets: c.meets,
      requiredAnswer: c.bestAnswer,
      allOptions: c.options.map(o => ({ label: o.label, score: o.score })),
    })),
    methodology: report.detail?.methodology || null,
    disclaimer: report.detail?.disclaimer || null,
  };
}

/** One requirement, evaluated. Kept for signature compatibility. */
export function evaluateRequirement(req, checklist = {}) {
  const controls = (req.controls || []).map(cid => {
    const id = typeof cid === "string" ? cid : cid.controlId;
    const q = SECURITY_CHECKLIST.find(x => x.id === id);
    const raw = checklist[id];
    const label = typeof raw === "string" ? raw : raw?.label ?? null;
    const opt = q?.options.find(o => o.label === label);
    const score = opt ? opt.score : null;
    const best = q ? [...q.options].sort((a, b) => b.score - a.score)[0] : null;
    return {
      controlId: id, question: q?.question || id, nistFunction: q?.nistFunction || null,
      answer: label, score, answered: score !== null,
      meets: score !== null && score >= (req.minScore ?? 80),
      bestAnswer: best?.label || null, options: q?.options || [],
    };
  });
  const answered = controls.filter(c => c.answered);
  let status;
  if (answered.length === 0) status = STATUS.UNKNOWN;
  else if (controls.every(c => c.meets)) status = STATUS.COMPLIANT;
  else if (controls.some(c => c.meets)) status = STATUS.PARTIAL;
  else status = STATUS.GAP;
  return {
    id: req.id, name: req.name, section: req.section, text: req.text,
    minScore: req.minScore ?? 80, status,
    score: answered.length ? Math.round(answered.reduce((s, c) => s + c.score, 0) / answered.length) : 0,
    controls, failingControls: controls.filter(c => !c.meets).map(c => c.controlId),
  };
}

/**
 * A framework report plus agent corroboration.
 *
 * The agent informs; the questionnaire decides. Corroboration rides alongside
 * the report rather than altering a single status — see agentEvidence.js for
 * why endpoint telemetry is never promoted to an org-wide control answer.
 */
export function evaluateWithAgent(frameworkId, checklist = {}, agentReports = [], opts = {}) {
  const report = evaluateFramework(frameworkId, checklist, opts);
  if (!report) return null;
  const evidence = toEvidence(checklist);
  const corroborations = corroborate(agentReports, evidence);
  const byEvidence = {};
  for (const c of corroborations) (byEvidence[c.evidenceId] ||= []).push(c);

  // Attach BOTH sources to every control the agent can speak to. The control
  // keeps the questionnaire's status — that rule doesn't bend — but the
  // telemetry rides alongside it visibly rather than being summarised away in
  // a panel somewhere else. A client looking at ISO A.8.24 should see, on that
  // control: what they said, what the agent measured, and the choice in front
  // of them if those disagree.
  const openDecisions = [];
  for (const req of report.requirements) {
    for (const c of req.controls) {
      const found = byEvidence[c.controlId];
      if (!found?.length) continue;
      c.agentEvidence = found;

      const disputed = found.filter(a => a.status === "disputed");
      const confirmed = found.filter(a => a.status === "confirmed");

      // Both values, side by side, on the control itself.
      c.sources = {
        questionnaire: { value: c.answer, score: c.score, decides: true },
        agent: found.map(a => ({
          observes: a.observes,
          verdict: a.agent.verdict,
          hosts: a.agent.hosts,
          pass: a.agent.pass,
          fail: a.agent.fail,
          perHost: a.agent.perHost,
          limits: a.limits,
          decides: false,
        })),
        agree: disputed.length === 0,
      };

      if (confirmed.length) {
        c.corroborated = true;
        c.corroborationNote =
          "Independently confirmed by the monitoring agent — this is measured evidence, not a self-assessment.";
      }
      if (disputed.length) {
        c.disputed = true;
        c.decision = disputed[0].resolution;
        openDecisions.push({
          frameworkId: report.framework.id,
          requirementId: req.id,
          requirementName: req.name,
          section: req.section,
          controlId: c.controlId,
          question: c.question,
          yourAnswer: c.answer,
          agentFound: `${disputed[0].agent.pass} pass / ${disputed[0].agent.fail} fail across ${disputed[0].agent.hosts} host(s)`,
          resolution: disputed[0].resolution,
        });
      }
    }
    req.hasDispute = req.controls.some(c => c.disputed);
    req.hasCorroboration = req.controls.some(c => c.corroborated);
  }

  return {
    ...report,
    agent: corroborationSummary(agentReports, evidence),
    corroborations,
    // The client's queue: every conflict needing a human decision. Deduped by
    // control, because one disagreement about disk encryption shouldn't appear
    // 40 times just because 40 controls depend on it.
    openDecisions: dedupeByControl(openDecisions),
    disputedRequirements: report.requirements.filter(r => r.hasDispute).map(r => ({
      id: r.id, name: r.name, section: r.section,
    })),
    corroboratedRequirements: report.requirements.filter(r => r.hasCorroboration).map(r => ({
      id: r.id, name: r.name, section: r.section,
    })),
  };
}

/**
 * One decision per underlying control, not per framework requirement.
 * A single BitLocker disagreement touches dozens of controls across ISO,
 * 800-53, and HIPAA; asking the client to resolve it dozens of times would be
 * a worse product than not detecting it at all.
 */
function dedupeByControl(decisions) {
  const seen = new Map();
  for (const d of decisions) {
    const prev = seen.get(d.controlId);
    if (!prev) {
      seen.set(d.controlId, { ...d, affects: [{ requirementId: d.requirementId, requirementName: d.requirementName }] });
    } else {
      prev.affects.push({ requirementId: d.requirementId, requirementName: d.requirementName });
    }
  }
  return [...seen.values()].map(d => {
    const { requirementId, requirementName, section, ...rest } = d;
    return { ...rest, affectsCount: d.affects.length };
  });
}

/** Back-compat: the legacy module exported a FRAMEWORKS object keyed by id. */
export const FRAMEWORKS = Object.fromEntries(
  REGISTRY.filter(f => f.depth !== DEPTH.PLANNED).map(f => {
    const legacyId = toLegacyId(f.id);
    return [legacyId, { ...getFrameworkDef(legacyId), requirements: [] }];
  })
);
