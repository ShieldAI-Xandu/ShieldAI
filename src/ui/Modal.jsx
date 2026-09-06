// src/ui/Modal.jsx
// Shared modal, primarily to replace the app's native window.confirm()/
// window.prompt() calls (7 call sites in App.jsx: delete assessment/program,
// delete evidence, remove vendor, reassess vendor, attach-evidence-via-
// prompt, delete report, delete training program) — a native browser dialog
// mid-flow reads as broken/untrustworthy to a non-technical user, and it
// can't be styled to explain the actual consequence of the action.
//
// Also generalizes the ~10 independently hand-rolled modal overlays already
// in App.jsx (VendorFormModal, CalendarEntryModal, AddIntegrationModal, etc.)
// into one implementation.
import { useEffect, useId, useRef } from "react";
import { C } from "./tokens.js";
import { FONT_BODY, FONT_HEADING } from "./type.js";
import Button from "./Button.jsx";

export default function Modal({ open, onClose, title, children, footer, closeOnBackdrop = true, wide = false }) {
  const titleId = useId();
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKeyDown = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={() => { if (closeOnBackdrop) onClose?.(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000, background: "rgba(8,13,24,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: wide ? 640 : 440, maxHeight: "88vh", overflowY: "auto",
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
          padding: "24px 26px", boxShadow: "0 20px 60px rgba(8,13,24,0.35)",
        }}
      >
        {title && (
          <h2 id={titleId} style={{ margin: "0 0 12px", fontFamily: FONT_HEADING, fontSize: 20, fontWeight: 700, color: C.text }}>
            {title}
          </h2>
        )}
        <div style={{ fontFamily: FONT_BODY }}>{children}</div>
        {footer && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// Convenience wrapper for the native-dialog-replacement pattern. `message`
// should state the concrete consequence ("This deletes the assessment and
// its history. This can't be undone.") rather than a generic "Are you sure?"
export function ConfirmDialog({
  open, onClose, onConfirm, title, message,
  confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, confirmDisabled = false,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{cancelLabel}</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 14, color: C.textSec, lineHeight: 1.6 }}>{message}</p>
    </Modal>
  );
}
