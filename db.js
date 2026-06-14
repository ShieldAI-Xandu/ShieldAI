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
await db.write();

export default db;
