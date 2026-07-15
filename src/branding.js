// src/branding.js
// ShieldAI white-label branding — frontend.
//
// The app has a single palette object `C` (App.jsx) that ~1,400 style
// references read from. Rather than touch every call site, we mutate that
// object in place when a brand loads. Because every reference resolves
// `C.accent` at render time, a re-render after applyBrandToPalette() picks up
// the new colour everywhere automatically.
//
// Status colours (green/amber/red) are deliberately NOT rebranded — they carry
// meaning ("at risk", "healthy") and must stay stable across brands.

export const DEFAULT_BRANDING = {
  productName: "ShieldAI",
  companyName: "ShieldAI",
  tagline: "Virtual CISO Platform",
  logoUrl: null,
  primaryColor: "#2E5EAA",
  accentColor: "#00C8FF",
  supportEmail: null,
  supportUrl: null,
  footerNote: null,
  isDefault: true,
};

// The original ShieldAI palette values, captured so we can always revert.
let ORIGINAL = null;

// ── colour helpers ────────────────────────────────────────────
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function rgbToHex({ r, g, b }) {
  const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** Darken a hex colour by `amount` (0–1). Used to derive the accentDm shade. */
export function darken(hex, amount = 0.28) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex({
    r: rgb.r * (1 - amount),
    g: rgb.g * (1 - amount),
    b: rgb.b * (1 - amount),
  });
}

/** Lighten a hex colour by `amount` (0–1). */
export function lighten(hex, amount = 0.2) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex({
    r: rgb.r + (255 - rgb.r) * amount,
    g: rgb.g + (255 - rgb.g) * amount,
    b: rgb.b + (255 - rgb.b) * amount,
  });
}

/** Relative luminance (WCAG). */
export function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const ch = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(rgb.r) + 0.7152 * ch(rgb.g) + 0.0722 * ch(rgb.b);
}

/** Contrast ratio between two hex colours (1–21). */
export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The app is a dark theme. If an MSP picks a very dark brand colour it will be
 * unreadable on the dark background, so lift it until it has usable contrast.
 * Returns a colour guaranteed to be legible on `bg`.
 */
export function ensureReadableOn(hex, bg, minRatio = 3.5) {
  let out = hex;
  let guard = 0;
  while (contrastRatio(out, bg) < minRatio && guard < 12) {
    out = lighten(out, 0.12);
    guard++;
  }
  return out;
}

/**
 * Mutate the palette in place to match a brand.
 * Only accent-family keys change; background/text/status keys are preserved.
 */
export function applyBrandToPalette(C, branding) {
  if (!ORIGINAL) ORIGINAL = { ...C };

  // Reset to the shipped palette first so switching brands doesn't compound.
  Object.assign(C, ORIGINAL);

  if (!branding || branding.isDefault) return C;

  const raw = branding.accentColor || branding.primaryColor;
  if (!hexToRgb(raw)) return C;

  const accent = ensureReadableOn(raw, ORIGINAL.bg);
  C.accent = accent;
  C.accentDm = darken(accent, 0.28);
  C.borderHi = darken(accent, 0.55);

  return C;
}

/** Restore the original ShieldAI palette. */
export function resetPalette(C) {
  if (ORIGINAL) Object.assign(C, ORIGINAL);
  return C;
}

/** Merge a server branding payload over the defaults. */
export function normalizeBranding(payload) {
  if (!payload || typeof payload !== "object") return { ...DEFAULT_BRANDING };
  return { ...DEFAULT_BRANDING, ...payload };
}

/**
 * Fetch the branding the current user should see.
 * Falls back to defaults on any failure — branding must never break the app.
 */
export async function fetchBranding(authFetch, apiBase) {
  try {
    const res = await authFetch(`${apiBase}/api/branding`);
    if (!res.ok) return { ...DEFAULT_BRANDING };
    return normalizeBranding(await res.json());
  } catch {
    return { ...DEFAULT_BRANDING };
  }
}
