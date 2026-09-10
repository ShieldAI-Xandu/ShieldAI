// versionHistory.js
// Shared full-version-history utility for client-editable entities (learners,
// training assignments, policy documents, training curricula). One
// implementation used by every entity route rather than three bespoke copies.
//
// Design
// ------
// A single db.data.versionHistory collection (NOT per-record history[]
// arrays) — kept out of the hot-path GET payloads for these entities (which
// are fetched on every page load) and fetched only when a human opens
// "History." Every write to a tracked entity gets one entry here:
//
//   create  — snapshot: null (just a timeline start marker)
//   update  — snapshot: the record's full state BEFORE this write (pre-image)
//   delete  — snapshot: the record's full live state at delete time
//   restore — snapshot: whatever was live immediately before the restore
//             overwrote it (a restore is itself one more undoable entry —
//             no special-cased "undo the undo" logic needed)
//
// Reverting to an older version uses a field-level conflict guard, the same
// idea as the existing conditional-revert in complianceRoutes.js's
// POST /api/compliance/remediation/:id/reject (only restores a checklist
// answer if nothing has changed it again since): for each field present in
// the target snapshot, only overwrite it if the LIVE value still matches
// what it was immediately after the next-newer history entry for that field.
// If something wrote to it since, skip that field and report it back in
// `skippedFields` so the UI can say "kept the current value — it changed
// since this version."
//
// Mount from server.js / trainingProgramRoutes.js / staffRoutes.js:
//   import { ensureVersionHistoryCollection, recordVersion, listVersions,
//     restoreVersion } from "./versionHistory.js";

import { randomUUID } from "crypto";

const nowIso = () => new Date().toISOString();

// Fields every entity carries that a restore must never overwrite — identity
// and creation metadata are immutable regardless of what an older snapshot says.
const IMMUTABLE_FIELDS = new Set(["id", "clientUserId", "userId", "createdAt", "token"]);

export function ensureVersionHistoryCollection(db) {
  db.data.versionHistory ||= [];
}

// Per-entity and global caps, mirroring the existing clientActions.slice(-5000)
// idiom. Policy/curriculum snapshots carry large generated text, so they're
// capped tighter than lightweight metadata records like learners/assignments.
const PER_ENTITY_CAP = { learner: 50, trainingAssignment: 50, policyDoc: 20, trainingCurriculum: 10 };
const GLOBAL_CAP = 20000;

function pruneForEntity(db, entityType, entityId) {
  const cap = PER_ENTITY_CAP[entityType] || 50;
  const forEntity = db.data.versionHistory.filter(v => v.entityType === entityType && v.entityId === entityId);
  if (forEntity.length <= cap) return;
  const dropCount = forEntity.length - cap;
  const idsToDrop = new Set(forEntity.slice(0, dropCount).map(v => v.id));
  db.data.versionHistory = db.data.versionHistory.filter(v => !idsToDrop.has(v.id));
}

// Record one version-history entry. Does NOT call db.write() — matches
// logClientAction's convention of one db.write() per request, called once by
// the route handler after all mutations for that request are made.
export function recordVersion(db, { entityType, entityId, clientUserId, action, snapshot = null, changedFields = null, actorUserId, actorRole }) {
  ensureVersionHistoryCollection(db);
  db.data.versionHistory.push({
    id: randomUUID(),
    entityType, entityId, clientUserId, action,
    snapshot, changedFields,
    actorUserId: actorUserId || null,
    actorRole: actorRole || "system",
    at: nowIso(),
  });
  pruneForEntity(db, entityType, entityId);
  if (db.data.versionHistory.length > GLOBAL_CAP) {
    db.data.versionHistory = db.data.versionHistory.slice(-GLOBAL_CAP);
  }
}

// Compute the pre-image → post-image changed field list for an update event.
export function diffFields(before, after, keys) {
  const changed = [];
  for (const k of keys) {
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) changed.push(k);
  }
  return changed;
}

// List an entity's timeline, newest first.
export function listVersions(db, entityType, entityId) {
  ensureVersionHistoryCollection(db);
  return db.data.versionHistory
    .filter(v => v.entityType === entityType && v.entityId === entityId)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}

// Restore an entity to a prior version. `liveRecord` is the current record
// (or null/undefined if it's been hard-deleted). Returns:
//   { record, appliedFields, skippedFields, recreated }
// `record` is the live record after restore (caller is responsible for
// re-inserting it into the live collection if `recreated` is true).
export function restoreVersion(db, { entityType, entityId, versionId, liveRecord }) {
  ensureVersionHistoryCollection(db);
  const timeline = listVersions(db, entityType, entityId); // newest first
  const target = timeline.find(v => v.id === versionId);
  if (!target) return { ok: false, error: "Version not found." };
  if (target.action === "delete" && !target.snapshot) return { ok: false, error: "Nothing to restore from this version." };

  const targetSnapshot = target.action === "delete"
    ? (target.snapshot.learner || target.snapshot) // learner-delete bundles {learner, cascadedAssignments}
    : target.snapshot;
  if (!targetSnapshot) return { ok: false, error: "This version has no earlier state to restore." };

  // Restoring past a hard delete: no live record exists, recreate verbatim,
  // reusing the original id so other records referencing it line back up.
  if (!liveRecord) {
    return {
      ok: true, recreated: true,
      record: { ...targetSnapshot },
      cascaded: target.action === "delete" ? (target.snapshot.cascadedAssignments || null) : null,
      appliedFields: Object.keys(targetSnapshot).filter(k => !IMMUTABLE_FIELDS.has(k)),
      skippedFields: [],
      preRestoreSnapshot: null, // nothing was live to snapshot
    };
  }

  // Snapshot the live record's state BEFORE this restore mutates it, so the
  // restore itself can be recorded as one more undoable version-history
  // entry — a shallow clone is enough: every restorable field on our entity
  // shapes is either a primitive or (curriculum) a single nested object
  // reassigned wholesale below, never mutated in place, so the clone's
  // reference to it stays valid after the loop runs.
  const preRestoreSnapshot = { ...liveRecord };

  // Find the index of the target entry in the (newest-first) timeline, then
  // the entry immediately AFTER it chronologically (i.e. the next-OLDER index
  // in this newest-first array, index - 1) — "what the live value should be
  // if nothing has touched this field since the version being restored."
  const targetIdx = timeline.findIndex(v => v.id === versionId);
  const nextNewer = targetIdx > 0 ? timeline[targetIdx - 1] : null;

  const appliedFields = [];
  const skippedFields = [];
  for (const [field, value] of Object.entries(targetSnapshot)) {
    if (IMMUTABLE_FIELDS.has(field)) continue;
    if (JSON.stringify(liveRecord[field]) === JSON.stringify(value)) continue; // already matches, nothing to do

    // If there's a newer entry whose pre-image (or post-update state) for this
    // field differs from what's live now, something changed it since — skip.
    if (nextNewer && nextNewer.snapshot && field in nextNewer.snapshot) {
      const expectedLiveIfUntouched = nextNewer.snapshot[field];
      if (JSON.stringify(liveRecord[field]) !== JSON.stringify(expectedLiveIfUntouched)) {
        skippedFields.push(field);
        continue;
      }
    }
    liveRecord[field] = value;
    appliedFields.push(field);
  }

  return { ok: true, recreated: false, record: liveRecord, cascaded: null, appliedFields, skippedFields, preRestoreSnapshot };
}
