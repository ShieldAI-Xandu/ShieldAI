// src/ui/InfoTip.jsx
// Small inline glossary tooltip for jargon terms ("posture score", "gap",
// "control", "vCISO") at their first use on a screen — a contextual
// definition right where the term appears, instead of sending a
// non-technical reader on a trip to the separate Help Center to find out
// what a word means before they can understand the sentence it's in.
import { useState } from "react";
import { C } from "./tokens.js";
import { FONT_BODY } from "./type.js";

export default function InfoTip({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}>
      <button
        type="button"
        className="sui-focusable"
        aria-label="What does this mean?"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onBlur={() => setOpen(false)}
        style={{
          width: 15, height: 15, borderRadius: "50%", marginLeft: 4,
          border: `1px solid ${C.textMut}`, background: "none", color: C.textMut,
          fontSize: 10, fontWeight: 700, lineHeight: 1, cursor: "pointer", padding: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}
      >i</button>
      {open && (
        <span role="tooltip" style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
          zIndex: 50, width: 230, padding: "9px 11px", borderRadius: 8,
          background: C.text, color: "#fff", fontFamily: FONT_BODY, fontSize: 12,
          fontWeight: 400, lineHeight: 1.5, boxShadow: "0 8px 24px rgba(8,13,24,0.3)",
        }}>
          {children}
        </span>
      )}
    </span>
  );
}
