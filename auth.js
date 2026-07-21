// auth.js
// Simple in-house authentication: email + password, bcrypt hashing, JWT sessions.
// Capped at MAX_USERS total NON-ADMIN accounts for the testing phase.
// The admin account (designated by ADMIN_EMAIL in .env) is exempt from the cap.

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import db from "./db.js";
import { TIERS, DEFAULT_TIER } from "./tiers.js";
import { verifyDemoToken } from "./demoGateway.js";

// No hardcoded fallback. This used to be
//   process.env.JWT_SECRET || "shieldai-test-secret-change-in-production"
// which meant an unset JWT_SECRET didn't fail — it silently signed every
// session (including admin sessions) with a fixed string sitting in this file
// on GitHub. Anyone who read the code could forge a valid token for any user.
// That is worse than crashing: a crash is loud and gets fixed before launch: a
// silently-forgeable auth system looks like it works right up until it's
// exploited. If this throws, JWT_SECRET is missing from the environment —
// set it in Railway → Variables (or .env locally) before anything else.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET is not set. Sessions cannot be signed securely without it. " +
    "Set JWT_SECRET in the environment (Railway → Variables, or .env locally) — " +
    "see env.example. Refusing to start with a hardcoded fallback secret."
  );
}
const TOKEN_EXPIRY = "7d";
// Account cap. Set high to effectively disable during the demo/build phase.
// (Lower this later if you want to re-enforce a limit.)
export const MAX_USERS = 9999;

// The email that becomes admin. Set ADMIN_EMAIL in your .env file.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
// The email that becomes an analyst. Set ANALYST_EMAIL in your .env file.
const ANALYST_EMAIL = (process.env.ANALYST_EMAIL || "analyst@xandultd.com").trim().toLowerCase();

function isAdminEmail(email) {
  return Boolean(ADMIN_EMAIL && email === ADMIN_EMAIL);
}

function isAnalystEmail(email) {
  return Boolean(ANALYST_EMAIL && email === ANALYST_EMAIL);
}

// Count only standard (non-admin, non-analyst) users against the cap
function nonAdminCount() {
  return (db.data.users || []).filter(u => !u.isAdmin && !u.isAnalyst).length;
}

// ── Registration ──────────────────────────────────────────────
export async function registerUser({ email, password, companyName }) {
  db.data.users = db.data.users || [];

  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail || !password) {
    const err = new Error("Email and password are required.");
    err.code = "INVALID_INPUT";
    throw err;
  }
  if (password.length < 8) {
    const err = new Error("Password must be at least 8 characters.");
    err.code = "WEAK_PASSWORD";
    throw err;
  }

  const willBeAdmin = isAdminEmail(normalizedEmail);
  const willBeAnalyst = isAnalystEmail(normalizedEmail);

  // Enforce the testing cap ONLY for standard accounts (admin & analyst exempt)
  if (!willBeAdmin && !willBeAnalyst && nonAdminCount() >= MAX_USERS) {
    const err = new Error(`Registration is currently limited to ${MAX_USERS} accounts during testing.`);
    err.code = "USER_LIMIT_REACHED";
    throw err;
  }

  const existing = db.data.users.find(u => u.email === normalizedEmail);
  if (existing) {
    const err = new Error("An account with this email already exists.");
    err.code = "EMAIL_TAKEN";
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: randomUUID(),
    email: normalizedEmail,
    companyName: companyName || "",
    passwordHash,
    isAdmin: willBeAdmin,
    isAnalyst: willBeAnalyst,
    createdAt: new Date().toISOString(),
  };

  db.data.users.push(user);
  await db.write();

  const token = signToken(user);
  return { token, user: publicUser(user) };
}

// ── Login ─────────────────────────────────────────────────────
export async function loginUser({ email, password }) {
  db.data.users = db.data.users || [];

  const normalizedEmail = (email || "").trim().toLowerCase();
  const user = db.data.users.find(u => u.email === normalizedEmail);
  if (!user) {
    const err = new Error("Invalid email or password.");
    err.code = "INVALID_CREDENTIALS";
    throw err;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const err = new Error("Invalid email or password.");
    err.code = "INVALID_CREDENTIALS";
    throw err;
  }

  // Promote to admin if their email matches ADMIN_EMAIL but flag isn't set yet
  // (handles the case where ADMIN_EMAIL was added after the account existed)
  if (isAdminEmail(normalizedEmail) && !user.isAdmin) {
    user.isAdmin = true;
    await db.write();
  }
  // Same for analyst designation
  if (isAnalystEmail(normalizedEmail) && !user.isAnalyst) {
    user.isAnalyst = true;
    await db.write();
  }

  const token = signToken(user);
  return { token, user: publicUser(user) };
}

// ── Token helpers ─────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, isAdmin: !!user.isAdmin, isAnalyst: !!user.isAnalyst },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

function publicUser(user) {
  const tierId = user.tier && TIERS[user.tier] ? user.tier : DEFAULT_TIER;
  const tier = TIERS[tierId];
  return {
    id: user.id,
    email: user.email,
    companyName: user.companyName,
    isAdmin: !!user.isAdmin,
    isAnalyst: !!user.isAnalyst,
    isDemo: !!user.isDemo,
    mustChangePassword: !!user.mustChangePassword,
    tier: tierId,
    tierName: tier.name,
    capabilities: { ...tier.capabilities },
    limits: { ...tier.limits },
    createdAt: user.createdAt,
  };
}

// ── Middleware: require a valid token ─────────────────────────
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required." });

  // Demo sessions are signed with a different secret and carry store:"demo".
  // They are already bound to the demo store by storeBinder, so letting them
  // through here lets the sandbox reuse the real read routes without any
  // ability to see production data. They are never admin and never write.
  const demo = verifyDemoToken(token);
  if (demo) {
    req.userId = demo.userId;
    req.userEmail = demo.email;
    req.isAdmin = false;
    req.isAnalyst = !!demo.isAnalyst;
    req.isDemo = true;
    return next();
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // A production token must never claim the demo store.
    if (payload.store) {
      return res.status(401).json({ error: "Invalid session." });
    }
    req.userId = payload.userId;
    req.userEmail = payload.email;
    req.isAdmin = !!payload.isAdmin;
    req.isAnalyst = !!payload.isAnalyst;
    req.isDemo = false;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired session. Please log in again." });
  }
}

// ── Middleware: require admin ─────────────────────────────────
export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.isDemo || !req.isAdmin) {
      return res.status(403).json({ error: "Admin access required." });
    }
    next();
  });
}

export function getCurrentUser(userId) {
  const user = (db.data.users || []).find(u => u.id === userId);
  return user ? publicUser(user) : null;
}

// ── Admin helpers ─────────────────────────────────────────────
export async function adminResetPassword(targetUserId, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    const err = new Error("New password must be at least 8 characters.");
    err.code = "WEAK_PASSWORD";
    throw err;
  }
  const user = (db.data.users || []).find(u => u.id === targetUserId);
  if (!user) {
    const err = new Error("User not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await db.write();
  return publicUser(user);
}

// ── Change own password (self-service + forced first-login) ───
// For a normal change we verify the current password. For a forced first-login
// change (mustChangePassword), the user already authenticated with the temp
// password to reach this route, so the current password is optional — but if
// supplied it's still verified. Clears the mustChangePassword flag on success.
export async function changeOwnPassword(userId, { currentPassword, newPassword }) {
  if (!newPassword || newPassword.length < 8) {
    const err = new Error("New password must be at least 8 characters.");
    err.code = "WEAK_PASSWORD";
    throw err;
  }
  const user = (db.data.users || []).find(u => u.id === userId);
  if (!user) {
    const err = new Error("User not found.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const forced = !!user.mustChangePassword;
  if (!forced || currentPassword) {
    const ok = await bcrypt.compare(currentPassword || "", user.passwordHash);
    if (!ok) {
      const err = new Error("Current password is incorrect.");
      err.code = "INVALID_CREDENTIALS";
      throw err;
    }
  }

  const same = await bcrypt.compare(newPassword, user.passwordHash);
  if (same) {
    const err = new Error("New password must be different from the current one.");
    err.code = "SAME_PASSWORD";
    throw err;
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.mustChangePassword = false;
  await db.write();
  return publicUser(user);
}

export async function adminDeleteUser(targetUserId) {
  const user = (db.data.users || []).find(u => u.id === targetUserId);
  if (!user) {
    const err = new Error("User not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (user.isAdmin) {
    const err = new Error("Cannot delete an admin account.");
    err.code = "FORBIDDEN";
    throw err;
  }

  // Remove the user and all their data
  db.data.users = db.data.users.filter(u => u.id !== targetUserId);
  db.data.assessments = (db.data.assessments || []).filter(a => a.userId !== targetUserId);
  db.data.programs = (db.data.programs || []).filter(p => p.userId !== targetUserId);
  db.data.policyDocs = (db.data.policyDocs || []).filter(p => p.userId !== targetUserId);
  await db.write();
  return { deleted: targetUserId };
}
