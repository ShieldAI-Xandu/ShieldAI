// modalFocus.test.mjs — run: node modalFocus.test.mjs
//
// The repo's only DOM test, and it exists for one specific bug class.
//
// src/ui/Modal.jsx focuses its dialog panel when it opens. That effect once
// listed `onClose` in its dependency array — and every call site passes an
// inline arrow (`onClose={()=>setAttachTask(null)}`), so `onClose` is a new
// function identity on every render of the component that owns the modal.
// Typing one character into a field inside the modal re-rendered the owner,
// changed that identity, re-ran the effect, and re-fired panel.focus() —
// yanking the caret out of the input. Every in-modal text field in the app
// was affected; it surfaced as "can't type in the evidence notes box".
//
// The bug is trivially reintroduced (add any unstable prop to that dep array)
// and completely invisible to esbuild, eslint, and every other test here —
// which is why this mounts the REAL component and asserts on real focus
// rather than inspecting the source.
//
// Modal.jsx is JSX, so it's bundled through rolldown (already a Vite
// dependency) before import. jsdom is a devDependency for the same reason.

import { build } from "rolldown";
import { JSDOM } from "jsdom";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

// ── Bundle the real Modal ─────────────────────────────────────
const bundled = await build({
  input: "src/ui/Modal.jsx",
  external: ["react", "react-dom", "react/jsx-runtime"],
  write: false,
  output: { format: "esm" },
});
// Written INSIDE the project (node_modules is gitignored) so the bundle's
// `import ... from "react"` resolves the normal way. A system temp dir has no
// node_modules above it, and the import fails there.
const tmp = path.resolve("node_modules/.cache/shieldai-modal-test");
mkdirSync(tmp, { recursive: true });
const modalPath = path.join(tmp, "Modal.mjs");
writeFileSync(modalPath, bundled.output[0].code, "utf8");

// ── DOM ───────────────────────────────────────────────────────
const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", {
  url: "http://localhost/", pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true, writable: true });
for (const k of ["HTMLElement", "Element", "Node", "Event", "KeyboardEvent", "MouseEvent", "getComputedStyle"]) {
  global[k] = dom.window[k];
}
global.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
global.cancelAnimationFrame = id => clearTimeout(id);
global.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import("react")).default;
const { useState } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const Modal = (await import(pathToFileURL(modalPath).href)).default;

const h = React.createElement;

// Mirrors src/App.jsx's EvidenceSection exactly: the draft state lives in the
// SAME component that renders <Modal>, and onClose is an inline arrow. That
// combination is what broke.
let closeCalls = 0;
function Harness() {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState("");
  return h(Modal, {
    open,
    onClose: () => { closeCalls++; setOpen(false); },
    title: "Attach proof",
  }, h("textarea", { id: "note", value: draft, onChange: e => setDraft(e.target.value) }));
}

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(h(Harness)); });

console.log("A text field inside a modal stays typeable:");
const ta = document.getElementById("note");
ok(!!ta, "modal renders with its text field");

// Set the value through the native setter so React's onChange fires the way a
// real keystroke would.
const nativeSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set;
const typeChar = (el, ch) => {
  nativeSetter.call(el, el.value + ch);
  el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};

await act(async () => { ta.focus(); });
ok(document.activeElement === ta, "field has focus before typing");

for (const ch of "Confirmed with IT") {
  await act(async () => { typeChar(document.getElementById("note"), ch); });
}

const after = document.getElementById("note");
ok(after.value === "Confirmed with IT", `every character landed (got "${after.value}")`);
ok(document.activeElement === after,
   `focus never left the field — the regression this file exists for (activeElement: ${document.activeElement?.tagName})`);

console.log("\nEscape still reaches the CURRENT onClose:");
// onClose is read through a ref now rather than captured by the effect, so
// this guards the other half: fixing the focus bug must not stale the handler.
await act(async () => {
  document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});
ok(closeCalls === 1, `Escape called onClose exactly once (got ${closeCalls})`);
ok(!document.getElementById("note"), "and the modal actually closed");

console.log("\nThe listener is cleaned up on close:");
await act(async () => {
  document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});
ok(closeCalls === 1, "a second Escape after closing does nothing");
ok(document.body.style.overflow !== "hidden", "body scroll lock released");

rmSync(tmp, { recursive: true, force: true });
console.log(fail === 0 ? "\nModal focus behaviour verified" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
