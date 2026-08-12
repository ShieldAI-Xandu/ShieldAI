// outboundUrlSafety.js
// Shared guard against SSRF via a client-supplied destination that the
// server later fetches on the client's behalf — the Teams webhook URL
// (productivityRoutes.js/productivityAdapters.js) and Okta's pasted domain
// (directoryRoutes.js/directoryAdapters.js) are the two cases today; any
// future connector with the same "client names a host, server calls it"
// shape should use this too rather than growing its own copy.
//
// Resolves the hostname and rejects private/loopback/link-local/CGNAT
// ranges. Call this immediately before every outbound fetch to the
// client-supplied host — not just once at connect time — so a connection
// that resolved to a public IP when it was first validated can't later be
// re-pointed at an internal one for a subsequent call.

import { lookup } from "dns/promises";
import net from "net";

export function isPrivateOrReservedIp(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;                          // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16.0.0/12
    if (a === 192 && b === 168) return true;              // 192.168.0.0/16
    if (a === 127) return true;                          // 127.0.0.0/8 (loopback)
    if (a === 169 && b === 254) return true;             // 169.254.0.0/16 (link-local + cloud metadata)
    if (a === 100 && b >= 64 && b <= 127) return true;    // 100.64.0.0/10 (CGNAT)
    if (a === 0) return true;                             // 0.0.0.0/8
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;                                        // loopback
    // fe80::/10 (link-local) spans the first-hextet range fe80-febf, not
    // just the literal fe80: prefix — a startsWith("fe80:") check alone
    // misses fe81:: through febf::, e.g. fe90::1, feaa::1.
    if (/^fe[89ab]/.test(lower)) return true;                                 // fe80::/10 link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;        // fc00::/7 unique-local
    if (lower.startsWith("::ffff:")) return isPrivateOrReservedIp(lower.slice(7)); // IPv4-mapped
    return false;
  }
  return true; // couldn't classify the address at all — fail closed
}

// Accepts either a full URL ("https://host/path") or a bare hostname.
export async function assertSafeExternalHost(urlOrHost) {
  let hostname;
  try {
    hostname = String(urlOrHost).includes("://") ? new URL(urlOrHost).hostname : String(urlOrHost);
  } catch { throw new Error("Invalid URL."); }
  if (!hostname) throw new Error("Invalid URL.");
  let address;
  try { ({ address } = await lookup(hostname)); }
  catch { throw new Error("Could not resolve that host."); }
  if (isPrivateOrReservedIp(address)) {
    throw new Error("That host resolves to a private or internal address, which isn't allowed.");
  }
}

// fetch() with the guard applied to EVERY hop, not just the initial URL.
// A bare fetch() defaults to following up to 20 redirects, re-resolving DNS
// at each one with no callback into assertSafeExternalHost — so validating
// only the caller-supplied URL and then handing it to a normal fetch() is
// not actually safe: an attacker's server can 302 a validated public host
// to an internal address (e.g. the cloud-metadata IP) and the redirect gets
// followed unchecked. This fetches with redirect:"manual" and re-validates
// each Location before following it itself, capped at a small hop count.
export async function safeFetch(url, options = {}, maxRedirects = 5) {
  let current = String(url);
  for (let hop = 0; ; hop++) {
    await assertSafeExternalHost(current);
    const res = await fetch(current, { ...options, redirect: "manual" });
    const isRedirect = res.status >= 300 && res.status < 400;
    const location = isRedirect ? res.headers.get("location") : null;
    if (!location) return res;
    if (hop >= maxRedirects) throw new Error("Too many redirects.");
    current = new URL(location, current).toString();
  }
}
