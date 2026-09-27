// trainingContentPrompt.js
// One shared prompt for AI-generated training slide + quiz content. Used by
// both server.js's POST /api/training/module-content (admin/analyst-built
// curriculum, ModuleCard flow) and trainingProgramRoutes.js's
// getOrGenerateModuleContent() (public tokenized learner flow). These two
// call sites used to hand-duplicate this prompt string — the learner-flow
// file's own comment admitted as much — and had already drifted on the quiz
// field name (fullQuiz vs quiz). One function closes that gap for good.
//
// Bullets are deliberately required to be full explanatory sentences, not
// bare phrases: a learner reading the exported .pptx or the in-app slide
// viewer only sees the slide body (bullets) — speakerNotes lands in the
// native .pptx's hidden presenter-notes pane (src/App.jsx's
// downloadPptxNative(), via addNotes()) and isn't something most learners
// see. So the bullets themselves have to carry the actual explanation.
export function buildModuleContentPrompt(mod, companyText, { quizField = "quiz" } = {}) {
  const sys = `You are a cybersecurity trainer creating presentable employee-training material for a small business. For the given module, produce (1) a set of teaching SLIDES and (2) a full scored QUIZ.

Return ONLY valid, minified JSON (no markdown, no trailing commas) in exactly this shape:
{"slides":[{"title":"","bullets":["a complete explanatory sentence","another complete explanatory sentence"],"speakerNotes":"2-3 sentences of extra context the presenter can say"}],"${quizField}":[{"question":"","options":["a","b","c","d"],"correct":0,"explanation":"why this is correct"}]}

Rules: produce 5-7 slides (title slide first, a summary/recap slide last). Each slide has 2-4 bullets. Every bullet must be a complete, explanatory sentence that teaches WHY the point matters or HOW to act on it — never a bare term or short phrase. For example, write "Weak passwords let attackers guess their way into an account within minutes, so every account needs a long, unique passphrase" rather than just "Use strong passwords." Keep each bullet to roughly one sentence — presentation-length, not a paragraph — but it must always explain, not just name, the point. Produce exactly 6 quiz questions, each with 4 options and a one-sentence explanation. Tailor examples to the company's industry.`;

  const usr = `${companyText}\n\nModule: ${mod.title}\nAudience: ${mod.audience}\nLearning objectives:\n${(mod.objectives || []).map(o => "- " + o).join("\n")}\n${mod.realWorldScenario ? "Scenario: " + mod.realWorldScenario : ""}`;

  return { sys, usr };
}
