// src/ui/Banner.jsx
// Shared inline alert/status banner. App.jsx already uses a fairly
// consistent visual pattern for these (a red- or green-tinted Card for
// errors/confirmations), just re-implemented independently at each call
// site — this makes that pattern a real component, adds the missing
// warning/info variants, and gives errors an assertive live-region so a
// screen reader announces them without the user needing to find them.
import { C } from "./tokens.js";
import { FONT_BODY } from "./type.js";

const VARIANTS = {
  info:    { bg: C.accent, text: C.accentText, icon: "ℹ️" },
  success: { bg: C.green,  text: C.greenText,  icon: "✓" },
  warning: { bg: C.amber,  text: C.amberText,  icon: "⚠" },
  error:   { bg: C.red,    text: C.redText,    icon: "⚠" },
};

export default function Banner({ variant = "info", children, onDismiss, style = {} }) {
  const v = VARIANTS[variant] || VARIANTS.info;
  const isAlert = variant === "error" || variant === "warning";
  return (
    <div
      role={isAlert ? "alert" : "status"}
      style={{
        display: "flex", alignItems: "flex-start", gap: 10,
        background: `${v.bg}18`, border: `1px solid ${v.bg}44`, borderRadius: 10,
        padding: "12px 14px", fontFamily: FONT_BODY, fontSize: 14, color: v.text,
        ...style,
      }}
    >
      <span aria-hidden="true">{v.icon}</span>
      <div style={{ flex: 1, lineHeight: 1.5 }}>{children}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="sui-focusable"
          style={{ background: "none", border: "none", cursor: "pointer", color: v.text, fontSize: 16, lineHeight: 1, padding: 2 }}
        >
          ×
        </button>
      )}
    </div>
  );
}
