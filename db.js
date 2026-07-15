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
  [DEMO_STORE]: await openStore("demo-db.json"),
};

// ── Request-scoped store selection ────────────────────────────
const storeContext = new AsyncLocalStorage();

/** Run `fn` with all db access bound to the named store. */
export function runInStore(storeName, fn) {
  const name = storeName === DEMO_STORE ? DEMO_STORE : PROD_STORE;
  return storeContext.run(name, fn);
}

/** Which store is the current async context bound to? Defaults to production. */
export function currentStoreName() {
  return storeContext.getStore() || PROD_STORE;
}

/** Direct handle to a specific store (for seeders/CLI). Bypasses context. */
export function getStore(storeName) {
  return stores[storeName === DEMO_STORE ? DEMO_STORE : PROD_STORE];
}

function active() {
  return stores[currentStoreName()];
}

// ── Express middleware ────────────────────────────────────────
// Binds the request to the demo store when it is a demo request, otherwise
// production. Everything downstream — routes, auth, generators — inherits it.
export function storeBinder(isDemoRequest) {
  return (req, res, next) => {
    const demo = !!isDemoRequest(req);
    req.storeName = demo ? DEMO_STORE : PROD_STORE;
    req.isDemo = demo;
    res.setHeader("X-ShieldAI-Store", req.storeName);
    runInStore(req.storeName, () => next());
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
