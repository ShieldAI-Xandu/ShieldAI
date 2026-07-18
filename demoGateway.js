// demoGateway.js
// The single, explicit boundary between the demo sandbox and production.
//
// How isolation works
// -------------------
// 1. Every demo session token carries `store: "demo"` in its JWT payload,
//    signed with a SEPARATE secret (DEMO_JWT_SECRET). A production token can
//    therefore never be verified as a demo token, and vice versa — even if the
//    payload were forged, the signature wouldn't validate.
// 2. `isDemoRequest()` decides, per request, which store to bind. It reads ONLY
//    the request path prefix and the token's own store claim — never user input
//    that a client could set to reach the other store's data.
// 3. `storeBinder` (db.js) then binds the whole request to demo-db.json.
//
// The demo is intentionally a sandbox: anyone can enter with one click, so it
// must never contain real client data, and nothing in it can reach production.

import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { DEMO_STORE, PROD_STORE, getStore, destroySandbox, sandboxStats } from "./db.js";

// Separate secret from production. If unset, derive a distinct one so demo and
// prod tokens are never interchangeable even in a bare dev environment.
const DEMO_JWT_SECRET =
  process.env.DEMO_JWT_SECRET ||
  (process.env.JWT_SECRET ? `${process.env.JWT_SECRET}::demo` : "shieldai-demo-secret-change-in-production");

const DEMO_TOKEN_EXPIRY = "4h"; // sandbox sessions are short-lived
export const DEMO_PATH_PREFIX = "/api/demo";

// Personas the public gateway can hand out. These emails exist ONLY in
// demo-db.json — they are seeded by seedDemo.js and have no production twin.
export const DEMO_PERSONAS = {
  client: { email: "demo-client@shieldai.demo", label: "Client view" },
  analyst: { email: "demo-analyst@shieldai.demo", label: "Analyst console" },
};

// ── Token helpers ─────────────────────────────────────────────
export function signDemoToken(user, sessionId = randomUUID()) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      isAdmin: false,           // demo sessions are never admin
      isAnalyst: !!user.isAnalyst,
      store: DEMO_STORE,        // the claim that routes this session
      sid: sessionId,           // the key to this visitor's private sandbox
    },
    DEMO_JWT_SECRET,
    { expiresIn: DEMO_TOKEN_EXPIRY }
  );
}

// Which sandbox does this request belong to? Read ONLY from the signed token —
// a visitor cannot name someone else's sandbox, because they can't forge a
// token carrying that sid.
export function demoSessionId(req) {
  const token = bearer(req);
  if (!token) return null;
  return verifyDemoToken(token)?.sid || null;
}

export function verifyDemoToken(token) {
  try {
    const payload = jwt.verify(token, DEMO_JWT_SECRET);
    return payload?.store === DEMO_STORE ? payload : null;
  } catch {
    return null;
  }
}

function bearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

// ── Store selection ───────────────────────────────────────────
// A request is a demo request if it targets the demo path prefix OR carries a
// valid demo-signed token. Nothing else can select the demo store — and no
// demo signal can ever select production, because a demo token simply fails
// verification against the production secret in requireAuth.
export function isDemoRequest(req) {
  if ((req.path || req.url || "").startsWith(DEMO_PATH_PREFIX)) return true;
  const token = bearer(req);
  return token ? !!verifyDemoToken(token) : false;
}

// ── Middleware: authenticate a demo session ───────────────────
export function requireDemoAuth(req, res, next) {
  const token = bearer(req);
  const payload = token ? verifyDemoToken(token) : null;
  if (!payload) {
    return res.status(401).json({ error: "Demo session required or expired. Start a new demo." });
  }
  req.userId = payload.userId;
  req.userEmail = payload.email;
  req.isAdmin = false;
  req.isAnalyst = !!payload.isAnalyst;
  req.isDemo = true;
  req.demoSessionId = payload.sid || null;
  next();
}

// ── The demo is fully writable ────────────────────────────────
// Each visitor works inside their own in-memory sandbox (see db.js), so writes
// are safe: they can't reach production, can't reach the seeded template, and
// can't reach another visitor. Everything a real account can do, a demo visitor
// can do — which is the point. An investor clicking a button that silently
// refuses is worse than no demo at all.
//
// A small number of things stay off because they'd touch the real world rather
// than the sandbox — real money, real credentials, real infrastructure.
const DEMO_BLOCKED_PREFIXES = [
  { prefix: "/api/billing",       why: "Billing is disabled in the demo — it would create real Stripe charges." },
  { prefix: "/api/admin",         why: "Admin controls aren't part of the demo — they manage real accounts." },
  { prefix: "/api/agents/enroll", why: "Agent enrollment is disabled in the demo — it would mint a real enrollment token." },
];

export function demoGuard(req, res, next) {
  const hit = DEMO_BLOCKED_PREFIXES.find(b => req.path.startsWith(b.prefix));
  if (hit) {
    return res.status(403).json({ error: hit.why, code: "DEMO_RESTRICTED" });
  }
  next();
}

// ── Access codes ──────────────────────────────────────────────
// Codes gate demo entry. An admin mints one when approving a lead; the visitor
// redeems it to enter the sandbox. Two types:
//   · "investor" → client + analyst views (the full product tour)
//   · "client"   → client views only (a prospect evaluating the service)
// Codes live in the PRODUCTION store (admin manages them against real leads),
// but redeeming one issues a DEMO-signed token so the visitor still lands in
// the isolated sandbox and can never touch real data.
// (getStore/PROD_STORE are already imported at the top of this file.)

export const ACCESS_CODE_TYPES = ["investor", "client"];

// Human-friendly, unambiguous code: SHLD-XXXX-XXXX (no 0/O/1/I).
function generateAccessCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const block = () => Array.from({ length: 4 }, () =>
    alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `SHLD-${block()}-${block()}`;
}

function prodDb() { return getStore(PROD_STORE); }

// Mint and persist a new access code (admin, production store).
export async function createAccessCode(db, { type, leadId = null, note = "", createdBy = null }) {
  if (!ACCESS_CODE_TYPES.includes(type)) {
    throw Object.assign(new Error("type must be 'investor' or 'client'."), { code: "BAD_TYPE" });
  }
  db.data.accessCodes ||= [];
  let code;
  do { code = generateAccessCode(); } while (db.data.accessCodes.some(c => c.code === code));
  const record = {
    id: randomUUID(),
    code,
    type,
    leadId,
    note: String(note || "").slice(0, 300),
    createdBy,
    active: true,
    redeemedCount: 0,
    lastRedeemedAt: null,
    createdAt: new Date().toISOString(),
  };
  db.data.accessCodes.push(record);
  await db.write();
  return record;
}

function findActiveCode(prod, raw) {
  const norm = String(raw || "").trim().toUpperCase();
  if (!norm) return null;
  return (prod.data.accessCodes || []).find(c => c.active && c.code.toUpperCase() === norm) || null;
}

// ── Public routes ─────────────────────────────────────────────
export function registerDemoRoutes(app, db) {

  // Redeem an access code → a scoped demo session. This is the ONLY demo entry
  // point exposed publicly once codes are enforced. Reads codes from prod,
  // issues a demo token whose persona matches the code type.
  app.post(`${DEMO_PATH_PREFIX}/redeem-code`, async (req, res) => {
    try {
      const prod = prodDb();
      const record = findActiveCode(prod, req.body?.code);
      if (!record) {
        return res.status(403).json({ error: "That access code isn't valid or has been deactivated.", code: "BAD_CODE" });
      }

      // investor → analyst persona (can see the analyst console); the frontend
      // additionally grants the client views. client → client persona only.
      const personaKey = record.type === "investor" ? "analyst" : "client";
      const persona = DEMO_PERSONAS[personaKey];
      const user = (db.data.users || []).find(u => u.email === persona.email);
      if (!user) {
        return res.status(503).json({ error: "The demo environment isn't seeded yet. Run: node seedDemo.js", code: "DEMO_NOT_SEEDED" });
      }

      // Record redemption on the prod code record.
      record.redeemedCount = (record.redeemedCount || 0) + 1;
      record.lastRedeemedAt = new Date().toISOString();
      await prod.write();

      const sessionId = randomUUID();
      res.json({
        token: signDemoToken(user, sessionId),
        persona: personaKey,
        accessType: record.type,   // "investor" | "client" — drives which views the UI shows
        sessionId,
        expiresIn: DEMO_TOKEN_EXPIRY,
        readOnly: false,
        sandbox: true,
        user: {
          id: user.id,
          email: user.email,
          companyName: user.companyName,
          isAdmin: false,
          isAnalyst: record.type === "investor",
          isDemo: true,
          accessType: record.type,
          tier: user.tier || "enterprise",
        },
      });
    } catch (err) {
      console.error("Access-code redeem error:", err.message);
      res.status(500).json({ error: "Could not redeem that code. Please try again." });
    }
  });

  // Start a demo session — no credentials, one click from the marketing page.
  // Runs inside the demo store because of the /api/demo prefix.
  app.post(`${DEMO_PATH_PREFIX}/session`, async (req, res) => {
    try {
      const key = req.body?.persona === "analyst" ? "analyst" : "client";
      const persona = DEMO_PERSONAS[key];

      const user = (db.data.users || []).find(u => u.email === persona.email);
      if (!user) {
        return res.status(503).json({
          error: "The demo environment isn't seeded yet. Run: node seedDemo.js",
          code: "DEMO_NOT_SEEDED",
        });
      }

      // A fresh session id = a fresh private sandbox, cloned from the template
      // on first use. Nothing this visitor does will outlive their session.
      const sessionId = randomUUID();

      res.json({
        token: signDemoToken(user, sessionId),
        persona: key,
        sessionId,
        expiresIn: DEMO_TOKEN_EXPIRY,
        readOnly: false,
        sandbox: true,
        user: {
          id: user.id,
          email: user.email,
          companyName: user.companyName,
          isAdmin: false,
          isAnalyst: !!user.isAnalyst,
          isDemo: true,
          tier: user.tier || "enterprise",
        },
      });
    } catch (err) {
      console.error("Demo session error:", err.message);
      res.status(500).json({ error: "Could not start the demo. Please try again." });
    }
  });

  // End a demo session and destroy its sandbox immediately.
  // Sandboxes expire on their own, but discarding on exit is what "the data
  // stays in the demo" should mean in practice rather than eventually.
  app.post(`${DEMO_PATH_PREFIX}/exit`, (req, res) => {
    const sid = demoSessionId(req);
    const destroyed = sid ? destroySandbox(sid) : false;
    res.json({ ended: true, destroyed });
  });

  // Is the demo available, and what can visitors enter as?
  app.get(`${DEMO_PATH_PREFIX}/status`, (req, res) => {
    const emails = new Set((db.data.users || []).map(u => u.email));
    const available = Object.entries(DEMO_PERSONAS)
      .filter(([, p]) => emails.has(p.email))
      .map(([id, p]) => ({ id, label: p.label }));
    res.json({
      seeded: available.length > 0,
      readOnly: false,
      personas: available,
      sandbox: sandboxStats(),
    });
  });
}

// ── Guard: refuse to boot if the boundary has been violated ───
// Cheap insurance against the one failure that actually matters: demo personas
// or demo-flagged records appearing in the production store.
export function assertStoreSeparation() {
  const prod = getStore(PROD_STORE);
  const demoEmails = new Set(Object.values(DEMO_PERSONAS).map(p => p.email));
  const leaked = (prod.data.users || []).filter(
    u => demoEmails.has(u.email) || u.isDemo || (u.email || "").endsWith("@shieldai.demo")
  );
  if (leaked.length) {
    return {
      ok: false,
      message: `Demo accounts found in the PRODUCTION store: ${leaked.map(u => u.email).join(", ")}. ` +
               `Remove them from db.json — demo data must live only in demo-db.json.`,
    };
  }
  return { ok: true };
}
