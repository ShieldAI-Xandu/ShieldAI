// src/ComplianceCalendar.jsx
// The compliance calendar — everything coming due (vendor reassessments,
// policy sign-offs, training deadlines, open tasks, and custom reminders) in
// one place, as both a flat list and traditional Year/Month/Week/Day grid
// views, plus a live subscribe feed for Google Calendar / Outlook / Apple
// Calendar.
//
// Extracted out of App.jsx following the same convention ComplianceWorkspace.jsx
// established: props-driven (authFetch/apiBase/onNavigate/onUpgrade passed
// in, nothing read from App.jsx module scope), and a handful of tiny shared
// UI primitives (Card, SectionLabel, Spinner, miniBtn, safeText) re-declared
// locally rather than imported from App.jsx, which isn't designed to be an
// import target — the same "small local duplication over cross-file
// coupling" convention the backend route files already use for things like
// resolveTarget().
//
// No date library: every grid here is hand-rolled Date arithmetic, matching
// how complianceCalendarRoutes.js's own addMonths() already does it
// server-side. One real subtlety worth flagging for future edits: item
// dueDates are stored as UTC ISO timestamps representing a CALENDAR DATE,
// not a moment in time, so bucketing them by day uses UTC getters
// (ymdKeyFromIso) while grid CELLS — locally constructed Date objects with
// no server round-trip — use local getters (ymdKeyLocal). Mixing these up
// silently shifts items to the wrong day for anyone not in UTC.

import { useState, useEffect, useCallback, useMemo } from "react";
import { C, textSafe } from "./ui/tokens.js";
import { ConfirmDialog } from "./ui/Modal.jsx";

// ── Locally-declared shared primitives (see file header) ──────────
function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "object") {
    if (Array.isArray(value)) return value.map(v => safeText(v, "")).filter(Boolean).join(", ") || fallback;
    const firstString = Object.values(value).find(v => typeof v === "string");
    return firstString || fallback;
  }
  return String(value);
}

function Card({ children, style = {}, onClick }) {
  const interactive = !!onClick;
  return (
    <div
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={interactive ? "sui-focusable" : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined}
      style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 22px", cursor: interactive ? "pointer" : undefined, ...style }}>
      {children}
    </div>
  );
}

function SectionLabel({ text }) {
  return (
    <div style={{ fontSize: 10, letterSpacing: 2.5, color: C.textMut, fontWeight: 700, marginBottom: 14, textTransform: "uppercase" }}>
      {text}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center", padding: "4px 0" }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent, animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
      ))}
      <style>{`@keyframes bounce { 0%, 100% { transform: translateY(0); opacity: 0.4; } 50% { transform: translateY(-6px); opacity: 1; } }`}</style>
    </div>
  );
}

function miniBtn(color, busy) {
  return {
    padding: "6px 12px", borderRadius: 7, border: `1px solid ${color}55`,
    background: `${color}12`, color, fontSize: 12, fontWeight: 600,
    cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
  };
}

// ── Calendar-specific constants ────────────────────────────────────
const CALENDAR_SOURCE_ICON = { vendor: "🤝", policy: "📄", training: "🎓", task: "🛠️", custom: "🗓️" };
const CALENDAR_STATUS_TONE = {
  overdue:  { color: C.redText,   label: "Overdue" },
  due_soon: { color: C.amberText, label: "Due soon" },
  current:  { color: C.greenText, label: "Upcoming" },
  not_set:  { color: C.textMut,   label: "No date set" },
};
// Same priority order the backend sorts the list view by
// (complianceCalendarRoutes.js) — reused here so Year view's day-dots pick
// the "worst" status present on a day the same way the list already ranks it.
const STATUS_PRIORITY = { overdue: 0, due_soon: 1, not_set: 2, current: 3 };
const CALENDAR_CATEGORY_LABEL = {
  insurance: "Insurance", license: "License", audit: "Audit",
  contract: "Contract", regulatory: "Regulatory", other: "Other",
  vendor: "Vendor", policy: "Policy", training: "Training", task: "Task",
};

function emptyCalendarForm() {
  return { title: "", category: "other", dueDate: "", recurrenceMonths: "", notes: "" };
}

// Rescheduling a non-custom item (vendor/policy/training/task) only ever
// edits that one date — title/category/recurrence belong to the real record
// this item is projected from, not the calendar.
const CALENDAR_RESCHEDULE_NOTE = {
  vendor: "This adjusts the vendor's reassessment interval so its next review lands on this date.",
  policy: "This changes when this employee's sign-off is due.",
  training: "This changes the training assignment's due date.",
  task: "This changes the task's due date.",
};

// ── Date helpers (no library — see file header) ────────────────────
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEKDAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonthsLocal(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function addYears(d, n) { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x; }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
// Grid cells are purely local Date objects (never round-tripped through the
// server), so local getters are correct and unambiguous here.
function ymdKeyLocal(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
// Item dueDates are UTC ISO timestamps representing a calendar date — UTC
// getters avoid shifting the date for anyone not in UTC (see file header).
function ymdKeyFromIso(iso) { const d = new Date(iso); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; }
function monthGridDays(anchor) { const start = startOfWeek(startOfMonth(anchor)); return Array.from({ length: 42 }, (_, i) => addDays(start, i)); }
function weekDays(anchor) { const start = startOfWeek(anchor); return Array.from({ length: 7 }, (_, i) => addDays(start, i)); }

// ── Add/edit/reschedule modal (unchanged from the pre-extraction version) ──
function CalendarEntryModal({ initial, dueDateOnly, newPreset, onSave, onClose, busy }) {
  const [form, setForm] = useState(initial ? {
    title: initial.title || "", category: ["insurance","license","audit","contract","regulatory","other"].includes(initial.category) ? initial.category : "other",
    dueDate: (initial.dueDate || "").slice(0, 10),
    recurrenceMonths: initial.recurrenceMonths ? String(initial.recurrenceMonths) : "",
    notes: initial.notes || "",
  } : { ...emptyCalendarForm(), ...newPreset });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const lbl = { display:"block", fontSize:11.5, color:C.textSec, fontWeight:600, marginBottom:5, marginTop:10 };
  const inp = { width:"100%", padding:"9px 11px", background:C.surface, border:`1px solid ${C.border}`,
    borderRadius:7, color:C.text, fontSize:13, fontFamily:"Inter,system-ui,sans-serif", boxSizing:"border-box" };

  if (dueDateOnly) {
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(3,7,15,0.72)",display:"flex",
        alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}
        onClick={onClose}>
        <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.border}`,
          borderRadius:14,padding:24,width:"100%",maxWidth:420,maxHeight:"88vh",overflowY:"auto"}}>
          <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:4}}>Reschedule</div>
          <p style={{fontSize:12.5,color:C.textSec,margin:"0 0 4px",lineHeight:1.5}}>{safeText(initial?.title)}</p>
          <p style={{fontSize:11.5,color:C.textMut,margin:"0 0 14px",lineHeight:1.5}}>
            {CALENDAR_RESCHEDULE_NOTE[initial?.sourceType] || ""}
          </p>
          <label style={lbl}>Due date</label>
          <input type="date" value={form.dueDate} onChange={e=>set("dueDate",e.target.value)} style={inp}/>
          <div style={{display:"flex",gap:10,marginTop:18,justifyContent:"flex-end"}}>
            <button onClick={onClose} style={{...miniBtn(C.textSec,false),padding:"9px 16px"}}>Cancel</button>
            <button onClick={()=>onSave(form)} disabled={busy||!form.dueDate}
              style={{...miniBtn(C.accent,busy||!form.dueDate),padding:"9px 16px",fontWeight:700}}>
              {busy ? "Saving…" : "Save date"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(3,7,15,0.72)",display:"flex",
      alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.border}`,
        borderRadius:14,padding:24,width:"100%",maxWidth:480,maxHeight:"88vh",overflowY:"auto"}}>
        <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:14}}>
          {initial ? "Edit reminder" : "Add a compliance reminder"}
        </div>

        <label style={lbl}>What is this?</label>
        <input value={form.title} onChange={e=>set("title",e.target.value)}
          placeholder="e.g. Cyber insurance renewal, Business license renewal" style={inp}/>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <label style={lbl}>Category</label>
            <select value={form.category} onChange={e=>set("category",e.target.value)} style={inp}>
              {["insurance","license","audit","contract","regulatory","other"].map(c =>
                <option key={c} value={c}>{CALENDAR_CATEGORY_LABEL[c]}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Due date</label>
            <input type="date" value={form.dueDate} onChange={e=>set("dueDate",e.target.value)} style={inp}/>
          </div>
        </div>

        <label style={lbl}>Repeats every (months, optional)</label>
        <input type="number" min="1" value={form.recurrenceMonths} onChange={e=>set("recurrenceMonths",e.target.value)}
          placeholder="Leave blank for a one-time reminder" style={inp}/>

        <label style={lbl}>Notes</label>
        <textarea value={form.notes} onChange={e=>set("notes",e.target.value)} rows={3}
          style={{...inp,resize:"vertical",fontFamily:"inherit"}}/>

        <div style={{display:"flex",gap:10,marginTop:18,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{...miniBtn(C.textSec,false),padding:"9px 16px"}}>Cancel</button>
          <button onClick={()=>onSave(form)} disabled={busy||!form.title.trim()||!form.dueDate}
            style={{...miniBtn(C.accent,busy||!form.title.trim()||!form.dueDate),padding:"9px 16px",fontWeight:700}}>
            {busy ? "Saving…" : (initial ? "Save changes" : "Add reminder")}
          </button>
        </div>
      </div>
    </div>
  );
}

// One item's action row — shared by List, Week, and Day views so the
// mark-done/edit/view/remove logic lives in exactly one place instead of
// being tripled across views.
function CalendarItemRow({ item, busy, onComplete, onEdit, onView, onRemove }) {
  const tone = CALENDAR_STATUS_TONE[item.reviewStatus] || CALENDAR_STATUS_TONE.not_set;
  return (
    <Card style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18 }}>{CALENDAR_SOURCE_ICON[item.sourceType]}</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ color: C.text, fontWeight: 600, fontSize: 13.5 }}>{safeText(item.title)}</div>
          <div style={{ color: C.textMut, fontSize: 11.5, marginTop: 2 }}>
            {CALENDAR_CATEGORY_LABEL[item.category] || item.category}
            {item.notes ? ` · ${safeText(item.notes)}` : ""}
            {item.dueDate ? ` · Due ${new Date(item.dueDate).toLocaleDateString()}` : ""}
            {item.recurrenceMonths ? ` · Repeats every ${item.recurrenceMonths}mo` : ""}
          </div>
        </div>
        <span style={{ color: tone.color, fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>{tone.label}</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {item.sourceType === "custom" && (
            <button onClick={() => onComplete(item)} disabled={busy} style={miniBtn(C.green, busy)}>Mark done</button>
          )}
          {item.editable && (
            <button onClick={() => onEdit(item)} disabled={busy} style={miniBtn(C.accent, busy)}>
              {item.sourceType === "custom" ? "Edit" : "Reschedule"}
            </button>
          )}
          {item.detailPath && (
            <button onClick={() => onView(item)} style={miniBtn(C.textSec, false)}>View</button>
          )}
          {item.removable && (
            <button onClick={() => onRemove(item)} disabled={busy} style={miniBtn(C.textMut, busy)}>
              {item.sourceType === "policy" ? "Unassign" : item.sourceType === "training" ? "Waive" : "Remove"}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Grid views ──────────────────────────────────────────────────────
function MonthView({ anchorDate, byDay, today, onEmptyDay, onJumpToDay }) {
  const days = monthGridDays(anchorDate);
  const thisMonth = anchorDate.getMonth();
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, marginBottom: 4 }}>
        {WEEKDAY_LABELS.map(w => (
          <div key={w} style={{ textAlign: "center", fontSize: 10.5, color: C.textMut, fontWeight: 700, letterSpacing: 0.5, padding: "4px 0" }}>{w}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {days.map((day, i) => {
          const key = ymdKeyLocal(day);
          const dayItems = byDay.get(key) || [];
          const inMonth = day.getMonth() === thisMonth;
          const isToday = sameDay(day, today);
          const shown = dayItems.slice(0, 3);
          const extra = dayItems.length - shown.length;
          return (
            <div key={i}
              onClick={() => dayItems.length ? onJumpToDay(day) : onEmptyDay(day)}
              style={{
                minHeight: 78, borderRadius: 8, padding: "6px 6px", cursor: "pointer",
                background: isToday ? `${C.accent}0D` : C.surface,
                border: `1px solid ${isToday ? C.accent + "55" : C.border}`,
                opacity: inMonth ? 1 : 0.45,
              }}>
              <div style={{ fontSize: 11, color: isToday ? textSafe(C.accent) : C.textSec, fontWeight: isToday ? 800 : 600, marginBottom: 4 }}>
                {day.getDate()}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {shown.map(it => {
                  const tone = CALENDAR_STATUS_TONE[it.reviewStatus] || CALENDAR_STATUS_TONE.not_set;
                  return (
                    <div key={it.id} title={it.title} style={{
                      fontSize: 9.5, color: tone.color, background: `${tone.color}18`,
                      borderRadius: 4, padding: "1px 4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>{safeText(it.title)}</div>
                  );
                })}
                {extra > 0 && <div style={{ fontSize: 9.5, color: C.textMut }}>+{extra} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ anchorDate, byDay, today, rowProps, onEmptyDay }) {
  const days = weekDays(anchorDate);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
      {days.map((day, i) => {
        const key = ymdKeyLocal(day);
        const dayItems = (byDay.get(key) || []).slice(0, 6);
        const isToday = sameDay(day, today);
        return (
          <div key={i}>
            <div style={{
              fontSize: 11, fontWeight: 700, marginBottom: 6, padding: "3px 6px", borderRadius: 6,
              color: isToday ? textSafe(C.accent) : C.textSec, background: isToday ? `${C.accent}14` : "transparent",
            }}>
              {WEEKDAY_LABELS[day.getDay()]} {day.getDate()}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 40 }}>
              {dayItems.length === 0 ? (
                <div onClick={() => onEmptyDay(day)} style={{
                  fontSize: 10.5, color: C.textMut, padding: "8px", textAlign: "center",
                  border: `1px dashed ${C.border}`, borderRadius: 6, cursor: "pointer",
                }}>+ Add</div>
              ) : dayItems.map(it => <CalendarItemRow key={it.id} item={it} {...rowProps} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function YearView({ anchorDate, byDay, today, onJumpToMonth, onJumpToDay }) {
  const year = anchorDate.getFullYear();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
      {Array.from({ length: 12 }, (_, m) => new Date(year, m, 1)).map((monthStart, m) => {
        const days = monthGridDays(monthStart);
        return (
          <div key={m}>
            <div onClick={() => onJumpToMonth(monthStart)}
              style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6, cursor: "pointer" }}>
              {MONTH_NAMES[m]}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
              {days.map((day, i) => {
                const key = ymdKeyLocal(day);
                const dayItems = byDay.get(key) || [];
                const inMonth = day.getMonth() === m;
                const isToday = sameDay(day, today);
                let worst = null;
                for (const it of dayItems) {
                  if (worst === null || (STATUS_PRIORITY[it.reviewStatus] ?? 9) < (STATUS_PRIORITY[worst] ?? 9)) worst = it.reviewStatus;
                }
                const tone = worst ? (CALENDAR_STATUS_TONE[worst] || CALENDAR_STATUS_TONE.not_set) : null;
                return (
                  <div key={i}
                    onClick={() => dayItems.length && onJumpToDay(day)}
                    title={dayItems.length ? `${dayItems.length} item(s) due` : undefined}
                    style={{
                      aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 8.5, borderRadius: 3, cursor: dayItems.length ? "pointer" : "default",
                      opacity: inMonth ? 1 : 0.3,
                      color: isToday ? textSafe(C.accent) : C.textMut,
                      fontWeight: isToday ? 800 : 400,
                      background: tone ? `${tone.color}22` : "transparent",
                      border: isToday ? `1px solid ${C.accent}` : "1px solid transparent",
                    }}>
                    {tone ? <span style={{ width: 4, height: 4, borderRadius: "50%", background: tone.color }} /> : day.getDate()}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayView({ anchorDate, byDay, rowProps, onEmptyDay }) {
  const key = ymdKeyLocal(anchorDate);
  const dayItems = byDay.get(key) || [];
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 12 }}>
        {MONTH_NAMES[anchorDate.getMonth()]} {anchorDate.getDate()}, {anchorDate.getFullYear()}
      </div>
      {dayItems.length === 0 ? (
        <Card style={{ textAlign: "center", padding: "20px 12px" }}>
          <p style={{ color: C.textSec, fontSize: 12.5, margin: "0 0 12px" }}>Nothing due on this day.</p>
          <button onClick={() => onEmptyDay(anchorDate)} style={{
            padding: "8px 16px", background: `${C.accent}18`, border: `1px solid ${C.accent}55`,
            borderRadius: 8, color: C.accentText, fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>+ Add reminder for this day</button>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {dayItems.map(it => <CalendarItemRow key={it.id} item={it} {...rowProps} />)}
        </div>
      )}
    </div>
  );
}

// ── Subscribe (live feed) panel ─────────────────────────────────────
function SubscribeFeedPanel({ authFetch, apiBase, canDownloadExports, onUpgrade }) {
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState(null); // { enabled, token, lastFetchedAt, fetchCount } | null while loading
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [locked, setLocked] = useState(!canDownloadExports);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await authFetch(`${apiBase}/api/client/calendar/feed`);
      const data = await res.json();
      if (res.status === 402) { setLocked(true); onUpgrade?.(data); return; }
      if (!res.ok) throw new Error(data.error || "Could not load your subscribe link.");
      setLocked(false);
      setFeed(data);
    } catch (e) { setError(e.message); }
  }, [authFetch, apiBase, onUpgrade]);

  // Fetched on open (a direct user action), not in an effect — there's no
  // external state to "synchronize" here, just a one-time fetch the first
  // time the panel is opened.
  function openPanel() {
    setOpen(true);
    if (!feed) load();
  }

  async function toggle(enabled) {
    setBusy(true); setError(null);
    try {
      const res = await authFetch(`${apiBase}/api/client/calendar/feed`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      if (res.status === 402) { setLocked(true); onUpgrade?.(data); return; }
      if (!res.ok) throw new Error(data.error || "Could not update your subscribe link.");
      setFeed(data);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function regenerate() {
    setConfirmRegen(false);
    setBusy(true); setError(null);
    try {
      const res = await authFetch(`${apiBase}/api/client/calendar/feed/regenerate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not regenerate your subscribe link.");
      setFeed(data);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const origin = apiBase || (typeof window !== "undefined" ? window.location.origin : "");
  const feedUrl = feed?.token ? `${origin}/api/calendar/feed/${feed.token}.ics` : null;

  function copyLink() {
    if (!feedUrl) return;
    try {
      navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — link is still selectable/visible */ }
  }

  return (
    <div>
      <button onClick={() => (open ? setOpen(false) : openPanel())} style={{
        padding: "7px 16px", background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 8, color: C.textSec, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
      }}>
        📆 Subscribe
      </button>

      {open && (
        <Card style={{ marginTop: 10, padding: "16px 18px" }}>
          {locked ? (
            <div>
              <div style={{ color: C.text, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                Subscribe from Google, Outlook, or Apple Calendar
              </div>
              <p style={{ color: C.textSec, fontSize: 12, lineHeight: 1.6, margin: "0 0 12px" }}>
                Live calendar subscriptions are available on Growth and up. Upgrade to keep your
                compliance due dates synced to your own calendar app automatically.
              </p>
              <button onClick={() => onUpgrade?.({
                  error: "Live calendar subscriptions aren't included on your current plan.",
                  code: "UPGRADE_REQUIRED", capability: "downloadExports", currentTier: null,
                })}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: `linear-gradient(135deg, ${C.accent}, ${C.accentDm})`, color: "#04121F",
                  fontSize: 12.5, fontWeight: 700,
                }}>Upgrade to Unlock</button>
            </div>
          ) : !feed ? (
            <Spinner />
          ) : (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ color: C.text, fontSize: 13, fontWeight: 700, flex: 1 }}>Live subscribe link</div>
                <button onClick={() => toggle(!feed.enabled)} disabled={busy} style={miniBtn(feed.enabled ? C.red : C.green, busy)}>
                  {feed.enabled ? "Turn off" : "Turn on"}
                </button>
              </div>

              {feed.enabled && feedUrl && (
                <>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                    <input readOnly value={feedUrl} onFocus={e => e.target.select()} style={{
                      flex: 1, padding: "7px 10px", background: C.surface, border: `1px solid ${C.border}`,
                      borderRadius: 6, color: C.textSec, fontSize: 11.5, fontFamily: "monospace",
                    }} />
                    <button onClick={copyLink} style={miniBtn(C.accent, false)}>{copied ? "Copied!" : "Copy"}</button>
                    <button onClick={() => setConfirmRegen(true)} disabled={busy} style={miniBtn(C.textMut, busy)}>Regenerate</button>
                  </div>

                  <div style={{ color: C.textMut, fontSize: 11, lineHeight: 1.6, marginBottom: 10 }}>
                    {feed.lastFetchedAt
                      ? `Last checked by your calendar app: ${new Date(feed.lastFetchedAt).toLocaleString()} (${feed.fetchCount} time${feed.fetchCount === 1 ? "" : "s"})`
                      : "Not yet fetched — add the link to a calendar app to start syncing."}
                  </div>

                  <div style={{ color: C.amberText, fontSize: 11, lineHeight: 1.6, marginBottom: 12, background: `${C.amber}0D`, border: `1px solid ${C.amber}33`, borderRadius: 6, padding: "8px 10px" }}>
                    Anyone with this link can see these due dates and titles — treat it like a password, don't share it publicly.
                  </div>

                  <div style={{ display: "grid", gap: 8, fontSize: 11.5, color: C.textSec, lineHeight: 1.6 }}>
                    <div><b style={{ color: C.text }}>Google Calendar:</b> Settings → Add calendar → From URL, paste the link above.</div>
                    <div><b style={{ color: C.text }}>Outlook:</b> Add calendar → Subscribe from web, paste the link above.</div>
                    <div><b style={{ color: C.text }}>Apple Calendar:</b> File → New Calendar Subscription, paste the link above.</div>
                  </div>
                </>
              )}
            </div>
          )}
          {error && <div style={{ marginTop: 10, color: C.redText, fontSize: 11.5 }}>{error}</div>}
        </Card>
      )}

      <ConfirmDialog
        open={confirmRegen}
        onClose={() => setConfirmRegen(false)}
        onConfirm={regenerate}
        title="Regenerate subscribe link?"
        message="This invalidates the current link — anyone subscribed to it (including your own calendar apps) will stop receiving updates until you give them the new link."
        confirmLabel="Regenerate"
        danger
      />
    </div>
  );
}

// ── Main section ──────────────────────────────────────────────────
const VIEWS = ["list", "day", "week", "month", "year"];
const VIEW_LABEL = { list: "List", day: "Day", week: "Week", month: "Month", year: "Year" };

export default function ComplianceCalendarSection({ authFetch, apiBase = "", onNavigate, canDownloadExports = false, onUpgrade }) {
  const [items, setItems] = useState(null); // null = not loaded yet
  const [summary, setSummary] = useState(null);
  const [cap, setCap] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // null | "new" | custom item being edited
  const [newPreset, setNewPreset] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [view, setView] = useState("list");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const today = useMemo(() => new Date(), []);

  // No synchronous setState before the fetch starts (matches
  // ComplianceWorkspace.jsx's load-on-mount convention throughout that
  // file) — `items` starting at null is what drives the loading spinner,
  // rather than a separate flag reset on every call.
  // Returns the fetch's promise so other handlers can `await load()` to
  // know the refresh actually finished — the mount effect below just fires
  // it and ignores the return value.
  const load = useCallback(() => {
    return authFetch(`${apiBase}/api/client/calendar`)
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load your calendar.");
        setError(null);
        setItems(data.items || []);
        setSummary(data.summary || null);
        setCap(data.limits?.calendarEntries ?? null);
      })
      .catch(e => setError(e.message));
  }, [authFetch, apiBase]);
  useEffect(load, [load]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const it of (items || [])) {
      if (!it.dueDate) continue;
      const key = ymdKeyFromIso(it.dueDate);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return map;
  }, [items]);
  const undatedCount = (items || []).filter(it => !it.dueDate).length;

  async function saveEntry(form) {
    setBusy(true); setError(null);
    try {
      const editing = modal && modal !== "new";
      const url = editing ? `${apiBase}/api/client/calendar/${modal.id}` : `${apiBase}/api/client/calendar`;
      const body = editing && modal.sourceType !== "custom"
        ? { dueDate: form.dueDate }
        : { ...form, recurrenceMonths: form.recurrenceMonths ? Number(form.recurrenceMonths) : null };
      const res = await authFetch(url, {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 402) { setModal(null); setNewPreset(null); return onUpgrade?.(data); }
      if (!res.ok) throw new Error(data.error || "Could not save that reminder.");
      setModal(null); setNewPreset(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function completeEntry(item) {
    setBusy(true); setError(null);
    try {
      const res = await authFetch(`${apiBase}/api/client/calendar/${item.id}/complete`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update that reminder.");
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function removeEntry(item) {
    setRemoveTarget(null);
    setBusy(true); setError(null);
    try {
      const res = await authFetch(`${apiBase}/api/client/calendar/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not remove that reminder.");
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const customCount = (items || []).filter(i => i.sourceType === "custom").length;
  const atCap = cap != null && customCount >= cap;

  function handleAddClick(preset = null) {
    if (atCap) {
      return onUpgrade?.({ error: `You've used all ${cap} custom reminder slots on your current plan.`, code: "LIMIT_REACHED", resource: "calendarEntries", currentTier: null });
    }
    setNewPreset(preset);
    setModal("new");
  }

  const rowProps = { busy, onComplete: completeEntry, onEdit: setModal, onView: (item) => onNavigate && onNavigate(item.detailPath), onRemove: setRemoveTarget };

  function goToday() { setAnchorDate(new Date()); }
  function goPrev() {
    if (view === "day") setAnchorDate(d => addDays(d, -1));
    else if (view === "week") setAnchorDate(d => addDays(d, -7));
    else if (view === "month") setAnchorDate(d => addMonthsLocal(d, -1));
    else if (view === "year") setAnchorDate(d => addYears(d, -1));
  }
  function goNext() {
    if (view === "day") setAnchorDate(d => addDays(d, 1));
    else if (view === "week") setAnchorDate(d => addDays(d, 7));
    else if (view === "month") setAnchorDate(d => addMonthsLocal(d, 1));
    else if (view === "year") setAnchorDate(d => addYears(d, 1));
  }
  function jumpToDay(d) { setAnchorDate(d); setView("day"); }
  function jumpToMonth(d) { setAnchorDate(d); setView("month"); }
  function addOnEmptyDay(d) { handleAddClick({ dueDate: ymdKeyLocal(d) }); }

  const anchorLabel =
    view === "day" ? `${MONTH_NAMES[anchorDate.getMonth()]} ${anchorDate.getDate()}, ${anchorDate.getFullYear()}`
    : view === "week" ? (() => { const days = weekDays(anchorDate); return `${MONTH_NAMES[days[0].getMonth()]} ${days[0].getDate()} – ${MONTH_NAMES[days[6].getMonth()]} ${days[6].getDate()}, ${days[6].getFullYear()}`; })()
    : view === "month" ? `${MONTH_NAMES[anchorDate.getMonth()]} ${anchorDate.getFullYear()}`
    : view === "year" ? String(anchorDate.getFullYear())
    : null;

  const statTiles = summary ? [
    { label: "Overdue", value: summary.overdue, color: C.redText },
    { label: "Due soon", value: summary.dueSoon, color: C.amberText },
    { label: "Upcoming", value: summary.current, color: C.greenText },
  ] : [];

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        <SectionLabel text="Compliance Calendar"/>
        {cap != null && (
          <span style={{fontSize:11.5,color:atCap?C.amberText:C.textMut,fontWeight:600}}>
            {customCount} of {cap} custom reminders used
          </span>
        )}
        <SubscribeFeedPanel authFetch={authFetch} apiBase={apiBase} canDownloadExports={canDownloadExports} onUpgrade={onUpgrade} />
        <button onClick={()=>handleAddClick({category:"audit",recurrenceMonths:"12"})}
          style={{marginLeft:"auto",padding:"7px 16px",background:C.surface,border:`1px solid ${C.border}`,
            borderRadius:8,color:C.textSec,fontSize:12.5,fontWeight:700,cursor:"pointer"}}>
          + Audit / assessment reminder
        </button>
        <button onClick={()=>handleAddClick()}
          style={{padding:"7px 16px",background:`${C.accent}18`,border:`1px solid ${C.accent}55`,
            borderRadius:8,color:C.accentText,fontSize:12.5,fontWeight:700,cursor:"pointer"}}>
          + Add reminder
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 3 }}>
          {VIEWS.map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 700,
              background: view === v ? C.card : "transparent", color: view === v ? textSafe(C.accent) : C.textMut,
            }}>{VIEW_LABEL[v]}</button>
          ))}
        </div>
        {view !== "list" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={goPrev} style={miniBtn(C.textSec, false)}>←</button>
            <button onClick={goToday} style={miniBtn(C.textSec, false)}>Today</button>
            <button onClick={goNext} style={miniBtn(C.textSec, false)}>→</button>
            <span style={{ fontSize: 12.5, color: C.text, fontWeight: 700 }}>{anchorLabel}</span>
          </div>
        )}
      </div>

      {error && (
        <div style={{marginBottom:12,padding:"9px 12px",background:`${C.red}15`,
          border:`1px solid ${C.red}33`,borderRadius:7,color:C.redText,fontSize:12.5}}>{error}</div>
      )}

      {items === null ? <Spinner/> : (
        <>
          {summary && summary.total > 0 && (
            <Card style={{marginBottom:14}}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(120px, 1fr))",gap:14}}>
                {statTiles.map(t => (
                  <div key={t.label} style={{textAlign:"center"}}>
                    <div style={{fontSize:28,fontWeight:800,color:t.color,lineHeight:1}}>{t.value}</div>
                    <div style={{fontSize:10.5,color:C.textMut,letterSpacing:0.8,marginTop:4,textTransform:"uppercase"}}>{t.label}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {view !== "list" && undatedCount > 0 && (
            <div style={{ marginBottom: 12, fontSize: 11.5, color: C.textMut }}>
              {undatedCount} item{undatedCount === 1 ? "" : "s"} with no date set — see List view.
            </div>
          )}

          {items.length === 0 ? (
            <Card style={{textAlign:"center",padding:"24px 12px"}}>
              <p style={{color:C.textSec,fontSize:13,margin:"0 0 14px"}}>
                Nothing on your calendar yet. Vendor reassessments, policy sign-offs, and training deadlines
                will show up here automatically as you use those features — or add your own reminder for
                things like insurance renewals or audit dates.
              </p>
              <button onClick={()=>handleAddClick()}
                style={{padding:"9px 18px",background:`${C.accent}18`,border:`1px solid ${C.accent}55`,
                  borderRadius:8,color:C.accentText,fontSize:12.5,fontWeight:700,cursor:"pointer"}}>
                + Add your first reminder
              </button>
            </Card>
          ) : view === "list" ? (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {items.map(item => <CalendarItemRow key={`${item.sourceType}-${item.id}`} item={item} {...rowProps} />)}
            </div>
          ) : view === "day" ? (
            <DayView anchorDate={anchorDate} byDay={byDay} rowProps={rowProps} onEmptyDay={addOnEmptyDay} />
          ) : view === "week" ? (
            <WeekView anchorDate={anchorDate} byDay={byDay} today={today} rowProps={rowProps} onEmptyDay={addOnEmptyDay} />
          ) : view === "month" ? (
            <MonthView anchorDate={anchorDate} byDay={byDay} today={today} onEmptyDay={addOnEmptyDay} onJumpToDay={jumpToDay} />
          ) : (
            <YearView anchorDate={anchorDate} byDay={byDay} today={today} onJumpToMonth={jumpToMonth} onJumpToDay={jumpToDay} />
          )}
        </>
      )}

      {modal && (
        <CalendarEntryModal
          initial={modal === "new" ? null : modal}
          newPreset={newPreset}
          dueDateOnly={modal !== "new" && modal.sourceType !== "custom"}
          busy={busy}
          onSave={saveEntry}
          onClose={()=>{ setModal(null); setNewPreset(null); }}
        />
      )}

      <ConfirmDialog
        open={!!removeTarget}
        onClose={()=>setRemoveTarget(null)}
        onConfirm={()=>removeEntry(removeTarget)}
        title={removeTarget?.sourceType === "policy" ? "Unassign this policy?"
          : removeTarget?.sourceType === "training" ? "Waive this training?" : "Remove this reminder?"}
        message={removeTarget?.sourceType === "policy"
          ? `"${removeTarget?.notes || removeTarget?.title || ""}" will no longer be pending for this person.`
          : removeTarget?.sourceType === "training"
          ? `"${removeTarget?.title || ""}" will be marked waived instead of overdue.`
          : `Remove "${removeTarget?.title || ""}"?`}
        confirmLabel={removeTarget?.sourceType === "policy" ? "Unassign" : removeTarget?.sourceType === "training" ? "Waive" : "Remove"}
        danger
      />
    </div>
  );
}
