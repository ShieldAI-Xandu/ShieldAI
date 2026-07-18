// riskEngine.js
// ShieldAI deterministic security posture scoring engine (v2).
//
// PRIMARY MODE: scores directly from the structured security checklist
// answers (precise, unambiguous).
//
// FALLBACK MODE: if no checklist answers are present (older assessments),
// falls back to keyword inference from free text so nothing breaks.
//
// Methodology: NIST Cybersecurity Framework — five functions, each
// scored 0-100 from weighted factors. Direction: HIGHER = BETTER.

// SCORING_CHECKLIST, not SECURITY_CHECKLIST. This is deliberate and load-bearing.
//
// SECURITY_CHECKLIST now also contains evidence-only questions (scoring: false)
// that exist to give control-mapped frameworks real signal — access reviews,
// encryption, vendor diligence, privacy rights, and so on. Those must never
// reach this engine: scoreFromChecklist() normalises by total factor weight,
// so every question it sees dilutes the 13 posture factors and shifts the
// score. Importing the full list here would retroactively change the posture
// score of every client on record, silently, with no change in their actual
// security. Import the filtered list.
import { SCORING_CHECKLIST } from "./securityChecklist.js";

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

// NIST function weights for the overall score
const FUNCTION_WEIGHTS = {
  Identify: 0.15,
  Protect: 0.30,
  Detect: 0.15,
  Respond: 0.15,
  Recover: 0.25,
};

// Factor weights WITHIN each NIST function (must sum to 1 per function)
const FACTOR_WEIGHTS = {
  // Protect
  mfa: 0.30, endpoint: 0.25, training: 0.20, itManagement: 0.25,
  // Identify
  dataInventory: 0.35, priorAudit: 0.35, documentedPolicies: 0.30,
  // Detect
  monitoring: 0.55, emailSecurity: 0.45,
  // Respond
  incidentResponse: 0.55, responseSupport: 0.45,
  // Recover
  backups: 0.55, disasterRecovery: 0.45,
};

// ──────────────────────────────────────────────────────────────
//  CIS SCORING LENS
// ──────────────────────────────────────────────────────────────
// A client can now choose to be scored against CIS Controls instead of (or as
// well as) NIST CSF. This is NOT a different score computed from different
// data — that would let the two frameworks disagree about the same business,
// which is exactly the kind of contradiction this codebase keeps having to fix.
// It's the SAME 13 scoring factors, regrouped under the CIS lens.
//
// NIST CSF groups controls into five Functions (Identify/Protect/Detect/
// Respond/Recover). CIS groups its IG1 baseline into practical hygiene areas.
// We map our 13 factors onto four CIS-flavoured groups so a CIS-oriented client
// reads their posture in the vocabulary they chose, while the arithmetic
// underneath is identical. A business doesn't become more or less secure
// because it picked a different framework on the intake screen.
//
// The group names and framing come from CIS's own "Basic Cyber Hygiene"
// language (IG1). Weights sum to 1 within each group; group weights sum to 1.
const CIS_GROUPS = {
  "Identify & Protect Assets": {
    weight: 0.30,
    factors: { dataInventory: 0.30, documentedPolicies: 0.25, itManagement: 0.25, priorAudit: 0.20 },
  },
  "Secure Access & Data": {
    weight: 0.35,
    factors: { mfa: 0.55, endpoint: 0.45 },
  },
  "Detect & Defend": {
    weight: 0.20,
    factors: { monitoring: 0.40, emailSecurity: 0.35, training: 0.25 },
  },
  "Respond & Recover": {
    weight: 0.15,
    factors: { incidentResponse: 0.30, responseSupport: 0.20, backups: 0.30, disasterRecovery: 0.20 },
  },
};

// Human-readable findings per factor based on the score achieved
function findingFor(factorId, score, label) {
  const strong = score >= 75, weak = score <= 35;
  const map = {
    mfa: strong ? "Multi-factor authentication is well established." : weak ? "Multi-factor authentication is largely absent — a critical gap." : "Partial MFA coverage; expand to all accounts.",
    endpoint: strong ? "Strong endpoint protection in place." : weak ? "Little or no endpoint protection." : "Basic endpoint protection; consider upgrading to EDR.",
    training: strong ? "Regular security awareness training is in place." : weak ? "No meaningful security awareness training." : "Some training exists but should be more regular.",
    itManagement: strong ? "Security is actively managed." : weak ? "No clear ownership of IT/security." : "Limited IT management capacity.",
    dataInventory: strong ? "Sensitive data is well understood and documented." : weak ? "No clear inventory of sensitive data." : "Partial understanding of data holdings.",
    priorAudit: strong ? "Recent security assessment completed." : weak ? "No prior security assessment." : "Security assessment is overdue.",
    documentedPolicies: strong ? "Security policies are documented." : weak ? "No documented security policies." : "Limited policy documentation.",
    monitoring: strong ? "Active security monitoring in place." : weak ? "No security monitoring or logging." : "Minimal monitoring capability.",
    emailSecurity: strong ? "Strong email threat protection." : weak ? "No email security controls." : "Baseline email filtering only.",
    incidentResponse: strong ? "Incident response plan is documented." : weak ? "No incident response plan." : "Incident response is informal.",
    responseSupport: strong ? "Clear incident response support available." : weak ? "No clear responder for a breach." : "Limited response support.",
    backups: strong ? "Robust, automated backups in place." : weak ? "No reliable data backups — major risk." : "Backups exist but need improvement/testing.",
    disasterRecovery: strong ? "Disaster recovery planning in place." : weak ? "No disaster recovery plan." : "Basic continuity planning only.",
  };
  return map[factorId] || `${label}: ${score}/100`;
}

// ──────────────────────────────────────────────────────────────
//  PRIMARY: score from structured checklist answers
//  `answers` shape: { mfa: "<selected label>", backups: "<label>", ... }
// ──────────────────────────────────────────────────────────────
function scoreFromChecklist(answers) {
  // Group questions by NIST function
  const byFunction = {};
  for (const q of SCORING_CHECKLIST) {
    byFunction[q.nistFunction] = byFunction[q.nistFunction] || [];

    // Find the selected option's score
    const selectedLabel = answers[q.id];
    const option = q.options.find(o => o.label === selectedLabel);
    const score = option ? option.score : 40; // default mid-low if unanswered

    byFunction[q.nistFunction].push({
      label: q.question,
      factorId: q.factor,
      score,
      weight: FACTOR_WEIGHTS[q.factor] || (1 / SCORING_CHECKLIST.length),
      finding: findingFor(q.factor, score, q.question),
    });
  }

  // Compose each function
  const functions = Object.entries(byFunction).map(([name, factors]) => {
    const totalWeight = factors.reduce((s, f) => s + f.weight, 0) || 1;
    const weighted = factors.reduce((s, f) => s + f.score * f.weight, 0) / totalWeight;
    return {
      name,
      score: clamp(weighted),
      factors: factors.map(f => ({
        label: f.label, score: clamp(f.score), weight: f.weight, finding: f.finding,
      })),
    };
  });

  return functions;
}

// ──────────────────────────────────────────────────────────────
//  FALLBACK: keyword inference (for assessments without checklist)
// ──────────────────────────────────────────────────────────────
function buildSearchText(assessment) {
  const parts = [];
  const pushVal = (v) => {
    if (!v) return;
    if (Array.isArray(v)) v.forEach(pushVal);
    else if (typeof v === "object") Object.values(v).forEach(pushVal);
    else parts.push(String(v));
  };
  const a = assessment || {};
  [a.company, a.posture, a.compliance, a.concerns, a.incidents, a.budget, a.summary].forEach(pushVal);
  return parts.join(" ").toLowerCase();
}
const has = (text, ...kw) => kw.some(k => text.includes(k.toLowerCase()));

function scoreFromKeywords(assessment) {
  const t = buildSearchText(assessment);
  const mk = (name, factors) => {
    const tw = factors.reduce((s, f) => s + f.weight, 0) || 1;
    const w = factors.reduce((s, f) => s + f.score * f.weight, 0) / tw;
    return { name, score: clamp(w), factors: factors.map(f => ({ ...f, score: clamp(f.score) })) };
  };
  return [
    mk("Identify", [
      { label: "Data inventory awareness", weight: 0.35, score: (assessment?.company?.dataTypes||[]).length >= 2 ? 70 : 30, finding: "Inferred from intake." },
      { label: "Prior risk assessment", weight: 0.35, score: has(t,"audit","soc 2","soc2","penetration","assessment") ? 70 : 25, finding: "Inferred from intake." },
      { label: "Documented policies", weight: 0.30, score: (assessment?.posture?.policies||[]).length >= 1 ? 55 : 20, finding: "Inferred from intake." },
    ]),
    mk("Protect", [
      { label: "MFA", weight: 0.30, score: has(t,"mfa","multi-factor","2fa") ? 80 : 20, finding: "Inferred from intake." },
      { label: "Endpoint protection", weight: 0.25, score: has(t,"edr","crowdstrike","defender","antivirus") ? 55 : 25, finding: "Inferred from intake." },
      { label: "Training", weight: 0.20, score: has(t,"training","awareness") ? 70 : 25, finding: "Inferred from intake." },
      { label: "IT management", weight: 0.25, score: has(t,"it staff","msp","managed","it team") ? 70 : 30, finding: "Inferred from intake." },
    ]),
    mk("Detect", [
      { label: "Monitoring", weight: 0.55, score: has(t,"siem","monitoring","logging","soc") ? 65 : 20, finding: "Inferred from intake." },
      { label: "Email security", weight: 0.45, score: has(t,"email security","proofpoint","microsoft 365","google workspace") ? 60 : 30, finding: "Inferred from intake." },
    ]),
    mk("Respond", [
      { label: "Incident response plan", weight: 0.55, score: has(t,"incident response","ir plan","playbook") ? 75 : 20, finding: "Inferred from intake." },
      { label: "Response support", weight: 0.45, score: has(t,"msp","managed","retained","consultant") ? 65 : 30, finding: "Inferred from intake." },
    ]),
    mk("Recover", [
      { label: "Backups", weight: 0.55, score: has(t,"backup","veeam","datto","cloud backup") ? 65 : 20, finding: "Inferred from intake." },
      { label: "Disaster recovery", weight: 0.45, score: has(t,"disaster recovery","continuity","rto") ? 70 : 20, finding: "Inferred from intake." },
    ]),
  ];
}

// ──────────────────────────────────────────────────────────────
//  Compliance adjustment (applies in both modes)
// ──────────────────────────────────────────────────────────────
function complianceAdjustment(assessment) {
  const compliance = assessment?.compliance || [];
  const t = buildSearchText(assessment);
  const hasNeed = compliance.length > 0 || has(t, "hipaa","pci","soc 2","soc2","gdpr","cmmc");
  const hasControls = has(t, "compliant","certified","audit","encryption") ||
    (assessment?.posture?.policies || []).length >= 2;

  if (hasNeed && !hasControls) return { adjustment: -8, finding: "Handles regulated data but shows few compliance controls (penalty applied)." };
  if (hasNeed && hasControls) return { adjustment: +3, finding: "Compliance obligations identified with some controls in place." };
  return { adjustment: 0, finding: "No specific regulatory compliance obligations identified." };
}

// ──────────────────────────────────────────────────────────────
//  MAIN
// ──────────────────────────────────────────────────────────────
export function computePostureScore(assessment) {
  // Which lens did the client choose at intake? Stored on the assessment as
  // frameworkLens ("nist" | "cis" | "both"). Absent → "nist", so every existing
  // assessment and every caller that doesn't know about lenses keeps its exact
  // current behaviour. This is why the 15 call sites didn't need touching: the
  // choice rides on the data, not the function signature.
  const lens = assessment?.frameworkLens || assessment?.data?.frameworkLens || "nist";
  if (lens === "cis" || lens === "both") {
    return computePostureForLens(assessment, lens);
  }
  return computeNistPosture(assessment);
}

function computeNistPosture(assessment) {
  // Prefer structured checklist answers if present
  const checklist = assessment?.checklist || assessment?.securityChecklist || null;
  const usingChecklist = checklist && Object.keys(checklist).length > 0;

  const functions = usingChecklist
    ? scoreFromChecklist(checklist)
    : scoreFromKeywords(assessment);

  let overall = functions.reduce(
    (sum, fn) => sum + fn.score * (FUNCTION_WEIGHTS[fn.name] || 0), 0
  );

  const compAdj = complianceAdjustment(assessment);
  overall = clamp(overall + compAdj.adjustment);

  let level;
  if (overall >= 80) level = "Strong";
  else if (overall >= 60) level = "Moderate";
  else if (overall >= 40) level = "Developing";
  else level = "At Risk";

  const sorted = [...functions].sort((x, y) => x.score - y.score);
  const weakestAreas = sorted.slice(0, 2).map(f => f.name);

  return {
    postureScore: overall,
    postureLevel: level,
    methodology: usingChecklist ? "NIST CSF (structured checklist)" : "NIST CSF (inferred from intake)",
    scoringMode: usingChecklist ? "structured" : "inferred",
    functions,
    weakestAreas,
    complianceNote: compAdj.finding,
  };
}

// ──────────────────────────────────────────────────────────────
//  CIS-LENS POSTURE
// ──────────────────────────────────────────────────────────────
// Scores the SAME checklist answers, regrouped under CIS's hygiene areas.
// Returns the identical contract as computePostureScore (postureScore,
// postureLevel, functions[], weakestAreas) so every consumer — the dashboard,
// the analyst portfolio, the program generator — works unchanged regardless of
// which lens the client chose. The only differences a client sees are the group
// names and the methodology label.
function scoreCisFromChecklist(checklist) {
  const answerScore = (factorId) => {
    const q = SCORING_CHECKLIST.find(x => x.factor === factorId);
    if (!q) return 40;
    const opt = q.options.find(o => o.label === checklist[q.id]);
    return opt ? opt.score : 40;
  };

  return Object.entries(CIS_GROUPS).map(([name, group]) => {
    const factors = Object.entries(group.factors).map(([factorId, weight]) => {
      const q = SCORING_CHECKLIST.find(x => x.factor === factorId);
      const score = answerScore(factorId);
      return {
        label: q ? q.question : factorId,
        score: clamp(score),
        weight,
        finding: findingFor(factorId, score, q ? q.question : factorId),
      };
    });
    const tw = factors.reduce((s, f) => s + f.weight, 0) || 1;
    const weighted = factors.reduce((s, f) => s + f.score * f.weight, 0) / tw;
    return { name, score: clamp(weighted), factors };
  });
}

/**
 * Posture through a chosen lens.
 *
 * lens="nist"  → the NIST CSF five functions (the default; unchanged behaviour).
 * lens="cis"   → the same answers grouped under CIS Controls hygiene areas.
 * lens="both"  → NIST is authoritative for the headline number (it's what
 *                insurers and the rest of the product expect), with the CIS view
 *                attached alongside so a "both" client sees both breakdowns
 *                without the two ever disagreeing on the overall score.
 *
 * Every branch returns the same shape, so nothing downstream needs to know which
 * lens was used. The keyword-inference fallback stays NIST-only — inferring a
 * CIS-grouped score from free text would be guessing about guessing.
 */
export function computePostureForLens(assessment, lens = "nist") {
  const base = computeNistPosture(assessment);
  const checklist = assessment?.checklist || assessment?.securityChecklist || null;
  const usingChecklist = checklist && Object.keys(checklist).length > 0;

  // No structured answers, or plain NIST → the existing result, labelled.
  if (lens === "nist" || !usingChecklist) {
    return { ...base, lens: "nist", frameworkLens: "NIST CSF" };
  }

  const cisFunctions = scoreCisFromChecklist(checklist);
  const cisOverall = clamp(
    cisFunctions.reduce((s, fn) => s + fn.score * (CIS_GROUPS[fn.name]?.weight || 0), 0)
    + complianceAdjustment(assessment).adjustment
  );
  const cisLevel = cisOverall >= 80 ? "Strong" : cisOverall >= 60 ? "Moderate" : cisOverall >= 40 ? "Developing" : "At Risk";
  const cisWeakest = [...cisFunctions].sort((a, b) => a.score - b.score).slice(0, 2).map(f => f.name);

  const cisView = {
    postureScore: cisOverall,
    postureLevel: cisLevel,
    functions: cisFunctions,
    weakestAreas: cisWeakest,
    methodology: "CIS Controls v8.1 (IG1 hygiene areas, structured checklist)",
  };

  if (lens === "cis") {
    // CIS is the client's chosen frame — it drives the headline number.
    return {
      ...base,
      postureScore: cisView.postureScore,
      postureLevel: cisView.postureLevel,
      functions: cisView.functions,
      weakestAreas: cisView.weakestAreas,
      methodology: cisView.methodology,
      lens: "cis",
      frameworkLens: "CIS Controls v8.1",
      // The NIST view is kept for anyone who needs the cross-framework number
      // (insurers still ask in CSF terms), but it does not override the score.
      alternateView: { lens: "nist", ...base },
    };
  }

  // lens === "both": NIST stays authoritative for the headline; CIS rides along.
  return {
    ...base,
    lens: "both",
    frameworkLens: "NIST CSF + CIS Controls",
    methodology: "NIST CSF (headline) with CIS Controls v8.1 view",
    alternateView: { lens: "cis", ...cisView },
  };
}
