// src/ui/TextField.jsx
// Shared text input, replacing the pattern of each screen defining its own
// local `inputStyle`/`inp` object and applying it by hand (App.jsx has no
// shared <Input>/<TextField> today). Always renders a real <label> tied to
// the field via htmlFor/id — the app currently has 0 semantic <label>
// elements associated with form fields — plus optional hint/error text wired
// up with aria-describedby so a screen reader announces it.
import { useId } from "react";
import { C, action } from "./tokens.js";
import { FONT_BODY } from "./type.js";

export default function TextField({
  label, value, onChange, type = "text", placeholder, hint, error,
  required = false, multiline = false, rows = 4, id, style = {}, ...rest
}) {
  const autoId = useId();
  const fieldId = id || autoId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const Tag = multiline ? "textarea" : "input";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, ...style }}>
      {label && (
        <label htmlFor={fieldId} style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, color: C.text }}>
          {label}{required && <span style={{ color: C.redText }} aria-hidden="true"> *</span>}
        </label>
      )}
      <Tag
        id={fieldId}
        className="sui-focusable"
        type={multiline ? undefined : type}
        rows={multiline ? rows : undefined}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? "true" : undefined}
        style={{
          fontFamily: FONT_BODY, fontSize: 14, color: C.text,
          padding: "10px 12px", borderRadius: 8,
          border: `1px solid ${error ? C.redText : C.border}`,
          background: C.card, resize: multiline ? "vertical" : undefined,
          outlineColor: action,
        }}
        {...rest}
      />
      {hint && !error && (
        <div id={hintId} style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.textSec }}>{hint}</div>
      )}
      {error && (
        <div id={errorId} role="alert" style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.redText }}>{error}</div>
      )}
    </div>
  );
}
