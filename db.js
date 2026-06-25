// db.js
// Simple JSON-file database using lowdb. No native dependencies required.

import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, "db.json");

const defaultData = {
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

const adapter = new JSONFile(file);
const db = new Low(adapter, defaultData);

await db.read();
db.data ||= defaultData;
// Ensure all collections exist even if db.json predates a change
db.data.users ||= [];
db.data.assessments ||= [];
db.data.programs ||= [];
db.data.policyDocs ||= [];
db.data.trainingPrograms ||= [];
db.data.leads ||= [];
db.data.agents ||= [];
db.data.enrollTokens ||= [];
db.data.agentReports ||= [];
db.data.agentEvents ||= [];
db.data.recommendations ||= [];
db.data.subscriptions ||= [];
db.data.transactions ||= [];
db.data.adminAudit ||= [];
db.data.assignments ||= [];
db.data.clientActions ||= [];
await db.write();

export default db;
