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
import { TIERS, TIER_ORDER, DEFAULT_TIER, getTier, hasCapability, addonPriceLabel } from "./tiers.js";
import {
  newEntitlement, assignEntitlement, cancelEntitlement, findEntitlement,
  entitlementsFor, publicEntitlement, frameworkAllowance, isFoundation,
  entitlementForFramework, ENTITLEMENT_STATUSES, INVOICE_STATES, FRAMEWORK_ADDON_ID,
} from "./frameworkEntitlements.js";
import { getFrameworkDef } from "./complianceBridge.js";
import { isSuperAdminEmail, accountCategory } from "./auth.js";
import { getProviderHealth } from "./aiProviders.js";
import { getEmailHealth } from "./emailService.js";
import { serverErrorSummary } from "./healthMonitor.js";
import { sandboxStats } from "./db.js";
import { pushNotification } from "./portfolioRoutes.js";

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
    isSuperAdmin: isSuperAdminEmail(u.email),
    category: accountCategory(u),
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

  // frameworkAllowance() only ever calls gate.tierOf(), and registerAdminRoutes
  // isn't handed the real tierGate. Rather than thread it through every
  // existing call site, satisfy the one method it needs from userTier() —
  // which is the same lookup tierGate.tierOf() performs.
  const tierGateShim = { tierOf: (id) => userTier(findUser(id)) };

  function latestAssessmentFor(userId) {
    const list = (db.data.assessments || []).filter(a => a.userId === userId);
    if (!list.length) return null;
    return list.reduce((best, a) =>
      !best || new Date(a.updatedAt || a.createdAt) > new Date(best.updatedAt || best.createdAt) ? a : best, null);
  }

  const allowanceForClient = (userId) =>
    frameworkAllowance(db, tierGateShim, userId, latestAssessmentFor(userId));

  // How many of this client's selected frameworks their plan no longer
  // covers. Computed AFTER the tier field has been updated, so it reflects
  // the new plan.
  const pausedFrameworkCount = (userId) => allowanceForClient(userId).blockedIds.length;

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
    if (role === "superadmin" || isSuperAdminEmail(normalized)) {
      return res.status(400).json({
        error: "The super-admin is defined by the ADMIN_EMAIL environment variable, not created here.",
      });
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

    // The super-admin is defined by ADMIN_EMAIL and is not editable here.
    if (isSuperAdminEmail(u.email)) {
      return res.status(403).json({
        error: "The super-admin account is defined by the ADMIN_EMAIL environment variable and can't be changed here.",
      });
    }
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

    // admin and analyst are mutually exclusive categories for a regular account —
    // granting one clears the other.
    if (role === "admin") { u.isAdmin = !!value; if (value) u.isAnalyst = false; }
    else if (role === "analyst") { u.isAnalyst = !!value; if (value) u.isAdmin = false; }
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

    // Upgrade-triggered "extended assessment unlocked" nudge — only fires
    // when the new tier actually gained the capability (not e.g. a lateral
    // no-op re-save), and only if there's an assessment to extend at all.
    if (direction === "upgrade" && !hasCapability(from, "extendedAssessment") && hasCapability(tier, "extendedAssessment")) {
      const hasAssessment = (db.data.assessments || []).some(a => a.userId === u.id);
      if (hasAssessment) {
        pushNotification(db, {
          userId: u.id,
          type: "extended_assessment_unlocked",
          title: "Extended Assessment unlocked",
          body: "Your plan now includes additional cloud, tooling, and MFA-depth questions that can sharpen your posture score.",
          link: "/assessment/edit",
          actorRole: "system",
        });
        await db.write();
      }
    }

    // Downgrade-triggered "frameworks paused" notice. A downgrade is a staff
    // action, not a client write, so the assessment's selectedFrameworks list
    // is deliberately left whole — nothing is deleted and a re-upgrade
    // restores everything exactly. But the read-side allow-list starts hiding
    // whatever is now over the limit immediately, and a client watching
    // frameworks vanish with no explanation would reasonably conclude the
    // product broke.
    //
    // Deliberately does NOT auto-create entitlements to cover the overage:
    // that would invent a recurring charge nobody agreed to.
    if (direction === "downgrade") {
      const paused = pausedFrameworkCount(u.id);
      if (paused > 0) {
        const nowIncluded = getTier(tier).limits?.complianceFrameworks ?? 0;
        pushNotification(db, {
          userId: u.id,
          type: "frameworks_paused",
          title: `${paused} compliance framework${paused === 1 ? "" : "s"} paused`,
          body: `Your new plan includes ${nowIncluded}. Nothing was deleted — upgrade again, or add a framework for ${addonPriceLabel(FRAMEWORK_ADDON_ID)}, and they come straight back.`,
          link: "/compliance",
          actorRole: "admin",
        });
        await audit(req, "frameworks_paused", u.id, `${paused} framework(s) paused by downgrade to ${tier}`);
      }
    }

    res.json(adminUserView(db, u));
  });

  // ── Framework add-ons ($49.99/mo slots) ─────────────────────
  //
  // These live here rather than in frameworkAddonRoutes.js for one concrete
  // reason: audit() is a closure inside registerAdminRoutes, not an export.
  // Every mutating admin action in this file writes an adminAudit row, and
  // granting or cancelling a recurring charge is exactly the kind of thing
  // someone will need attributed six months later.

  app.get("/api/admin/accounts/:id/framework-addons", requireAdmin, (req, res) => {
    const u = findUser(req.params.id);
    if (!u) return res.status(404).json({ error: "Account not found." });
    const a = allowanceForClient(u.id);
    res.json({
      entitlements: entitlementsFor(db, u.id),
      allowance: {
        tier: a.tierId, limit: a.limit, included: a.included,
        entitlements: a.entitlements,
        blocked: a.blockedIds, grandfathered: a.grandfatheredIds,
      },
      addonPrice: addonPriceLabel(FRAMEWORK_ADDON_ID),
    });
  });

  // Grant a slot. `frameworkId: null` grants an UNASSIGNED slot the client
  // applies themselves — for when you've agreed to sell them a framework but
  // they haven't decided which one.
  // body: { frameworkId?: string|null, status?: "comped"|"pending_billing"|"active", note?: string }
  app.post("/api/admin/accounts/:id/framework-addons", requireAdmin, async (req, res) => {
    const u = findUser(req.params.id);
    if (!u) return res.status(404).json({ error: "Account not found." });
    if (u.isAdmin || u.isAnalyst) {
      return res.status(400).json({ error: "Staff accounts don't hold framework add-ons." });
    }

    const { frameworkId = null, status = "comped", note = "" } = req.body || {};
    if (!ENTITLEMENT_STATUSES.includes(status) || status === "cancelled") {
      return res.status(400).json({ error: "status must be one of: comped, pending_billing, active." });
    }

    let frameworkName = null;
    let kind = "registry";
    if (frameworkId) {
      if (isFoundation(frameworkId)) {
        return res.status(400).json({ error: "Foundation frameworks are included on every plan — they can't be sold as add-ons." });
      }
      const def = getFrameworkDef(frameworkId);
      const custom = def ? null : (db.data.customFrameworks || []).find(f => f.id === frameworkId);
      if (!def && !custom) return res.status(404).json({ error: "Unknown framework." });
      frameworkName = def ? (def.short || def.name) : custom.name;
      kind = def ? "registry" : "custom";

      // Without this, granting twice for the same framework (a double
      // click, or re-granting after a miscommunication) silently created a
      // second billable slot and doubled this client's counted MRR — the
      // client-facing self-serve route already guards the identical case.
      const existing = entitlementForFramework(db, u.id, frameworkId);
      if (existing) {
        return res.status(409).json({
          error: `${frameworkName} already has an add-on (${existing.status}). Use PATCH to change it instead of granting a second one.`,
          code: "ALREADY_ENTITLED",
          existingEntitlementId: existing.id,
        });
      }
    }

    const rec = newEntitlement({
      userId: u.id,
      frameworkId: frameworkId || null,
      frameworkName,
      kind,
      status,
      billingMode: status === "comped" ? "comped" : "manual_invoice",
      source: "admin_grant",
      grantedByUserId: req.userId,
      note,
    });
    (db.data.frameworkEntitlements ||= []).push(rec);
    await db.write();

    await audit(req, "framework_addon_grant", u.id,
      `${frameworkName || "unassigned slot"} · ${status}${note ? " · " + note : ""}`);
    pushNotification(db, {
      userId: u.id,
      type: "framework_addon_granted",
      title: frameworkName ? `${frameworkName} added to your plan` : "A framework add-on slot was added to your plan",
      body: status === "comped"
        ? "Added by your ShieldAI team at no charge."
        : `Billed at ${addonPriceLabel(FRAMEWORK_ADDON_ID)}.`,
      link: "/compliance",
      actorRole: "admin",
    });
    await db.write();

    res.status(201).json(rec);
  });

  // Move an add-on through its billing lifecycle, or re-point it at another
  // framework. body: { status?, invoiceState?, lastInvoiceRef?, frameworkId?, note? }
  app.patch("/api/admin/framework-addons/:id", requireAdmin, async (req, res) => {
    const rec = findEntitlement(db, req.params.id);
    if (!rec) return res.status(404).json({ error: "Add-on not found." });

    const { status, invoiceState, lastInvoiceRef, frameworkId, note } = req.body || {};
    const changes = [];

    if (status !== undefined) {
      if (!ENTITLEMENT_STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${ENTITLEMENT_STATUSES.join(", ")}.` });
      }
      if (status === "cancelled") {
        return res.status(400).json({ error: "Use DELETE to cancel an add-on — it keeps the record and stamps cancelledAt." });
      }
      if (rec.status !== status) changes.push(`status ${rec.status} → ${status}`);
      rec.status = status;
      if (status === "active" && !rec.activatedAt) rec.activatedAt = nowIso();
    }

    if (invoiceState !== undefined) {
      if (!INVOICE_STATES.includes(invoiceState)) {
        return res.status(400).json({ error: `invoiceState must be one of: ${INVOICE_STATES.join(", ")}.` });
      }
      rec.billing ||= {};
      if (rec.billing.invoiceState !== invoiceState) changes.push(`invoice ${rec.billing.invoiceState} → ${invoiceState}`);
      rec.billing.invoiceState = invoiceState;
      if (invoiceState === "invoiced" && !rec.billing.invoicedAt) rec.billing.invoicedAt = nowIso();
      if (invoiceState === "paid") {
        rec.billing.paidAt = nowIso();
        // Paid means the slot is no longer merely owed, so promote it out of
        // pending_billing and off the invoicing worklist.
        if (rec.status === "pending_billing") {
          rec.status = "active";
          rec.activatedAt ||= nowIso();
          changes.push("status pending_billing → active (paid)");
        }
      }
    }

    if (lastInvoiceRef !== undefined) {
      rec.billing ||= {};
      rec.billing.lastInvoiceRef = String(lastInvoiceRef || "").slice(0, 120) || null;
    }

    if (frameworkId !== undefined) {
      if (frameworkId === null) {
        assignEntitlement(rec, { frameworkId: null, frameworkName: null, kind: rec.kind });
        changes.push("unassigned");
      } else {
        if (isFoundation(frameworkId)) return res.status(400).json({ error: "Foundation frameworks can't be add-ons." });
        const def = getFrameworkDef(frameworkId);
        const custom = def ? null : (db.data.customFrameworks || []).find(f => f.id === frameworkId);
        if (!def && !custom) return res.status(404).json({ error: "Unknown framework." });
        assignEntitlement(rec, {
          frameworkId,
          frameworkName: def ? (def.short || def.name) : custom.name,
          kind: def ? "registry" : "custom",
        });
        changes.push(`applied to ${rec.frameworkName}`);
      }
    }

    if (note !== undefined) rec.note = String(note || "").slice(0, 500);
    rec.updatedAt = nowIso();
    await db.write();

    if (changes.length) await audit(req, "framework_addon_billing", rec.userId, changes.join(" · "));
    res.json(rec);
  });

  // The deliberate cancellation — the only thing that stops the charge. A
  // client unticking a framework does NOT reach here; that only releases the
  // slot (see frameworkAddonRoutes.js). The record is kept rather than
  // deleted so the billing history stays answerable.
  app.delete("/api/admin/framework-addons/:id", requireAdmin, async (req, res) => {
    const rec = findEntitlement(db, req.params.id);
    if (!rec) return res.status(404).json({ error: "Add-on not found." });
    if (rec.status === "cancelled") return res.status(409).json({ error: "Already cancelled." });

    const was = rec.frameworkName || "an unassigned slot";
    cancelEntitlement(rec, String(req.body?.note || "").slice(0, 500));
    await db.write();

    await audit(req, "framework_addon_cancel", rec.userId, `${was} cancelled`);
    pushNotification(db, {
      userId: rec.userId,
      type: "framework_addon_cancelled",
      title: "A framework add-on was cancelled",
      body: `${was} is no longer covered by an add-on, and the ${addonPriceLabel(FRAMEWORK_ADDON_ID)} charge stops. The framework stays selected on your assessment but won't be assessed unless your plan covers it.`,
      link: "/compliance",
      actorRole: "admin",
    });
    await db.write();

    res.json(publicEntitlement(rec));
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
    if (isSuperAdminEmail(u.email) && suspended) {
      return res.status(403).json({ error: "The super-admin account cannot be suspended." });
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

  // ── System Health ─────────────────────────────────────────────
  // "Is anything actually broken right now" without leaving the product for
  // Railway's own dashboard/logs. Everything here is in-memory (see
  // healthMonitor.js's header) — a live snapshot of the current process, not
  // a durable log; a redeploy or restart clearing it is expected. Threat-intel
  // service status (NVD/HIBP) has its own established tab/endpoint
  // (/api/admin/threat-intel/status) and isn't duplicated here.
  app.get("/api/admin/system-health", requireAdmin, (req, res) => {
    res.json({
      aiProviders: getProviderHealth(),
      email: getEmailHealth(),
      serverErrors: serverErrorSummary(),
      demoSandboxes: sandboxStats(),
      checkedAt: new Date().toISOString(),
    });
  });

  console.log("ShieldAI admin account-control routes registered.");
}
