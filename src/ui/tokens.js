// src/ui/tokens.js
// Canonical home for the design tokens shared across the customer-facing UI.
// Moved out of App.jsx (values unchanged) so new components under src/ui/
// can import them without App.jsx importing back from src/ui/ (circular).
// App.jsx imports C/NAV/textSafe/etc. from here now instead of declaring
// them locally.
//
// Light theme (2026-08 migration). accent/green/amber/red/purple below are
// NEVER edited in place — SOC (App.jsx, "const SOC =") holds live references
// to these five keys for the analyst console, which must stay on its own
// dark palette. Add new light-safe *Text siblings instead of touching the
// originals; see accentText/greenText/amberText/redText/purpleText below for
// the WCAG-AA-safe text/icon variants.
export const C = {
  bg:       "#F8FAFC",
  surface:  "#F1F5F9",
  card:     "#FFFFFF",
  cardHov:  "#EDF1F5",
  // Was a near-invisible pale gray (#E2E8F0/#CBD5E1) — every white card,
  // button, and input outline in the app used it, which made white-on-white
  // tiles hard to distinguish from the page and from each other. Now reuses
  // the existing brand-blue tokens (accentDm/accentText) instead of a new
  // color, and both clear WCAG's 3:1 non-text contrast minimum against
  // white (3.68:1) and the page background (3.91:1/5.67:1) — the old gray
  // did not (~1.2:1). Deliberately does NOT touch borderBottom/borderTop
  // divider lines elsewhere in the app, which are separate properties from
  // this full-outline `border`.
  border:   "#0090BB",
  borderHi: "#0369A1",
  accent:   "#00C8FF",
  accentDm: "#0090BB",
  green:    "#00E5A0",
  amber:    "#FFB800",
  red:      "#FF4D6A",
  purple:   "#A855F7",
  text:     "#080D18",
  textSec:  "#475569",
  textMut:  "#94A3B8",
  // Light-safe text/icon variants — use these wherever accent/green/amber/
  // red/purple color TEXT or an icon glyph. Backgrounds, chip fills, and
  // progress-bar fills keep using the raw tokens above unchanged.
  accentText: "#0369A1",
  greenText:  "#047857",
  amberText:  "#B45309",
  redText:    "#DC2626",
  // Light-safe replacement for the orphan mid-tier-severity green (#7ED957,
  // used raw in several places). Only apply at light-bound call sites —
  // pColor() in the analyst console intentionally keeps the raw literal.
  midGreenText: "#4D7C0F",
  purpleText: "#9333EA",
  // Secondary "Trust Blue" accent — icon fill / border / secondary-button
  // background only (2.77:1, fails as small text — never use for text).
  trustBlue:  "#0EA5E9",
};

// Warm primary-action accent, introduced for the customer-UI redesign.
// C.accent (cyan) reads as cool/informational and is already used for links
// and data highlights; every filled button in the app previously reused
// C.accent or a status color (green/amber/red) as its background, which is
// why those colors ended up doing double duty as both "posture status" and
// "click this." `action` gives buttons their own identity so status colors
// stay reserved for posture semantics.
//
// Contrast (WCAG relative-luminance formula, verified against every surface
// it's actually used on):
//   C.text (#080D18) on action   = 6.83:1  (filled-button label)
//   actionText on C.bg           = 5.53:1
//   actionText on C.card/#FFFFFF = 5.79:1
//   actionText on actionSoft     = 4.78:1
// All comfortably clear the 4.5:1 AA threshold for normal text.
export const action = "#FF6A3D";
export const actionText = "#B8390E";
export const actionSoft = "#FFE4D9";

// Maps a raw vivid accent/green/amber/red/purple/action hex to its
// light-safe text variant; anything else (already-safe colors, textSec/
// textMut, literal hexes not in this table) passes through unchanged, so
// this is safe to apply even when the input might already be text-safe.
const TEXT_SAFE = {
  [C.accent]: C.accentText,
  [C.green]:  C.greenText,
  [C.amber]:  C.amberText,
  [C.red]:    C.redText,
  [C.purple]: C.purpleText,
  [action]:   actionText,
};
export function textSafe(hex) { return TEXT_SAFE[hex] || hex; }

// Original pre-light-theme dark palette, copy-pasted (not C-referencing) so
// it can't drift when C changes. For standalone "product preview" style
// components (dashboard/report mockups) that want to look like real dark
// app UI regardless of the page they're dropped into — currently the
// marketing page's compliance-snapshot and policy-checklist previews.
export const DARK = {
  bg: "#080D18", card: "#101C30", surface: "#0D1526", border: "#1A2D47",
  text: "#E2EDFF", textSec: "#7B92B2", textMut: "#2E4A6A",
};

// The top-of-page nav bar — one navy shared by the client TopBar, the admin
// console header, the analyst console header, and the marketing site's sticky
// nav (MarketingPage's local `navy`), so every page reads as one product.
export const NAV = { bg: "#0A1428", border: "#1A2D47", text: "#E2EDFF", textDim: "#8AA0C0" };
