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
import { DEMO_STORE, PROD_STORE, getStore } from "./db.js";

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
export function signDemoToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      isAdmin: false,           // demo sessions are never admin
      isAnalyst: !!user.isAnalyst,
      store: DEMO_STORE,        // the claim that routes this session
    },
    DEMO_JWT_SECRET,
    { expiresIn: DEMO_TOKEN_EXPIRY }
  );
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
  next();
}

// ── Middleware: block writes inside the demo sandbox ──────────
// The demo is read-only by design: visitors explore seeded data, they don't
// mutate it. This keeps the sandbox pristine for the next visitor without a
// reset job, and means a hostile visitor has nothing to corrupt.
const DEMO_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Gateway routes that must stay POST-able — starting a session is the one write
// a visitor is allowed, and it writes nothing to the store anyway.
const DEMO_WRITE_ALLOWLIST = new Set([`${DEMO_PATH_PREFIX}/session`]);

export function demoReadOnly(req, res, next) {
  if (DEMO_SAFE_METHODS.has(req.method)) return next();
  if (DEMO_WRITE_ALLOWLIST.has(req.path)) return next();
  return res.status(403).json({
    error: "This is a read-only demo sandbox. Create an account to run assessments and generate documents.",
    code: "DEMO_READ_ONLY",
  });
}

// ── Public routes ─────────────────────────────────────────────
export function registerDemoRoutes(app, db) {
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

      res.json({
        token: signDemoToken(user),
        persona: key,
        expiresIn: DEMO_TOKEN_EXPIRY,
        readOnly: true,
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

  // Is the demo available, and what can visitors enter as?
  app.get(`${DEMO_PATH_PREFIX}/status`, (req, res) => {
    const emails = new Set((db.data.users || []).map(u => u.email));
    const available = Object.entries(DEMO_PERSONAS)
      .filter(([, p]) => emails.has(p.email))
      .map(([id, p]) => ({ id, label: p.label }));
    res.json({ seeded: available.length > 0, readOnly: true, personas: available });
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
