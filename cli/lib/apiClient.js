// cli/lib/apiClient.js
// Thin authenticated fetch wrapper. Every call site supplies its own path —
// there is no generic "build a URL from user input" helper here; the only
// caller allowed to construct arbitrary admin paths is adminOpsAllowlist.js,
// and even that is a closed list, not free-form.

import { SERVER_URL } from "./config.js";

export async function apiRequest(token, method, path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const message = (data && data.error) || res.statusText;
    throw new Error(`${method} ${path} -> ${res.status}: ${message}`);
  }
  return data;
}
