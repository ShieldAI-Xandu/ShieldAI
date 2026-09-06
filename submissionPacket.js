// submissionPacket.js
// Builds the data behind a client's per-framework "submission packet" report
// (reportRoutes.js's "framework-packet" type) — the artifact a client hands
// to a cyber-insurance underwriter or a regulator: this framework's control
// status, remediation attestation history, and itemized evidence, all in one
// place. Read-only; never mutates.
//
// Composed entirely from pieces that already exist rather than a new engine:
// evaluateFramework/evaluateWithAgent (complianceBridge.js) for the real
// control status — the same engine the client's own Compliance tab uses —
// and checkFrameworkAccess/annotateWithAttestations (complianceRoutes.js)
// for the exact same access rule and attestation join that tab already
// applies, so this can't silently drift from what the client sees in-app.

import { getFrameworkDef, evaluateFramework, evaluateWithAgent, toRegistryId } from "./complianceBridge.js";
import { toAssessOpts } from "./frameworkIntake.js";
import { checkFrameworkAccess, annotateWithAttestations } from "./complianceRoutes.js";
import { computePostureScore } from "./riskEngine.js";

function latestAssessmentFor(db, userId) {
  const list = (db.data.assessments || []).filter((a) => a.userId === userId);
  if (!list.length) return null;
  return list.reduce(
    (best, a) =>
      !best || new Date(a.updatedAt || a.createdAt) > new Date(best.updatedAt || best.createdAt)
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
    try { out[toRegistryId(fid)] = toAssessOpts(toRegistryId(fid), answers); } catch { /* skip malformed scoping */ }
  }
  return out;
}

// Most recent agent report per host — agents report repeatedly, and counting
// every historical report would make one laptop look like a fleet. Same
// de-dup as the walkthrough route in complianceRoutes.js.
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

/**
 * Returns `{ error: { status, body } }` on any failure reportRoutes.js should
 * surface as that HTTP status/body, otherwise the full packet data
 * buildFrameworkPacketReport() renders.
 */
export function buildSubmissionPacketData(db, gate, clientId, frameworkId) {
  const client = (db.data.users || []).find((u) => u.id === clientId);
  if (!client) return { error: { status: 404, body: { error: "Client not found." } } };

  const def = getFrameworkDef(frameworkId);
  if (!def) return { error: { status: 404, body: { error: "Unknown framework." } } };

  const a = latestAssessmentFor(db, clientId);
  if (!a) return { error: { status: 400, body: { error: "This client has no completed assessment yet." } } };

  // Same "only what they selected, capped to their plan's limit" rule the
  // Compliance tab enforces — a client can't build a packet for a framework
  // they never selected or that's beyond their plan.
  const access = checkFrameworkAccess(gate, clientId, def, a);
  if (!access.ok) return { error: { status: access.status, body: access.body } };

  const checklist = checklistOf(a);
  const opts = optsFor(a)[toRegistryId(frameworkId)] || {};
  const reports = agentReportsFor(db, clientId);
  const report = reports.length
    ? evaluateWithAgent(frameworkId, checklist, reports, opts)
    : evaluateFramework(frameworkId, checklist, opts);

  if (!report || report.notControlMapped) {
    return {
      error: {
        status: 400,
        body: {
          error: `${def.name} doesn't have a control-by-control walkthrough to build a submission packet from — it's scored through the posture engine or an AI-assisted gap analysis instead.`,
        },
      },
    };
  }

  const requirements = annotateWithAttestations(db, report.requirements, clientId, def.id);

  // Itemize evidence per requirement. The only place that writes kind:"control"
  // evidence is ComplianceWorkspace.jsx's "Mark remediated" flow, which tags it
  // "<frameworkId>:<requirementId>" — match on that exactly, not by control id.
  const evidenceByRequirement = new Map();
  for (const e of db.data.evidence || []) {
    if (e.ownerUserId !== clientId || e.kind !== "control") continue;
    const [fwId, requirementId] = String(e.refId || "").split(":");
    if (fwId !== def.id) continue;
    if (!evidenceByRequirement.has(requirementId)) evidenceByRequirement.set(requirementId, []);
    evidenceByRequirement.get(requirementId).push({
      id: e.id, title: e.title, note: e.note, filename: e.filename, uploadedAt: e.uploadedAt,
    });
  }

  const evidenceIds = new Set();
  for (const r of requirements) {
    r.evidence = evidenceByRequirement.get(r.id) || [];
    r.evidence.forEach((e) => evidenceIds.add(e.id));
  }

  const posture = computePostureScore(a.data);

  return {
    client: { id: client.id, name: client.companyName || client.email, industry: client.industry || null },
    generatedAt: new Date().toISOString(),
    frameworkId: def.id,
    frameworkName: def.name,
    frameworkCitation: def.citation || null,
    assessedAt: a.updatedAt || a.createdAt,
    posture: { score: posture.postureScore, level: posture.postureLevel },
    summary: report.summary,
    requirements,
    evidenceIds: [...evidenceIds],
  };
}
