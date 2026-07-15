// brandingRoutes.js
// ShieldAI white-label branding.
//
// Lets an MSP/analyst (or admin, on behalf of one) present ShieldAI under their
// own brand: company display name, logo, accent colour, product name, and
// support contact. Clients assigned to that analyst see the analyst's brand
// instead of ShieldAI's default.
//
// Resolution order for a given client:
//   1. Branding of the analyst assigned to that client (first assignment wins)
//   2. Platform default branding (admin-owned, brandingId "platform")
//   3. Hard-coded ShieldAI defaults
//
// Staff (admin/analyst) always see their own brand when they have one.
//
// Mount from server.js:
//   import { registerBrandingRoutes, resolveBrandingForUser } from "./brandingRoutes.js";
//   registerBrandingRoutes(app, { db, requireAuth, requireAdmin });
//
// Mastermind integration: brandingSummary() is surfaced in portfolioSnapshot so
// Mastermind knows which clients are white-labelled and by whom. Read-only —
// Mastermind never mutates branding (advisory-only boundary preserved).

const nowIso = () => new Date().toISOString();

// ── Defaults ──────────────────────────────────────────────────
export const DEFAULT_BRANDING = Object.freeze({
  ownerUserId: null,
  productName: "ShieldAI",
  companyName: "ShieldAI",
  tagline: "Virtual CISO Platform",
  logoUrl: null,            // data URI or https URL; null → render wordmark
  primaryColor: "#2E5EAA",
  accentColor: "#22D3EE",
  supportEmail: null,
  supportUrl: null,
  footerNote: null,
  isDefault: true,
});

// ── Validation ────────────────────────────────────────────────
const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_LOGO_BYTES = 512 * 1024; // 512KB ceiling for data-URI logos

function badRequest(res, msg) {
  res.status(400).json({ error: msg });
  return null;
}

// Only allow https URLs or image data URIs. Blocks javascript:, http:, etc.
function validLogo(value) {
  if (value === null || value === "") return true;
  if (typeof value !== "string") return false;
  if (/^https:\/\/[^\s]+$/i.test(value)) return true;
  if (/^data:image\/(png|jpeg|jpg|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)) {
    return value.length <= MAX_LOGO_BYTES;
  }
  return false;
}

function sanitizeText(v, max = 120) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

// Validate an incoming patch. Returns {ok:true, patch} or {ok:false, error}.
export function validateBrandingPatch(input = {}) {
  const patch = {};

  if ("productName" in input) {
    const v = sanitizeText(input.productName, 40);
    if (!v) return { ok: false, error: "productName cannot be empty." };
    patch.productName = v;
  }
  if ("companyName" in input) {
    const v = sanitizeText(input.companyName, 80);
    if (!v) return { ok: false, error: "companyName cannot be empty." };
    patch.companyName = v;
  }
  if ("tagline" in input) patch.tagline = sanitizeText(input.tagline, 90);
  if ("footerNote" in input) patch.footerNote = sanitizeText(input.footerNote, 200);
  if ("supportEmail" in input) {
    const v = sanitizeText(input.supportEmail, 120);
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { ok: false, error: "supportEmail is not a valid address." };
    patch.supportEmail = v;
  }
  if ("supportUrl" in input) {
    const v = sanitizeText(input.supportUrl, 200);
    if (v && !/^https:\/\//i.test(v)) return { ok: false, error: "supportUrl must be an https:// URL." };
    patch.supportUrl = v;
  }
  for (const key of ["primaryColor", "accentColor"]) {
    if (key in input) {
      const v = sanitizeText(input[key], 7);
      if (!v || !HEX.test(v)) return { ok: false, error: `${key} must be a hex colour like #2E5EAA.` };
      patch[key] = v;
    }
  }
  if ("logoUrl" in input) {
    if (!validLogo(input.logoUrl)) {
      return { ok: false, error: "logoUrl must be an https:// URL or a base64 image data URI under 512KB." };
    }
    patch.logoUrl = input.logoUrl || null;
  }

  return { ok: true, patch };
}

// ── Store helpers ─────────────────────────────────────────────
function ensure(db) {
  db.data.branding ||= [];
  return db.data.branding;
}

export function getBrandingRecord(db, ownerUserId) {
  return ensure(db).find(b => b.ownerUserId === ownerUserId) || null;
}

function platformBranding(db) {
  return ensure(db).find(b => b.ownerUserId === "platform") || null;
}

function merged(record) {
  if (!record) return { ...DEFAULT_BRANDING };
  const { updatedAt, ...rest } = record;
  return { ...DEFAULT_BRANDING, ...rest, isDefault: false, updatedAt };
}

/**
 * Resolve the branding a given user should see.
 * - Staff with their own branding → their brand.
 * - Client → their assigned analyst's brand, else platform, else default.
 */
export function resolveBrandingForUser(db, user) {
  if (!user) return { ...DEFAULT_BRANDING };

  // Staff see their own brand if set.
  if (user.isAdmin || user.isAnalyst) {
    const own = getBrandingRecord(db, user.id);
    if (own) return merged(own);
  }

  // Clients inherit from their assigned analyst.
  if (!user.isAdmin && !user.isAnalyst) {
    const assignment = (db.data.assignments || []).find(a => a.clientUserId === user.id);
    if (assignment) {
      const analystBrand = getBrandingRecord(db, assignment.analystUserId);
      if (analystBrand) return merged(analystBrand);
    }
  }

  const plat = platformBranding(db);
  if (plat) return merged(plat);
  return { ...DEFAULT_BRANDING };
}

/**
 * Compact, read-only branding view for Mastermind's portfolio snapshot.
 * Tells Mastermind which brands exist and which clients are white-labelled,
 * without dumping logo blobs into the prompt.
 */
export function brandingSummary(db) {
  const records = ensure(db);
  const users = db.data.users || [];
  const assignments = db.data.assignments || [];
  const nameOf = (id) => {
    if (id === "platform") return "Platform default";
    const u = users.find(x => x.id === id);
    return u ? (u.companyName || u.email) : "—";
  };

  const brands = records.map(b => {
    const clientCount = b.ownerUserId === "platform"
      ? 0
      : assignments.filter(a => a.analystUserId === b.ownerUserId).length;
    return {
      owner: nameOf(b.ownerUserId),
      ownerUserId: b.ownerUserId,
      productName: b.productName || DEFAULT_BRANDING.productName,
      companyName: b.companyName || DEFAULT_BRANDING.companyName,
      hasLogo: !!b.logoUrl,
      primaryColor: b.primaryColor || DEFAULT_BRANDING.primaryColor,
      clientsBranded: clientCount,
      updatedAt: b.updatedAt,
    };
  });

  const clientUsers = users.filter(u => !u.isAdmin && !u.isAnalyst);
  const brandedClientIds = new Set(
    assignments
      .filter(a => records.some(b => b.ownerUserId === a.analystUserId))
      .map(a => a.clientUserId)
  );

  return {
    brandCount: brands.length,
    platformDefaultCustomized: !!platformBranding(db),
    clientsWhiteLabelled: clientUsers.filter(u => brandedClientIds.has(u.id)).length,
    clientsOnDefaultBrand: clientUsers.filter(u => !brandedClientIds.has(u.id)).length,
    brands,
  };
}

// ── Routes ────────────────────────────────────────────────────
export function registerBrandingRoutes(app, { db, requireAuth, requireAdmin }) {
  ensure(db);

  // Everyone: the branding THIS user should render.
  app.get("/api/branding", requireAuth, (req, res) => {
    const user = (db.data.users || []).find(u => u.id === req.userId);
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json(resolveBrandingForUser(db, user));
  });

  // Staff: read own branding record (falls back to defaults if unset).
  app.get("/api/branding/mine", requireAuth, (req, res) => {
    const user = (db.data.users || []).find(u => u.id === req.userId);
    if (!user) return res.status(404).json({ error: "User not found." });
    if (!user.isAdmin && !user.isAnalyst) {
      return res.status(403).json({ error: "Only analysts and admins can manage branding." });
    }
    const rec = getBrandingRecord(db, user.id);
    res.json(rec ? merged(rec) : { ...DEFAULT_BRANDING, ownerUserId: user.id });
  });

  // Staff: create/update own branding.
  app.put("/api/branding/mine", requireAuth, async (req, res) => {
    const user = (db.data.users || []).find(u => u.id === req.userId);
    if (!user) return res.status(404).json({ error: "User not found." });
    if (!user.isAdmin && !user.isAnalyst) {
      return res.status(403).json({ error: "Only analysts and admins can manage branding." });
    }

    const { ok, error, patch } = validateBrandingPatch(req.body || {});
    if (!ok) return badRequest(res, error);

    const list = ensure(db);
    let rec = list.find(b => b.ownerUserId === user.id);
    if (!rec) {
      rec = { ownerUserId: user.id, createdAt: nowIso() };
      list.push(rec);
    }
    Object.assign(rec, patch, { updatedAt: nowIso() });
    await db.write();
    res.json(merged(rec));
  });

  // Staff: reset own branding back to platform/default.
  app.delete("/api/branding/mine", requireAuth, async (req, res) => {
    const user = (db.data.users || []).find(u => u.id === req.userId);
    if (!user) return res.status(404).json({ error: "User not found." });
    if (!user.isAdmin && !user.isAnalyst) {
      return res.status(403).json({ error: "Only analysts and admins can manage branding." });
    }
    const list = ensure(db);
    const i = list.findIndex(b => b.ownerUserId === user.id);
    if (i >= 0) { list.splice(i, 1); await db.write(); }
    res.json({ ok: true, branding: resolveBrandingForUser(db, user) });
  });

  // Admin: set the platform-wide default brand (applies to unassigned clients).
  app.put("/api/admin/branding/platform", requireAdmin, async (req, res) => {
    const { ok, error, patch } = validateBrandingPatch(req.body || {});
    if (!ok) return badRequest(res, error);

    const list = ensure(db);
    let rec = list.find(b => b.ownerUserId === "platform");
    if (!rec) {
      rec = { ownerUserId: "platform", createdAt: nowIso() };
      list.push(rec);
    }
    Object.assign(rec, patch, { updatedAt: nowIso() });
    await db.write();
    res.json(merged(rec));
  });

  // Admin: overview of every brand + white-label coverage (also what
  // Mastermind sees via brandingSummary).
  app.get("/api/admin/branding", requireAdmin, (req, res) => {
    res.json(brandingSummary(db));
  });

  // Admin: preview what a specific client currently sees.
  app.get("/api/admin/branding/effective/:userId", requireAdmin, (req, res) => {
    const target = (db.data.users || []).find(u => u.id === req.params.userId);
    if (!target) return res.status(404).json({ error: "User not found." });
    res.json({
      user: { id: target.id, email: target.email, company: target.companyName || target.email },
      branding: resolveBrandingForUser(db, target),
    });
  });

  console.log("ShieldAI branding (white-label) routes registered.");
}
