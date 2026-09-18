// cli/lib/adminOpsAllowlist.js
// The ONLY dispatch path for admin read/write actions the CLI can perform —
// there is no generic "call any admin path" escape hatch, ever. Adding a
// new op later means adding one entry here; nothing else in the dispatch
// path changes. Every path/body here maps to an existing, unchanged
// adminRoutes.js/supportRoutes.js endpoint — the CLI adds no new backend
// authorization, it's just a new client of routes already gated by
// requireAdmin/requireAnalyst.

export const ADMIN_OPS = [
  { id: "accounts-list", method: "GET", path: () => "/api/admin/accounts", confirm: false },
  { id: "account-get", method: "GET", path: ({ id }) => `/api/admin/accounts/${encodeURIComponent(id)}`, confirm: false },
  { id: "audit-list", method: "GET", path: () => "/api/admin/audit", confirm: false },
  { id: "system-health", method: "GET", path: () => "/api/admin/system-health", confirm: false },

  {
    id: "account-suspend",
    method: "POST",
    path: ({ id }) => `/api/admin/accounts/${encodeURIComponent(id)}/suspend`,
    body: ({ suspended }) => ({ suspended: !!suspended }),
    confirm: true,
    confirmMessage: ({ id, suspended }) => `${suspended ? "Suspend" : "Unsuspend"} account ${id}?`,
  },
  {
    id: "account-role",
    method: "POST",
    path: ({ id }) => `/api/admin/accounts/${encodeURIComponent(id)}/role`,
    body: ({ role, value }) => ({ role, value }),
    confirm: true,
    confirmMessage: ({ id, role, value }) => `Set role="${role}" value=${value} on account ${id}?`,
  },

  {
    id: "support-requests-list",
    method: "GET",
    path: ({ escalated, status } = {}) => {
      const qs = new URLSearchParams();
      if (escalated) qs.set("escalated", "true");
      if (status) qs.set("status", status);
      const suffix = qs.toString();
      return `/api/analyst/support-requests${suffix ? `?${suffix}` : ""}`;
    },
    confirm: false,
  },
  {
    id: "support-request-resolve",
    method: "PATCH",
    path: ({ id }) => `/api/analyst/support-requests/${encodeURIComponent(id)}`,
    body: ({ status }) => ({ status }),
    confirm: true,
    confirmMessage: ({ id, status }) => `Set support request ${id} status to "${status}"?`,
  },
];

export function findOp(id) {
  const op = ADMIN_OPS.find(o => o.id === id);
  if (!op) throw new Error(`Unknown admin op "${id}".`);
  return op;
}
