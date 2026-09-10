// policyWriteOps.js
// Shared "apply an edit/delete/restore to a policyDoc" implementation, used
// by BOTH the client-facing policy routes (server.js) and the staff-on-
// behalf-of-client routes (staffRoutes.js) — one implementation, two callers,
// each supplying their own actorRole, so the snapshot/write/audit-log logic
// exists in exactly one place instead of being duplicated per caller.

import { recordVersion, restoreVersion, diffFields } from "./versionHistory.js";

const nowIso = () => new Date().toISOString();
const TRACKED_FIELDS = ["content", "policyName"];

// Edit a policy's content/name. Snapshots the pre-image for undo, applies the
// edit, logs the action. Caller is responsible for `await db.write()` once
// after calling this (matches the one-write-per-request convention).
export function applyPolicyEdit(db, { record, content, policyName, actorUserId, actorRole, logClientAction }) {
  const before = { content: record.content, policyName: record.policyName };
  if (typeof content === "string") record.content = content;
  if (typeof policyName === "string" && policyName.trim()) record.policyName = policyName.trim();
  record.updatedAt = nowIso();
  record.lastEditedBy = actorUserId;

  const changedFields = diffFields(before, record, TRACKED_FIELDS);
  if (changedFields.length) {
    recordVersion(db, {
      entityType: "policyDoc", entityId: record.id, clientUserId: record.userId,
      action: "update", snapshot: before, changedFields, actorUserId, actorRole,
    });
  }

  logClientAction(db, {
    clientUserId: record.userId, actorUserId, actorRole,
    action: actorRole === "client_admin" ? "policy_edited" : "edited_policy",
    detail: `Edited policy "${record.policyName}" (${record.id}).`,
  });
  return record;
}

// Delete a policy. Snapshots the full live record so it can be restored later,
// removes it from db.data.policyDocs, logs the action.
export function applyPolicyDelete(db, { record, actorUserId, actorRole, logClientAction }) {
  recordVersion(db, {
    entityType: "policyDoc", entityId: record.id, clientUserId: record.userId,
    action: "delete", snapshot: { ...record }, actorUserId, actorRole,
  });
  db.data.policyDocs = (db.data.policyDocs || []).filter(p => p.id !== record.id);
  logClientAction(db, {
    clientUserId: record.userId, actorUserId, actorRole,
    action: actorRole === "client_admin" ? "policy_deleted" : "deleted_policy",
    detail: `Deleted policy "${record.policyName}" (${record.id}).`,
  });
}

// Restore a policy to a prior version. `clientUserId` scopes which client's
// policyDocs to search/recreate into. Returns { ok, error? } or
// { ok:true, record, appliedFields, skippedFields }.
export function restorePolicyVersion(db, { policyId, versionId, clientUserId, actorUserId, actorRole, logClientAction }) {
  const liveRecord = (db.data.policyDocs || []).find(p => p.id === policyId && p.userId === clientUserId);
  const result = restoreVersion(db, { entityType: "policyDoc", entityId: policyId, versionId, liveRecord });
  if (!result.ok) return result;

  let record;
  if (result.recreated) {
    record = { ...result.record, id: policyId, userId: clientUserId };
    db.data.policyDocs.push(record);
  } else {
    record = result.record;
  }
  record.updatedAt = nowIso();
  record.lastEditedBy = actorUserId;

  recordVersion(db, {
    entityType: "policyDoc", entityId: policyId, clientUserId,
    action: "restore", snapshot: result.recreated ? null : result.preRestoreSnapshot, actorUserId, actorRole,
  });
  logClientAction(db, {
    clientUserId, actorUserId, actorRole,
    action: actorRole === "client_admin" ? "policy_restored" : "restored_policy",
    detail: `Restored policy "${record.policyName}" (${policyId}) to an earlier version.`,
  });
  return { ok: true, record, appliedFields: result.appliedFields, skippedFields: result.skippedFields };
}
