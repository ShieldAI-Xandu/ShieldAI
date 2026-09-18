// cli/lib/session.js
// Local session storage (~/.shieldai-cli/session.json — outside the repo
// working tree by construction) plus the real enforcement point: every
// privileged command must call getLiveSession(), which re-validates against
// the live server (GET /api/auth/me) rather than trusting the cached JWT's
// claims. This mirrors what requireAuth already does server-side on every
// request, and catches suspension/demotion/deletion that happened after the
// token was minted.

import fs from "node:fs";
import { CONFIG_DIR, SESSION_FILE, SERVER_URL } from "./config.js";

export class SessionError extends Error {}

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

export function saveSession({ token, email }) {
  ensureConfigDir();
  const data = { token, email, issuedAt: new Date().toISOString() };
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function readSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function clearSession() {
  try { fs.unlinkSync(SESSION_FILE); } catch { /* already gone */ }
}

export async function getLiveSession() {
  const session = readSession();
  if (!session?.token) {
    throw new SessionError("Not logged in. Run `shieldai login` first.");
  }
  let res;
  try {
    res = await fetch(`${SERVER_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
  } catch (err) {
    throw new SessionError(`Could not reach ${SERVER_URL}: ${err.message}`);
  }
  if (!res.ok) {
    throw new SessionError("Session is no longer valid. Run `shieldai login` again.");
  }
  const user = await res.json();
  if (!user.isAdmin) {
    throw new SessionError("This account no longer has admin access — this CLI is admin/super-admin only.");
  }
  return { token: session.token, user };
}
