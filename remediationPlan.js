// remediationPlan.js
// Aggregates every open compliance gap and conflict for one client across the
// frameworks they selected, dedupes them to a minimal set of fixes, and asks
// Mastermind to narrate the deterministic remediation facts into concrete
// steps. Consumed by reportRoutes.js's "remediation" report builder.
//
// Boundaries: this module reads db.data only — it never mutates. The facts
// (current answer, required answer, which requirements a control drives) come
// straight from complianceBridge.js; Mastermind only writes prose around them.
// If the AI is unavailable, every fix still gets deterministic, honest steps.

import {
  listFrameworkIds, getFrameworkDef, evaluateFramework, remediationContext,
  toRegistryId, toLegacyId,
} from "./complianceBridge.js";
import { toAssessOpts } from "./frameworkIntake.js";
import { corroborate, RESOLUTION_OPTIONS } from "./agentEvidence.js";
import { toEvidence, SECURITY_CHECKLIST } from "./securityChecklist.js";

// Cap the number of Mastermind calls one report makes. Fixes beyond this get
// deterministic guidance and the report says so — no silent truncation.
const MAX_AI_FIXES = 20;

function latestAssessmentFor(db, userId) {
  const list = (db.data.assessments || []).filter((a) => a.userId === userId);
  if (!list.length) return null;
  return list.reduce(
    (best, a) =>
      !best ||
      new Date(a.updatedAt || a.createdAt) >
        new Date(best.updatedAt || best.createdAt)
        ? a
        : best,
    null,
  );
}

function checklistOf(a) {
  return a?.data?.checklist || a?.data?.securityChecklist || {};
}

function optsFor(a) {
  const stored = a?.data?.frameworkIntake || {};
  const out = {};
  for (const [fid, answers] of Object.entries(stored)) {
    if (!answers) continue;
    try {
      out[toRegistryId(fid)] = toAssessOpts(toRegistryId(fid), answers);
    } catch {
      /* skip malformed scoping */
    }
  }
  return out;
}

// Most recent report per host — agents report repeatedly, and counting every
// historical report would make one laptop look like a fleet.
function agentReportsFor(db, ownerUserId) {
  const byHost = new Map();
  for (const r of db.data.agentReports || []) {
    if (r.ownerUserId !== ownerUserId) continue;
    const rep = r.report || r;
    const host = rep?.host?.hostname;
    if (!host) continue;
    const prev = byHost.get(host);
    if (!prev || new Date(r.receivedAt || 0) > new Date(prev.receivedAt || 0)) {
      byHost.set(host, { receivedAt: r.receivedAt, rep });
    }
  }
  return [...byHost.values()].map((v) => v.rep);
}

function deterministicSteps(failing) {
  return (
    "Steps to close this gap:\n" +
    failing
      .map(
        (c, i) =>
          `${i + 1}. ${c.question}\n   Move from "${
            c.currentAnswer || "unanswered"
          }" to "${c.requiredAnswer}".`,
      )
      .join("\n") +
    "\n\nKeep configuration exports or screenshots as evidence for audit."
  );
}

/**
 * @param {object} db          lowdb instance
 * @param {string} clientId    target client user id
 * @param {{callClaudeText?: Function}} deps
 * @returns {Promise<object|null>}  null if the client has no assessment
 */
export async function buildRemediationPlanData(db, clientId, { callClaudeText } = {}) {
  const client = (db.data.users || []).find((u) => u.id === clientId) || null;
  const a = latestAssessmentFor(db, clientId);
  if (!client || !a) return null;

  const checklist = checklistOf(a);
  const opts = optsFor(a);
  const company = a.data?.company || {};

  // Framework set: what the client selected, falling back to their compliance
  // name strings, then to the whole catalogue.
  let ids = Array.isArray(a.data?.selectedFrameworks)
    ? a.data.selectedFrameworks.map((f) => toLegacyId(f.id)).filter(Boolean)
    : [];
  if (!ids.length && Array.isArray(a.data?.compliance)) {
    const names = a.data.compliance.map((s) => String(s).toLowerCase());
    ids = listFrameworkIds().filter((id) => {
      const def = getFrameworkDef(id);
      return (
        def &&
        names.some(
          (n) =>
            def.name.toLowerCase().includes(n) ||
            def.short.toLowerCase().includes(n) ||
            n.includes(def.short.toLowerCase()),
        )
      );
    });
  }
  if (!ids.length) ids = listFrameworkIds();
  ids = [...new Set(ids)];

  const frameworks = []; // overview table rows
  const gapReqs = []; // { frameworkId, frameworkName, requirement, status, failing[] }

  for (const id of ids) {
    const rep = evaluateFramework(id, checklist, opts[toRegistryId(id)] || {});
    if (!rep || rep.notControlMapped) {
      const def = getFrameworkDef(id);
      if (def)
        frameworks.push({
          id: def.id,
          name: def.name,
          short: def.short,
          notControlMapped: true,
        });
      continue;
    }
    frameworks.push({
      id: rep.framework.id,
      name: rep.framework.name,
      short: rep.framework.short,
      notControlMapped: false,
      ...rep.summary,
    });
    for (const req of rep.requirements) {
      if (req.status !== "gap" && req.status !== "partial") continue;
      const ctx = remediationContext(
        id,
        req.id,
        checklist,
        opts[toRegistryId(id)] || {},
      );
      if (!ctx) continue;
      const failing = ctx.controls
        .filter((c) => !c.meets)
        .map((c) => ({
          controlId: c.controlId,
          question: c.question,
          currentAnswer: c.currentAnswer,
          requiredAnswer: c.requiredAnswer,
        }));
      if (!failing.length) continue;
      gapReqs.push({
        frameworkId: rep.framework.id,
        frameworkName: rep.framework.name,
        requirement: {
          id: req.id,
          name: req.name,
          section: req.section,
          citation: req.citation,
        },
        status: req.status,
        failing,
      });
    }
  }

  // Dedupe into fixes: one per distinct set of failing controls. A single
  // disk-encryption answer drives dozens of requirements across ISO/PCI/HIPAA —
  // the client should read one fix, not forty.
  const bySig = new Map();
  for (const g of gapReqs) {
    const sig = g.failing
      .map((f) => f.controlId)
      .sort()
      .join("|");
    if (!bySig.has(sig)) {
      bySig.set(sig, {
        controlIds: g.failing.map((f) => f.controlId).sort(),
        failing: g.failing,
        affects: [],
      });
    }
    bySig.get(sig).affects.push({
      frameworkName: g.frameworkName,
      requirementId: g.requirement.id,
      requirementName: g.requirement.name,
      section: g.requirement.section,
    });
  }
  const fixes = [...bySig.values()].sort(
    (x, y) => y.affects.length - x.affects.length,
  );

  // Mastermind narrates each fix. Cap the AI calls; the rest get deterministic
  // guidance and the report notes how many.
  const aiCap = Math.min(fixes.length, MAX_AI_FIXES);
  let aiGenerated = false;
  for (let i = 0; i < fixes.length; i++) {
    const fx = fixes[i];
    if (i >= aiCap || !callClaudeText) {
      fx.steps = deterministicSteps(fx.failing);
      fx.aiGenerated = false;
      continue;
    }
    const prompt = `You are ShieldAI Mastermind advising a virtual CISO.

CLIENT: ${company.name || client.companyName || "the client"}${
      company.industry ? ` · ${company.industry}` : ""
    }${company.employees ? ` · ${company.employees} employees` : ""}

ONE FIX CLOSES THESE REQUIREMENTS:
${fx.affects
  .map((r) => `- ${r.frameworkName} ${r.requirementId} — ${r.requirementName}`)
  .join("\n")}

WHAT IS FAILING (facts from the client's assessment — do not dispute or restate them as uncertain):
${fx.failing
  .map(
    (c) =>
      `- ${c.question}\n  Currently: "${
        c.currentAnswer || "unanswered"
      }"\n  Needs to be: "${c.requiredAnswer}"`,
  )
  .join("\n")}

Write remediation steps to close this gap. Requirements for your answer:
- 3 to 5 concrete, ordered steps a small business can actually execute.
- Name specific, common tooling where useful (e.g. Microsoft 365, Google Workspace, Duo).
- Include a realistic effort estimate and who should own it.
- End with one line: what evidence to keep to prove this at audit.
- Do NOT invent facts about the client beyond what is given.
- Plain text. No preamble. No markdown headers.`;
    try {
      const text = await callClaudeText({
        system:
          "You are ShieldAI Mastermind, a precise virtual-CISO advisor. You state only what the provided facts support. You never invent details about a client.",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 700,
      });
      if (text && text.trim()) {
        fx.steps = text.trim();
        fx.aiGenerated = true;
        aiGenerated = true;
      } else {
        fx.steps = deterministicSteps(fx.failing);
        fx.aiGenerated = false;
      }
    } catch {
      fx.steps = deterministicSteps(fx.failing);
      fx.aiGenerated = false;
    }
  }
  const truncatedCount =
    fixes.length > MAX_AI_FIXES ? fixes.length - MAX_AI_FIXES : 0;

  // Conflicts: agent telemetry vs. the questionnaire, deduped by control.
  const reports = agentReportsFor(db, clientId);
  const conflicts = [];
  if (reports.length) {
    const seen = new Set();
    for (const c of corroborate(reports, toEvidence(checklist))) {
      if (c.status !== "disputed" || seen.has(c.evidenceId)) continue;
      seen.add(c.evidenceId);
      const q = SECURITY_CHECKLIST.find((x) => x.id === c.evidenceId);
      conflicts.push({
        controlId: c.evidenceId,
        question: c.question,
        yourAnswer: c.clientAnswer,
        agentObserved: `${c.agent.pass} pass / ${c.agent.fail} fail / ${c.agent.warn} warn across ${c.agent.hosts} host(s)`,
        validAnswers: q ? q.options.map((o) => o.label) : [],
        options: RESOLUTION_OPTIONS.map((o) => ({
          label: o.label,
          effect: o.effect,
        })),
      });
    }
  }

  return {
    client: {
      id: client.id,
      name: client.companyName || client.email,
      industry: client.industry || company.industry || null,
      tier: client.tier || "free",
    },
    generatedAt: new Date().toISOString(),
    frameworks,
    fixes,
    conflicts,
    counts: {
      frameworks: frameworks.filter((f) => !f.notControlMapped).length,
      gaps: gapReqs.length,
      fixes: fixes.length,
      conflicts: conflicts.length,
      truncated: truncatedCount,
    },
    aiProvider: aiGenerated ? "claude" : null,
    aiGenerated,
  };
}
