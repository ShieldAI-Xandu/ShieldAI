// adminRoutes.js
// ShieldAI admin account-control backend. Adds capabilities the base admin
// routes don't cover: role elevation/demotion, subscription-tier changes,
// account repair/reset actions, a richer account profile, and an audit log.
//
// Every mutating action is admin-protected AND writes an entry to adminAudit
// so there's an accountable trail of who changed what.
//
// Mount from server.js:
//   import { registerAdminRoutes } from "./adminRoutes.js";
//   registerAdminRoutes(app, { db, requireAdmin });
//
// NOTE on tiers: this stage changes tier INTERNALLY only (the field on the
// user/subscription). It does not talk to Stripe — that's Stage 4, which will
// reconcile internal tier with the real subscription. Until then a tier change
// here is an administrative override.

import { randomUUID } from "crypto";
import { TIERS, TIER_ORDER, DEFAULT_TIER, getTier } from "./tiers.js";

const nowIso = () => new Date().toISOString();

// A user's effective tier (defaults to free if unset — no migration needed).
function userTier(user) {
  return user?.tier && TIERS[user.tier] ? user.tier : DEFAULT_TIER;
}

// Public projection of a user for admin views (never includes passwordHash).
function adminUserView(db, u) {
  const subs = (db.data.subscriptions || []).find(s => s.userId === u.id) || null;
  const agentCount = (db.data.agents || []).filter(a => a.ownerUserId === u.id && a.status !== "revoked").length;
  return {
    id: u.id,
    email: u.email,
    companyName: u.companyName || "",
    isAdmin: !!u.isAdmin,
    isAnalyst: !!u.isAnalyst,
    tier: userTier(u),
    suspended: !!u.suspended,
    mustChangePassword: !!u.mustChangePassword,
    createdAt: u.createdAt,
    subscription: subs ? {
      status: subs.status, currentPeriodEnd: subs.currentPeriodEnd,
      stripeCustomerId: subs.stripeCustomerId || null,
    } : null,
    counts: {
      endpoints: agentCount,
      assessments: (db.data.assessments || []).filter(a => a.userId === u.id).length,
      programs: (db.data.programs || []).filter(p => p.userId === u.id).length,
      policies: (db.data.policyDocs || []).filter(p => p.userId === u.id).length,
    },
  };
}

export function registerAdminRoutes(app, { db, requireAdmin, registerUser }) {
  db.data.adminAudit ||= [];
  db.data.subscriptions ||= [];

  // Write an audit entry. Call after a successful mutation.
  async function audit(req, action, targetUserId, detail) {
    db.data.adminAudit.push({
      id: randomUUID(),
      actorUserId: req.userId,
      actorEmail: req.userEmail || "",
      action,
      targetUserId: targetUserId || null,
      detail: detail || "",
      at: nowIso(),
    });
    await db.write();
  }

  const findUser = (id) => (db.data.users || []).find(u => u.id === id);

  // ── Rich account list (tier, role, subscription, counts) ────
  app.get("/api/admin/accounts", requireAdmin, (req, res) => {
    const out = (db.data.users || []).map(u => adminUserView(db, u));
    res.json(out);
  });

  // ── Single account profile ──────────────────────────────────
  app.get("/api/admin/accounts/:id", requireAdmin, (req, res) => {
    const u = findUser(req.params.id);
    if (!u) return res.status(404).json({ error: "Account not found." });
    res.json(adminUserView(db, u));
  });

  // ── Create a new account (admin) ────────────────────────────
  // Creates a brand-new account with an initial temp password and assigns a
  // role. The new user must change the password on first login (mustChangePassword).
  // body: { email, companyName?, role: "analyst"|"admin"|"client", tempPassword? }
  // If tempPassword is omitted, a strong one is generated and returned ONCE.
  app.post("/api/admin/accounts", requireAdmin, async (req, res) => {
    if (!registerUser) {
      return res.status(503).json({ error: "Account creation is not wired (registerUser unavailable)." });
    }
    const { email, companyName, role, tempPassword } = req.body || {};
    const normalized = (email || "").trim().toLowerCase();
    if (!normalized || !normalized.includes("@")) {
      return res.status(400).json({ error: "A valid email is required." });
    }
    if ((db.data.users || []).some(u => u.email === normalized)) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }
    const wantRole = ["analyst", "admin", "client"].includes(role) ? role : "client";

    // Use the provided temp password, or generate a strong one to show once.
    let pw = (tempPassword || "").trim();
    let generated = false;
    if (!pw) {
      pw = "Sa-" + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6).toUpperCase() + "!" + Math.floor(Math.random()*90+10);
      generated = true;
    }
    if (pw.length < 8) return res.status(400).json({ error: "Temp password must be at least 8 characters." });

    try {
      // registerUser handles hashing, the user cap, and email normalization.
      const { user } = await registerUser({ email: normalized, password: pw, companyName: companyName || "" });
      const created = (db.data.users || []).find(u => u.id === user.id);
      if (created) {
        if (wantRole === "admin") created.isAdmin = true;
        else if (wantRole === "analyst") created.isAnalyst = true;
        // force a password change on first login
        created.mustChangePassword = true;
        await db.write();
      }
      await audit(req, "create_account", user.id, `Created ${wantRole} account ${normalized}.`);
      res.json({
        account: adminUserView(db, created || user),
        // The temp password is returned ONCE. If the admin supplied it, we don't echo it back.
        tempPassword: generated ? pw : undefined,
        mustChangePassword: true,
      });
    } catch (err) {
      const code = err.code === "USER_LIMIT_REACHED" ? 409 : err.code === "WEAK_PASSWORD" ? 400 : 500;
      res.status(code).json({ error: err.message || "Could not create account." });
    }
  });

  // ── Role elevation / demotion ───────────────────────────────
  // body: { role: "admin"|"analyst"|"client", value: true|false }
  // "client" means a standard account (both flags false).
  app.post("/api/admin/accounts/:id/role", requireAdmin, async (req, res) => {
    const u = findUser(req.params.id);
    if (!u) return res.status(404).json({ error: "Account not found." });
    const { role, value } = req.body || {};

    // Guard: an admin cannot remove their OWN admin rights (prevents lockout).
    if (u.id === req.userId && role === "admin" && value === false) {
      return res.status(409).json({ error: "You cannot remove your own admin access." });
    }
    // Guard: don't allow removing the last admin in the system.
    if (role === "admin" && value === false) {
      const admins = (db.data.users || []).filter(x => x.isAdmin).length;
      if (admins <= 1 && u.isAdmin) {
        return res.status(409).json({ error: "Cannot remove the last remaining admin." });
      }
    }

    if (role === "admin") u.isAdmin = !!value;
    else if (role === "analyst") u.isAnalyst = !!value;
    else if (role === "client") { u.isAdmin = false; u.isAnalyst = false; }
    else return res.status(400).json({ error: "role must be 'admin', 'analyst', or 'client'." });

    await audit(req, "role_change", u.id, `Set ${role}=${value === undefined ? "(client reset)" : value}`);
    res.json(adminUserView(db, u));
  });

  // ── Tier change (internal override; Stripe sync comes in Stage 4) ──
  // body: { tier: "free"|"starter"|"growth"|"guided"|"managed", note?: string }
  app.post("/api/admin/accounts/:id/tier", requireAdmin, async (req, res) => {
    const u = findUser(req.params.id);
    if (!u) return res.status(404).json({ error: "Account not found." });
    const { tier, note } = req.body || {};
    if (!TIERS[tier]) {
      return res.status(400).json({ error: `tier must be one of: ${TIER_ORDER.join(", ")}.` });
    }
    const from = userTier(u);
    u.tier = tier;

    // Keep an internal subscription record in sync (status managed for real in Stage 4).
    let sub = (db.data.subscriptions || []).find(s => s.userId === u.id);
    if (!sub) {
      sub = { id: randomUUID(), userId: u.id, tier, status: tier === "free" ? "free" : "manual",
              stripeCustomerId: null, stripeSubscriptionId: null, currentPeriodEnd: null, updatedAt: nowIso() };
      db.data.subscriptions.push(sub);
    } else {
      sub.tier = tier;
      sub.status = tier === "free" ? "free" : (sub.stripeSubscriptionId ? sub.status : "manual");
      sub.updatedAt = nowIso();
    }

    const direction = getTier(tier).rank > getTier(from).rank ? "upgrade"
                    : getTier(tier).rank < getTier(from).rank ? "downgrade" : "no-change";
    await audit(req, "tier_change", u.id, `${from} → ${tier} (${direction})${note ? " · " + note : ""}`);
    res.json(adminUserView(db, u));
  });

  // ── Suspend / reactivate an account ─────────────────────────
  // body: { suspended: true|false }
  app.post("/api/admin/accounts/:id/suspend", requireAdmin, async (req, res) => {
    const u = findUser(req.params.id);
    if (!u) return res.status(404).json({ error: "Account not found." });
    const { suspended } = req.body || {};
    if (u.id === req.userId && suspended) {
      return res.status(409).json({ error: "You cannot suspend your own account." });
    }
    if (u.isAdmin && suspended) {
      return res.status(409).json({ error: "Suspend the admin role before suspending an admin account." });
    }
    u.suspended = !!suspended;
    await audit(req, suspended ? "suspend" : "reactivate", u.id, suspended ? "Account suspended." : "Account reactivated.");
    res.json(adminUserView(db, u));
  });

  // ── Repair / reset actions ──────────────────────────────────
  // Repairs an account's data integrity issues without deleting the account.
  // body: { actions: ["clear_stuck_programs"|"clear_orphans"|"reset_endpoints"] }
  app.post("/api/admin/accounts/:id/repair", requireAdmin, async (req, res) => {
    const u = findUser(req.params.id);
    if (!u) return res.status(404).json({ error: "Account not found." });
    const actions = Array.isArray(req.body?.actions) ? req.body.actions : [];
    if (actions.length === 0) return res.status(400).json({ error: "Provide one or more actions." });

    const result = {};

    if (actions.includes("clear_stuck_programs")) {
      // Programs left in "running" become "error" so the user can regenerate.
      let n = 0;
      for (const p of (db.data.programs || [])) {
        if (p.userId === u.id && p.status === "running") { p.status = "error"; n++; }
      }
      result.clearedStuckPrograms = n;
    }

    if (actions.includes("clear_orphans")) {
      // Remove programs/policy docs that reference a missing assessment.
      const assessmentIds = new Set((db.data.assessments || []).filter(a => a.userId === u.id).map(a => a.id));
      const beforeP = (db.data.programs || []).length;
      db.data.programs = (db.data.programs || []).filter(p =>
        p.userId !== u.id || !p.assessmentId || assessmentIds.has(p.assessmentId));
      result.removedOrphanPrograms = beforeP - db.data.programs.length;
    }

    if (actions.includes("reset_endpoints")) {
      // Revoke all of the user's agents (forces re-enrollment). Non-destructive
      // to reports; just invalidates tokens.
      let n = 0;
      for (const a of (db.data.agents || [])) {
        if (a.ownerUserId === u.id && a.status !== "revoked") {
          a.status = "revoked"; a.revokedAt = nowIso(); n++;
        }
      }
      result.revokedEndpoints = n;
    }

    await audit(req, "repair", u.id, `Actions: ${actions.join(", ")} → ${JSON.stringify(result)}`);
    res.json({ ok: true, result });
  });

  // ── Audit log ───────────────────────────────────────────────
  // Optional ?targetUserId= filter; newest first.
  app.get("/api/admin/audit", requireAdmin, (req, res) => {
    let rows = [...(db.data.adminAudit || [])];
    if (req.query.targetUserId) rows = rows.filter(r => r.targetUserId === req.query.targetUserId);
    rows.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json(rows.slice(0, 500));
  });

  console.log("ShieldAI admin account-control routes registered.");
}
