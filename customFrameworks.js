// customFrameworks.js
// Lets ShieldAI support compliance frameworks that aren't built in. An admin
// (or analyst) can register a framework by name, description, and its controls;
// clients can then select it in an assessment, and the compliance gap-analysis
// step assesses against its real controls — not invented ones.
//
// HONESTY NOTE: a custom framework is only as good as the controls entered for
// it. If someone adds just a name with no controls, the gap analysis has nothing
// authoritative to assess against, so we flag that state rather than pretend.
// This does NOT change the deterministic NIST posture score (that engine is
// NIST-specific); custom frameworks feed the compliance gap-analysis section.

import { randomUUID } from "crypto";

// Normalize a framework name into a stable key for matching against
// assessmentData.selectedFrameworks (which stores names).
export function frameworkKey(name) {
  return String(name || "").trim().toLowerCase();
}

export function listFrameworks(db) {
  return (db.data.customFrameworks || []).map(f => ({
    id: f.id, name: f.name, description: f.description,
    controlCount: (f.controls || []).length,
    createdAt: f.createdAt, updatedAt: f.updatedAt,
  }));
}

export function getFramework(db, idOrName) {
  const key = frameworkKey(idOrName);
  return (db.data.customFrameworks || []).find(
    f => f.id === idOrName || frameworkKey(f.name) === key
  ) || null;
}

export async function upsertFramework(db, { id, name, description, controls }, actorId) {
  db.data.customFrameworks ||= [];
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Framework name is required.");

  // Controls: accept array of {id?, title, description?, category?} or plain strings.
  const cleanControls = (Array.isArray(controls) ? controls : []).map((c, i) => {
    if (typeof c === "string") return { id: `C${i + 1}`, title: c.trim(), description: "", category: "" };
    return {
      id: (c.id && String(c.id).trim()) || `C${i + 1}`,
      title: String(c.title || "").trim(),
      description: String(c.description || "").trim(),
      category: String(c.category || "").trim(),
    };
  }).filter(c => c.title);

  const now = new Date().toISOString();
  let existing = id ? (db.data.customFrameworks.find(f => f.id === id)) : getFramework(db, cleanName);

  if (existing) {
    existing.name = cleanName;
    existing.description = String(description || "").trim();
    existing.controls = cleanControls;
    existing.updatedAt = now;
    existing.updatedBy = actorId || existing.updatedBy;
    await db.write();
    return existing;
  }

  const fw = {
    id: randomUUID(), name: cleanName, description: String(description || "").trim(),
    controls: cleanControls, createdAt: now, updatedAt: now, createdBy: actorId || null,
  };
  db.data.customFrameworks.push(fw);
  await db.write();
  return fw;
}

export async function deleteFramework(db, id) {
  db.data.customFrameworks ||= [];
  const before = db.data.customFrameworks.length;
  db.data.customFrameworks = db.data.customFrameworks.filter(f => f.id !== id);
  await db.write();
  return db.data.customFrameworks.length < before;
}

// Build a prompt block describing any selected custom frameworks + their real
// controls, so the compliance step assesses against them (parallel to the CIS
// block). Returns "" if none of the selected frameworks are custom.
export function buildCustomFrameworkBlock(db, selectedFrameworks) {
  const selected = (Array.isArray(selectedFrameworks) ? selectedFrameworks : []).map(frameworkKey);
  if (selected.length === 0) return "";
  const matches = (db.data.customFrameworks || []).filter(f => selected.includes(frameworkKey(f.name)));
  if (matches.length === 0) return "";

  let block = "\n\nCUSTOM FRAMEWORKS (assess against these EXACT controls — do not invent controls):";
  for (const f of matches) {
    block += `\n\n### ${f.name}`;
    if (f.description) block += `\n${f.description}`;
    if ((f.controls || []).length === 0) {
      block += `\n(No controls have been defined for this framework yet — note in the gap analysis that controls need to be entered before a meaningful assessment is possible; do not fabricate controls.)`;
    } else {
      block += "\nControls:";
      for (const c of f.controls) {
        block += `\n- [${c.id}] ${c.title}${c.category ? ` (${c.category})` : ""}${c.description ? `: ${c.description}` : ""}`;
      }
    }
  }
  return block;
}

export function registerCustomFrameworkRoutes(app, { db, requireAuth, requireAdmin }) {
  // Any authenticated user can list frameworks (needed to select them in an assessment).
  app.get("/api/frameworks", requireAuth, (req, res) => {
    res.json({ frameworks: listFrameworks(db) });
  });

  app.get("/api/frameworks/:id", requireAuth, (req, res) => {
    const fw = getFramework(db, req.params.id);
    if (!fw) return res.status(404).json({ error: "Framework not found." });
    res.json({ framework: fw });
  });

  // Create/update/delete require admin (staff curate the framework catalog).
  app.post("/api/frameworks", requireAdmin, async (req, res) => {
    try {
      const fw = await upsertFramework(db, req.body || {}, req.userId);
      res.json({ framework: fw });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/frameworks/:id", requireAdmin, async (req, res) => {
    const ok = await deleteFramework(db, req.params.id);
    res.json({ ok });
  });
}
