// db.js
// Dual-store JSON database using lowdb.
//
// ShieldAI runs TWO fully separate data stores on the same server:
//   • production  → db.json        (real clients, real analysts, real data)
//   • demo        → demo-db.json   (sandbox; investor/prospect demos)
//
// Isolation model
// ---------------
// Every request runs inside an AsyncLocalStorage context that names its store.
// The default export is a Proxy that forwards `.data`, `.read()`, and `.write()`
// to whichever store the current request is bound to. Existing call sites
// (`db.data.users`, `await db.write()`) work unchanged — they simply operate on
// the correct store automatically.
//
// Data CANNOT cross the boundary: there is no code path that reads one store
// while writing the other. A request bound to "demo" can only ever see
// demo-db.json. Outside any request context the store defaults to production,
// which is what CLI scripts and boot-time code expect.

import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AsyncLocalStorage } from "async_hooks";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DB_DIR lets Railway point storage at a mounted volume; falls back to app dir.
const DB_DIR = process.env.DB_DIR || __dirname;

export const PROD_STORE = "prod";
export const DEMO_STORE = "demo";

function freshDefaults() {
  return {
    users: [],         // { id, email, companyName, passwordHash, createdAt }
    assessments: [],   // { id, userId, createdAt, data }
    programs: [],      // { id, userId, assessmentId, createdAt, status, sections: {...} }
    policyDocs: [],    // { id, userId, policyId, policyName, createdAt, companyContext, answers, content }
    trainingPrograms: [], // { id, userId, createdAt, companyContext, curriculum: {...} }
    leads: [],         // { id, name, email, company, employees, message, status, createdAt }
    agents: [],        // { id, ownerUserId, hostname, os, tokenHash, status, createdAt, lastSeen }
    enrollTokens: [],  // { tokenHash, ownerUserId, createdAt, expiresAt, usedAt }
    agentReports: [],  // { id, agentId, ownerUserId, receivedAt, report }
    agentEvents: [],   // { id, agentId, ownerUserId, ts, source, severity, type, message, raw, ack }
    recommendations: [], // { id, ownerUserId, agentId, origin, title, detail, severity, status, history[] }
    subscriptions: [], // { id, userId, tier, status, stripeCustomerId, stripeSubscriptionId, currentPeriodEnd, updatedAt }
    transactions: [],  // { id, userId, stripeInvoiceId, amountCents, currency, status, description, createdAt }
    adminAudit: [],    // { id, actorUserId, actorEmail, action, targetUserId, detail, at }
    assignments: [],   // { id, analystUserId, clientUserId, assignedBy, assignedAt }
    clientActions: [], // { id, clientUserId, actorUserId, actorRole, action, detail, recommendationId, at }
  };
}

const COLLECTIONS = Object.keys(freshDefaults());

async function openStore(filename) {
  const file = path.join(DB_DIR, filename);

  // Create DB_DIR if it doesn't exist. Without this, lowdb fails with a bare
  // ENOENT on its temp file (e.g. "/data/.db.json.tmp") that names neither the
  // real directory nor the cause — which is a genuinely awful thing to debug
  // at 2am when a volume isn't mounted where you expected.
  try {
    fs.mkdirSync(DB_DIR, { recursive: true });
  } catch (err) {
    throw new Error(
      `Cannot create the database directory "${DB_DIR}" (${err.code}). ` +
      `If this is a deployment, check that DB_DIR points at a mounted volume.`
    );
  }

  const store = new Low(new JSONFile(file), freshDefaults());
  try {
    await store.read();
  } catch (err) {
    throw new Error(
      `Cannot read the database file "${file}" (${err.code}). ` +
      (err.code === "EISDIR"
        ? "A directory exists at that path where a JSON file should be."
        : "Check file permissions and that DB_DIR is correct.")
    );
  }

  store.data ||= freshDefaults();
  // Ensure every collection exists even if the file predates a schema change
  for (const key of COLLECTIONS) store.data[key] ||= [];

  try {
    await store.write();
  } catch (err) {
    throw new Error(
      `Cannot write to the database file "${file}" (${err.code}). ` +
      `DB_DIR="${DB_DIR}" must exist and be writable — on a PaaS this usually ` +
      `means the volume isn't mounted at that path.`
    );
  }
  return store;
}

const stores = {
  [PROD_STORE]: await openStore("db.json"),
  // The seeded sandbox on disk. This is a TEMPLATE, not a live store: visitors
  // never write to it. Each session gets its own in-memory clone of it.
  [DEMO_STORE]: await openStore("demo-db.json"),
};

// ── Ephemeral per-visitor sandboxes ───────────────────────────
// Every demo visitor gets a full, writable copy of the demo template that lives
// only in memory and only for their session. This is what lets the demo be a
// real product — every button works, writes persist, Mastermind generates —
// without visitors seeing each other's work or corrupting the template.
//
// Why in-memory rather than a file per visitor:
//   · nothing to clean up if the process dies
//   · no disk growth from abandoned sessions
//   · genuinely impossible for one sandbox to read another's data
//
// The cost is that a sandbox dies with the process (a redeploy ends live demo
// sessions) and doesn't survive across multiple server instances. Both are
// correct for a throwaway sandbox and neither affects production.

const SANDBOX_TTL_MS = 4 * 60 * 60 * 1000;   // matches the demo token lifetime
const SANDBOX_SWEEP_MS = 10 * 60 * 1000;
const MAX_SANDBOXES = 200;                   // back-pressure against abuse

const sandboxes = new Map();  // sessionId -> { data, createdAt, lastUsedAt }

// A sandbox mimics lowdb's interface (`data`, `read()`, `write()`) so that every
// existing call site works untouched. `write()` is a no-op that just marks the
// sandbox as used: the data already lives in memory, and persisting it is
// exactly what we don't want.
function makeSandbox(sessionId) {
  const template = stores[DEMO_STORE];
  const box = {
    id: sessionId,
    // structuredClone gives a genuine deep copy — no shared references back to
    // the template, so a visitor mutating a nested object can't corrupt it.
    data: structuredClone(template.data),
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    ephemeral: true,
    async read() { this.lastUsedAt = Date.now(); return this.data; },
    async write() { this.lastUsedAt = Date.now(); return this.data; },
  };
  return box;
}

/** Get (or lazily create) the sandbox for a demo session. */
export function getSandbox(sessionId) {
  let box = sandboxes.get(sessionId);
  if (!box) {
    if (sandboxes.size >= MAX_SANDBOXES) sweepSandboxes(true);
    box = makeSandbox(sessionId);
    sandboxes.set(sessionId, box);
  }
  box.lastUsedAt = Date.now();
  return box;
}

/** Explicitly discard a sandbox — called when a visitor exits the demo. */
export function destroySandbox(sessionId) {
  return sandboxes.delete(sessionId);
}

/** Drop expired sandboxes. With `force`, also drop the least-recently-used. */
export function sweepSandboxes(force = false) {
  const now = Date.now();
  let dropped = 0;
  for (const [id, box] of sandboxes) {
    if (now - box.lastUsedAt > SANDBOX_TTL_MS) { sandboxes.delete(id); dropped++; }
  }
  if (force && sandboxes.size >= MAX_SANDBOXES) {
    const oldest = [...sandboxes.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    const cull = Math.ceil(MAX_SANDBOXES * 0.2);
    for (let i = 0; i < cull && i < oldest.length; i++) { sandboxes.delete(oldest[i][0]); dropped++; }
  }
  return dropped;
}

export function sandboxStats() {
  return {
    active: sandboxes.size,
    max: MAX_SANDBOXES,
    ttlHours: SANDBOX_TTL_MS / 3600000,
    oldestAgeMin: sandboxes.size
      ? Math.round((Date.now() - Math.min(...[...sandboxes.values()].map(b => b.createdAt))) / 60000)
      : 0,
  };
}

const sweepTimer = setInterval(() => sweepSandboxes(), SANDBOX_SWEEP_MS);
sweepTimer.unref?.();  // never keep the process alive just to sweep

// ── Request-scoped store selection ────────────────────────────
// The context holds either a fixed store name, or { sandbox } for a demo
// session. Everything else in the app is oblivious to which it got.
const storeContext = new AsyncLocalStorage();

/** Run `fn` with all db access bound to the named store. */
export function runInStore(storeName, fn) {
  const name = storeName === DEMO_STORE ? DEMO_STORE : PROD_STORE;
  return storeContext.run({ name }, fn);
}

/** Run `fn` with all db access bound to one visitor's private sandbox. */
export function runInSandbox(sessionId, fn) {
  return storeContext.run({ name: DEMO_STORE, sandbox: getSandbox(sessionId) }, fn);
}

/** Which store is the current async context bound to? Defaults to production. */
export function currentStoreName() {
  return storeContext.getStore()?.name || PROD_STORE;
}

/** The current sandbox, if this request belongs to a demo session. */
export function currentSandbox() {
  return storeContext.getStore()?.sandbox || null;
}

/** Direct handle to a specific store (for seeders/CLI). Bypasses context. */
export function getStore(storeName) {
  return stores[storeName === DEMO_STORE ? DEMO_STORE : PROD_STORE];
}

function active() {
  const ctx = storeContext.getStore();
  // A sandbox always wins: a demo request must never touch the shared template.
  if (ctx?.sandbox) return ctx.sandbox;
  return stores[ctx?.name || PROD_STORE];
}

// ── Express middleware ────────────────────────────────────────
// Binds each request to exactly one store before any route runs:
//   · demo session with a session id → that visitor's private sandbox
//   · demo request without one (e.g. /api/demo/status) → the shared template
//   · everything else → production
export function storeBinder(isDemoRequest, demoSessionId = () => null) {
  return (req, res, next) => {
    const demo = !!isDemoRequest(req);
    req.isDemo = demo;

    if (!demo) {
      req.storeName = PROD_STORE;
      res.setHeader("X-ShieldAI-Store", PROD_STORE);
      return runInStore(PROD_STORE, () => next());
    }

    const sid = demoSessionId(req);
    req.storeName = DEMO_STORE;
    req.demoSessionId = sid || null;
    res.setHeader("X-ShieldAI-Store", sid ? "demo-sandbox" : DEMO_STORE);

    if (sid) return runInSandbox(sid, () => next());
    return runInStore(DEMO_STORE, () => next());
  };
}

// ── Proxy: transparent drop-in for the old single db instance ─
const db = new Proxy(
  {},
  {
    get(_t, prop) {
      const store = active();
      const value = store[prop];
      return typeof value === "function" ? value.bind(store) : value;
    },
    set(_t, prop, value) {
      active()[prop] = value;
      return true;
    },
    has(_t, prop) {
      return prop in active();
    },
    ownKeys() {
      return Reflect.ownKeys(active());
    },
    getOwnPropertyDescriptor(_t, prop) {
      return { ...Object.getOwnPropertyDescriptor(active(), prop), configurable: true };
    },
  }
);

export default db;
