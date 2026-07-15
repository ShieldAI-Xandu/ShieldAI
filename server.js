// server.js
// ShieldAI backend: auth + AI proxy + database persistence + program pipeline.

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import db, { storeBinder } from "./db.js";
import {
  isDemoRequest,
  registerDemoRoutes,
  demoReadOnly,
  assertStoreSeparation,
  DEMO_PATH_PREFIX,
} from "./demoGateway.js";
import { PIPELINE } from "./generators.js";
import { registerAgentRoutes } from "./agentRoutes.js";
import { registerAdminRoutes } from "./adminRoutes.js";
import { registerBillingRoutes } from "./billingRoutes.js";
import { registerMastermindRoutes } from "./mastermindRoutes.js";
import { registerAssignmentRoutes, logClientAction, analystClientIds, analystOwnsClient } from "./assignmentRoutes.js";
import { buildCISPromptBlock, CIS_IMPLEMENTATION_GROUPS } from "./cisControls.js";
import { POLICY_CATALOG } from "./policyCatalog.js";
import { buildStructurePrompt } from "./policyFormats.js";
import { TRAINING_TOPICS, MANAGER_TOPICS, DEFAULT_SCHEDULE, getTopic } from "./trainingCatalog.js";
import { computePostureScore } from "./riskEngine.js";
import { makeTierGate, counters } from "./tierGate.js";
import {
  registerUser,
  loginUser,
  requireAuth,
  requireAdmin,
  getCurrentUser,
  adminResetPassword,
  changeOwnPassword,
  adminDeleteUser,
  MAX_USERS,
} from "./auth.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const gate = makeTierGate(db);
// Railway (and most PaaS) inject the port to listen on. Falling back to 3001
// keeps local dev unchanged.
const PORT = process.env.PORT || 3001;
// Must bind all interfaces in a container — binding localhost makes the app
// unreachable from outside, which looks exactly like a silent healthcheck fail.
const HOST = process.env.HOST || "0.0.0.0";

// ── Healthcheck ──────────────────────────────────────────────
// Registered first: no auth, no DB, no store binding. Railway's healthcheckPath
// points here, so it must answer 200 even if nothing else is ready, and it must
// never be swallowed by the SPA fallback below.
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

app.use(cors());
// The Stripe webhook needs the RAW body for signature verification, so exclude
// just that path from the global JSON parser. Everything else parses JSON.
app.use((req, res, next) => {
  if (req.originalUrl === "/api/billing/webhook") return next();
  return express.json({ limit: "5mb" })(req, res, next);
});

// ── DEMO / PRODUCTION BOUNDARY ───────────────────────────────
// Bind every request to exactly one data store before any route runs.
// Demo requests → demo-db.json. Everything else → db.json. Nothing downstream
// can reach across: db.data always resolves to the bound store.
app.use(storeBinder(isDemoRequest));

// The demo sandbox never writes. Blocks mutations on both the /api/demo
// routes and any real route reached with a demo token.
app.use((req, res, next) => (req.isDemo ? demoReadOnly(req, res, next) : next()));

// Demo billing and enrollment are meaningless and must never touch Stripe or
// mint real agent tokens — refuse outright rather than half-work.
app.use((req, res, next) => {
  if (req.isDemo && (req.path.startsWith("/api/billing") || req.path.startsWith("/api/admin"))) {
    return res.status(403).json({ error: "Not available in the demo sandbox.", code: "DEMO_RESTRICTED" });
  }
  next();
});

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

// Public lead-capture form (prospective customers requesting info)
app.post("/api/leads", async (req, res) => {
  try {
    const { name, email, company, employees, message } = req.body || {};
    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required." });
    }
    // Basic email sanity check
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    const lead = {
      id: randomUUID(),
      name: String(name).slice(0, 200),
      email: String(email).slice(0, 200),
      company: company ? String(company).slice(0, 200) : "",
      employees: employees ? String(employees).slice(0, 50) : "",
      message: message ? String(message).slice(0, 2000) : "",
      status: "new",
      createdAt: new Date().toISOString(),
    };
    db.data.leads ||= [];
    db.data.leads.push(lead);
    await db.write();
    res.json({ ok: true });
  } catch (err) {
    console.error("Lead capture error:", err.message);
    res.status(500).json({ error: "Could not submit your request. Please try again." });
  }
});

// Admin: view captured leads
app.get("/api/admin/leads", requireAdmin, (req, res) => {
  const leads = [...(db.data.leads || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(leads);
});

// Admin: update a lead's status (new | contacted | qualified | closed)
app.patch("/api/admin/leads/:id", requireAdmin, async (req, res) => {
  const lead = (db.data.leads || []).find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: "Lead not found." });
  const allowed = ["new", "contacted", "qualified", "closed"];
  const { status } = req.body || {};
  if (status !== undefined) {
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${allowed.join(", ")}.` });
    }
    lead.status = status;
  }
  await db.write();
  res.json(lead);
});

// Admin: delete a lead
app.delete("/api/admin/leads/:id", requireAdmin, async (req, res) => {
  const before = (db.data.leads || []).length;
  db.data.leads = (db.data.leads || []).filter(l => l.id !== req.params.id);
  if (db.data.leads.length === before) return res.status(404).json({ error: "Lead not found." });
  await db.write();
  res.json({ deleted: req.params.id });
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

// Change own password (normal self-service, or forced first-login change).
app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const user = await changeOwnPassword(req.userId, { currentPassword, newPassword });
    res.json({ ok: true, user });
  } catch (err) {
    const code = ["WEAK_PASSWORD", "SAME_PASSWORD"].includes(err.code) ? 400
      : err.code === "INVALID_CREDENTIALS" ? 401
      : err.code === "NOT_FOUND" ? 404 : 500;
    res.status(code).json({ error: err.message || "Could not change password." });
  }
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
app.post("/api/programs/generate", requireAuth, gate.capability("buildPrograms"), gate.limit("programs", counters.programs), async (req, res) => {
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
      } else if (step.key === "compliance") {
        // Framework-aware compliance mapping. The user selected which
        // frameworks apply in the assessment; honor that selection instead
        // of letting the AI guess. When CIS Controls is selected, inject the
        // real v8.1 control list for the chosen Implementation Group.
        const selected = Array.isArray(assessmentData.selectedFrameworks)
          ? assessmentData.selectedFrameworks : [];
        const cisEntry = selected.find(f => f.id === "cis");
        const userNamedFrameworks = selected
          .map(f => f.name + (f.id === "cis" && f.implementationGroup ? ` (${f.implementationGroup})` : ""))
          .filter(Boolean);

        let frameworkInstruction;
        if (userNamedFrameworks.length > 0) {
          frameworkInstruction =
            `The business has explicitly selected these compliance frameworks to be assessed against: ${userNamedFrameworks.join(", ")}. Produce a gap analysis for EACH selected framework — do not substitute or omit any.`;
        } else {
          frameworkInstruction =
            `Limit to the 2-3 most relevant frameworks for this business based on its industry and stated compliance needs.`;
        }

        let cisBlock = "";
        if (cisEntry) {
          const ig = cisEntry.implementationGroup || "IG1";
          const grp = CIS_IMPLEMENTATION_GROUPS[ig] || CIS_IMPLEMENTATION_GROUPS.IG1;
          cisBlock =
            `\n\nFor the CIS Controls framework, assess against CIS Controls v8.1 at ${ig} (${grp.tagline}). ` +
            `For the "name" field use exactly "CIS Controls v8.1 (${ig})". ` +
            `Draw the gap analysis "control" values from this authoritative control list (use the real control names):\n` +
            buildCISPromptBlock(ig);
        }

        const userContent =
          `Business context:\n${ctx}\n\n${frameworkInstruction}${cisBlock}\n\n` +
          `Generate the "compliance" section. Return ONLY valid JSON matching the schema in your instructions. Limit gaps to 3 per framework.`;

        let parsed = null;
        try {
          const text = await callClaudeText({
            system: step.system,
            messages: [{ role: "user", content: userContent }],
            max_tokens: step.maxTokens,
          });
          parsed = extractJson(text);
        } catch (firstErr) {
          console.warn(`Step "compliance" first attempt failed (${firstErr.message}); retrying…`);
          const retryText = await callClaudeText({
            system: step.system,
            messages: [{ role: "user", content: userContent + " Return strictly valid, minified JSON — no trailing commas, no text before or after." }],
            max_tokens: step.maxTokens,
          });
          parsed = extractJson(retryText);
        }
        program.sections[step.key] = parsed;
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

app.post("/api/policies/generate", requireAuth, gate.capability("createPolicies"), gate.limit("policies", counters.policies), async (req, res) => {
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
//  TRAINING PROGRAM ROUTES
// ─────────────────────────────────────────────────────────────

// Expose the topic backbone + default schedule for the builder UI
app.get("/api/training/catalog", requireAuth, (req, res) => {
  res.json({ topics: TRAINING_TOPICS, managerTopics: MANAGER_TOPICS, schedule: DEFAULT_SCHEDULE });
});

// Generate a full, company-tailored curriculum (hybrid: fixed backbone + AI detail)
app.post("/api/training/generate", requireAuth, gate.capability("trainingPrograms"), gate.limit("trainingPrograms", counters.trainingPrograms), async (req, res) => {
  try {
    const { companyContext, includeManagerTrack } = req.body || {};
    const company = companyContext || {};
    const companyText = `Company: ${company.name || "the business"}\nIndustry: ${company.industry || "general"}\nEmployees: ${company.employees || "small team"}`;

    // Build the backbone we want the AI to tailor (don't let it invent the structure)
    const backbone = DEFAULT_SCHEDULE.map(phase => ({
      phase: phase.phase,
      theme: phase.theme,
      note: phase.note || null,
      topics: phase.topicIds.map(id => {
        const t = getTopic(id);
        return { id: t.id, title: t.title, audience: t.audience, duration: t.duration, objectives: t.objectives, source: t.source };
      }),
    }));

    const managerTrack = includeManagerTrack
      ? MANAGER_TOPICS.map(t => ({ id: t.id, title: t.title, audience: t.audience, duration: t.duration, objectives: t.objectives, source: t.source }))
      : [];

    // Per-phase fallback builder (used if a phase's AI call fails)
    const phaseFallback = (ph) => ({
      phase: ph.phase, theme: ph.theme, note: ph.note,
      modules: ph.topics.map(t => ({
        id: t.id, title: t.title, audience: t.audience, duration: t.duration,
        objectives: t.objectives,
        tailoredIntro: `Essential for ${company.name || "your team"}: ${t.objectives[0].toLowerCase()}.`,
        realWorldScenario: "An employee receives an unexpected request that looks legitimate but isn't — recognizing the warning signs prevents a costly mistake.",
        quiz: [{ question: `What is the most important takeaway from "${t.title}"?`, options: [t.objectives[0], "Ignore it", "Forward to everyone", "Delete all email"], correct: 0 }],
      })),
    });

    // Generate ONE phase at a time so each response stays small (avoids truncation)
    async function generatePhase(ph) {
      const sys = `You are a cybersecurity awareness training designer for small businesses. Tailor the given CISA/NIST training modules to this specific company. DO NOT change the module titles, audiences, or objectives — only enrich them.

Return ONLY valid, minified JSON (no markdown, no trailing commas) in exactly this shape:
{"modules":[{"id":"","title":"","audience":"","duration":"","objectives":["keep provided objectives"],"tailoredIntro":"1-2 sentences on why this matters for THIS company","realWorldScenario":"a short concrete scenario for their industry","quiz":[{"question":"","options":["a","b","c","d"],"correct":0}]}]}

Exactly 1 quiz question per module with exactly 4 options. Keep every field concise.`;
      const usr = `${companyText}\n\nModules to tailor for the "${ph.theme}" phase:\n${JSON.stringify(ph.topics)}`;
      try {
        const text = await callClaudeText({ system: sys, messages: [{ role: "user", content: usr }], max_tokens: 3000 });
        const parsed = extractJson(text);
        if (!parsed.modules || !Array.isArray(parsed.modules) || parsed.modules.length === 0) throw new Error("no modules");
        return { phase: ph.phase, theme: ph.theme, note: ph.note, modules: parsed.modules };
      } catch (e) {
        console.warn(`Training phase "${ph.phase}" fell back: ${e.message}`);
        return phaseFallback(ph);
      }
    }

    // Build all phases (sequentially to be gentle on rate limits)
    const phases = [];
    for (const ph of backbone) {
      phases.push(await generatePhase(ph));
    }

    // Manager track (one small call, or fallback)
    let mgrOut = [];
    if (includeManagerTrack && managerTrack.length) {
      try {
        const sys = `Tailor these manager/owner cybersecurity training modules to the company. Keep titles, audiences, and objectives. Return ONLY valid minified JSON: {"modules":[{"id":"","title":"","audience":"","duration":"","objectives":[...],"tailoredIntro":"","quiz":[{"question":"","options":["a","b","c","d"],"correct":0}]}]}. Exactly 1 quiz question, 4 options each. Be concise.`;
        const usr = `${companyText}\n\nManager modules:\n${JSON.stringify(managerTrack)}`;
        const text = await callClaudeText({ system: sys, messages: [{ role: "user", content: usr }], max_tokens: 2500 });
        const parsed = extractJson(text);
        mgrOut = parsed.modules || [];
        if (!mgrOut.length) throw new Error("no manager modules");
      } catch (e) {
        console.warn(`Manager track fell back: ${e.message}`);
        mgrOut = managerTrack.map(t => ({
          id: t.id, title: t.title, audience: t.audience, duration: t.duration,
          objectives: t.objectives,
          tailoredIntro: `Leadership responsibility: ${t.objectives[0].toLowerCase()}.`,
          quiz: [{ question: `What is a manager's key role in "${t.title}"?`, options: [t.objectives[0], "Delegate entirely", "Avoid involvement", "Wait for an incident"], correct: 0 }],
        }));
      }
    }

    const curriculum = {
      overview: `A CISA/NIST-aligned security awareness program tailored for ${company.name || "your business"}${company.industry ? ` in the ${company.industry} sector` : ""}. Delivered over three months with quarterly refreshers.`,
      phases,
      managerTrack: mgrOut,
      deliveryTips: [
        "Keep sessions short (15-30 min) and schedule them during work hours.",
        "Run a simulated phishing test after Month 1 to reinforce learning.",
        "Track completion and follow up with anyone who misses a module.",
        "Refresh quarterly and whenever a policy changes.",
      ],
    };

    const record = {
      id: randomUUID(),
      userId: req.userId,
      createdAt: new Date().toISOString(),
      companyContext: company,
      includeManagerTrack: !!includeManagerTrack,
      curriculum,
    };
    db.data.trainingPrograms.push(record);
    await db.write();
    res.json(record);
  } catch (err) {
    console.error("Training generation error:", err.message);
    res.status(500).json({ error: "Failed to generate training program" });
  }
});

// List the user's saved training programs
app.get("/api/training", requireAuth, (req, res) => {
  const list = (db.data.trainingPrograms || [])
    .filter(t => t.userId === req.userId)
    .map(t => ({ id: t.id, createdAt: t.createdAt, companyContext: t.companyContext,
      moduleCount: (t.curriculum?.phases || []).reduce((s, p) => s + (p.modules?.length || 0), 0) }));
  res.json(list);
});

// Fetch one full training program
app.get("/api/training/:id", requireAuth, (req, res) => {
  const record = (db.data.trainingPrograms || []).find(t => t.id === req.params.id && t.userId === req.userId);
  if (!record) return res.status(404).json({ error: "Training program not found" });
  res.json(record);
});

// Delete a training program
app.delete("/api/training/:id", requireAuth, async (req, res) => {
  const before = (db.data.trainingPrograms || []).length;
  db.data.trainingPrograms = (db.data.trainingPrograms || []).filter(
    t => !(t.id === req.params.id && t.userId === req.userId)
  );
  if (db.data.trainingPrograms.length === before) {
    return res.status(404).json({ error: "Training program not found" });
  }
  await db.write();
  res.json({ ok: true, deleted: req.params.id });
});

// Generate (and cache) slides + a full quiz for ONE module within a saved program.
// Body: { programId, phaseIndex | "mgr", moduleIndex }
app.post("/api/training/module-content", requireAuth, async (req, res) => {
  try {
    const { programId, phaseIndex, moduleIndex } = req.body || {};
    const program = (db.data.trainingPrograms || []).find(t => t.id === programId && t.userId === req.userId);
    if (!program) return res.status(404).json({ error: "Training program not found" });

    // Locate the module (in a phase or the manager track)
    let mod;
    if (phaseIndex === "mgr") {
      mod = program.curriculum?.managerTrack?.[moduleIndex];
    } else {
      mod = program.curriculum?.phases?.[phaseIndex]?.modules?.[moduleIndex];
    }
    if (!mod) return res.status(404).json({ error: "Module not found" });

    // If already generated, return cached content
    if (mod.slides && mod.fullQuiz) {
      return res.json({ slides: mod.slides, fullQuiz: mod.fullQuiz, cached: true });
    }

    const company = program.companyContext || {};
    const companyText = `Company: ${company.name || "the business"} | Industry: ${company.industry || "general"} | Employees: ${company.employees || "small team"}`;

    const sys = `You are a cybersecurity trainer creating presentable employee-training material for a small business. For the given module, produce (1) a set of teaching SLIDES and (2) a full scored QUIZ.

Return ONLY valid, minified JSON (no markdown, no trailing commas) in exactly this shape:
{"slides":[{"title":"","bullets":["point 1","point 2","point 3"],"speakerNotes":"1-2 sentences the presenter can say"}],"fullQuiz":[{"question":"","options":["a","b","c","d"],"correct":0,"explanation":"why this is correct"}]}

Rules: produce 5-7 slides (title slide first, a summary/recap slide last). Each slide has 2-4 bullets. Produce exactly 6 quiz questions, each with 4 options and a one-sentence explanation. Tailor examples to the company's industry. Keep text concise and presentation-friendly.`;

    const usr = `${companyText}\n\nModule: ${mod.title}\nAudience: ${mod.audience}\nLearning objectives:\n${(mod.objectives||[]).map(o=>"- "+o).join("\n")}\n${mod.realWorldScenario ? "Scenario: "+mod.realWorldScenario : ""}`;

    let content;
    try {
      const text = await callClaudeText({ system: sys, messages: [{ role: "user", content: usr }], max_tokens: 3000 });
      content = extractJson(text);
      if (!Array.isArray(content.slides) || !Array.isArray(content.fullQuiz) || !content.slides.length || !content.fullQuiz.length) {
        throw new Error("incomplete content");
      }
    } catch (e) {
      console.warn(`Module content fell back for "${mod.title}": ${e.message}`);
      // Fallback: build slides from objectives + a simple quiz
      content = {
        slides: [
          { title: mod.title, bullets: [`Audience: ${mod.audience}`, `Duration: ${mod.duration}`, "Security awareness training"], speakerNotes: "Introduce the topic and why it matters for our business." },
          ...(mod.objectives||[]).map((o,i)=>({ title: `Key Point ${i+1}`, bullets: [o], speakerNotes: "Explain this objective with a relatable example." })),
          { title: "Recap", bullets: (mod.objectives||[]).slice(0,3), speakerNotes: "Summarize and open the floor for questions." },
        ],
        fullQuiz: (mod.objectives||[]).slice(0,3).map((o,i)=>({
          question: `Which statement best reflects good practice regarding: ${o}?`,
          options: [o, "Ignore established policy", "Share credentials freely", "Skip reporting incidents"],
          correct: 0,
          explanation: "Following the stated objective is the secure choice.",
        })),
      };
    }

    // Cache back into the saved program
    mod.slides = content.slides;
    mod.fullQuiz = content.fullQuiz;
    await db.write();

    res.json({ slides: content.slides, fullQuiz: content.fullQuiz, cached: false });
  } catch (err) {
    console.error("Module content error:", err.message);
    res.status(500).json({ error: "Failed to generate module content" });
  }
});

// ─────────────────────────────────────────────────────────────
//  LEADS — routes defined earlier (public POST /api/leads,
//  admin GET/PATCH/DELETE /api/admin/leads). Duplicate definitions
//  removed: Express uses the first-registered route, so these never ran.
// ─────────────────────────────────────────────────────────────

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
      isAnalyst: !!u.isAnalyst,
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
    isAnalyst: !!user.isAnalyst,
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
//  MONITORING AGENT ROUTES (enrollment, ingestion, fleet, recommendations)
// ─────────────────────────────────────────────────────────────
registerDemoRoutes(app, db);
registerAgentRoutes(app, { db, requireAuth, requireAdmin, callClaudeText, extractJson, logClientAction, analystClientIds, analystOwnsClient });
registerAdminRoutes(app, { db, requireAdmin, registerUser });
await registerBillingRoutes(app, { db, requireAuth, requireAdmin, express });
registerMastermindRoutes(app, { db, requireAdmin, requireAuth, callClaudeText, extractJson });
registerAssignmentRoutes(app, { db, requireAuth, requireAdmin });

// ─────────────────────────────────────────────────────────────
//  STATIC FRONTEND
// ─────────────────────────────────────────────────────────────
// Serve the built Vite app. This MUST come after every API route so it can
// never shadow one, and the SPA fallback excludes /api and /health so those
// keep returning real responses instead of index.html.
const DIST_DIR = path.join(__dirname, "dist");
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^\/(?!api\/|health$).*/, (req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
  console.log("ShieldAI static frontend served from ./dist");
} else {
  console.warn("⚠️  ./dist not found — frontend not served. Run `npm run build`.");
}

// ─────────────────────────────────────────────────────────────
// Fail loudly at boot if demo data ever leaked into production.
const separation = assertStoreSeparation();
if (!separation.ok) {
  console.error("\n✖ STORE SEPARATION VIOLATION\n  " + separation.message + "\n");
  process.exit(1);
}
console.log("✔ Demo/production stores are separate (db.json | demo-db.json)");

const server = app.listen(PORT, HOST, () => {
  console.log(`✅ ShieldAI backend listening on ${HOST}:${PORT}`);
  console.log(`   Auth enabled · max ${MAX_USERS} testing accounts`);
  console.log(`   Admin: ${process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL : "(set ADMIN_EMAIL in .env)"}`);
});

// Surface the real reason if the server can't stay up (e.g. port in use).
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n❌ Port ${PORT} is already in use — another server instance is probably still running.`);
    console.error(`   On Windows:  netstat -ano | findstr :${PORT}   then   taskkill /PID <pid> /F`);
  } else {
    console.error("\n❌ Server failed to start:", err);
  }
  process.exit(1);
});

// If something drains the event loop and the process tries to exit unexpectedly,
// log it so the cause is visible instead of a silent return to the prompt.
process.on("exit", (code) => {
  if (code === 0) console.error(`\n⚠️  Process exited (code 0). If this happened right after startup, the server did not stay alive — check for unhandled errors above.`);
});
process.on("uncaughtException", (err) => { console.error("\n❌ Uncaught exception:", err); process.exit(1); });
process.on("unhandledRejection", (err) => { console.error("\n❌ Unhandled promise rejection:", err); process.exit(1); });
