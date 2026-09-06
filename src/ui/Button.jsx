// src/ui/Button.jsx
// Shared button for the customer-facing UI. Introduced because App.jsx has
// 396 independently hand-styled <button> elements with no shared component,
// so visual consistency (padding, radius, color-per-purpose) currently
// depends entirely on each call site copying an existing pattern correctly.
//
// Color convention follows the one already established by the existing
// "Upgrade to Unlock" button in App.jsx's LockedFeature: dark text on a
// bright, saturated background reads better here than white-on-color (a
// plain white label on `action` only clears ~2.85:1 contrast; C.text on
// `action` clears 6.83:1 — see src/ui/tokens.js for the full contrast note).
import { C, action, actionSoft, actionText, textSafe } from "./tokens.js";
import { FONT_BODY } from "./type.js";

const SIZES = {
  sm: { padding: "7px 14px", fontSize: 13, borderRadius: 8 },
  md: { padding: "11px 22px", fontSize: 14, borderRadius: 9 },
  lg: { padding: "13px 28px", fontSize: 15, borderRadius: 10 },
};

function variantStyle(variant) {
  switch (variant) {
    case "danger":
      return { background: C.red, color: C.text, border: "none" };
    case "secondary":
      return { background: actionSoft, color: textSafe(actionText), border: `1px solid ${action}44` };
    case "ghost":
      return { background: "transparent", color: C.textSec, border: `1px solid ${C.border}` };
    case "primary":
    default:
      return { background: action, color: C.text, border: "none" };
  }
}

export default function Button({
  children, onClick, variant = "primary", size = "md",
  disabled = false, type = "button", fullWidth = false, icon = null, style = {},
}) {
  const sizeStyle = SIZES[size] || SIZES.md;
  const colorStyle = variantStyle(variant);
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="sui-focusable"
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        width: fullWidth ? "100%" : "auto",
        fontFamily: FONT_BODY, fontWeight: 700, cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1, transition: "filter 0.15s, opacity 0.15s",
        ...sizeStyle, ...colorStyle, ...style,
      }}
      onMouseOver={(e) => { if (!disabled) e.currentTarget.style.filter = "brightness(0.94)"; }}
      onMouseOut={(e) => { e.currentTarget.style.filter = "none"; }}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {children}
    </button>
  );
}
