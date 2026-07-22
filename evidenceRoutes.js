// evidenceRoutes.js
// ShieldAI evidence collection.
//
// WHY THIS EXISTS
// ---------------
// Auditors, insurers, and boards don't accept "we say we did it" — they want
// proof. Evidence attaches a file or note to a task, a control, or an
// assessment, with who uploaded it and when. Without this, ShieldAI can't
// support the three moments clients feel value most: audit, insurance
// renewal, and board review.
//
// STORAGE MODEL
// -------------
// Files are written to DB_DIR/evidence/<ownerUserId>/<id><ext> — DB_DIR is the
// mounted Railway volume (/data), so evidence survives redeploys. Only
// METADATA goes in db.json; the bytes never do (that would bloat the JSON
// database and slow every read).
//
// Uploads arrive as base64 through the existing express.json parser (5mb cap),
// matching how branding logos already work — no multipart dependency needed.
//
// Mount from server.js:
//   import { registerEvidenceRoutes } from "./evidenceRoutes.js";
//   registerEvidenceRoutes(app, { db, requireAuth, requireAdmin, logClientAction,
//                                 analystOwnsClient, analystClientIds });

import { randomUUID, createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = process.env.DB_DIR || __dirname;
const EVIDENCE_DIR = path.join(DB_DIR, "evidence");

const nowIso = () => new Date().toISOString();

// Hard ceiling per file. express.json is capped at 5mb and base64 inflates by
// ~33%, so 3.5MB of real bytes is the practical maximum.
const MAX_BYTES = 3.5 * 1024 * 1024;

// Only formats that make sense as audit evidence. Deliberately excludes
// executables and archives — this is a proof store, not a file share.
const ALLOWED = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/msword": ".doc",
  "application/vnd.ms-excel": ".xls",
};

export const EVIDENCE_KINDS = ["task", "control", "assessment", "general"];

function ensure(db) {
  db.data.evidence ||= [];
  return db.data.evidence;
}

/** Safe filename: strip paths, control chars, and keep it short. */
function safeName(name) {
  const base = String(name || "evidence").split(/[/\\]/).pop();
  return base.replace(/[\u0000-\u001f<>:"|?*]/g, "").slice(0, 120) || "evidence";
}

/**
 * Parse a data URI or raw base64 into a Buffer.
 * Returns { ok, buffer, mime, error }.
 */
function decodeUpload(content, declaredMime) {
  if (typeof content !== "string" || !content) {
    return { ok: false, error: "content is required (base64 or data URI)." };
  }
  let b64 = content;
  let mime = declaredMime;

  const m = /^data:([^;,]+);base64,(.*)$/s.exec(content);
  if (m) { mime = m[1]; b64 = m[2]; }

  if (!mime) return { ok: false, error: "mimeType is required when content is not a data URI." };
  if (!ALLOWED[mime]) {
    return { ok: false, error: `Unsupported file type "${mime}". Allowed: PDF, images, text, CSV, Word, Excel.` };
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) {
    return { ok: false, error: "content is not valid base64." };
  }

  let buffer;
  try { buffer = Buffer.from(b64, "base64"); }
  catch { return { ok: false, error: "Could not decode base64 content." }; }

  if (!buffer.length) return { ok: false, error: "File is empty." };
  if (buffer.length > MAX_BYTES) {
    return { ok: false, error: `File is ${(buffer.length/1024/1024).toFixed(1)}MB — the limit is 3.5MB.` };
  }
  return { ok: true, buffer, mime };
}

function publicEvidence(db, e) {
  const users = db.data.users || [];
  const nameOf = (id) => { const u = users.find(x => x.id === id); return u ? (u.companyName || u.email) : "—"; };
  const { storagePath, ...rest } = e; // never expose the on-disk path
  return {
    ...rest,
    uploadedByName: e.uploadedBy ? nameOf(e.uploadedBy) : null,
    ownerName: nameOf(e.ownerUserId),
    downloadUrl: `/api/evidence/${e.id}/download`,
  };
}

/**
 * Read-only evidence summary for Mastermind's portfolio snapshot.
 * Counts and coverage only — never file contents.
 */
export function evidenceSummary(db, depth = "summary") {
  const items = ensure(db);
  const users = db.data.users || [];
  const tasks = db.data.tasks || [];
  const nameOf = (id) => { const u = users.find(x => x.id === id); return u ? (u.companyName || u.email) : "—"; };
  const full = depth === "full";

  const doneTasks = tasks.filter(t => t.status === "done");
  const doneWithEvidence = doneTasks.filter(t =>
    items.some(e => e.kind === "task" && e.refId === t.id)).length;

  return {
    total: items.length,
    totalBytes: items.reduce((s, e) => s + (e.bytes || 0), 0),
    byKind: items.reduce((m, e) => { m[e.kind] = (m[e.kind] || 0) + 1; return m; }, {}),
    // The number that matters for audit readiness: completed work that can
    // actually be proven.
    completedTasks: doneTasks.length,
    completedTasksWithEvidence: doneWithEvidence,
    completedTasksMissingEvidence: doneTasks.length - doneWithEvidence,
    ...(full ? {
      items: items.slice(-30).map(e => ({
        client: nameOf(e.ownerUserId), title: e.title, kind: e.kind,
        filename: e.filename, uploadedAt: e.uploadedAt,
      })),
    } : {}),
  };
}

export function registerEvidenceRoutes(app, {
  db, requireAuth, requireAdmin, logClientAction, analystOwnsClient, analystClientIds,
}) {
  ensure(db);

  const userById = (id) => (db.data.users || []).find(u => u.id === id) || null;

  function canAccess(actor, ownerUserId) {
    if (!actor) return false;
    if (actor.isAdmin) return true;
    if (actor.id === ownerUserId) return true;
    if (actor.isAnalyst && analystOwnsClient) return analystOwnsClient(db, actor.id, ownerUserId);
    return false;
  }

  // Verify the thing we're attaching to exists and belongs to the owner.
  function validateRef(kind, refId, ownerUserId) {
    if (kind === "general") return { ok: true };
    if (!refId) return { ok: false, error: `refId is required for kind "${kind}".` };
    if (kind === "task") {
      const t = (db.data.tasks || []).find(x => x.id === refId);
      if (!t) return { ok: false, error: "Task not found." };
      if (t.ownerUserId !== ownerUserId) return { ok: false, error: "Task belongs to a different client." };
      return { ok: true };
    }
    if (kind === "assessment") {
      const a = (db.data.assessments || []).find(x => x.id === refId);
      if (!a) return { ok: false, error: "Assessment not found." };
      if (a.userId !== ownerUserId) return { ok: false, error: "Assessment belongs to a different client." };
      return { ok: true };
    }
    if (kind === "control") return { ok: true }; // refId is a control id string
    return { ok: false, error: "Unknown kind." };
  }

  // ── Upload ──
  app.post("/api/evidence", requireAuth, async (req, res) => {
    const actor = userById(req.userId);
    const {
      ownerUserId, kind = "general", refId, title, note,
      filename, mimeType, content,
    } = req.body || {};

    const owner = ownerUserId || req.userId;
    if (!canAccess(actor, owner)) return res.status(403).json({ error: "Not permitted." });
    // `owner` is used to build a filesystem path below (EVIDENCE_DIR/<owner>/...).
    // It must resolve to a real user record — never just "whatever the caller
    // sent" — or a crafted ownerUserId (e.g. containing "../") could write
    // outside the evidence directory. canAccess() already restricts WHO can
    // set an arbitrary owner (admins, or an analyst's own assigned clients),
    // but doesn't confirm the id is real; this closes that gap.
    if (!userById(owner)) {
      return res.status(400).json({ error: "ownerUserId does not match an existing user." });
    }
    if (!EVIDENCE_KINDS.includes(kind)) {
      return res.status(400).json({ error: `kind must be one of: ${EVIDENCE_KINDS.join(", ")}` });
    }

    const ref = validateRef(kind, refId, owner);
    if (!ref.ok) return res.status(400).json({ error: ref.error });

    // A note-only record is valid evidence (e.g. "confirmed verbally with IT").
    const noteOnly = !content;
    if (noteOnly && !note && !title) {
      return res.status(400).json({ error: "Provide a file, or a title/note." });
    }

    let stored = null;
    if (!noteOnly) {
      const dec = decodeUpload(content, mimeType);
      if (!dec.ok) return res.status(400).json({ error: dec.error });

      const id = randomUUID();
      const ext = ALLOWED[dec.mime];
      const dir = path.join(EVIDENCE_DIR, owner);
      const abs = path.join(dir, `${id}${ext}`);
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(abs, dec.buffer);
      } catch (e) {
        return res.status(500).json({ error: `Could not store file: ${e.message}` });
      }
      stored = {
        id, storagePath: abs, mimeType: dec.mime, bytes: dec.buffer.length,
        // Integrity hash — lets an auditor confirm the file wasn't swapped.
        sha256: createHash("sha256").update(dec.buffer).digest("hex"),
      };
    }

    const record = {
      id: stored?.id || randomUUID(),
      ownerUserId: owner,
      kind,
      refId: refId || null,
      title: String(title || safeName(filename) || "Evidence note").slice(0, 160),
      note: String(note || "").slice(0, 2000),
      filename: filename ? safeName(filename) : null,
      mimeType: stored?.mimeType || null,
      bytes: stored?.bytes || 0,
      sha256: stored?.sha256 || null,
      storagePath: stored?.storagePath || null,
      uploadedBy: req.userId,
      uploadedAt: nowIso(),
    };

    ensure(db).push(record);

    // Mirror onto the task so the task card can show evidence without a join.
    if (kind === "task") {
      const t = (db.data.tasks || []).find(x => x.id === refId);
      if (t) {
        t.evidence = t.evidence || [];
        t.evidence.push({ id: record.id, title: record.title, filename: record.filename, at: record.uploadedAt });
        t.updatedAt = nowIso();
      }
    }

    if (logClientAction) {
      try {
        logClientAction(db, {
          clientUserId: owner, actorUserId: req.userId,
          actorRole: actor.isAdmin ? "admin" : actor.isAnalyst ? "analyst" : "client_admin",
          action: "evidence_added", detail: record.title,
        });
      } catch { /* non-fatal */ }
    }

    await db.write();
    res.status(201).json(publicEvidence(db, record));
  });

  // ── List ──
  app.get("/api/evidence", requireAuth, (req, res) => {
    const actor = userById(req.userId);
    if (!actor) return res.status(404).json({ error: "User not found." });

    let scope;
    if (req.query.clientId) {
      if (!canAccess(actor, req.query.clientId)) return res.status(403).json({ error: "Not permitted." });
      scope = [req.query.clientId];
    } else if (actor.isAdmin) {
      scope = null;
    } else if (actor.isAnalyst && analystClientIds) {
      scope = [...analystClientIds(db, actor.id), actor.id];
    } else {
      scope = [actor.id];
    }

    let list = ensure(db);
    if (scope) list = list.filter(e => scope.includes(e.ownerUserId));
    if (req.query.kind) list = list.filter(e => e.kind === req.query.kind);
    if (req.query.refId) list = list.filter(e => e.refId === req.query.refId);

    list = [...list].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    res.json(list.map(e => publicEvidence(db, e)));
  });

  // ── Download ──
  app.get("/api/evidence/:id/download", requireAuth, async (req, res) => {
    const actor = userById(req.userId);
    const e = ensure(db).find(x => x.id === req.params.id);
    if (!e) return res.status(404).json({ error: "Evidence not found." });
    if (!canAccess(actor, e.ownerUserId)) return res.status(403).json({ error: "Not permitted." });
    if (!e.storagePath) return res.status(404).json({ error: "This evidence is a note, not a file." });

    try {
      const buf = await fs.readFile(e.storagePath);
      res.setHeader("Content-Type", e.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition",
        `attachment; filename="${(e.filename || "evidence").replace(/"/g, "")}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(buf);
    } catch {
      res.status(410).json({ error: "The stored file is no longer available on disk." });
    }
  });

  // ── Delete ──
  app.delete("/api/evidence/:id", requireAuth, async (req, res) => {
    const actor = userById(req.userId);
    const list = ensure(db);
    const i = list.findIndex(x => x.id === req.params.id);
    if (i < 0) return res.status(404).json({ error: "Evidence not found." });
    if (!canAccess(actor, list[i].ownerUserId)) return res.status(403).json({ error: "Not permitted." });

    const [removed] = list.splice(i, 1);

    // Unlink from the task mirror.
    if (removed.kind === "task") {
      const t = (db.data.tasks || []).find(x => x.id === removed.refId);
      if (t && Array.isArray(t.evidence)) {
        t.evidence = t.evidence.filter(ev => ev.id !== removed.id);
      }
    }
    // Best-effort file cleanup; metadata removal is what matters.
    if (removed.storagePath) {
      try { await fs.unlink(removed.storagePath); } catch { /* already gone */ }
    }
    await db.write();
    res.json({ ok: true });
  });

  // ── Audit-readiness: completed work that can't be proven ──
  app.get("/api/evidence/coverage", requireAuth, (req, res) => {
    const actor = userById(req.userId);
    const targetId = req.query.clientId || req.userId;
    if (!canAccess(actor, targetId)) return res.status(403).json({ error: "Not permitted." });

    const items = ensure(db).filter(e => e.ownerUserId === targetId);
    const tasks = (db.data.tasks || []).filter(t => t.ownerUserId === targetId && t.status === "done");
    const withEv = tasks.filter(t => items.some(e => e.kind === "task" && e.refId === t.id));
    const missing = tasks.filter(t => !items.some(e => e.kind === "task" && e.refId === t.id));

    res.json({
      completedTasks: tasks.length,
      withEvidence: withEv.length,
      missingEvidence: missing.length,
      coveragePct: tasks.length ? Math.round((withEv.length / tasks.length) * 100) : 100,
      missing: missing.map(t => ({ id: t.id, title: t.title, completedAt: t.completedAt })),
      totalEvidence: items.length,
    });
  });

  console.log("ShieldAI evidence routes registered.");
}
