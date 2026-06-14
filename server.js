// server.js
// ShieldAI backend: auth + AI proxy + database persistence + program pipeline.

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import db from "./db.js";
import { PIPELINE } from "./generators.js";
import { POLICY_CATALOG } from "./policyCatalog.js";
import { buildStructurePrompt } from "./policyFormats.js";
import { computePostureScore } from "./riskEngine.js";
import {
  registerUser,
  loginUser,
  requireAuth,
  requireAdmin,
  getCurrentUser,
  adminResetPassword,
  adminDeleteUser,
  MAX_USERS,
} from "./auth.js";

dotenv.config();

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: "5mb" }));

const progressStore = {};

// ─────────────────────────────────────────────────────────────
//  CLAUDE CORE
// ─────────────────────────────────────────────────────────────
async function callClaude({ system, messages, max_tokens = 1500, stream = false }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set in .env");

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens,
      system,
      messages,
      stream,
    }),
  });

  if (!anthropicRes.ok) {
    const errBody = await anthropicRes.text();
    throw new Error(`Anthropic API error ${anthropicRes.status}: ${errBody}`);
  }
  return anthropicRes;
}

async function callClaudeText({ system, messages, max_tokens }) {
  const res = await callClaude({ system, messages, max_tokens, stream: false });
  const data = await res.json();
  return data?.content?.map(c => c.text || "").join("") || "";
}

function extractJson(text) {
  let clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in response");
  let body = clean.slice(start, end + 1);

  // First attempt: parse as-is
  try {
    return JSON.parse(body);
  } catch (e) {
    // Repair pass for common LLM JSON glitches, then retry
    let repaired = body
      // smart quotes → straight quotes
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      // remove trailing commas before } or ]
      .replace(/,\s*([}\]])/g, "$1")
      // strip control characters that break JSON.parse
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
    return JSON.parse(repaired);
  }
}

// ─────────────────────────────────────────────────────────────
//  AUTH ROUTES (public)
// ─────────────────────────────────────────────────────────────
app.post("/api/auth/register", async (req, res) => {
  try {
    const result = await registerUser(req.body);
    res.json(result);
  } catch (err) {
    const status = err.code === "USER_LIMIT_REACHED" ? 403 : 400;
    res.status(status).json({ error: err.message, code: err.code });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const result = await loginUser(req.body);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message, code: err.code });
  }
});

// How many registration slots remain (used by the UI)
app.get("/api/auth/capacity", (req, res) => {
  const used = (db.data.users || []).length;
  res.json({ used, max: MAX_USERS, available: Math.max(0, MAX_USERS - used) });
});

// Current logged-in user
app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = getCurrentUser(req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

// ─────────────────────────────────────────────────────────────
//  CLAUDE PROXY (protected — intake chat)
// ─────────────────────────────────────────────────────────────
app.post("/api/claude", requireAuth, async (req, res) => {
  try {
    const anthropicRes = await callClaude(req.body);
    if (req.body.stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      const reader = anthropicRes.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value));
      }
      res.end();
    } else {
      const data = await anthropicRes.json();
      res.json(data);
    }
  } catch (err) {
    console.error("Claude proxy error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  ASSESSMENTS (protected, user-scoped)
// ─────────────────────────────────────────────────────────────
app.post("/api/assessments", requireAuth, async (req, res) => {
  try {
    const id = randomUUID();
    const record = {
      id,
      userId: req.userId,
      createdAt: new Date().toISOString(),
      data: req.body,
    };
    db.data.assessments.push(record);
    await db.write();
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/assessments", requireAuth, (req, res) => {
  const list = db.data.assessments
    .filter(a => a.userId === req.userId)
    .map(a => ({ id: a.id, createdAt: a.createdAt, company: a.data?.company || {} }));
  res.json(list);
});

app.get("/api/assessments/:id", requireAuth, (req, res) => {
  const record = db.data.assessments.find(a => a.id === req.params.id && a.userId === req.userId);
  if (!record) return res.status(404).json({ error: "Assessment not found" });
  res.json(record);
});

// Update an existing assessment's data (company info + checklist)
app.patch("/api/assessments/:id", requireAuth, async (req, res) => {
  const record = db.data.assessments.find(a => a.id === req.params.id && a.userId === req.userId);
  if (!record) return res.status(404).json({ error: "Assessment not found" });

  // Merge incoming data into the stored assessment data.
  // Frontend sends the full updated `data` object.
  if (req.body.data && typeof req.body.data === "object") {
    record.data = { ...record.data, ...req.body.data };
  }
  record.updatedAt = new Date().toISOString();
  await db.write();
  res.json({ ok: true, id: record.id, data: record.data });
});

// ─────────────────────────────────────────────────────────────
//  PROGRAM GENERATION (protected, user-scoped)
// ─────────────────────────────────────────────────────────────
app.post("/api/programs/generate", requireAuth, async (req, res) => {
  try {
    const { assessmentId } = req.body;
    const assessment = db.data.assessments.find(
      a => a.id === assessmentId && a.userId === req.userId
    );
    if (!assessment) return res.status(404).json({ error: "Assessment not found" });

    const programId = randomUUID();
    const program = {
      id: programId,
      userId: req.userId,
      assessmentId,
      createdAt: new Date().toISOString(),
      status: "running",
      sections: {},
    };
    db.data.programs.push(program);
    await db.write();

    progressStore[programId] = { step: 0, total: PIPELINE.length, label: "Starting...", status: "running" };

    runPipeline(programId, assessment.data).catch(err => {
      console.error("Pipeline fatal error:", err);
      progressStore[programId] = { ...progressStore[programId], status: "error", error: err.message };
    });

    res.json({ programId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function runPipeline(programId, assessmentData) {
  const ctx = JSON.stringify(assessmentData, null, 2);
  const program = db.data.programs.find(p => p.id === programId);

  // Compute the REAL posture score deterministically up front.
  const posture = computePostureScore(assessmentData);

  for (let i = 0; i < PIPELINE.length; i++) {
    const step = PIPELINE[i];
    progressStore[programId] = { step: i, total: PIPELINE.length, label: step.label, status: "running" };

    try {
      if (step.key === "riskOverview") {
        // Give Claude the computed score + breakdown, and ask it ONLY
        // to write the narrative + threats around that fixed number.
        const postureSummary = `COMPUTED SECURITY POSTURE (authoritative — do not change these numbers):
- Overall posture score: ${posture.postureScore}/100 (${posture.postureLevel}) — higher is better
- Methodology: ${posture.methodology}
- Per-function scores: ${posture.functions.map(f => `${f.name} ${f.score}/100`).join(", ")}
- Weakest areas: ${posture.weakestAreas.join(", ")}
- Key findings: ${posture.functions.flatMap(f => f.factors.map(x => x.finding)).join(" ")}
- Compliance note: ${posture.complianceNote}`;

        const system = `You are a senior CISO. A deterministic scoring engine has ALREADY computed this business's security posture score using the NIST CSF framework. Your job is to write the narrative around it — you must NOT invent or change the score.

Return ONLY valid JSON, no markdown fences:
{"postureScore":<use the exact computed score>,"postureLevel":"<use the exact computed level>","executiveSummary":"3-4 sentences explaining what this score means for this specific business, referencing the weakest areas","topThreats":[{"threat":"","likelihood":"High|Medium|Low","impact":"High|Medium|Low","description":""}]}

Limit topThreats to exactly 3, focused on the weakest NIST areas identified. Keep each description to 1 sentence. Higher score = better security posture.`;

        const text = await callClaudeText({
          system,
          messages: [{
            role: "user",
            content: `Business context:\n${ctx}\n\n${postureSummary}\n\nWrite the risk overview JSON. Use the computed postureScore (${posture.postureScore}) and postureLevel (${posture.postureLevel}) EXACTLY.`,
          }],
          max_tokens: step.maxTokens,
        });

        const aiResult = extractJson(text);

        // Enforce the computed values (defend against the AI drifting)
        aiResult.postureScore = posture.postureScore;
        aiResult.postureLevel = posture.postureLevel;

        // Attach the full breakdown for the dashboard to render
        aiResult.breakdown = {
          methodology: posture.methodology,
          functions: posture.functions,
          weakestAreas: posture.weakestAreas,
          complianceNote: posture.complianceNote,
        };

        program.sections[step.key] = aiResult;
      } else {
        // All other steps: try once, and on parse failure retry with a
        // stricter "valid JSON only" nudge before giving up.
        let parsed = null;
        try {
          const text = await callClaudeText({
            system: step.system,
            messages: [{
              role: "user",
              content: `Business context:\n${ctx}\n\nGenerate the "${step.key}" section. Return ONLY valid JSON matching the schema in your instructions.`,
            }],
            max_tokens: step.maxTokens,
          });
          parsed = extractJson(text);
        } catch (firstErr) {
          console.warn(`Step "${step.key}" first attempt failed (${firstErr.message}); retrying…`);
          const retryText = await callClaudeText({
            system: step.system,
            messages: [{
              role: "user",
              content: `Business context:\n${ctx}\n\nGenerate the "${step.key}" section. Return ONLY strictly valid, minified JSON — no trailing commas, no comments, no text before or after the JSON object. Match the schema exactly.`,
            }],
            max_tokens: step.maxTokens,
          });
          parsed = extractJson(retryText);
        }
        program.sections[step.key] = parsed;
      }
    } catch (err) {
      console.error(`Pipeline step "${step.key}" failed:`, err.message);
      // Even if the AI narrative fails, still save the computed score
      if (step.key === "riskOverview") {
        program.sections[step.key] = {
          postureScore: posture.postureScore,
          postureLevel: posture.postureLevel,
          executiveSummary: `This business has a ${posture.postureLevel.toLowerCase()} security posture (${posture.postureScore}/100). Weakest areas: ${posture.weakestAreas.join(" and ")}.`,
          topThreats: [],
          breakdown: {
            methodology: posture.methodology,
            functions: posture.functions,
            weakestAreas: posture.weakestAreas,
            complianceNote: posture.complianceNote,
          },
        };
      } else {
        program.sections[step.key] = null;
      }
    }
    await db.write();
  }

  program.status = "complete";
  await db.write();
  progressStore[programId] = { step: PIPELINE.length, total: PIPELINE.length, label: "Complete", status: "complete" };
}

app.get("/api/programs/:id/status", requireAuth, (req, res) => {
  const progress = progressStore[req.params.id];
  if (!progress) {
    const program = db.data.programs.find(p => p.id === req.params.id && p.userId === req.userId);
    if (!program) return res.status(404).json({ error: "Program not found" });
    return res.json({
      step: program.status === "complete" ? PIPELINE.length : 0,
      total: PIPELINE.length,
      label: program.status,
      status: program.status,
    });
  }
  res.json(progress);
});

app.get("/api/programs/:id", requireAuth, (req, res) => {
  const program = db.data.programs.find(p => p.id === req.params.id && p.userId === req.userId);
  if (!program) return res.status(404).json({ error: "Program not found" });
  res.json(program);
});

// Delete one of your own programs (used by "replace" on regenerate)
app.delete("/api/programs/:id", requireAuth, async (req, res) => {
  const before = (db.data.programs || []).length;
  db.data.programs = (db.data.programs || []).filter(
    p => !(p.id === req.params.id && p.userId === req.userId)
  );
  if (db.data.programs.length === before) {
    return res.status(404).json({ error: "Program not found" });
  }
  await db.write();
  res.json({ ok: true, deleted: req.params.id });
});

app.get("/api/assessments/:id/programs", requireAuth, (req, res) => {
  const programs = db.data.programs
    .filter(p => p.assessmentId === req.params.id && p.userId === req.userId)
    .map(p => ({ id: p.id, createdAt: p.createdAt, status: p.status }));
  res.json(programs);
});

// ─────────────────────────────────────────────────────────────
//  POLICY LIBRARY (catalog public, generation protected)
// ─────────────────────────────────────────────────────────────
app.get("/api/policy-catalog", (req, res) => {
  const catalog = POLICY_CATALOG.map(p => ({
    id: p.id, name: p.name, category: p.category, description: p.description, fields: p.fields,
  }));
  res.json(catalog);
});

app.post("/api/policies/generate", requireAuth, async (req, res) => {
  try {
    const { policyId, companyContext, answers } = req.body;
    const policyDef = POLICY_CATALOG.find(p => p.id === policyId);
    if (!policyDef) return res.status(404).json({ error: "Unknown policy ID" });

    const answersText = Object.entries(answers || {})
      .map(([key, value]) => {
        const field = policyDef.fields.find(f => f.id === key);
        return `- ${field ? field.label : key}: ${value}`;
      })
      .join("\n");

    const companyText = companyContext
      ? `Company: ${companyContext.name || "the company"}\nIndustry: ${companyContext.industry || "not specified"}\nEmployees: ${companyContext.employees || "not specified"}`
      : "Company details not provided.";

    const structurePrompt = buildStructurePrompt(policyId);
    const today = new Date().toISOString().slice(0, 10);

    const system = `You are a senior CISO writing a complete, professional, ready-to-use security policy document for a small business. The document must follow standard enterprise policy formatting (the same structure used by universities and large organizations). Write in clear, plain English that a non-technical business owner can follow, while remaining thorough and legally sound.

Begin the document with a header block exactly like this (fill in the values):

# [Policy Name]

**Policy Owner:** [responsible role]
**Effective Date:** ${today}
**Version:** 1.0
**Applies To:** [scope summary]

---

Then include these numbered sections as markdown level-2 headers (##), in this exact order, with substantive tailored content under each (no placeholders):

${structurePrompt}

Formatting rules:
- Use markdown: # for the title, ## for sections, **bold** for labels, and - bullets or numbered lists where appropriate.
- The Revision History section must be a markdown table with columns: Version | Date | Description.
- Tailor all content to the specific business using the details provided.
- Output ONLY the policy document, starting with the "# [Policy Name]" header. No commentary before or after.`;

    const userPrompt = `Generate a complete "${policyDef.name}" for the following business:\n\n${companyText}\n\nPolicy-specific details provided by the business:\n${answersText || "(none provided)"}\n\nPolicy purpose: ${policyDef.description}`;

    const text = await callClaudeText({
      system,
      messages: [{ role: "user", content: userPrompt }],
      max_tokens: 4000,
    });

    const docId = randomUUID();
    const record = {
      id: docId,
      userId: req.userId,
      policyId,
      policyName: policyDef.name,
      createdAt: new Date().toISOString(),
      companyContext: companyContext || null,
      answers: answers || {},
      content: text.trim(),
    };
    db.data.policyDocs.push(record);
    await db.write();
    res.json(record);
  } catch (err) {
    console.error("Policy generation error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/policies", requireAuth, (req, res) => {
  const list = db.data.policyDocs
    .filter(p => p.userId === req.userId)
    .map(p => ({ id: p.id, policyId: p.policyId, policyName: p.policyName, createdAt: p.createdAt }));
  res.json(list);
});

app.get("/api/policies/:id", requireAuth, (req, res) => {
  const record = db.data.policyDocs.find(p => p.id === req.params.id && p.userId === req.userId);
  if (!record) return res.status(404).json({ error: "Policy document not found" });
  res.json(record);
});

// Delete one of your own saved policies
app.delete("/api/policies/:id", requireAuth, async (req, res) => {
  const before = (db.data.policyDocs || []).length;
  db.data.policyDocs = (db.data.policyDocs || []).filter(
    p => !(p.id === req.params.id && p.userId === req.userId)
  );
  if (db.data.policyDocs.length === before) {
    return res.status(404).json({ error: "Policy document not found" });
  }
  await db.write();
  res.json({ ok: true, deleted: req.params.id });
});

// ─────────────────────────────────────────────────────────────
//  ADMIN ROUTES (admin only)
// ─────────────────────────────────────────────────────────────
app.get("/api/admin/users", requireAdmin, (req, res) => {
  const users = (db.data.users || []).map(u => {
    const assessments = (db.data.assessments || []).filter(a => a.userId === u.id);
    const programs = (db.data.programs || []).filter(p => p.userId === u.id);
    const policies = (db.data.policyDocs || []).filter(p => p.userId === u.id);
    return {
      id: u.id,
      email: u.email,
      companyName: u.companyName,
      isAdmin: !!u.isAdmin,
      createdAt: u.createdAt,
      stats: {
        assessments: assessments.length,
        programs: programs.length,
        completePrograms: programs.filter(p => p.status === "complete").length,
        stuckPrograms: programs.filter(p => p.status === "running").length,
        policies: policies.length,
      },
    };
  });
  res.json(users);
});

app.get("/api/admin/users/:id", requireAdmin, (req, res) => {
  const user = (db.data.users || []).find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const assessments = (db.data.assessments || [])
    .filter(a => a.userId === user.id)
    .map(a => ({ id: a.id, createdAt: a.createdAt, company: a.data?.company || {} }));

  const programs = (db.data.programs || [])
    .filter(p => p.userId === user.id)
    .map(p => ({
      id: p.id, assessmentId: p.assessmentId, createdAt: p.createdAt,
      status: p.status, sectionCount: Object.keys(p.sections || {}).length,
    }));

  const policies = (db.data.policyDocs || [])
    .filter(p => p.userId === user.id)
    .map(p => ({ id: p.id, policyName: p.policyName, createdAt: p.createdAt }));

  res.json({
    id: user.id,
    email: user.email,
    companyName: user.companyName,
    isAdmin: !!user.isAdmin,
    createdAt: user.createdAt,
    assessments,
    programs,
    policies,
  });
});

app.post("/api/admin/users/:id/reset-password", requireAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;
    const updated = await adminResetPassword(req.params.id, newPassword);
    res.json({ ok: true, user: updated });
  } catch (err) {
    const status = err.code === "NOT_FOUND" ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const result = await adminDeleteUser(req.params.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "FORBIDDEN" ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.delete("/api/admin/programs/:id", requireAdmin, async (req, res) => {
  const before = (db.data.programs || []).length;
  db.data.programs = (db.data.programs || []).filter(p => p.id !== req.params.id);
  if (db.data.programs.length === before) {
    return res.status(404).json({ error: "Program not found" });
  }
  await db.write();
  res.json({ ok: true, deleted: req.params.id });
});

app.delete("/api/admin/assessments/:id", requireAdmin, async (req, res) => {
  const before = (db.data.assessments || []).length;
  db.data.assessments = (db.data.assessments || []).filter(a => a.id !== req.params.id);
  if (db.data.assessments.length === before) {
    return res.status(404).json({ error: "Assessment not found" });
  }
  await db.write();
  res.json({ ok: true, deleted: req.params.id });
});

// Admin: bulk-delete all programs stuck in "running" status
app.post("/api/admin/clear-stuck", requireAdmin, async (req, res) => {
  const stuck = (db.data.programs || []).filter(p => p.status === "running");
  const stuckIds = stuck.map(p => p.id);
  db.data.programs = (db.data.programs || []).filter(p => p.status !== "running");
  await db.write();
  res.json({ ok: true, cleared: stuckIds.length, ids: stuckIds });
});

// Admin: fetch any program's full content (bypasses user scoping)
app.get("/api/admin/programs/:id", requireAdmin, (req, res) => {
  const program = (db.data.programs || []).find(p => p.id === req.params.id);
  if (!program) return res.status(404).json({ error: "Program not found" });
  const assessment = (db.data.assessments || []).find(a => a.id === program.assessmentId);
  res.json({ program, assessment: assessment ? assessment.data : null });
});

app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const users = db.data.users || [];
  res.json({
    totalUsers: users.length,
    adminUsers: users.filter(u => u.isAdmin).length,
    testingUsers: users.filter(u => !u.isAdmin).length,
    maxTestingUsers: MAX_USERS,
    slotsAvailable: Math.max(0, MAX_USERS - users.filter(u => !u.isAdmin).length),
    totalAssessments: (db.data.assessments || []).length,
    totalPrograms: (db.data.programs || []).length,
    stuckPrograms: (db.data.programs || []).filter(p => p.status === "running").length,
    totalPolicies: (db.data.policyDocs || []).length,
  });
});

// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ ShieldAI backend running at http://localhost:${PORT}`);
  console.log(`   Auth enabled · max ${MAX_USERS} testing accounts`);
  console.log(`   Admin: ${process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL : "(set ADMIN_EMAIL in .env)"}`);
});
