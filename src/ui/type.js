// src/ui/type.js
// Type scale + font stacks for the customer-facing UI redesign.
//
// Two families, self-hosted (see src/assets/fonts + the @font-face rules in
// src/index.css) rather than loaded from Google Fonts' CDN: server.js runs
// helmet() with its default Content-Security-Policy, which is deliberately
// scoped to 'self' (see the comment above `app.use(helmet())` in server.js)
// because the built SPA loads no external scripts, fonts, or images today.
// Self-hosting keeps that true instead of requiring a CSP change to allow
// fonts.gstatic.com, and avoids a third-party network round-trip on every
// login.
//
// - Atkinson Hyperlegible: body copy, forms, data-dense screens. Designed by
//   the Braille Institute specifically to stay legible for low-vision and
//   less digitally-fluent readers — directly matches this app's audience.
// - Lexend: headings. Google's readability-research-backed family; visually
//   distinct enough from Atkinson Hyperlegible to carry hierarchy on its
//   own (no reliance on size/weight alone), while staying close enough to
//   Inter (the font every existing App.jsx style object still asks for,
//   even though it was never actually loaded) that Inter's presence in
//   fallback chains degrades gracefully rather than needing a global
//   find-and-replace across those ~dozens of call sites in phase 1.
export const FONT_BODY = '"Atkinson Hyperlegible", Inter, system-ui, sans-serif';
export const FONT_HEADING = 'Lexend, Inter, system-ui, sans-serif';

// Base 16px, ~1.25 (major third) step ratio. Replaces the ad hoc 10-52px
// pixel literals scattered through App.jsx's inline styles — apply this
// opportunistically as screens are redesigned in later phases, not as a
// global sweep of every existing style={{fontSize:...}}.
export const TYPE = {
  xs:   12,  // fine print, badge labels
  sm:   14,  // secondary text, captions
  base: 16,  // body copy, form inputs
  md:   18,  // emphasized body, card titles
  lg:   20,  // section headings
  xl:   25,  // screen titles
  xxl:  31,  // hero/summary numbers
  xxxl: 39,  // marketing/onboarding hero text
};
