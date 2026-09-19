// extendedAssessmentRoutes.js
// The paid-tier "Extended Assessment" — GET the question set + current
// answers, POST to save. Gated by `extendedAssessment` (Growth+, tiers.js).
// Both GET and POST are gated: unlike complianceView/complianceAccess's
// free-read/paid-write split, there is no honest free preview of
// vendor-specific questions.
//
// Mirrors complianceRoutes.js's framework-intake GET/POST
// (/api/compliance/intake/:frameworkId) almost exactly — same "reject
// unknown answer keys," same "compute a before/after and hand the payoff
// back" shape — because this is the same kind of thing: a topic-scoped
// question set, stored separately from the base assessment, whose value is
// made visible immediately after saving rather than discovered later.
//
// Mount from server.js:
//   import { registerExtendedAssessmentRoutes } from "./extendedAssessmentRoutes.js";
//   registerExtendedAssessmentRoutes(app, { db, requireAuth, gate });

import { visibleExtendedQuestions, EXTENDED_SCORING_CHECKLIST, EXTENDED_EVIDENCE_CHECKLIST, EXTENDED_FREE_TEXT_MAX, EXTENDED_FREE_TEXT_IDS } from "./extendedChecklist.js";
import { computePostureScore } from "./riskEngine.js";
import { recordPostureSnapshot } from "./portfolioRoutes.js";

const nowIso = () => new Date().toISOString();

// The softwareInventory question's own help text promises it "feeds the same
// Technology Stack field used for CVE matching" (cveService.js's
// clientSoftwareDescriptors() reads data.techStack) — so it has to actually
// land there, not just sit in extendedChecklist where nothing reads it.
// Splits on comma/newline/semicolon, matching a client typing a freeform list
// the same way EditAssessmentScreen's tag-at-a-time UI builds the same array.
function mergeSoftwareInventoryIntoTechStack(data, rawInventory) {
  if (!rawInventory || typeof rawInventory !== "string") return;
  const tokens = rawInventory
    .split(/[,;\n]/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 50); // matches the free-text length cap below; a sane upper bound either way
  if (!tokens.length) return;
  const existing = Array.isArray(data.techStack) ? data.techStack : [];
  const merged = new Set(existing);
  for (const t of tokens) merged.add(t);
  data.techStack = [...merged];
}

function latestAssessmentFor(db, userId) {
  const list = (db.data.assessments || []).filter(a => a.userId === userId);
  if (!list.length) return null;
  return list.reduce((best, a) =>
    !best || new Date(a.updatedAt || a.createdAt) > new Date(best.updatedAt || best.createdAt) ? a : best, null);
}

export function registerExtendedAssessmentRoutes(app, { db, requireAuth, gate }) {
  const ALL_QUESTION_IDS = new Set([
    ...EXTENDED_SCORING_CHECKLIST.map(q => q.id),
    ...EXTENDED_EVIDENCE_CHECKLIST.map(q => q.id),
  ]);

  app.get("/api/assessments/:id/extended", requireAuth, gate.capability("extendedAssessment"), (req, res) => {
    const record = (db.data.assessments || []).find(a => a.id === req.params.id && a.userId === req.userId);
    if (!record) return res.status(404).json({ error: "Assessment not found" });

    const answers = record.data?.extendedChecklist || {};
    res.json({
      questions: visibleExtendedQuestions(answers),
      answers,
    });
  });

  app.post("/api/assessments/:id/extended", requireAuth, gate.capability("extendedAssessment"), async (req, res) => {
    const record = (db.data.assessments || []).find(a => a.id === req.params.id && a.userId === req.userId);
    if (!record) return res.status(404).json({ error: "Assessment not found" });

    const incoming = req.body?.answers || {};
    // Only accept ids this question bank actually defines — unknown keys
    // could otherwise reach scoring/evidence consumers unchecked, same guard
    // complianceRoutes.js's intake save uses. Free-text answers are also
    // length-capped and coerced to a string — nothing here should let a
    // client store an arbitrarily large or non-string value.
    const answers = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (!ALL_QUESTION_IDS.has(k)) continue;
      if (EXTENDED_FREE_TEXT_IDS.has(k)) {
        answers[k] = String(v ?? "").slice(0, EXTENDED_FREE_TEXT_MAX);
      } else {
        answers[k] = v;
      }
    }

    const before = computePostureScore(record.data);

    record.data = record.data || {};
    record.data.extendedChecklist = { ...(record.data.extendedChecklist || {}), ...answers };
    mergeSoftwareInventoryIntoTechStack(record.data, answers.softwareInventory);
    record.updatedAt = nowIso();
    await db.write();

    const after = computePostureScore(record.data);

    // The payoff, made visible: an explicit before/after rather than a
    // silent score jump the client discovers later on a chart.
    if (after.postureScore !== before.postureScore) {
      recordPostureSnapshot(db, req.userId, after.postureScore, after.postureLevel, "extended_assessment");
    }

    res.json({
      answers: record.data.extendedChecklist,
      questions: visibleExtendedQuestions(record.data.extendedChecklist),
      before: { postureScore: before.postureScore, postureLevel: before.postureLevel },
      after: { postureScore: after.postureScore, postureLevel: after.postureLevel },
      delta: after.postureScore - before.postureScore,
      functions: after.functions,
    });
  });

  console.log("ShieldAI extended assessment routes registered.");
}
