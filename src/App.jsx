import { useState, useRef, useEffect, useCallback, createContext, useContext } from "react";
import ComplianceWorkspace from "./ComplianceWorkspace.jsx";

// ─────────────────────────────────────────────────────────────
//  DESIGN TOKENS
// ─────────────────────────────────────────────────────────────
const C = {
  bg:       "#080D18",
  surface:  "#0D1526",
  card:     "#101C30",
  cardHov:  "#142035",
  border:   "#1A2D47",
  borderHi: "#254060",
  accent:   "#00C8FF",
  accentDm: "#0090BB",
  green:    "#00E5A0",
  amber:    "#FFB800",
  red:      "#FF4D6A",
  purple:   "#A855F7",
  text:     "#E2EDFF",
  textSec:  "#7B92B2",
  textMut:  "#2E4A6A",
};

// ─────────────────────────────────────────────────────────────
//  AI ROUTER — routes tasks to the right model
//
//  Claude-routed tasks stream live via /api/claude, unchanged.
//  Gemini/GPT-routed tasks call /api/ai/generate, which genuinely invokes
//  that provider's own API through aiProviders.js on the backend — this used
//  to always be Claude with a system-prompt instruction to role-play as the
//  other providers ("You are operating as the Gemini engine..."), so every
//  "🔵 Gemini" / "🟢 GPT-4o" badge in the product was mislabeling Claude's
//  output. That's now fixed: the badge reflects whichever provider actually
//  answered, including when a provider is unconfigured or fails and the
//  backend silently falls back to Claude — the fallback is real, but it's
//  reported as what it is rather than displayed as the originally-requested
//  provider.
// ─────────────────────────────────────────────────────────────
const AI_MODELS = {
  claude: {
    id: "claude",
    label: "Claude (Anthropic)",
    color: "#CC785C",
    icon: "🟠",
    specialty: "Risk analysis, policy drafting, compliance reasoning",
  },
  gemini: {
    id: "gemini",
    label: "Gemini (Google)",
    color: "#4285F4",
    icon: "🔵",
    specialty: "Threat intelligence, real-time web search, vendor research",
  },
  gpt4: {
    id: "gpt4",
    label: "GPT-4o (OpenAI)",
    color: "#10A37F",
    icon: "🟢",
    specialty: "Security awareness training, executive summaries, reporting",
  },
};

// Task → model routing rules
function routeTask(taskType) {
  const routes = {
    intake:          "claude",
    riskAnalysis:    "claude",
    policyDraft:     "claude",
    complianceMap:   "claude",
    threatIntel:     "gemini",
    vendorResearch:  "gemini",
    realtimeSearch:  "gemini",
    execSummary:     "gpt4",
    awarenessTraining: "gpt4",
    incidentReport:  "gpt4",
  };
  return routes[taskType] || "claude";
}

// ─────────────────────────────────────────────────────────────
//  API LAYER
// ─────────────────────────────────────────────────────────────
async function callAI(taskType, messages, systemPrompt, onChunk) {
  const model = routeTask(taskType);
  const modelInfo = AI_MODELS[model];

  // Claude keeps its existing live-streaming path — no change in behavior.
  if (model === "claude") {
    const res = await authFetch(`${API_BASE}/api/claude`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 16384,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
      }),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = dec.decode(value).split("\n").filter(l => l.startsWith("data: "));
      for (const line of lines) {
        try {
          const j = JSON.parse(line.slice(6));
          if (j.type === "content_block_delta" && j.delta?.text) {
            full += j.delta.text;
            if (onChunk) onChunk(full, "claude");
          }
        } catch {}
      }
    }
    return { text: full, model: "claude" };
  }

  // Gemini/GPT: a real call to that provider via /api/ai/generate. No
  // streaming (see the comment on that route for why), so the full answer
  // arrives at once — still reported through onChunk for callers that render
  // progressively, just as a single "chunk" rather than a live stream.
  const res = await authFetch(`${API_BASE}/api/ai/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: model,
      max_tokens: 4000,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json(); // { text, provider, fallback }
  const actualModel = data.provider === "openai" ? "gpt4" : (data.provider || model);
  if (onChunk) onChunk(data.text || "", actualModel);
  // `data.provider` is who ACTUALLY answered — if Gemini/GPT failed or wasn't
  // configured, this will correctly read "claude" (the real fallback), not
  // whatever was originally requested.
  return { text: data.text || "", model: actualModel, fallback: !!data.fallback };
}

async function callAIJson(taskType, prompt, systemPrompt) {
  const { text } = await callAI(taskType, [{ role: "user", content: prompt }], systemPrompt, null);
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ─────────────────────────────────────────────────────────────
//  SYSTEM PROMPTS
// ─────────────────────────────────────────────────────────────
const SYS = {
  // The only prompt actually used by the frontend's callAI(). Every other
  // "task type" (riskAnalysis, policyDraft, complianceMap, workflows,
  // threatIntel, toolRecommendations, awarenessTraining, execSummary) has its
  // own real, working implementation server-side in generators.js's PIPELINE,
  // called via callClaudeText during program generation — genuinely Claude,
  // with no persona role-play. This file used to carry a second, dead copy of
  // each of those prompts, unreachable from any actual call site, several of
  // them instructing the model to write "(Gemini)" or "(GPT-4o style)" — the
  // same content, never invoked, mislabeling a provider that never touched it.
  // Removed rather than fixed in place, since keeping an unreachable, inaccurate
  // duplicate around is worse than not having it.
  intake: `You are the intake AI for ShieldAI, conducting a security assessment interview for small businesses. Ask ONE conversational question at a time. After 7-9 exchanges gather:
1. Business basics: industry, employee count, revenue range, data handled
2. Current security: tools in use, IT staff, last security review
3. Compliance needs: HIPAA, PCI-DSS, SOC2, GDPR, CMMC, etc.
4. Recent incidents or concerns
5. Budget range for security

When you have enough data, output ONLY this block:
<ASSESSMENT_DONE>
{"company":{"name":"","industry":"","employees":"","revenue":"","dataTypes":[]},"posture":{"tools":[],"itStaff":"","lastAudit":"","policies":[]},"compliance":[],"incidents":"","concerns":[],"budget":"","summary":""}
</ASSESSMENT_DONE>

Before that, just have a warm, professional conversation. Start by greeting them and asking for their company name and industry.`,
};

// ─────────────────────────────────────────────────────────────
//  BRANDED DOCUMENT EXPORT HELPERS
//  Word/PowerPoint open HTML saved with a .doc/.ppt extension. These
//  helpers stamp the ShieldAI logo + brand palette onto exported docs so
//  generated policies and training decks look like a real product.
// ─────────────────────────────────────────────────────────────
const BRAND = {
  navy:   "#080D18",
  ink:    "#0B2540",
  cyan:   "#00C8FF",
  cyanDk: "#0284C7",
  rule:   "#CBD8E6",
  muted:  "#5B7088",
};

// Inline SVG of the shield mark, sized for document headers (self-contained,
// no external assets — Word renders inline SVG in modern versions; a styled
// fallback wordmark is shown regardless so older Word still looks branded).
function brandLogoSvg(px = 30) {
  return `<svg viewBox="0 0 64 80" width="${px}" height="${Math.round(px*80/64)}" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle">
  <defs><linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#0EA5E9"/><stop offset="100%" stop-color="#0284C7"/>
  </linearGradient></defs>
  <path d="M32 4 L56 14 L56 38 C56 56 42 68 32 76 C22 68 8 56 8 38 L8 14 Z" fill="url(#sg)"/>
  <path d="M22 28 L32 38 L42 28 M32 38 L32 54" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="22" cy="28" r="3.5" fill="#FFFFFF"/><circle cx="42" cy="28" r="3.5" fill="#FFFFFF"/>
  <circle cx="32" cy="54" r="3.5" fill="#FFFFFF"/><circle cx="32" cy="38" r="4.5" fill="#00E5FF"/>
  <circle cx="32" cy="38" r="2" fill="#FFFFFF"/>
</svg>`;
}

// The wordmark as inline HTML ("Shield" dark + "AI" cyan).
function brandWordmarkHtml(sizePt = 16) {
  return `<span style="font-weight:800;font-size:${sizePt}pt;letter-spacing:-0.3px;">` +
    `<span style="color:${BRAND.ink}">Shield</span><span style="color:${BRAND.cyan}">AI</span></span>`;
}

// A branded header band for the top of an exported document.
// `subtitle` is small text under the document title (e.g. company name).
function brandHeaderHtml({ docTitle = "", subtitle = "" } = {}) {
  return `
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 18pt;">
    <tr>
      <td style="vertical-align:middle;padding:0 0 10pt;">
        <span style="display:inline-block;vertical-align:middle;">${brandLogoSvg(30)}</span>
        <span style="display:inline-block;vertical-align:middle;margin-left:8px;">${brandWordmarkHtml(16)}</span>
      </td>
      <td style="vertical-align:middle;text-align:right;padding:0 0 10pt;color:${BRAND.muted};font-size:8.5pt;letter-spacing:0.5px;text-transform:uppercase;">
        Virtual CISO Platform
      </td>
    </tr>
    <tr><td colspan="2" style="border-bottom:2.5pt solid ${BRAND.cyan};font-size:0;line-height:0;">&nbsp;</td></tr>
  </table>
  ${docTitle ? `<div style="margin:0 0 2pt;font-size:9pt;letter-spacing:1px;text-transform:uppercase;color:${BRAND.cyanDk};font-weight:700;">${docTitle}</div>` : ""}
  ${subtitle ? `<div style="margin:0 0 14pt;font-size:10.5pt;color:${BRAND.muted};">${subtitle}</div>` : ""}
  `;
}

// A branded footer band (confidentiality + generation note).
function brandFooterHtml({ note = "" } = {}) {
  const year = new Date().getFullYear();
  return `
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:26pt 0 0;">
    <tr><td style="border-top:1pt solid ${BRAND.rule};font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="padding:8pt 0 0;color:${BRAND.muted};font-size:8pt;line-height:1.5;">
      <strong style="color:${BRAND.ink}">CONFIDENTIAL</strong> &middot; Prepared by ShieldAI &middot; &copy; ${year} ShieldAI.
      ${note ? `<br/>${note}` : ""}
      This document was generated by ShieldAI and should be reviewed by a qualified person before adoption.
    </td></tr>
  </table>`;
}

// Shared <style> block giving exported docs the brand look.
function brandDocStyles() {
  return `
  body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1A2A3A;line-height:1.5;}
  h1{font-size:20pt;color:${BRAND.ink};margin:0 0 6pt;}
  h2{font-size:14pt;color:${BRAND.cyanDk};border-bottom:1px solid ${BRAND.rule};padding-bottom:3pt;margin:16pt 0 6pt;}
  h3{font-size:12pt;color:${BRAND.ink};margin:10pt 0 4pt;}
  a{color:${BRAND.cyanDk};}
  table.content{margin:8pt 0;border-collapse:collapse;width:100%;}
  table.content th{background:#EAF6FC;color:${BRAND.ink};text-align:left;border:1px solid ${BRAND.rule};padding:6px;}
  table.content td{border:1px solid ${BRAND.rule};padding:6px;}
  hr{border:none;border-top:1px solid ${BRAND.rule};}
  .meta{color:${BRAND.muted};font-size:10pt;}
  `;
}

// Wrap body HTML into a complete, branded Word-openable document.
function buildBrandedWordDoc({ title, docKicker, subtitle, bodyHtml, footerNote }) {
  return `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${title || "ShieldAI Document"}</title>
<style>${brandDocStyles()}</style></head>
<body>
${brandHeaderHtml({ docTitle: docKicker || "", subtitle: subtitle || "" })}
${bodyHtml}
${brandFooterHtml({ note: footerNote || "" })}
</body></html>`;
}

// ─────────────────────────────────────────────────────────────
//  SHARED UI COMPONENTS
// ─────────────────────────────────────────────────────────────
function Badge({ label, color }) {
  const map = {
    High:"#FF4D6A", Critical:"#FF4D6A", Medium:"#FFB800", Low:C.green,
    "Quick Win":C.green, "30 Days":C.accent, "90 Days":C.amber, "Long Term":C.textSec,
    Free:C.green, "<$50/mo":C.accent, "$50-200/mo":C.amber, "$200+/mo":C.red,
    Required:C.red, Recommended:C.amber, Optional:C.green,
    Missing:C.red, Partial:C.amber, Compliant:C.green,
    Easy:C.green, Moderate:C.amber, Complex:C.red,
  };
  const c = color || map[label] || C.textSec;
  return (
    <span style={{display:"inline-flex",alignItems:"center",padding:"2px 9px",borderRadius:20,
      background:c+"22",color:c,fontSize:11,fontWeight:600,letterSpacing:0.3,margin:"2px 2px"}}>
      {label}
    </span>
  );
}

function Card({ children, style={}, onClick }) {
  return (
    <div onClick={onClick} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,
      padding:"20px 22px",...style}}>
      {children}
    </div>
  );
}

function SectionLabel({ text }) {
  return (
    <div style={{fontSize:10,letterSpacing:2.5,color:C.textMut,fontWeight:700,
      marginBottom:14,textTransform:"uppercase"}}>
      {text}
    </div>
  );
}

function AIChip({ model }) {
  const m = AI_MODELS[model] || AI_MODELS.claude;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"3px 10px",
      borderRadius:20,background:m.color+"15",border:`1px solid ${m.color}33`,
      color:m.color,fontSize:10,fontWeight:600}}>
      {m.icon} {m.label.split(" ")[0]}
    </span>
  );
}

function Spinner() {
  return (
    <div style={{display:"flex",gap:5,alignItems:"center",padding:"4px 0"}}>
      {[0,1,2].map(i => (
        <div key={i} style={{width:6,height:6,borderRadius:"50%",background:C.accent,
          animation:`bounce 1.2s ease-in-out ${i*0.2}s infinite`}}/>
      ))}
      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function PostureGauge({ score, level }) {
  // Higher = better, so colors invert vs. a risk gauge: green high, red low.
  const clr = score >= 80 ? C.green
            : score >= 60 ? "#7ED957"
            : score >= 40 ? C.amber
            : C.red;
  const circ = 2 * Math.PI * 52;
  return (
    <div style={{textAlign:"center"}}>
      <svg width={140} height={140} viewBox="0 0 140 140">
        <circle cx={70} cy={70} r={52} fill="none" stroke={C.border} strokeWidth={13}/>
        <circle cx={70} cy={70} r={52} fill="none" stroke={clr} strokeWidth={13}
          strokeDasharray={`${(score/100)*circ} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 70 70)" style={{transition:"stroke-dasharray 1.2s ease"}}/>
        <text x={70} y={64} textAnchor="middle" fill={clr} fontSize={30} fontWeight={700}
          fontFamily="Inter,system-ui,sans-serif">{score}</text>
        <text x={70} y={82} textAnchor="middle" fill={C.textSec} fontSize={9}
          fontFamily="Inter,system-ui,sans-serif">POSTURE / 100</text>
      </svg>
      <div style={{display:"inline-block",padding:"4px 18px",borderRadius:20,
        background:clr+"22",color:clr,fontSize:12,fontWeight:700,letterSpacing:1}}>
        {level?.toUpperCase()}
      </div>
    </div>
  );
}

function NavTab({ label, icon, active, onClick, badge }) {
  return (
    <button onClick={onClick} style={{
      display:"flex",alignItems:"center",gap:8,padding:"10px 14px",width:"100%",
      background:active?`${C.accent}15`:"none",border:"none",
      borderLeft:`3px solid ${active?C.accent:"transparent"}`,
      borderRadius:"0 6px 6px 0",color:active?C.accent:C.textSec,
      cursor:"pointer",fontSize:13,fontWeight:active?600:400,textAlign:"left",
      transition:"all 0.15s",marginBottom:2,
    }}>
      <span style={{fontSize:15}}>{icon}</span>
      <span style={{flex:1}}>{label}</span>
      {badge && <span style={{padding:"1px 7px",borderRadius:10,background:C.accent+"22",
        color:C.accent,fontSize:10}}>{badge}</span>}
    </button>
  );
}

function ProgressBar({ value, color=C.accent }) {
  return (
    <div style={{background:C.border,borderRadius:4,height:6,overflow:"hidden"}}>
      <div style={{width:`${value}%`,background:color,height:"100%",borderRadius:4,
        transition:"width 1s ease"}}/>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────
//  INTAKE CHAT
// ─────────────────────────────────────────────────────────────
function IntakeChat({ onComplete }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [activeModel, setActiveModel] = useState("claude");
  const chatRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    startConversation();
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, streaming]);

  async function startConversation() {
    setLoading(true);
    const { text, model } = await callAI("intake",
      [{ role:"user", content:"Hello, I want to get started with my security assessment." }],
      SYS.intake,
      (txt, m) => { setStreaming(txt); setActiveModel(m); }
    );
    setStreaming("");
    setMessages([{ role:"assistant", content:text, model }]);
    setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  async function send() {
    if (!input.trim() || loading) return;
    const userText = input.trim();
    setInput("");
    const newMsgs = [...messages, { role:"user", content:userText }];
    setMessages(newMsgs);
    setLoading(true);

    let aiText = "";
    const { text, model } = await callAI("intake", newMsgs, SYS.intake,
      (txt, m) => { setStreaming(txt); setActiveModel(m); aiText = txt; }
    );
    setStreaming("");

    if (text.includes("<ASSESSMENT_DONE>")) {
      const match = text.match(/<ASSESSMENT_DONE>([\s\S]*?)<\/ASSESSMENT_DONE>/);
      if (match) {
        try {
          const data = JSON.parse(match[1].trim());
          const finalMsg = "Excellent! I have a complete picture of your security landscape. Spinning up the full AI analysis now — Claude will handle risk modeling, Gemini will pull threat intelligence, and GPT-4o will draft your executive summary. This takes about 30 seconds...";
          setMessages([...newMsgs, { role:"assistant", content:finalMsg, model }]);
          setLoading(false);
          setTimeout(() => onComplete(data), 1800);
        } catch(e) { console.error(e); }
      }
    } else {
      setMessages([...newMsgs, { role:"assistant", content:text, model }]);
      setLoading(false);
    }
  }

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      {/* AI model indicator */}
      <div style={{padding:"10px 20px",background:C.surface,borderBottom:`1px solid ${C.border}`,
        display:"flex",alignItems:"center",gap:12}}>
        <div style={{fontSize:12,color:C.textSec}}>Active AI:</div>
        {Object.values(AI_MODELS).map(m => (
          <div key={m.id} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 10px",
            borderRadius:20,background:m.color+(activeModel===m.id?"33":"11"),
            border:`1px solid ${m.color}${activeModel===m.id?"55":"22"}`,
            color:activeModel===m.id?m.color:C.textMut,fontSize:11,fontWeight:600,
            transition:"all 0.3s"}}>
            {m.icon} {m.label.split(" ")[0]}
          </div>
        ))}
        <div style={{marginLeft:"auto",fontSize:11,color:C.textMut}}>
          Intake routed to Claude · Threat Intel → Gemini · Reports → GPT-4o
        </div>
      </div>

      {/* Messages */}
      <div ref={chatRef} style={{flex:1,overflowY:"auto",padding:"24px 20px",
        display:"flex",flexDirection:"column",gap:14}}>
        {messages.map((m,i) => (
          <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",gap:10}}>
            {m.role==="assistant" && (
              <div style={{width:34,height:34,borderRadius:8,flexShrink:0,
                background:`${C.accent}15`,border:`1px solid ${C.accent}33`,
                display:"flex",alignItems:"center",justifyContent:"center"}}><ShieldLogo size={20}/></div>
            )}
            <div style={{maxWidth:"75%"}}>
              <div style={{padding:"12px 16px",borderRadius:m.role==="user"?"16px 16px 4px 16px":"4px 16px 16px 16px",
                background:m.role==="user"?`${C.accent}18`:C.card,
                border:`1px solid ${m.role==="user"?C.accent+"33":C.border}`,
                color:C.text,fontSize:14,lineHeight:1.7}}>
                {m.role==="user" ? m.content : <ChatMarkdown text={m.content} color={C.text} mutedColor={C.textSec}/>}
              </div>
              {m.model && m.role==="assistant" && (
                <div style={{marginTop:4,paddingLeft:4}}><AIChip model={m.model}/></div>
              )}
            </div>
          </div>
        ))}
        {(streaming||loading) && (
          <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
            <div style={{width:34,height:34,borderRadius:8,flexShrink:0,
              background:`${C.accent}15`,border:`1px solid ${C.accent}33`,
              display:"flex",alignItems:"center",justifyContent:"center"}}><ShieldLogo size={20}/></div>
            <div style={{maxWidth:"75%",padding:"12px 16px",borderRadius:"4px 16px 16px 16px",
              background:C.card,border:`1px solid ${C.border}`,color:C.text,fontSize:14,lineHeight:1.7}}>
              {streaming ? <ChatMarkdown text={streaming} color={C.text} mutedColor={C.textSec}/> : <Spinner/>}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{padding:"14px 20px",borderTop:`1px solid ${C.border}`,background:C.surface}}>
        <div style={{display:"flex",gap:10}}>
          <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()}
            placeholder="Type your response…"
            style={{flex:1,padding:"11px 16px",background:C.card,border:`1px solid ${C.border}`,
              borderRadius:10,color:C.text,fontSize:14,outline:"none",
              fontFamily:"Inter,system-ui,sans-serif"}}/>
          <button onClick={send} disabled={!input.trim()||loading}
            style={{padding:"11px 22px",background:!input.trim()||loading?C.border:
              `linear-gradient(135deg,${C.accent},${C.accentDm})`,
              color:!input.trim()||loading?C.textMut:C.bg,border:"none",borderRadius:10,
              fontSize:14,fontWeight:700,cursor:!input.trim()||loading?"not-allowed":"pointer"}}>
            Send →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  ANALYSIS ENGINE  (backend-powered)
// ─────────────────────────────────────────────────────────────
// In production the Express backend serves this built frontend from ./dist, so
// the API lives on the same origin — an empty base makes every fetch relative
// and correct regardless of the deployed domain. In dev, Vite serves the
// frontend on its own port, so calls must be pointed at the backend explicitly.
const API_BASE = import.meta.env.DEV ? "http://localhost:3001" : "";

// ─────────────────────────────────────────────────────────────
//  AUTH HELPERS
// ─────────────────────────────────────────────────────────────
let AUTH_TOKEN = null;

function setAuthToken(token) {
  AUTH_TOKEN = token;
  if (!token) IS_DEMO_SESSION = false;
  // For persistence across refreshes in your local Vite app, uncomment:
  // if (token) localStorage.setItem("shieldai_token", token);
  // else localStorage.removeItem("shieldai_token");
}

// ── DEMO SANDBOX ─────────────────────────────────────────────
// Starts a read-only demo session with no credentials. The token returned is
// signed with the demo secret and binds every subsequent request to the demo
// data store on the backend — a visitor in the demo can never reach real
// client data, and nothing they do can write to it.
let IS_DEMO_SESSION = false;
function isDemoSession() { return IS_DEMO_SESSION; }

// The access-code type for the current demo session: "investor" | "client" |
// null. Drives whether the analyst console is reachable and whether the client
// dashboard shows the "Your vCISO" explainer instead.
let DEMO_ACCESS_TYPE = null;
function demoAccessType() { return DEMO_ACCESS_TYPE; }

async function startDemoSession(persona = "client") {
  const res = await fetch(`${API_BASE}/api/demo/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not start the demo.");
  IS_DEMO_SESSION = true;
  setAuthToken(data.token);
  return { ...data.user, isDemo: true, readOnly: false };
}

// Redeem an admin-issued access code → a scoped demo session. Investor codes
// return accessType "investor" (client + analyst views); client codes return
// "client" (client views only). The code is the only credential the visitor
// needs — no password, no account.
async function redeemAccessCode(code) {
  const res = await fetch(`${API_BASE}/api/demo/redeem-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not redeem that access code.");
  IS_DEMO_SESSION = true;
  DEMO_ACCESS_TYPE = data.accessType || "client";
  setAuthToken(data.token);
  return { ...data.user, isDemo: true, readOnly: false, accessType: data.accessType };
}

// Tell the server to destroy this visitor's sandbox now rather than waiting for
// it to expire. Everything they created in the demo disappears with it.
async function endDemoSession() {
  if (!IS_DEMO_SESSION) return;
  try {
    await authFetch(`${API_BASE}/api/demo/exit`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
  } catch { /* best-effort: the sandbox expires on its own regardless */ }
  IS_DEMO_SESSION = false;
  DEMO_ACCESS_TYPE = null;
}

function getAuthToken() {
  // For persistence across refreshes, uncomment:
  // if (!AUTH_TOKEN) AUTH_TOKEN = localStorage.getItem("shieldai_token");
  return AUTH_TOKEN;
}

// Drop-in replacement for fetch() that attaches the auth token.
// Capability context: lets any component check the current user's plan
// capabilities without prop-threading. Defaults to "deny" until provided.
const CapabilityContext = createContext({ can: () => false, tier: "free", capabilities: {} });
function useCapabilities() { return useContext(CapabilityContext); }

// ── White-label branding store ──
// Resolves the brand THIS user should see (their assigned analyst's brand, the
// platform default, or ShieldAI's built-in default) from GET /api/branding.
// Implemented as a tiny subscribable store rather than a context provider so it
// can re-skin every ShieldLockup without wrapping the app's many render
// branches. Display-only; the advisory boundary is untouched.
const DEFAULT_BRAND = {
  productName: "ShieldAI", companyName: "ShieldAI", tagline: "Virtual CISO Platform",
  logoUrl: null, primaryColor: "#2E5EAA", accentColor: "#00C8FF",
  supportEmail: null, supportUrl: null, footerNote: null, isDefault: true,
};
let _brand = DEFAULT_BRAND;
const _brandSubs = new Set();
function setBrand(b) {
  _brand = b ? { ...DEFAULT_BRAND, ...b } : DEFAULT_BRAND;
  _brandSubs.forEach(fn => { try { fn(_brand); } catch { /* ignore */ } });
}
// React hook: subscribe to the current brand.
function useBranding() {
  const [b, setB] = useState(_brand);
  useEffect(() => { _brandSubs.add(setB); setB(_brand); return () => { _brandSubs.delete(setB); }; }, []);
  return b;
}
// Fetch + publish the resolved brand for the logged-in user. Call from the root
// whenever the user changes; resets to default when logged out.
function refreshBrandForUser(user) {
  if (!user) { setBrand(DEFAULT_BRAND); return; }
  authFetch(`${API_BASE}/api/branding`)
    .then(r => (r.ok ? r.json() : null))
    .then(d => { if (d) setBrand(d); })
    .catch(() => { /* keep default — branding must never block the app */ });
}

// Global hook for tier-gate (HTTP 402) responses. The root registers a handler
// that shows an "upgrade" modal; any gated API call that returns 402 triggers it.
let _onUpgradeRequired = null;
function setUpgradeHandler(fn) { _onUpgradeRequired = fn; }

async function authFetch(url, options = {}) {
  const token = getAuthToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 402 && _onUpgradeRequired) {
    // Clone so the caller can still read the body if it wants to.
    try {
      const data = await res.clone().json();
      _onUpgradeRequired(data);
    } catch { _onUpgradeRequired({ error: "Upgrade required.", code: "UPGRADE_REQUIRED" }); }
  }
  return res;
}

const inputStyle = {
  width: "100%",
  padding: "11px 14px",
  background: "#0D1526",
  border: "1px solid #1A2D47",
  borderRadius: 8,
  color: "#E2EDFF",
  fontSize: 14,
  outline: "none",
  fontFamily: "Inter,system-ui,sans-serif",
  boxSizing: "border-box",
};

// ─────────────────────────────────────────────────────────────
//  AUTH SCREEN
// ─────────────────────────────────────────────────────────────
function AuthScreen({ onAuthenticated, onBack }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [capacity, setCapacity] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/auth/capacity`)
      .then(r => r.json())
      .then(setCapacity)
      .catch(() => {});
  }, []);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body = mode === "login"
        ? { email, password }
        : { email, password, companyName };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Something went wrong");

      setAuthToken(data.token);
      onAuthenticated(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const slotsFull = capacity && capacity.available === 0;
  const registerBlocked = mode === "register" && slotsFull;

  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",
      justifyContent:"center",fontFamily:"Inter,system-ui,sans-serif",padding:24}}>
      <div style={{width:"100%",maxWidth:420}}>
        {onBack && (
          <button onClick={onBack} style={{marginBottom:16,padding:"7px 14px",background:"none",
            border:`1px solid ${C.border}`,borderRadius:8,color:C.textSec,fontSize:12,cursor:"pointer"}}>
            ← Back to home
          </button>
        )}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{display:"flex",justifyContent:"center",marginBottom:12}}><ShieldLogo size={48} glow/></div>
          <ShieldWordmark size={24} ink={C.text}/>
          <div style={{fontSize:11,color:C.textMut,letterSpacing:2,marginTop:8}}>
            VIRTUAL CISO PLATFORM
          </div>
        </div>

        <Card style={{padding:"28px 26px"}}>
          <div style={{display:"flex",gap:4,marginBottom:22,background:C.surface,
            borderRadius:10,padding:4}}>
            {["login","register"].map(m => (
              <button key={m} onClick={() => { setMode(m); setError(null); }}
                style={{flex:1,padding:"9px",borderRadius:8,border:"none",cursor:"pointer",
                  background: mode===m ? C.accent : "transparent",
                  color: mode===m ? C.bg : C.textSec,
                  fontSize:13,fontWeight:600,transition:"all 0.2s"}}>
                {m === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          {mode === "register" && (
            <div style={{marginBottom:14}}>
              <label style={{display:"block",color:C.textSec,fontSize:12,marginBottom:6}}>
                Company Name
              </label>
              <input value={companyName} onChange={e=>setCompanyName(e.target.value)}
                placeholder="Acme Consulting" style={inputStyle}/>
            </div>
          )}

          <div style={{marginBottom:14}}>
            <label style={{display:"block",color:C.textSec,fontSize:12,marginBottom:6}}>
              Email
            </label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
              placeholder="you@company.com" style={inputStyle}/>
          </div>

          <div style={{marginBottom:18}}>
            <label style={{display:"block",color:C.textSec,fontSize:12,marginBottom:6}}>
              Password
            </label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !registerBlocked && submit()}
              placeholder={mode === "register" ? "At least 8 characters" : "••••••••"}
              style={inputStyle}/>
          </div>

          {error && (
            <div style={{marginBottom:16,padding:"10px 14px",background:`${C.red}15`,
              border:`1px solid ${C.red}33`,borderRadius:8,color:C.red,fontSize:13}}>
              {error}
            </div>
          )}

          {registerBlocked && (
            <div style={{marginBottom:16,padding:"10px 14px",background:`${C.amber}15`,
              border:`1px solid ${C.amber}33`,borderRadius:8,color:C.amber,fontSize:13}}>
              All {capacity.max} testing accounts are currently in use. Please sign in to an
              existing account.
            </div>
          )}

          <button onClick={submit} disabled={loading || registerBlocked}
            style={{width:"100%",padding:"12px",borderRadius:10,border:"none",
              background: loading || registerBlocked ? C.border :
                `linear-gradient(135deg,${C.accent},${C.accentDm})`,
              color: loading || registerBlocked ? C.textMut : C.bg,
              fontSize:14,fontWeight:700,
              cursor: loading || registerBlocked ? "not-allowed" : "pointer"}}>
            {loading ? "Please wait…" : mode === "login" ? "Sign In →" : "Create Account →"}
          </button>

          {capacity && mode === "register" && !registerBlocked && (
            <div style={{textAlign:"center",marginTop:14,color:C.textMut,fontSize:11}}>
              {capacity.available} of {capacity.max} testing {capacity.available === 1 ? "slot" : "slots"} remaining
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

async function generateProgram(assessmentData, onProgress) {
  // 1. Save the assessment
  const saveRes = await authFetch(`${API_BASE}/api/assessments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(assessmentData),
  });
  if (!saveRes.ok) throw new Error(`Failed to save assessment: ${saveRes.status}`);
  const { id: assessmentId } = await saveRes.json();

  // 2. Kick off generation
  const genRes = await authFetch(`${API_BASE}/api/programs/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assessmentId }),
  });
  if (!genRes.ok) throw new Error(`Failed to start generation: ${genRes.status}`);
  const { programId } = await genRes.json();

  // 3. Poll for progress
  while (true) {
    await new Promise(r => setTimeout(r, 2000));
    const statusRes = await authFetch(`${API_BASE}/api/programs/${programId}/status`);
    if (!statusRes.ok) throw new Error(`Failed to check status: ${statusRes.status}`);
    const progress = await statusRes.json();
    onProgress(progress);

    if (progress.status === "complete") break;
    if (progress.status === "error") throw new Error(progress.error || "Pipeline failed");
  }

  // 4. Fetch final program
  const programRes = await authFetch(`${API_BASE}/api/programs/${programId}`);
  if (!programRes.ok) throw new Error(`Failed to fetch program: ${programRes.status}`);
  const program = await programRes.json();
  return program.sections;
}

// Regenerate a program for an ALREADY-SAVED assessment (used by edit flow).
// Optionally deletes the user's prior programs for that assessment first.
async function regenerateProgram(assessmentId, replaceOld, onProgress) {
  if (replaceOld) {
    try {
      const listRes = await authFetch(`${API_BASE}/api/assessments/${assessmentId}/programs`);
      if (listRes.ok) {
        const programs = await listRes.json();
        await Promise.all(programs.map(p =>
          authFetch(`${API_BASE}/api/programs/${p.id}`, { method: "DELETE" }).catch(() => {})
        ));
      }
    } catch { /* non-fatal */ }
  }

  const genRes = await authFetch(`${API_BASE}/api/programs/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assessmentId }),
  });
  if (!genRes.ok) throw new Error(`Failed to start generation: ${genRes.status}`);
  const { programId } = await genRes.json();

  while (true) {
    await new Promise(r => setTimeout(r, 2000));
    const statusRes = await authFetch(`${API_BASE}/api/programs/${programId}/status`);
    if (!statusRes.ok) throw new Error(`Failed to check status: ${statusRes.status}`);
    const progress = await statusRes.json();
    onProgress(progress);
    if (progress.status === "complete") break;
    if (progress.status === "error") throw new Error(progress.error || "Pipeline failed");
  }

  const programRes = await authFetch(`${API_BASE}/api/programs/${programId}`);
  if (!programRes.ok) throw new Error(`Failed to fetch program: ${programRes.status}`);
  const program = await programRes.json();
  return program.sections;
}

// ─────────────────────────────────────────────────────────────
//  ANALYSIS PROGRESS SCREEN  (backend-powered)
// ─────────────────────────────────────────────────────────────
function AnalysisScreen({ assessment, regenerate, onComplete }) {
  const [progress, setProgress] = useState({ step: 0, total: 10, label: "Initializing…" });
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const task = regenerate
      ? regenerateProgram(regenerate.assessmentId, regenerate.replaceOld, p => setProgress(p))
      : generateProgram(assessment, p => setProgress(p));
    task
      .then(sections => onComplete(sections))
      .catch(err => {
        console.error("Generation failed:", err);
        setError(err.message);
      });
  }, []);

  const pct = Math.round((progress.step / progress.total) * 100);

  // Map pipeline step labels to a representative AI model badge for display
  const stepModelMap = {
    "Risk overview & top threats": "claude",
    "Prioritized roadmap & quick wins": "claude",
    "Core security policies": "claude",
    "Operational security policies": "claude",
    "Compliance framework gap analysis": "claude",
    "Incident response workflows": "claude",
    "Threat intelligence": "gemini",
    "Recommended tool stack": "gemini",
    "Awareness training program": "gpt4",
    "Executive summary report": "gpt4",
  };
  const activeModel = stepModelMap[progress.label] || "claude";

  if (error) {
    return (
      <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",
        justifyContent:"center",fontFamily:"Inter,system-ui,sans-serif",padding:24}}>
        <div style={{textAlign:"center",maxWidth:480}}>
          <div style={{fontSize:48,marginBottom:16}}>⚠️</div>
          <h2 style={{color:C.red,marginBottom:8}}>Generation Failed</h2>
          <p style={{color:C.textSec,fontSize:14}}>{error}</p>
          <p style={{color:C.textMut,fontSize:12,marginTop:16}}>
            Check that the backend server (node server.js) is running on port 3001.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",
      justifyContent:"center",fontFamily:"Inter,system-ui,sans-serif",padding:24}}>
      <div style={{width:"100%",maxWidth:520,textAlign:"center"}}>
        <div style={{fontSize:52,marginBottom:20,animation:"spin 4s linear infinite"}}>⚙️</div>
        <h2 style={{color:C.text,marginBottom:8,fontSize:22}}>Building Your Security Program</h2>
        <p style={{color:C.textSec,marginBottom:32,fontSize:14}}>
          Generating 10 components of your customized cybersecurity program
        </p>

        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,
          padding:"20px 24px",marginBottom:20,textAlign:"left"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <span style={{color:C.text,fontSize:14}}>{progress.label}</span>
            <span style={{color:C.accent,fontWeight:700}}>{pct}%</span>
          </div>
          <ProgressBar value={pct} color={C.accent}/>
          <div style={{marginTop:10,display:"flex",gap:6,alignItems:"center"}}>
            <AIChip model={activeModel}/>
            <span style={{color:C.textMut,fontSize:11}}>
              Step {progress.step} of {progress.total}
            </span>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
          {Object.values(AI_MODELS).map(m => (
            <div key={m.id} style={{padding:"12px",background:C.surface,
              border:`1px solid ${activeModel===m.id?m.color+"55":C.border}`,
              borderRadius:10,textAlign:"center",transition:"border-color 0.3s"}}>
              <div style={{fontSize:20,marginBottom:4}}>{m.icon}</div>
              <div style={{color:m.color,fontSize:11,fontWeight:600}}>{m.label.split(" ")[0]}</div>
              <div style={{color:C.textMut,fontSize:10,marginTop:2}}>
                {activeModel===m.id?"● Active":"Standby"}
              </div>
            </div>
          ))}
        </div>
      </div>
      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  DASHBOARD SECTIONS
// ─────────────────────────────────────────────────────────────

function OverviewSection({ assessment, results }) {
  const risk = results?.riskOverview;
  const quickWins = results?.priorities?.quickWins || [];
  const exec = results?.execReport?.executiveReport;
  const breakdown = risk?.breakdown;
  return (
    <div>
      <SectionLabel text="Security Program Overview"/>
      <div style={{display:"grid",gridTemplateColumns:"180px 1fr",gap:16,marginBottom:16}}>
        <Card style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
          <PostureGauge score={risk?.postureScore||0} level={risk?.postureLevel||"Unknown"}/>
        </Card>
        <Card>
          <SectionLabel text="Executive Summary"/>
          <p style={{color:C.textSec,fontSize:14,lineHeight:1.75,margin:"0 0 14px"}}>
            {risk?.executiveSummary || exec?.headline}
          </p>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {assessment?.compliance?.map(c=><Badge key={c} label={c} color={C.accent}/>)}
            <Badge label={`${assessment?.company?.employees||"?"} employees`} color={C.textSec}/>
            <Badge label={assessment?.company?.industry||"Unknown"} color={C.purple}/>
          </div>
        </Card>
      </div>

      {/* Posture breakdown — labelled by the client's chosen lens */}
      {breakdown?.functions && (
        <Card style={{marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
            <SectionLabel text={`${breakdown.frameworkLens || "NIST CSF"} Posture Breakdown`}/>
            <span style={{marginLeft:"auto",fontSize:10,color:C.textMut}}>
              Methodology: {breakdown.methodology}
            </span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {breakdown.functions.map((fn,i)=>{
              const clr = fn.score>=80?C.green:fn.score>=60?"#7ED957":fn.score>=40?C.amber:C.red;
              const isWeak = breakdown.weakestAreas?.includes(fn.name);
              return (
                <div key={i}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                    <span style={{color:C.text,fontSize:13,fontWeight:600}}>
                      {fn.name}
                      {isWeak && <span style={{marginLeft:8,fontSize:10,color:C.amber}}>● priority area</span>}
                    </span>
                    <span style={{color:clr,fontSize:13,fontWeight:700}}>{fn.score}/100</span>
                  </div>
                  <ProgressBar value={fn.score} color={clr}/>
                </div>
              );
            })}
          </div>
          {breakdown.complianceNote && (
            <div style={{marginTop:14,padding:"10px 12px",background:C.surface,
              borderRadius:6,color:C.textSec,fontSize:12}}>
              ⚖️ {breakdown.complianceNote}
            </div>
          )}

          {/* The other framework's view, for clients who chose CIS or both.
              Same business, same answers — a second lens, not a second verdict.
              Collapsed by default so the chosen lens stays the focus. */}
          {breakdown.alternateView?.functions && (
            <details style={{marginTop:14}}>
              <summary style={{cursor:"pointer",color:C.accent,fontSize:12,fontWeight:600}}>
                Also view in {breakdown.alternateView.frameworkLens || (breakdown.lens === "cis" ? "NIST CSF" : "CIS Controls")} terms
                {" · "}{breakdown.alternateView.postureScore}/100
              </summary>
              <div style={{marginTop:10,paddingLeft:2,display:"flex",flexDirection:"column",gap:10}}>
                <div style={{fontSize:10,color:C.textMut}}>
                  Same answers, grouped by {breakdown.alternateView.frameworkLens || "the other framework"}. The headline
                  score above is your chosen lens — this is the same posture seen a different way.
                </div>
                {breakdown.alternateView.functions.map((fn,i)=>{
                  const clr = fn.score>=80?C.green:fn.score>=60?"#7ED957":fn.score>=40?C.amber:C.red;
                  return (
                    <div key={i}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                        <span style={{color:C.textSec,fontSize:12}}>{fn.name}</span>
                        <span style={{color:clr,fontSize:12,fontWeight:700}}>{fn.score}/100</span>
                      </div>
                      <ProgressBar value={fn.score} color={clr}/>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </Card>
      )}

      {/* Top threats */}
      {risk?.topThreats?.length > 0 && (
        <Card style={{marginBottom:16}}>
          <SectionLabel text="Top Threats Identified"/>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
            {risk.topThreats.map((t,i)=>(
              <div key={i} style={{padding:"12px 14px",background:C.surface,
                border:`1px solid ${C.border}`,borderRadius:8}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{color:C.text,fontSize:13,fontWeight:600}}>{t.threat}</span>
                  <Badge label={t.likelihood}/>
                </div>
                <p style={{color:C.textSec,fontSize:12,margin:0,lineHeight:1.6}}>{t.description}</p>
                <div style={{marginTop:8}}><Badge label={`Impact: ${t.impact}`}/></div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Quick wins */}
      {quickWins.length > 0 && (
        <Card>
          <SectionLabel text="Quick Wins — Do These First"/>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {quickWins.map((w,i)=>(
              <div key={i} style={{display:"flex",gap:14,alignItems:"flex-start",padding:"10px 14px",
                background:C.surface,borderRadius:8,border:`1px solid ${C.green}22`}}>
                <div style={{width:24,height:24,borderRadius:"50%",background:C.green+"22",
                  border:`1px solid ${C.green}44`,display:"flex",alignItems:"center",
                  justifyContent:"center",color:C.green,fontSize:11,fontWeight:700,flexShrink:0}}>
                  ✓
                </div>
                <div>
                  <div style={{color:C.text,fontSize:13,fontWeight:600,marginBottom:4}}>{w.action}</div>
                  <div style={{color:C.textSec,fontSize:12}}>{w.howTo}</div>
                  <div style={{marginTop:4,color:C.green,fontSize:11}}>{w.benefit}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
function PrioritiesSection({ results }) {
  const items = results?.priorities?.priorities || [];
  const [filter, setFilter] = useState("All");
  const categories = ["All","Identity","Network","Data","Endpoint","Compliance","Awareness","AppSec"];
  const filtered = filter==="All" ? items : items.filter(p=>p.category===filter);

  return (
    <div>
      <SectionLabel text="Prioritized Security Roadmap"/>
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {categories.map(c=>(
          <button key={c} onClick={()=>setFilter(c)}
            style={{padding:"5px 14px",background:filter===c?`${C.accent}22`:C.surface,
              border:`1px solid ${filter===c?C.accent:C.border}`,borderRadius:20,
              color:filter===c?C.accent:C.textSec,fontSize:12,cursor:"pointer"}}>
            {c}
          </button>
        ))}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {filtered.map((p,i)=>(
          <Card key={p.id||i} style={{padding:"14px 18px"}}>
            <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
              <div style={{minWidth:38,height:38,borderRadius:8,background:`${C.accent}15`,
                border:`1px solid ${C.accent}33`,display:"flex",alignItems:"center",
                justifyContent:"center",color:C.accent,fontSize:11,fontWeight:700,flexShrink:0}}>
                #{p.rank||i+1}
              </div>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:4,marginBottom:6}}>
                  <span style={{color:C.text,fontWeight:600,fontSize:14}}>{p.title}</span>
                  <Badge label={p.effort}/><Badge label={p.impact}/><Badge label={p.category}/>
                  {p.estimatedCost && <Badge label={p.estimatedCost} color={C.textSec}/>}
                </div>
                <p style={{color:C.textSec,fontSize:13,margin:"0 0 8px",lineHeight:1.65}}>
                  {p.description}
                </p>
                <div style={{display:"flex",gap:6}}>
                  <span style={{fontSize:11,color:C.textMut}}>Owner:</span>
                  <span style={{fontSize:11,color:C.textSec}}>{p.owner}</span>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
function PoliciesSection({ results }) {
  // Combine policies from both pipeline steps
  const items = [
    ...(results?.policiesCore?.policies || []),
    ...(results?.policiesOps?.policies || []),
  ];
  const [expanded, setExpanded] = useState(null);
  return (
    <div>
      <SectionLabel text="Security Policies — Click to Expand"/>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {items.map((p,i)=>(
          <Card key={p.id||i} style={{cursor:"pointer",padding:"14px 18px"}}
            onClick={()=>setExpanded(expanded===i?null:i)}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:18}}>📄</span>
              <div style={{flex:1}}>
                <div style={{color:C.text,fontWeight:600,fontSize:14}}>{p.name}</div>
                <div style={{color:C.textSec,fontSize:12,marginTop:2}}>{p.purpose}</div>
              </div>
              <div style={{display:"flex",gap:6}}>
                <Badge label={p.reviewCycle||"Annual"}/>
                <span style={{color:C.textMut,fontSize:16}}>{expanded===i?"▲":"▼"}</span>
              </div>
            </div>
            {expanded===i && (
              <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${C.border}`}}>
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:11,color:C.textMut,marginBottom:6}}>SCOPE</div>
                  <p style={{color:C.textSec,fontSize:13,margin:0}}>{p.scope}</p>
                </div>
                <div style={{marginBottom:10,padding:"12px 14px",background:C.bg,
                  borderLeft:`3px solid ${C.accent}`,borderRadius:4}}>
                  <div style={{fontSize:11,color:C.accent,marginBottom:6}}>POLICY TEXT</div>
                  <p style={{color:C.text,fontSize:13,margin:0,lineHeight:1.75,fontStyle:"italic"}}>
                    {p.policyText}
                  </p>
                </div>
                {p.procedures && (
                  <div>
                    <div style={{fontSize:11,color:C.textMut,marginBottom:6}}>PROCEDURES</div>
                    {p.procedures.map((step,j)=>(
                      <div key={j} style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:6}}>
                        <div style={{width:20,height:20,borderRadius:"50%",background:`${C.accent}22`,
                          color:C.accent,fontSize:10,fontWeight:700,display:"flex",
                          alignItems:"center",justifyContent:"center",flexShrink:0}}>{j+1}</div>
                        <span style={{color:C.textSec,fontSize:13}}>{step}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{marginTop:10,display:"flex",gap:8}}>
                  <Badge label={`Owner: ${p.owner||"IT"}`} color={C.textSec}/>
                  <Badge label={`Review: ${p.reviewCycle||"Annual"}`} color={C.textSec}/>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
function WorkflowsSection({ results }) {
  const items = results?.workflows?.workflows || [];
  const [active, setActive] = useState(0);
  if (!items.length) return <div style={{color:C.textSec,padding:20}}>No workflows generated.</div>;
  const w = items[active];

  return (
    <div style={{display:"grid",gridTemplateColumns:"220px 1fr",gap:16,alignItems:"start"}}>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {items.map((wf,i)=>(
          <button key={i} onClick={()=>setActive(i)}
            style={{padding:"10px 14px",background:active===i?`${C.accent}15`:C.surface,
              border:`1px solid ${active===i?C.accent:C.border}`,borderRadius:8,
              color:active===i?C.accent:C.textSec,cursor:"pointer",textAlign:"left",
              fontSize:12,fontWeight:active===i?600:400}}>
            <div style={{fontSize:14,marginBottom:2}}>{wf.name}</div>
            <Badge label={wf.severity||"Medium"}/>
          </button>
        ))}
      </div>
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
          <div>
            <div style={{color:C.text,fontWeight:700,fontSize:16,marginBottom:4}}>{w.name}</div>
            <div style={{color:C.accent,fontSize:12}}>⚡ Trigger: {w.trigger}</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            <Badge label={w.category||""}/>
            <Badge label={w.severity||""}/>
          </div>
        </div>
        <div style={{marginBottom:14}}>
          <SectionLabel text="Steps"/>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {(w.steps||[]).map((s,i)=>(
              <div key={i} style={{display:"flex",gap:12,padding:"10px 14px",
                background:C.surface,borderRadius:8,alignItems:"flex-start"}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:`${C.accent}15`,
                  border:`1px solid ${C.accent}33`,color:C.accent,fontSize:11,fontWeight:700,
                  display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {i+1}
                </div>
                <div style={{flex:1}}>
                  <div style={{color:C.text,fontSize:13,fontWeight:600,marginBottom:3}}>
                    {s.action||s}
                  </div>
                  {s.responsible && (
                    <div style={{display:"flex",gap:8}}>
                      <span style={{color:C.textMut,fontSize:11}}>👤 {s.responsible}</span>
                      {s.timeframe && <span style={{color:C.textMut,fontSize:11}}>⏱ {s.timeframe}</span>}
                      {s.tools && <span style={{color:C.textMut,fontSize:11}}>🔧 {s.tools}</span>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        {w.escalationPath?.length > 0 && (
          <div>
            <SectionLabel text="Escalation Path"/>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {w.escalationPath.map((e,i)=>(
                <span key={i} style={{color:C.textSec,fontSize:12}}>
                  {i>0&&<span style={{color:C.textMut,margin:"0 4px"}}>→</span>}{e}
                </span>
              ))}
            </div>
          </div>
        )}
        {w.successCriteria && (
          <div style={{marginTop:12,padding:"10px 14px",background:`${C.green}11`,
            border:`1px solid ${C.green}33`,borderRadius:8}}>
            <span style={{color:C.green,fontSize:12}}>✓ Success: </span>
            <span style={{color:C.textSec,fontSize:12}}>{w.successCriteria}</span>
          </div>
        )}
      </Card>
    </div>
  );
}

// SUPERSEDED by ComplianceWorkspace.jsx and no longer routed.
//
// This rendered `results.compliance.frameworks` — prose the AI wrote during
// program generation — which was the only compliance view a client ever saw
// while the deterministic engine's 624 cited controls went unrendered. The
// workspace now reads /api/compliance/* directly.
//
// Kept for reference until the AI-generated program output is reworked; it is
// not imported anywhere. Delete once that's settled.
function ComplianceSection({ results }) {
  const frames = results?.compliance?.frameworks || [];

  // Detect a CIS Controls framework and pull out its Implementation Group
  // (the backend names it e.g. "CIS Controls v8.1 (IG1)").
  function cisInfo(name = "") {
    const isCIS = /\bCIS\b/i.test(name);
    if (!isCIS) return null;
    const m = name.match(/\b(IG[123])\b/i);
    return { ig: m ? m[1].toUpperCase() : null };
  }
  const IG_TAGLINE = {
    IG1: "Essential cyber hygiene",
    IG2: "Risk-based safeguards",
    IG3: "Full control set",
  };

  return (
    <div>
      <SectionLabel text="Compliance Framework Analysis"/>
      {frames.map((f,i)=>{
        const cis = cisInfo(f.name);
        return (
        <Card key={i} style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span style={{color:C.text,fontWeight:700,fontSize:16}}>{f.name}</span>
                {cis?.ig && (
                  <span title={`CIS Controls v8.1 — ${IG_TAGLINE[cis.ig]||""}`}
                    style={{display:"inline-flex",alignItems:"center",gap:5,
                      padding:"3px 9px",borderRadius:999,
                      background:`${C.purple}1F`,border:`1px solid ${C.purple}66`,
                      color:C.purple,fontSize:11,fontWeight:700,letterSpacing:0.4}}>
                    🛈 {cis.ig}
                    <span style={{color:C.purple,opacity:0.8,fontWeight:500}}>
                      · {IG_TAGLINE[cis.ig]||""}
                    </span>
                  </span>
                )}
              </div>
              <div style={{marginTop:4}}><Badge label={f.applicability}/></div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:28,fontWeight:700,color:
                f.overallScore>=80?C.green:f.overallScore>=50?C.amber:C.red}}>
                {f.overallScore}%
              </div>
              <ProgressBar value={f.overallScore}
                color={f.overallScore>=80?C.green:f.overallScore>=50?C.amber:C.red}/>
            </div>
          </div>
          {f.certificationPath && (
            <div style={{marginBottom:12,padding:"8px 12px",background:`${C.accent}11`,
              borderRadius:6,color:C.accent,fontSize:12}}>
              📋 Path to certification: {f.certificationPath}
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {(f.gaps||[]).map((g,j)=>(
              <div key={j} style={{display:"flex",gap:12,padding:"10px 14px",
                background:C.surface,borderRadius:8,alignItems:"flex-start"}}>
                <Badge label={g.status}/>
                <div style={{flex:1}}>
                  <div style={{color:C.text,fontSize:13,fontWeight:600}}>{g.control}</div>
                  <div style={{color:C.textSec,fontSize:12,marginTop:3}}>{g.remediation}</div>
                </div>
                <Badge label={g.priority}/>
              </div>
            ))}
          </div>
        </Card>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  BREACH MONITORING — company domain card
// ─────────────────────────────────────────────────────────────
// Real HIBP-backed breach exposure, gated on two things the backend enforces:
//   1. the client proving they control the domain (DNS TXT record)
//   2. an admin enrolling it in the HIBP dashboard (manual, no API for it)
//
// Everything shown here comes from the server's clientView(), which is the
// single source of truth for what a client is told. This component deliberately
// does NOT compute its own status — that's how a UI drifts into implying
// monitoring that isn't actually running.
// ─────────────────────────────────────────────────────────────
//  CVE EXPOSURE — live NVD-backed vulnerability matching.
//  Reads /api/client/cve-exposure, which derives real CVEs from the
//  software the monitoring agent / assessment actually reports. This is
//  the real-data replacement for the model-generated "recentCVEs" prose
//  that used to sit in this section — nothing here is fabricated.
// ─────────────────────────────────────────────────────────────
const SEV_TONE = {
  CRITICAL: C.red, HIGH: C.red, MEDIUM: C.amber, LOW: C.green, UNKNOWN: C.textSec,
};
function cveSevColor(s) { return SEV_TONE[String(s || "UNKNOWN").toUpperCase()] || C.textSec; }

function CveExposureCard() {
  const [data, setData] = useState(null);     // { software, exposure, note? }
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/client/cve-exposure`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load CVE exposure.");
      setData(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function refresh() {
    setRefreshing(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/client/cve-exposure/refresh`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Refresh failed.");
      // Refresh returns { userId, exposure }; reload the full view so
      // software list + note stay in sync with the recomputed exposure.
      await load();
    } catch (e) { setError(e.message); }
    finally { setRefreshing(false); }
  }

  const exposure = data?.exposure;
  const counts = exposure?.counts || {};
  const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
  const totalFindings = order.reduce((n, k) => n + (counts[k] || 0), 0);

  return (
    <Card style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <SectionLabel text="CVE Exposure"/>
        <span style={{fontSize:10,color:C.textMut,letterSpacing:1,fontWeight:600}}>LIVE · NVD/CVE</span>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          {exposure?.degraded && (
            <span style={{fontSize:11,color:C.amber,fontWeight:600}}>⚠ partial results</span>
          )}
          <button onClick={refresh} disabled={refreshing||loading}
            style={{padding:"5px 12px",borderRadius:7,border:`1px solid ${C.border}`,
              background:C.surface,color:C.accent,fontSize:12,fontWeight:600,
              cursor:(refreshing||loading)?"default":"pointer",opacity:(refreshing||loading)?0.6:1}}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{marginBottom:12,padding:"9px 12px",background:`${C.red}15`,
          border:`1px solid ${C.red}33`,borderRadius:7,color:C.red,fontSize:12.5}}>{error}</div>
      )}

      {loading ? <Spinner/> : (
        <>
          {/* No inventory — honest empty state, not a fabricated all-clear. */}
          {(!data?.software || data.software.length === 0) ? (
            <div style={{padding:"14px 12px",background:C.surface,border:`1px solid ${C.border}`,
              borderRadius:8,color:C.textSec,fontSize:12.5,lineHeight:1.6}}>
              {data?.note ||
                "No software inventory found yet. CVE matching needs the monitoring agent's inventory or a tech-stack entry in the assessment."}
            </div>
          ) : (
            <>
              {/* Severity rollup */}
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
                {order.filter(k => counts[k]).map(k => (
                  <div key={k} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 12px",
                    background:`${cveSevColor(k)}12`,border:`1px solid ${cveSevColor(k)}33`,borderRadius:8}}>
                    <span style={{fontSize:16,fontWeight:800,color:cveSevColor(k)}}>{counts[k]}</span>
                    <span style={{fontSize:11,fontWeight:600,color:cveSevColor(k),letterSpacing:0.4}}>{k}</span>
                  </div>
                ))}
                {totalFindings === 0 && (
                  <div style={{padding:"6px 12px",background:`${C.green}12`,
                    border:`1px solid ${C.green}33`,borderRadius:8,color:C.green,fontSize:12,fontWeight:600}}>
                    No CVEs matched the current inventory.
                  </div>
                )}
              </div>

              {/* Monitored software */}
              <div style={{fontSize:10,color:C.textMut,letterSpacing:1.5,fontWeight:600,marginBottom:8}}>
                MONITORED SOFTWARE ({data.software.length})
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:16}}>
                {data.software.map((sw,i) => (
                  <span key={i} style={{padding:"3px 10px",borderRadius:6,background:C.surface,
                    border:`1px solid ${C.border}`,color:C.textSec,fontSize:11.5}}>{sw}</span>
                ))}
              </div>

              {/* Top CVEs, most severe first */}
              {(exposure?.top || []).length > 0 && (
                <>
                  <div style={{fontSize:10,color:C.textMut,letterSpacing:1.5,fontWeight:600,marginBottom:8}}>
                    HIGHEST-SEVERITY MATCHES
                  </div>
                  {(exposure.top || []).map((c,i) => (
                    <div key={c.id+i} style={{marginBottom:8,padding:"10px 12px",
                      background:C.surface,borderRadius:7,border:`1px solid ${C.border}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                        <a href={c.url||`https://www.cve.org/CVERecord?id=${c.id}`} target="_blank" rel="noreferrer"
                          style={{color:C.accent,fontSize:12.5,fontWeight:700,textDecoration:"none"}}>{c.id}</a>
                        <Badge label={String(c.severity||"UNKNOWN")} color={cveSevColor(c.severity)}/>
                        {c.score != null && (
                          <span style={{fontSize:11,color:C.textMut,fontWeight:600}}>CVSS {c.score}</span>
                        )}
                        {c.software && (
                          <span style={{marginLeft:"auto",fontSize:11,color:C.textSec}}>{c.software}</span>
                        )}
                      </div>
                      <div style={{color:C.textSec,fontSize:12,lineHeight:1.5}}>{c.description}</div>
                    </div>
                  ))}
                </>
              )}

              {exposure?.queriedAt && (
                <div style={{marginTop:10,fontSize:11,color:C.textMut}}>
                  Queried {new Date(exposure.queriedAt).toLocaleString()} · source: NVD
                </div>
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
//  DARK-WEB / BREACH EXPOSURE — real HIBP-backed monitoring.
//
// This existed fully working on the backend (clientExposure() in
// darkwebService.js: verification-gated, never a fabricated all-clear, and
// correctly flagged `simulated: true` for demo accounts since HIBP cannot
// verify a fictional domain) but had NO frontend component displaying it —
// DomainMonitoringCard only shows the domain-verification workflow, not the
// actual breach results once verified. This is that missing piece.
// ─────────────────────────────────────────────────────────────
function DarkWebExposureCard({ clientId } = {}) {
  const [data, setData] = useState(null);   // { userId, configured, exposure }
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const qs = clientId ? `?userId=${encodeURIComponent(clientId)}` : "";
      const res = await authFetch(`${API_BASE}/api/client/darkweb-exposure${qs}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load breach exposure.");
      setData(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [clientId]);

  async function refresh() {
    setRefreshing(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/client/darkweb-exposure/refresh`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clientId ? { userId: clientId } : {}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Refresh failed.");
      await load();
    } catch (e) { setError(e.message); }
    finally { setRefreshing(false); }
  }

  const exp = data?.exposure;
  const statusColor = {
    "High alert": C.red, "Elevated": C.amber, "Low risk": "#7ED957",
    "No intel": C.green, "Not monitored": C.textMut, "Not active": C.textMut,
    "Unknown": C.textMut,
  }[exp?.statusLevel] || C.textMut;

  return (
    <Card style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <SectionLabel text="Breach & Dark-Web Exposure"/>
        <span style={{fontSize:10,color:C.textMut,letterSpacing:1,fontWeight:600}}>HIBP</span>
        {/* Load-bearing disclosure — never remove this for a cleaner-looking
            card. A demo/simulated result must never be mistakable for a live
            breach finding. */}
        {(exp?.simulated || exp?.demo) && (
          <span style={{fontSize:10,color:C.purple,letterSpacing:1,fontWeight:700,
            padding:"2px 8px",borderRadius:20,background:`${C.purple}18`,border:`1px solid ${C.purple}44`}}>
            SIMULATED — DEMO ONLY
          </span>
        )}
        <div style={{marginLeft:"auto"}}>
          {exp?.monitored && (
            <button onClick={refresh} disabled={refreshing||loading}
              style={{padding:"5px 12px",borderRadius:7,border:`1px solid ${C.border}`,
                background:C.surface,color:C.accent,fontSize:12,fontWeight:600,
                cursor:(refreshing||loading)?"default":"pointer",opacity:(refreshing||loading)?0.6:1}}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{marginBottom:12,padding:"9px 12px",background:`${C.red}15`,
          border:`1px solid ${C.red}33`,borderRadius:7,color:C.red,fontSize:12.5}}>{error}</div>
      )}

      {loading ? <Spinner/> : !exp ? (
        <div style={{padding:"14px 12px",background:C.surface,border:`1px solid ${C.border}`,
          borderRadius:8,color:C.textSec,fontSize:12.5,lineHeight:1.6}}>
          No data to report.
        </div>
      ) : !exp.monitored ? (
        // Every non-monitored state (no domain, not verified, HIBP unconfigured)
        // renders the SAME honest way: a clear reason, never a green "all clear".
        <div style={{padding:"14px 12px",background:C.surface,border:`1px solid ${C.border}`,
          borderRadius:8,color:C.textSec,fontSize:12.5,lineHeight:1.6}}>
          <div style={{color:C.text,fontWeight:600,marginBottom:4}}>{exp.statusLevel || "Not monitored"}</div>
          {exp.reason || "Breach monitoring requires a verified company domain. Add and verify your domain above to enable it."}
        </div>
      ) : (
        <>
          <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",
              background:`${statusColor}12`,border:`1px solid ${statusColor}33`,borderRadius:9}}>
              <span style={{fontSize:13,fontWeight:700,color:statusColor}}>{exp.statusLevel}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:7,padding:"8px 14px",
              background:C.surface,border:`1px solid ${C.border}`,borderRadius:9}}>
              <span style={{fontSize:16,fontWeight:800,color:C.text}}>{exp.breachedAccounts ?? 0}</span>
              <span style={{fontSize:11,color:C.textSec}}>breached account{exp.breachedAccounts===1?"":"s"}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:7,padding:"8px 14px",
              background:C.surface,border:`1px solid ${C.border}`,borderRadius:9}}>
              <span style={{fontSize:16,fontWeight:800,color:C.text}}>{exp.distinctBreaches ?? 0}</span>
              <span style={{fontSize:11,color:C.textSec}}>distinct breach{exp.distinctBreaches===1?"":"es"}</span>
            </div>
          </div>

          {(exp.breaches || []).length > 0 && (
            <>
              <div style={{fontSize:10,color:C.textMut,letterSpacing:1.5,fontWeight:600,marginBottom:8}}>
                NAMED BREACHES ({exp.breaches.length})
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
                {exp.breaches.map((b,i) => (
                  <span key={i} style={{padding:"3px 10px",borderRadius:6,background:C.surface,
                    border:`1px solid ${C.border}`,color:C.textSec,fontSize:11.5}}>{b}</span>
                ))}
              </div>
            </>
          )}

          {exp.domain && (
            <div style={{fontSize:11,color:C.textMut,marginBottom:4}}>Domain: <span style={{fontFamily:"monospace"}}>{exp.domain}</span></div>
          )}
          {(exp.checkedAt || exp.refreshedAt) && (
            <div style={{fontSize:11,color:C.textMut}}>
              Checked {new Date(exp.checkedAt || exp.refreshedAt).toLocaleString()} · source: Have I Been Pwned
            </div>
          )}
          {exp.note && (
            <div style={{marginTop:8,fontSize:11.5,color:C.textSec,lineHeight:1.5,fontStyle:"italic"}}>{exp.note}</div>
          )}
        </>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
//  REMEDIATION — the closed loop.
//  Gaps ranked by projected posture gain → create task → work it →
//  complete it → the deterministic engine re-scores and the trend moves.
//  Everything here reads/writes /api/tasks/*; no score is ever invented.
// ─────────────────────────────────────────────────────────────
const TASK_STATUS_TONE = {
  open:        { color: C.textSec, label: "Open" },
  in_progress: { color: C.accent,  label: "In Progress" },
  blocked:     { color: C.red,     label: "Blocked" },
  done:        { color: C.green,   label: "Done" },
  cancelled:   { color: C.textMut, label: "Cancelled" },
};
const TASK_PRIO_TONE = {
  critical: C.red, high: "#FF8C00", medium: C.amber, low: C.textSec,
};

// Small dependency-free SVG line chart for posture over time.
function PostureTrend({ history }) {
  const pts = (history || []).map(h => ({ t: new Date(h.at).getTime(), score: h.score }));
  if (pts.length < 2) {
    return (
      <div style={{color:C.textMut,fontSize:12,padding:"8px 0"}}>
        The trend chart fills in as tasks are completed — each completion records a real posture snapshot.
      </div>
    );
  }
  const W = 640, H = 120, pad = 24;
  const xs = pts.map(p => p.t), ys = pts.map(p => p.score);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.max(0, Math.min(...ys) - 5), yMax = Math.min(100, Math.max(...ys) + 5);
  const xOf = t => pad + ((t - xMin) / (xMax - xMin || 1)) * (W - pad * 2);
  const yOf = s => H - pad - ((s - yMin) / (yMax - yMin || 1)) * (H - pad * 2);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${xOf(p.t).toFixed(1)},${yOf(p.score).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1], first = pts[0];
  const net = last.score - first.score;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{display:"block"}}>
        <line x1={pad} y1={H-pad} x2={W-pad} y2={H-pad} stroke={C.border} strokeWidth="1"/>
        <path d={path} fill="none" stroke={C.accent} strokeWidth="2"/>
        {pts.map((p,i) => (
          <circle key={i} cx={xOf(p.t)} cy={yOf(p.score)} r="3" fill={C.accent}/>
        ))}
        <circle cx={xOf(last.t)} cy={yOf(last.score)} r="4.5" fill={C.green}/>
      </svg>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.textMut,marginTop:4}}>
        <span>{new Date(first.t).toLocaleDateString()} · {first.score}</span>
        <span style={{color: net >= 0 ? C.green : C.red, fontWeight:600}}>
          {net >= 0 ? "+" : ""}{net} over {pts.length} snapshots
        </span>
        <span>{new Date(last.t).toLocaleDateString()} · {last.score}</span>
      </div>
    </div>
  );
}

function RemediationSection() {
  const [gaps, setGaps] = useState(null);      // { posture, gaps[] }
  const [tasks, setTasks] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState("gaps");       // gaps | tasks

  async function loadAll() {
    setLoading(true); setError(null);
    try {
      const [gRes, tRes, hRes] = await Promise.all([
        authFetch(`${API_BASE}/api/tasks/gaps`),
        authFetch(`${API_BASE}/api/tasks`),
        authFetch(`${API_BASE}/api/tasks/posture-history`),
      ]);
      const g = await gRes.json();
      const t = await tRes.json();
      const h = await hRes.json();
      if (!gRes.ok) throw new Error(g.error || "Could not load gap analysis.");
      setGaps(g);
      setTasks(Array.isArray(t) ? t : []);
      setHistory(Array.isArray(h) ? h : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); }, []);

  function flash(msg, tone = C.green) {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 3200);
  }

  async function createTask(gap, priority = "medium") {
    setBusyId("gap:" + gap.controlId); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/tasks`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          controlId: gap.controlId, targetLabel: gap.targetAnswer,
          title: `Improve: ${gap.question}`, priority,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not create task.");
      flash(`Task created · projected +${gap.projectedGain} posture`);
      await loadAll();
      setTab("tasks");
    } catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  }

  async function setStatus(task, status) {
    setBusyId(task.id); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/tasks/${task.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not update task.");
      await loadAll();
    } catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  }

  async function complete(task) {
    setBusyId(task.id); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/tasks/${task.id}/complete`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not complete task.");
      const p = d.posture || {};
      const delta = p.delta ?? 0;
      flash(`Completed · posture ${p.before} → ${p.after} (${delta >= 0 ? "+" : ""}${delta})`,
        delta >= 0 ? C.green : C.amber);
      await loadAll();
    } catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  }

  async function removeTask(task) {
    setBusyId(task.id); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/tasks/${task.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not delete task.");
      await loadAll();
    } catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  }

  const posture = gaps?.posture;
  const openGaps = (gaps?.gaps || []).filter(g => !g.hasOpenTask);
  const activeTasks = tasks.filter(t => !["done", "cancelled"].includes(t.status));
  const doneTasks = tasks.filter(t => t.status === "done");

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <SectionLabel text="Remediation"/>
        <span style={{fontSize:10,color:C.textMut,letterSpacing:1,fontWeight:600}}>DETERMINISTIC SCORING</span>
      </div>

      {toast && (
        <div style={{marginBottom:12,padding:"10px 14px",background:`${toast.tone}18`,
          border:`1px solid ${toast.tone}44`,borderRadius:8,color:toast.tone,fontSize:13,fontWeight:600}}>
          {toast.msg}
        </div>
      )}
      {error && (
        <div style={{marginBottom:12,padding:"9px 12px",background:`${C.red}15`,
          border:`1px solid ${C.red}33`,borderRadius:7,color:C.red,fontSize:12.5}}>{error}</div>
      )}

      {loading ? <Spinner/> : (
        <>
          {/* Posture header + trend */}
          <Card style={{marginBottom:14}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:20,flexWrap:"wrap"}}>
              <div style={{minWidth:120}}>
                <div style={{fontSize:11,color:C.textMut,letterSpacing:1,fontWeight:600,marginBottom:4}}>POSTURE SCORE</div>
                {posture ? (
                  <>
                    <div style={{fontSize:40,fontWeight:800,color:C.accent,lineHeight:1}}>{posture.score}</div>
                    <div style={{fontSize:12,color:C.textSec,marginTop:4}}>{posture.level}</div>
                  </>
                ) : (
                  <div style={{fontSize:13,color:C.textSec}}>No assessment yet.</div>
                )}
              </div>
              <div style={{flex:1,minWidth:280}}>
                <div style={{fontSize:11,color:C.textMut,letterSpacing:1,fontWeight:600,marginBottom:6}}>POSTURE TREND</div>
                <PostureTrend history={history}/>
              </div>
            </div>
            {posture?.weakestAreas?.length > 0 && (
              <div style={{marginTop:12,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{fontSize:11,color:C.textMut,fontWeight:600}}>WEAKEST:</span>
                {posture.weakestAreas.map((w,i) => (
                  <span key={i} style={{padding:"3px 10px",borderRadius:6,background:`${C.red}12`,
                    border:`1px solid ${C.red}30`,color:C.red,fontSize:11}}>{w}</span>
                ))}
              </div>
            )}
          </Card>

          {/* Tabs */}
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            {[["gaps",`Prioritized Gaps (${openGaps.length})`],["tasks",`Tasks (${activeTasks.length})`]].map(([id,label]) => (
              <button key={id} onClick={()=>setTab(id)}
                style={{padding:"7px 16px",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer",
                  border:`1px solid ${tab===id?C.accent:C.border}`,
                  background:tab===id?`${C.accent}18`:C.surface,
                  color:tab===id?C.accent:C.textSec}}>{label}</button>
            ))}
          </div>

          {/* GAPS */}
          {tab === "gaps" && (
            <>
              {!posture ? (
                <Card><div style={{color:C.textSec,fontSize:13}}>
                  Complete a security assessment to see prioritized remediation gaps.
                </div></Card>
              ) : openGaps.length === 0 ? (
                <Card><div style={{color:C.green,fontSize:13,fontWeight:600}}>
                  ✓ No open gaps. Every scored control is at its best answer, or already has a task.
                </div></Card>
              ) : (
                <div style={{fontSize:12,color:C.textSec,marginBottom:10}}>
                  Ranked by how much each fix would move the deterministic posture score. Creating a task lets you track the work; completing it applies the change and re-scores.
                </div>
              )}
              {openGaps.map(g => {
                const busy = busyId === "gap:" + g.controlId;
                return (
                  <Card key={g.controlId} style={{marginBottom:10}}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:14}}>
                      <div style={{textAlign:"center",minWidth:60}}>
                        <div style={{fontSize:22,fontWeight:800,color:C.green}}>+{g.projectedGain}</div>
                        <div style={{fontSize:9,color:C.textMut,letterSpacing:0.5}}>PROJECTED</div>
                      </div>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                          <Badge label={g.nistFunction} color={NIST_COLORS[g.nistFunction]}/>
                          <span style={{fontSize:11,color:C.textMut}}>→ score {g.projectedScore}</span>
                        </div>
                        <div style={{color:C.text,fontSize:13.5,fontWeight:600,marginBottom:6}}>{g.question}</div>
                        <div style={{fontSize:12,color:C.textSec,lineHeight:1.5}}>
                          <span style={{color:C.textMut}}>Now:</span> {g.currentAnswer || "Unanswered"}
                          <span style={{margin:"0 8px",color:C.textMut}}>→</span>
                          <span style={{color:C.green}}>{g.targetAnswer}</span>
                        </div>
                      </div>
                      <button onClick={()=>createTask(g)} disabled={busy}
                        style={{padding:"8px 14px",borderRadius:8,border:"none",
                          background:C.accent,color:"#04121F",fontSize:12.5,fontWeight:700,
                          cursor:busy?"default":"pointer",opacity:busy?0.6:1,whiteSpace:"nowrap"}}>
                        {busy ? "Creating…" : "Create Task"}
                      </button>
                    </div>
                  </Card>
                );
              })}
            </>
          )}

          {/* TASKS */}
          {tab === "tasks" && (
            <>
              {activeTasks.length === 0 && doneTasks.length === 0 ? (
                <Card><div style={{color:C.textSec,fontSize:13}}>
                  No tasks yet. Open the Prioritized Gaps tab to turn your biggest fixes into tracked work.
                </div></Card>
              ) : null}

              {activeTasks.map(t => {
                const busy = busyId === t.id;
                const tone = TASK_STATUS_TONE[t.status] || TASK_STATUS_TONE.open;
                const overdue = t.dueDate && new Date(t.dueDate) < new Date();
                return (
                  <Card key={t.id} style={{marginBottom:10}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
                      <span style={{width:8,height:8,borderRadius:"50%",background:TASK_PRIO_TONE[t.priority]||C.textSec}}/>
                      <span style={{color:C.text,fontSize:13.5,fontWeight:600,flex:1}}>{t.title}</span>
                      {t.projectedGain != null && (
                        <span style={{fontSize:11,color:C.green,fontWeight:600}}>+{t.projectedGain} projected</span>
                      )}
                      <span style={{fontSize:11,fontWeight:700,color:tone.color,
                        padding:"2px 9px",borderRadius:20,background:`${tone.color}18`}}>{tone.label}</span>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:10,fontSize:11,color:C.textMut,marginBottom:10}}>
                      <span>{t.nistFunction}</span>
                      {t.dueDate && (
                        <span style={{color:overdue?C.red:C.textMut}}>
                          {overdue ? "⚠ overdue " : "due "}{new Date(t.dueDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      {t.status !== "in_progress" && (
                        <button onClick={()=>setStatus(t,"in_progress")} disabled={busy}
                          style={miniBtn(C.accent,busy)}>Start</button>
                      )}
                      {t.status !== "blocked" && (
                        <button onClick={()=>setStatus(t,"blocked")} disabled={busy}
                          style={miniBtn(C.red,busy)}>Block</button>
                      )}
                      <button onClick={()=>complete(t)} disabled={busy}
                        style={{...miniBtn(C.green,busy),background:C.green,color:"#04121F",border:"none"}}>
                        {busy ? "Working…" : "Complete & Re-score"}
                      </button>
                      <button onClick={()=>removeTask(t)} disabled={busy}
                        style={{...miniBtn(C.textMut,busy),marginLeft:"auto"}}>Delete</button>
                    </div>
                  </Card>
                );
              })}

              {doneTasks.length > 0 && (
                <>
                  <div style={{fontSize:10,color:C.textMut,letterSpacing:1.5,fontWeight:600,margin:"16px 0 8px"}}>
                    COMPLETED ({doneTasks.length})
                  </div>
                  {doneTasks.map(t => (
                    <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",
                      background:C.surface,borderRadius:7,border:`1px solid ${C.border}`,marginBottom:6}}>
                      <span style={{color:C.green}}>✓</span>
                      <span style={{color:C.textSec,fontSize:12.5,flex:1}}>{t.title}</span>
                      {t.actualGain != null && (
                        <span style={{fontSize:11,color: t.actualGain >= 0 ? C.green : C.amber,fontWeight:600}}>
                          {t.actualGain >= 0 ? "+" : ""}{t.actualGain} posture
                        </span>
                      )}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
function miniBtn(color, busy) {
  return {
    padding:"6px 12px", borderRadius:7, border:`1px solid ${color}55`,
    background:`${color}12`, color, fontSize:12, fontWeight:600,
    cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
  };
}

// ─────────────────────────────────────────────────────────────
//  EVIDENCE / AUDIT READINESS.
//  Auditors, insurers, and boards want proof, not assertions. This reads
//  /api/evidence/* — coverage (completed work that can't be proven),
//  the evidence list, base64 upload, authenticated download, delete.
// ─────────────────────────────────────────────────────────────
const EVIDENCE_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,.doc,.docx,.xls,.xlsx";
const EVIDENCE_MAX_BYTES = 3.5 * 1024 * 1024;

function fmtBytes(n) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Read a File into { filename, mimeType, content } where content is raw base64.
function fileToUpload(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result || "");
      const comma = res.indexOf(",");
      resolve({ filename: file.name, mimeType: file.type, content: comma >= 0 ? res.slice(comma + 1) : res });
    };
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });
}

// Download an auth-protected evidence file as a blob (can't use a bare href
// because the endpoint requires the Authorization header).
async function downloadEvidence(ev) {
  const res = await authFetch(`${API_BASE}${ev.downloadUrl}`);
  if (!res.ok) {
    let msg = "Download failed.";
    try { msg = (await res.json()).error || msg; } catch { /* non-json */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = ev.filename || "evidence";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Download a generated report (branded .doc) as a blob. The endpoint requires
// the Authorization header, so a bare href won't work — we fetch and trigger
// a download from the blob, exactly like evidence downloads.
async function downloadReport(report) {
  const res = await authFetch(`${API_BASE}/api/reports/${report.id}/download`);
  if (!res.ok) {
    let msg = "Download failed.";
    try { msg = (await res.json()).error || msg; } catch { /* non-json */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = report.filename || "ShieldAI_Report.doc";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Shared metadata for the report types (icons, labels, one-line descriptions).
const REPORT_TYPE_META = {
  status:     { icon: "📋", label: "Status Report",      blurb: "Plain-language snapshot of where you stand today." },
  update:     { icon: "🔄", label: "Update Report",      blurb: "What has changed and what happened this period." },
  compliance: { icon: "✅", label: "Compliance Report",  blurb: "Framework-by-framework control posture for auditors/regulators." },
  insurance:  { icon: "🛡️", label: "Insurance Report",   blurb: "Attestable controls for a cyber-insurance application or renewal." },
  legal:      { icon: "⚖️", label: "Legal Record",       blurb: "Defensible record of what was assessed, advised, and acted on." },
};

function EvidenceSection() {
  const [coverage, setCoverage] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  // Upload form
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const fileRef = useRef(null);

  async function loadAll() {
    setLoading(true); setError(null);
    try {
      const [cRes, lRes] = await Promise.all([
        authFetch(`${API_BASE}/api/evidence/coverage`),
        authFetch(`${API_BASE}/api/evidence`),
      ]);
      const c = await cRes.json();
      const l = await lRes.json();
      if (!cRes.ok) throw new Error(c.error || "Could not load coverage.");
      setCoverage(c);
      setItems(Array.isArray(l) ? l : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); }, []);

  function flash(msg, tone = C.green) { setToast({ msg, tone }); setTimeout(() => setToast(null), 3200); }

  async function submitEvidence(extra = {}) {
    setBusy(true); setError(null);
    try {
      let payload = { kind: "general", title: title.trim() || undefined, note: note.trim() || undefined, ...extra };
      if (file) {
        if (file.size > EVIDENCE_MAX_BYTES) throw new Error(`File is ${(file.size/1024/1024).toFixed(1)}MB — the limit is 3.5MB.`);
        const up = await fileToUpload(file);
        payload = { ...payload, ...up };
      } else if (!payload.note && !payload.title) {
        throw new Error("Attach a file, or add a title/note.");
      }
      const res = await authFetch(`${API_BASE}/api/evidence`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Upload failed.");
      flash("Evidence added.");
      setFile(null); setTitle(""); setNote("");
      if (fileRef.current) fileRef.current.value = "";
      await loadAll();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  // Quick-attach a note against a specific completed task that lacks proof.
  async function attachToTask(taskId, taskTitle) {
    const proof = window.prompt(`Describe the evidence for "${taskTitle}"\n(e.g. "MFA screenshot filed in IT drive; confirmed with admin")`);
    if (proof == null || !proof.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/evidence`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "task", refId: taskId, title: `Evidence: ${taskTitle}`, note: proof.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not attach evidence.");
      flash("Evidence attached to task.");
      await loadAll();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function remove(ev) {
    if (!window.confirm(`Delete "${ev.title}"? This cannot be undone.`)) return;
    setBusy(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/evidence/${ev.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Delete failed.");
      await loadAll();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function doDownload(ev) {
    try { await downloadEvidence(ev); }
    catch (e) { setError(e.message); }
  }

  const pct = coverage?.coveragePct ?? 100;
  const covTone = pct >= 80 ? C.green : pct >= 50 ? C.amber : C.red;

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <SectionLabel text="Evidence & Audit Readiness"/>
      </div>

      {toast && (
        <div style={{marginBottom:12,padding:"10px 14px",background:`${toast.tone}18`,
          border:`1px solid ${toast.tone}44`,borderRadius:8,color:toast.tone,fontSize:13,fontWeight:600}}>{toast.msg}</div>
      )}
      {error && (
        <div style={{marginBottom:12,padding:"9px 12px",background:`${C.red}15`,
          border:`1px solid ${C.red}33`,borderRadius:7,color:C.red,fontSize:12.5}}>{error}</div>
      )}

      {loading ? <Spinner/> : (
        <>
          {/* Coverage banner */}
          <Card style={{marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
              <div style={{minWidth:96,textAlign:"center"}}>
                <div style={{fontSize:38,fontWeight:800,color:covTone,lineHeight:1}}>{pct}%</div>
                <div style={{fontSize:10,color:C.textMut,letterSpacing:1,marginTop:2}}>AUDIT COVERAGE</div>
              </div>
              <div style={{flex:1,minWidth:240}}>
                <div style={{fontSize:13.5,color:C.text,fontWeight:600,marginBottom:4}}>
                  {coverage?.completedTasks
                    ? `${coverage.withEvidence} of ${coverage.completedTasks} completed tasks have proof on file.`
                    : "No completed tasks yet — audit coverage tracks proof for work you finish."}
                </div>
                <p style={{fontSize:12,color:C.textSec,lineHeight:1.6,margin:0}}>
                  Auditors, insurers, and boards accept proof, not assertions. Anything below shows completed work that can't yet be evidenced.
                </p>
                {/* progress bar */}
                <div style={{marginTop:10,height:8,borderRadius:6,background:C.surface,overflow:"hidden"}}>
                  <div style={{width:`${pct}%`,height:"100%",background:covTone,transition:"width .3s"}}/>
                </div>
              </div>
            </div>
          </Card>

          {/* Completed tasks missing proof */}
          {coverage?.missing?.length > 0 && (
            <Card style={{marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <span style={{color:C.amber}}>⚠</span>
                <SectionLabel text={`Completed — proof missing (${coverage.missing.length})`}/>
              </div>
              {coverage.missing.map(m => (
                <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",
                  background:C.surface,borderRadius:7,border:`1px solid ${C.border}`,marginBottom:6}}>
                  <span style={{color:C.textSec,fontSize:12.5,flex:1}}>{m.title}</span>
                  {m.completedAt && <span style={{fontSize:11,color:C.textMut}}>{new Date(m.completedAt).toLocaleDateString()}</span>}
                  <button onClick={()=>attachToTask(m.id, m.title)} disabled={busy}
                    style={miniBtn(C.accent,busy)}>Attach proof</button>
                </div>
              ))}
            </Card>
          )}

          {/* Upload */}
          <Card style={{marginBottom:14}}>
            <SectionLabel text="Add Evidence"/>
            <div style={{marginTop:12,display:"grid",gap:10}}>
              <input value={title} onChange={e=>setTitle(e.target.value)}
                placeholder="Title (e.g. Q3 access review sign-off)" style={inputStyle}/>
              <textarea value={note} onChange={e=>setNote(e.target.value)} rows={2}
                placeholder="Note (optional) — a note alone is valid evidence, e.g. 'Confirmed with IT on 3/14'"
                style={{...inputStyle,resize:"vertical",fontFamily:"inherit"}}/>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <input ref={fileRef} type="file" accept={EVIDENCE_ACCEPT}
                  onChange={e=>setFile(e.target.files?.[0]||null)}
                  style={{fontSize:12,color:C.textSec}}/>
                {file && <span style={{fontSize:11,color:C.textMut}}>{fmtBytes(file.size)}</span>}
                <button onClick={()=>submitEvidence()} disabled={busy}
                  style={{marginLeft:"auto",padding:"9px 18px",borderRadius:8,border:"none",
                    background:C.accent,color:"#04121F",fontSize:13,fontWeight:700,
                    cursor:busy?"default":"pointer",opacity:busy?0.6:1}}>
                  {busy ? "Saving…" : "Add Evidence"}
                </button>
              </div>
              <div style={{fontSize:11,color:C.textMut}}>
                PDF, images, text, CSV, Word, Excel · 3.5MB max. Files are stored with a SHA-256 integrity hash.
              </div>
            </div>
          </Card>

          {/* Evidence list */}
          <SectionLabel text={`Evidence on File (${items.length})`}/>
          <div style={{marginTop:10}}>
            {items.length === 0 ? (
              <div style={{color:C.textSec,fontSize:13,padding:"8px 2px"}}>No evidence stored yet.</div>
            ) : items.map(ev => (
              <div key={ev.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",
                background:C.card,borderRadius:8,border:`1px solid ${C.border}`,marginBottom:8}}>
                <span style={{fontSize:18}}>{ev.filename ? "📎" : "📝"}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{color:C.text,fontSize:13,fontWeight:600,marginBottom:2}}>{ev.title}</div>
                  <div style={{fontSize:11,color:C.textMut,display:"flex",gap:8,flexWrap:"wrap"}}>
                    <Badge label={ev.kind} color={C.textSec}/>
                    {ev.filename && <span>{ev.filename} · {fmtBytes(ev.bytes)}</span>}
                    <span>{new Date(ev.uploadedAt).toLocaleDateString()}</span>
                    {ev.uploadedByName && <span>by {ev.uploadedByName}</span>}
                  </div>
                  {ev.note && <div style={{fontSize:12,color:C.textSec,marginTop:4,lineHeight:1.5}}>{ev.note}</div>}
                </div>
                {ev.filename && (
                  <button onClick={()=>doDownload(ev)} style={miniBtn(C.accent,false)}>Download</button>
                )}
                <button onClick={()=>remove(ev)} disabled={busy} style={miniBtn(C.textMut,busy)}>Delete</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  NOTIFICATIONS — persistent bell in the dashboard top bar.
//  Reads /api/notifications ({ unread, notifications }), marks single/all
//  read. Polls lightly so analyst review outcomes surface without a reload.
// ─────────────────────────────────────────────────────────────
const NOTIF_TONE = {
  review_approved:          { icon: "✅", color: C.green },
  review_changes_requested: { icon: "✏️", color: C.amber },
  info:                     { icon: "ℹ️", color: C.accent },
  alert:                    { icon: "⚠️", color: C.red },
  system:                   { icon: "🔔", color: C.textSec },
};
function notifTone(type) { return NOTIF_TONE[type] || NOTIF_TONE.system; }

// Map a notification's link to a dashboard section id, when it points at one.
function sectionForLink(link) {
  if (!link) return null;
  const l = String(link).toLowerCase();
  if (l.includes("polic")) return "policies";
  if (l.includes("complian")) return "compliance";
  if (l.includes("task") || l.includes("remediat")) return "remediation";
  if (l.includes("evidence")) return "evidence";
  if (l.includes("threat") || l.includes("cve") || l.includes("breach")) return "threats";
  if (l.includes("train")) return "training";
  return null;
}

function NotificationBell({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ unread: 0, notifications: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  async function load() {
    try {
      const res = await authFetch(`${API_BASE}/api/notifications`);
      if (!res.ok) return;
      const d = await res.json();
      setData({ unread: d.unread || 0, notifications: d.notifications || [] });
    } catch { /* silent — the bell must never break the dashboard */ }
    finally { setLoading(false); }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // light poll
    return () => clearInterval(t);
  }, []);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function markRead(n) {
    if (!n.read) {
      try {
        await authFetch(`${API_BASE}/api/notifications/${n.id}/read`, { method: "POST", body: "{}" });
        setData(d => ({
          unread: Math.max(0, d.unread - 1),
          notifications: d.notifications.map(x => x.id === n.id ? { ...x, read: true } : x),
        }));
      } catch { /* non-fatal */ }
    }
    const sec = sectionForLink(n.link);
    if (sec && onNavigate) { onNavigate(sec); setOpen(false); }
  }

  async function markAll() {
    setBusy(true);
    try {
      await authFetch(`${API_BASE}/api/notifications/read-all`, { method: "POST", body: "{}" });
      setData(d => ({ unread: 0, notifications: d.notifications.map(x => ({ ...x, read: true })) }));
    } catch { /* non-fatal */ }
    finally { setBusy(false); }
  }

  const { unread, notifications } = data;

  return (
    <div ref={ref} style={{position:"relative"}}>
      <button onClick={()=>setOpen(o=>!o)} aria-label="Notifications"
        style={{position:"relative",width:38,height:38,borderRadius:9,cursor:"pointer",
          border:`1px solid ${open?C.accent:C.border}`,background:open?`${C.accent}18`:C.surface,
          color:C.text,fontSize:17,display:"flex",alignItems:"center",justifyContent:"center"}}>
        🔔
        {unread > 0 && (
          <span style={{position:"absolute",top:-5,right:-5,minWidth:18,height:18,padding:"0 5px",
            borderRadius:10,background:C.red,color:"#fff",fontSize:10.5,fontWeight:700,
            display:"flex",alignItems:"center",justifyContent:"center",border:`2px solid ${C.bg}`}}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{position:"absolute",right:0,top:46,width:360,maxHeight:460,overflowY:"auto",
          background:C.card,border:`1px solid ${C.borderHi}`,borderRadius:12,zIndex:50,
          boxShadow:"0 12px 40px rgba(0,0,0,0.5)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
            padding:"14px 16px",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,background:C.card}}>
            <span style={{fontSize:14,fontWeight:700,color:C.text}}>Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} disabled={busy}
                style={{background:"none",border:"none",color:C.accent,fontSize:12,fontWeight:600,
                  cursor:busy?"default":"pointer",opacity:busy?0.6:1}}>
                Mark all read
              </button>
            )}
          </div>

          {loading ? (
            <div style={{padding:"20px"}}><Spinner/></div>
          ) : notifications.length === 0 ? (
            <div style={{padding:"28px 16px",textAlign:"center",color:C.textSec,fontSize:13}}>
              You're all caught up.
            </div>
          ) : (
            notifications.map(n => {
              const tone = notifTone(n.type);
              const clickable = !!sectionForLink(n.link);
              return (
                <div key={n.id} onClick={()=>markRead(n)}
                  style={{display:"flex",gap:11,padding:"12px 16px",borderBottom:`1px solid ${C.border}`,
                    cursor:(clickable||!n.read)?"pointer":"default",
                    background:n.read?"transparent":`${C.accent}0C`}}>
                  <span style={{fontSize:16,lineHeight:1.2}}>{tone.icon}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:12.5,fontWeight:600,color:C.text,flex:1}}>{n.title}</span>
                      {!n.read && <span style={{width:7,height:7,borderRadius:"50%",background:C.accent,flexShrink:0}}/>}
                    </div>
                    {n.body && <div style={{fontSize:12,color:C.textSec,marginTop:3,lineHeight:1.5}}>{n.body}</div>}
                    <div style={{fontSize:10.5,color:C.textMut,marginTop:4,display:"flex",gap:8}}>
                      <span>{timeAgo(n.createdAt)}</span>
                      {n.actorRole && n.actorRole !== "system" && <span>· {n.actorRole}</span>}
                      {clickable && <span style={{color:C.accent}}>· view</span>}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── "Your vCISO" — shown to client-access demo visitors in place of the analyst
// console. It explains what a human security analyst does for them at each stage
// of the engagement. The platform's boundary holds: AI advises, humans act — and
// this is where a prospect sees the "humans act" half made concrete.
const VCISO_STAGES = [
  { icon:"🧭", stage:"Onboarding", title:"Scoping your program",
    analyst:"A dedicated analyst reviews your assessment answers, confirms which compliance frameworks actually apply to you, and sets a realistic posture target — so you're not chasing controls that don't fit your business." },
  { icon:"📊", stage:"Assessment review", title:"Validating the baseline",
    analyst:"They sanity-check the AI's findings against how your business really runs, correct anything the questionnaire couldn't capture, and flag the risks that matter most for your size and industry." },
  { icon:"🛠️", stage:"Remediation", title:"Driving the work forward",
    analyst:"Your analyst turns the prioritized gaps into a plan, helps your team action the highest-impact fixes first, and keeps the posture score moving — reviewing evidence as work gets completed." },
  { icon:"✅", stage:"Compliance", title:"Getting you audit-ready",
    analyst:"They map your controls to each framework, make sure the evidence would satisfy an auditor or insurer, and prepare the documentation you'd need when someone asks you to prove it." },
  { icon:"🔍", stage:"Ongoing monitoring", title:"Watching your back",
    analyst:"As new CVEs and breaches surface, your analyst interprets what's actually relevant to your stack, cuts the noise, and tells you what to do — not just that something happened." },
  { icon:"📈", stage:"Reviews", title:"Reporting to your stakeholders",
    analyst:"On a regular cadence they produce the board- and client-ready posture reports that show progress over time, so leadership can see security improving in terms they trust." },
];

function VirtualCISOSection() {
  return (
    <div>
      <div style={{marginBottom:16}}>
        <SectionLabel text="Your Virtual CISO"/>
      </div>

      <Card style={{marginBottom:16}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:14}}>
          <div style={{fontSize:30}}>🤝</div>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:6}}>
              The platform does the heavy lifting. A human makes the calls.
            </div>
            <p style={{fontSize:13.5,color:C.textSec,lineHeight:1.65,margin:0}}>
              Everything you see in this dashboard is generated and tracked automatically — but ShieldAI's
              core principle is <strong style={{color:C.text}}>“AI advises, humans act.”</strong> On a
              Guided or Managed plan, a dedicated security analyst works alongside you at every stage below.
              This is what that looks like.
            </p>
          </div>
        </div>
      </Card>

      <div style={{position:"relative"}}>
        {VCISO_STAGES.map((s,i) => (
          <div key={i} style={{display:"flex",gap:16,marginBottom:14}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div style={{width:44,height:44,borderRadius:12,background:`${C.accent}18`,
                border:`1px solid ${C.accent}44`,display:"flex",alignItems:"center",
                justifyContent:"center",fontSize:20,flexShrink:0}}>{s.icon}</div>
              {i < VCISO_STAGES.length-1 && (
                <div style={{width:2,flex:1,minHeight:20,background:C.border,marginTop:4}}/>
              )}
            </div>
            <Card style={{flex:1,marginBottom:0}}>
              <div style={{fontSize:10,color:C.accent,letterSpacing:1.5,fontWeight:700,marginBottom:4}}>
                {s.stage.toUpperCase()}
              </div>
              <div style={{fontSize:14.5,fontWeight:700,color:C.text,marginBottom:6}}>{s.title}</div>
              <p style={{fontSize:13,color:C.textSec,lineHeight:1.6,margin:0}}>{s.analyst}</p>
            </Card>
          </div>
        ))}
      </div>

      <Card style={{marginTop:6,background:`${C.accent}0C`,border:`1px solid ${C.accent}33`}}>
        <div style={{fontSize:13.5,color:C.text,lineHeight:1.6}}>
          Want to see how an analyst manages this behind the scenes? The full analyst console is part of the
          investor tour. Talk to us about a Guided or Managed plan to have a real vCISO assigned to your business.
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  TRAINING PROGRAM — standalone product management dashboard.
//  Manage learners, assign catalog topics, schedule quarterly training, and
//  track completion. Reads/writes /api/training-program/*. Fully separate from
//  the endpoint monitoring agent — no overlap by design.
// ─────────────────────────────────────────────────────────────
const TP_STATUS_TONE = {
  assigned:    { c: C.textSec, l: "Assigned" },
  in_progress: { c: C.accent,  l: "In Progress" },
  completed:   { c: C.green,   l: "Completed" },
  overdue:     { c: C.red,     l: "Overdue" },
  waived:      { c: C.textMut, l: "Waived" },
};
function tpTone(s) { return TP_STATUS_TONE[s] || TP_STATUS_TONE.assigned; }

function TrainingProgramSection() {
  const [tab, setTab] = useState("overview"); // overview | learners | assign | quarterly | reports
  const [catalog, setCatalog] = useState([]);
  const [learners, setLearners] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  // Add-learner form
  const [nl, setNl] = useState({ name: "", email: "", department: "" });
  // Assign form
  const [pickLearners, setPickLearners] = useState([]);
  const [pickTopics, setPickTopics] = useState([]);
  const [assignDue, setAssignDue] = useState("");
  // Quarterly form
  const now = new Date();
  const [qForm, setQForm] = useState({
    year: now.getFullYear(), quarter: Math.floor(now.getMonth() / 3) + 1, topicIds: [], dueDate: "", label: "",
  });

  function flash(msg, tone = C.green) { setToast({ msg, tone }); setTimeout(() => setToast(null), 3200); }

  async function loadAll() {
    setLoading(true); setError(null);
    try {
      const [c, l, a, o] = await Promise.all([
        authFetch(`${API_BASE}/api/training-program/catalog`).then(r => r.json()),
        authFetch(`${API_BASE}/api/training-program/learners`).then(r => r.json()),
        authFetch(`${API_BASE}/api/training-program/assignments`).then(r => r.json()),
        authFetch(`${API_BASE}/api/training-program/overview`).then(r => r.json()),
      ]);
      setCatalog(Array.isArray(c) ? c : []);
      setLearners(Array.isArray(l) ? l : []);
      setAssignments(Array.isArray(a) ? a : []);
      setOverview(o && !o.error ? o : null);
    } catch (e) { setError("Could not load training data."); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); }, []);

  async function addLearner() {
    if (!nl.name.trim() || !nl.email.trim()) { setError("Name and email are required."); return; }
    setBusy(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/training-program/learners`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nl),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not add learner.");
      setNl({ name: "", email: "", department: "" });
      flash(`Added ${d.name}.`);
      await loadAll();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function removeLearner(l) {
    if (!window.confirm(`Remove ${l.name} and their assignments? This can't be undone.`)) return;
    setBusy(true);
    try {
      const res = await authFetch(`${API_BASE}/api/training-program/learners/${l.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Delete failed.");
      await loadAll();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function copyLink(l) {
    const url = `${window.location.origin}${l.link}`;
    try { navigator.clipboard.writeText(url); flash("Training link copied."); }
    catch { flash("Copy failed — link: " + url, C.amber); }
  }

  async function submitAssign() {
    if (!pickLearners.length || !pickTopics.length) { setError("Pick at least one learner and one topic."); return; }
    setBusy(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/training-program/assignments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ learnerIds: pickLearners, topicIds: pickTopics, dueDate: assignDue || null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Assign failed.");
      flash(`Assigned to ${d.created} learner(s).`);
      setPickLearners([]); setPickTopics([]); setAssignDue("");
      await loadAll();
      setTab("overview");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function scheduleQuarter() {
    if (!qForm.topicIds.length) { setError("Pick at least one topic for the quarter."); return; }
    setBusy(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/training-program/quarters`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(qForm),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not schedule.");
      flash(`Scheduled "${d.quarter.label}" for ${d.assigned} learner(s).`);
      setQForm(f => ({ ...f, topicIds: [], label: "" }));
      await loadAll();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function remind(a) {
    setBusy(true);
    try {
      const res = await authFetch(`${API_BASE}/api/training-program/assignments/${a.id}/remind`, { method: "POST", body: "{}" });
      if (!res.ok) throw new Error((await res.json()).error || "Reminder failed.");
      flash("Reminder logged.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function waive(a) {
    if (!window.confirm(`Waive "${a.title}" for ${a.learnerName}?`)) return;
    setBusy(true);
    try {
      const res = await authFetch(`${API_BASE}/api/training-program/assignments/${a.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "waived" }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Waive failed.");
      await loadAll();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function toggle(list, setList, id) {
    setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  }
  function toggleQTopic(id) {
    setQForm(f => ({ ...f, topicIds: f.topicIds.includes(id) ? f.topicIds.filter(x => x !== id) : [...f.topicIds, id] }));
  }

  const tabs = [["overview","Overview"],["learners",`Learners (${learners.length})`],
    ["assign","Assign"],["quarterly","Quarterly"],["reports","Reports"]];
  const inp = { padding:"9px 12px", background:C.surface, border:`1px solid ${C.border}`,
    borderRadius:8, color:C.text, fontSize:13, boxSizing:"border-box", fontFamily:"inherit" };

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <SectionLabel text="Training Program"/>
        <span style={{fontSize:10,color:C.textMut,letterSpacing:1,fontWeight:600}}>ASSIGN · TRACK · REPORT</span>
      </div>

      {toast && (
        <div style={{marginBottom:12,padding:"10px 14px",background:`${toast.tone}18`,
          border:`1px solid ${toast.tone}44`,borderRadius:8,color:toast.tone,fontSize:13,fontWeight:600}}>{toast.msg}</div>
      )}
      {error && (
        <div style={{marginBottom:12,padding:"9px 12px",background:`${C.red}15`,
          border:`1px solid ${C.red}33`,borderRadius:7,color:C.red,fontSize:12.5}}>{error}</div>
      )}

      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {tabs.map(([id,label]) => (
          <button key={id} onClick={()=>setTab(id)}
            style={{padding:"7px 15px",borderRadius:8,fontSize:12.5,fontWeight:600,cursor:"pointer",
              border:`1px solid ${tab===id?C.accent:C.border}`,
              background:tab===id?`${C.accent}18`:C.surface,color:tab===id?C.accent:C.textSec}}>{label}</button>
        ))}
      </div>

      {loading ? <Spinner/> : (
        <>
          {/* OVERVIEW */}
          {tab === "overview" && (
            <>
              <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:16}}>
                {[
                  ["Learners", overview?.learnerCount ?? 0, C.accent],
                  ["Completion", `${overview?.completionRate ?? 0}%`, C.green],
                  ["Overdue", overview?.overdue ?? 0, (overview?.overdue ? C.red : C.textSec)],
                  ["Avg Score", overview?.avgScore != null ? `${overview.avgScore}` : "—", C.amber],
                ].map(([label,val,tone],i)=>(
                  <div key={i} style={{flex:"1 1 140px",padding:"16px 18px",background:C.card,
                    border:`1px solid ${C.border}`,borderRadius:12}}>
                    <div style={{fontSize:28,fontWeight:800,color:tone,lineHeight:1}}>{val}</div>
                    <div style={{fontSize:11,color:C.textMut,letterSpacing:0.5,marginTop:5}}>{label}</div>
                  </div>
                ))}
              </div>
              <SectionLabel text="Recent Assignments"/>
              <div style={{marginTop:10}}>
                {assignments.length === 0 ? (
                  <div style={{color:C.textSec,fontSize:13,padding:"8px 2px"}}>
                    No assignments yet. Add learners, then use the Assign tab.
                  </div>
                ) : assignments.slice(0,12).map(a => {
                  const tone = tpTone(a.status);
                  return (
                    <div key={a.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",
                      background:C.card,borderRadius:8,border:`1px solid ${C.border}`,marginBottom:6}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:C.text}}>{a.learnerName}</div>
                        <div style={{fontSize:11,color:C.textMut}}>{a.title}</div>
                      </div>
                      <div style={{width:90,height:6,borderRadius:6,background:C.surface,overflow:"hidden"}}>
                        <div style={{width:`${a.progress}%`,height:"100%",background:tone.c}}/>
                      </div>
                      <span style={{fontSize:11,fontWeight:700,color:tone.c,padding:"2px 9px",
                        borderRadius:20,background:`${tone.c}18`,minWidth:78,textAlign:"center"}}>{tone.l}</span>
                      {a.status !== "completed" && a.status !== "waived" && (
                        <>
                          <button onClick={()=>remind(a)} disabled={busy} style={miniBtn(C.accent,busy)}>Remind</button>
                          <button onClick={()=>waive(a)} disabled={busy} style={miniBtn(C.textMut,busy)}>Waive</button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* LEARNERS */}
          {tab === "learners" && (
            <>
              <Card style={{marginBottom:14}}>
                <SectionLabel text="Add Learner"/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr auto",gap:10,marginTop:12,alignItems:"center"}}>
                  <input style={inp} placeholder="Full name" value={nl.name} onChange={e=>setNl({...nl,name:e.target.value})}/>
                  <input style={inp} placeholder="Email" value={nl.email} onChange={e=>setNl({...nl,email:e.target.value})}/>
                  <input style={inp} placeholder="Department (optional)" value={nl.department} onChange={e=>setNl({...nl,department:e.target.value})}/>
                  <button onClick={addLearner} disabled={busy}
                    style={{padding:"9px 18px",borderRadius:8,border:"none",background:C.accent,color:C.bg,
                      fontSize:13,fontWeight:700,cursor:busy?"default":"pointer",opacity:busy?0.6:1}}>Add</button>
                </div>
              </Card>
              {learners.length === 0 ? (
                <div style={{color:C.textSec,fontSize:13,padding:"8px 2px"}}>No learners yet.</div>
              ) : learners.map(l => (
                <div key={l.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",
                  background:C.card,borderRadius:8,border:`1px solid ${C.border}`,marginBottom:7}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.text}}>{l.name}
                      {l.department && <span style={{fontSize:11,color:C.textMut,fontWeight:400}}> · {l.department}</span>}
                    </div>
                    <div style={{fontSize:11,color:C.textMut}}>{l.email}</div>
                  </div>
                  <span style={{fontSize:11,color:C.textSec}}>{l.completedCount}/{l.assignmentCount} done</span>
                  <button onClick={()=>copyLink(l)} style={miniBtn(C.accent,false)}>Copy link</button>
                  <button onClick={()=>removeLearner(l)} disabled={busy} style={miniBtn(C.textMut,busy)}>Remove</button>
                </div>
              ))}
            </>
          )}

          {/* ASSIGN */}
          {tab === "assign" && (
            <>
              {learners.length === 0 ? (
                <Card><div style={{color:C.textSec,fontSize:13}}>Add learners first, then assign training.</div></Card>
              ) : (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                  <Card>
                    <SectionLabel text={`Learners (${pickLearners.length} selected)`}/>
                    <div style={{marginTop:10,maxHeight:320,overflowY:"auto"}}>
                      {learners.map(l => (
                        <label key={l.id} style={{display:"flex",alignItems:"center",gap:9,padding:"7px 6px",cursor:"pointer"}}>
                          <input type="checkbox" checked={pickLearners.includes(l.id)}
                            onChange={()=>toggle(pickLearners,setPickLearners,l.id)}/>
                          <span style={{fontSize:12.5,color:C.text}}>{l.name}</span>
                          <span style={{fontSize:11,color:C.textMut,marginLeft:"auto"}}>{l.email}</span>
                        </label>
                      ))}
                    </div>
                    <button onClick={()=>setPickLearners(pickLearners.length===learners.length?[]:learners.map(l=>l.id))}
                      style={{...miniBtn(C.accent,false),marginTop:8}}>
                      {pickLearners.length===learners.length?"Clear all":"Select all"}
                    </button>
                  </Card>
                  <Card>
                    <SectionLabel text={`Topics (${pickTopics.length} selected)`}/>
                    <div style={{marginTop:10,maxHeight:320,overflowY:"auto"}}>
                      {catalog.map(t => (
                        <label key={t.id} style={{display:"flex",alignItems:"flex-start",gap:9,padding:"7px 6px",cursor:"pointer"}}>
                          <input type="checkbox" checked={pickTopics.includes(t.id)}
                            onChange={()=>toggle(pickTopics,setPickTopics,t.id)} style={{marginTop:3}}/>
                          <div>
                            <div style={{fontSize:12.5,color:C.text,fontWeight:600}}>{t.title}</div>
                            <div style={{fontSize:11,color:C.textMut}}>{t.audience} · {t.duration}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                    <div style={{marginTop:12,display:"flex",gap:10,alignItems:"center"}}>
                      <span style={{fontSize:11,color:C.textMut}}>Due:</span>
                      <input type="date" value={assignDue} onChange={e=>setAssignDue(e.target.value)} style={inp}/>
                    </div>
                    <button onClick={submitAssign} disabled={busy}
                      style={{marginTop:12,width:"100%",padding:"11px",borderRadius:8,border:"none",
                        background:C.accent,color:C.bg,fontSize:13.5,fontWeight:700,
                        cursor:busy?"default":"pointer",opacity:busy?0.6:1}}>
                      {busy ? "Assigning…" : `Assign to ${pickLearners.length} learner(s)`}
                    </button>
                  </Card>
                </div>
              )}
            </>
          )}

          {/* QUARTERLY */}
          {tab === "quarterly" && (
            <Card>
              <SectionLabel text="Schedule Quarterly Training"/>
              <p style={{fontSize:12.5,color:C.textSec,margin:"6px 0 14px",lineHeight:1.6}}>
                Pick a quarter and the topics to cover. On scheduling, an assignment is created for every active learner.
              </p>
              <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:14}}>
                <div><label style={{fontSize:11,color:C.textMut,display:"block",marginBottom:4}}>YEAR</label>
                  <input type="number" value={qForm.year} onChange={e=>setQForm({...qForm,year:+e.target.value})} style={{...inp,width:100}}/></div>
                <div><label style={{fontSize:11,color:C.textMut,display:"block",marginBottom:4}}>QUARTER</label>
                  <select value={qForm.quarter} onChange={e=>setQForm({...qForm,quarter:+e.target.value})} style={{...inp,width:100}}>
                    {[1,2,3,4].map(q=><option key={q} value={q}>Q{q}</option>)}
                  </select></div>
                <div><label style={{fontSize:11,color:C.textMut,display:"block",marginBottom:4}}>DUE DATE</label>
                  <input type="date" value={qForm.dueDate} onChange={e=>setQForm({...qForm,dueDate:e.target.value})} style={inp}/></div>
                <div style={{flex:1,minWidth:180}}><label style={{fontSize:11,color:C.textMut,display:"block",marginBottom:4}}>LABEL (optional)</label>
                  <input value={qForm.label} onChange={e=>setQForm({...qForm,label:e.target.value})} placeholder={`Q${qForm.quarter} ${qForm.year} Training`} style={{...inp,width:"100%"}}/></div>
              </div>
              <div style={{fontSize:11,color:C.textMut,letterSpacing:1,fontWeight:600,marginBottom:8}}>TOPICS</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:6,marginBottom:14}}>
                {catalog.map(t => (
                  <label key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",
                    background:qForm.topicIds.includes(t.id)?`${C.accent}12`:C.surface,
                    border:`1px solid ${qForm.topicIds.includes(t.id)?C.accent+"44":C.border}`,borderRadius:7,cursor:"pointer"}}>
                    <input type="checkbox" checked={qForm.topicIds.includes(t.id)} onChange={()=>toggleQTopic(t.id)}/>
                    <span style={{fontSize:12,color:C.text}}>{t.title}</span>
                  </label>
                ))}
              </div>
              <button onClick={scheduleQuarter} disabled={busy}
                style={{padding:"11px 22px",borderRadius:8,border:"none",background:C.accent,color:C.bg,
                  fontSize:13.5,fontWeight:700,cursor:busy?"default":"pointer",opacity:busy?0.6:1}}>
                {busy ? "Scheduling…" : "Schedule Quarter"}
              </button>
            </Card>
          )}

          {/* REPORTS */}
          {tab === "reports" && (
            <TrainingReportView/>
          )}
        </>
      )}
    </div>
  );
}

// Per-learner completion report with CSV export.
function TrainingReportView() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    authFetch(`${API_BASE}/api/training-program/report`)
      .then(r => r.json()).then(d => setReport(d)).catch(() => setReport({ rows: [] }))
      .finally(() => setLoading(false));
  }, []);

  function exportCsv() {
    const rows = report?.rows || [];
    const header = ["Learner","Email","Department","Assigned","Completed","Completion %","Avg Score","Overdue","Last Completed"];
    const lines = [header.join(",")].concat(rows.map(r =>
      [r.learner, r.email, r.department, r.assigned, r.completed, r.completionRate,
       r.avgScore ?? "", r.overdue, r.lastCompletedAt ? new Date(r.lastCompletedAt).toLocaleDateString() : ""]
      .map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `training-report-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  if (loading) return <Spinner/>;
  const rows = report?.rows || [];
  return (
    <Card>
      <div style={{display:"flex",alignItems:"center",marginBottom:14}}>
        <SectionLabel text="Completion Report"/>
        <button onClick={exportCsv} disabled={!rows.length}
          style={{marginLeft:"auto",padding:"7px 14px",borderRadius:7,border:`1px solid ${C.border}`,
            background:C.surface,color:C.accent,fontSize:12,fontWeight:600,cursor:rows.length?"pointer":"default",opacity:rows.length?1:0.5}}>
          Export CSV
        </button>
      </div>
      {rows.length === 0 ? (
        <div style={{color:C.textSec,fontSize:13}}>No learners to report on yet.</div>
      ) : (
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
            <thead>
              <tr style={{textAlign:"left",color:C.textMut,fontSize:11,letterSpacing:0.5}}>
                <th style={{padding:"8px 10px"}}>LEARNER</th><th style={{padding:"8px 10px"}}>DEPT</th>
                <th style={{padding:"8px 10px"}}>DONE</th><th style={{padding:"8px 10px"}}>RATE</th>
                <th style={{padding:"8px 10px"}}>SCORE</th><th style={{padding:"8px 10px"}}>OVERDUE</th>
                <th style={{padding:"8px 10px"}}>LAST</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i)=>(
                <tr key={i} style={{borderTop:`1px solid ${C.border}`,color:C.textSec}}>
                  <td style={{padding:"9px 10px",color:C.text,fontWeight:600}}>{r.learner}</td>
                  <td style={{padding:"9px 10px"}}>{r.department||"—"}</td>
                  <td style={{padding:"9px 10px"}}>{r.completed}/{r.assigned}</td>
                  <td style={{padding:"9px 10px",color:r.completionRate>=80?C.green:r.completionRate>=50?C.amber:C.red,fontWeight:600}}>{r.completionRate}%</td>
                  <td style={{padding:"9px 10px"}}>{r.avgScore!=null?r.avgScore:"—"}</td>
                  <td style={{padding:"9px 10px",color:r.overdue?C.red:C.textSec}}>{r.overdue}</td>
                  <td style={{padding:"9px 10px"}}>{r.lastCompletedAt?new Date(r.lastCompletedAt).toLocaleDateString():"—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DomainMonitoringCard() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(null);   // "submit" | "verify"
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/client/domain`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load domain status.");
      setState(data);
      if (!data.domain && data.suggested) setInput(data.suggested);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function submit() {
    if (!input.trim()) return;
    setBusy("submit"); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/client/domain`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: input.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save that domain.");
      setState(data);
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  async function verify() {
    setBusy("verify"); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/client/domain/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification check failed.");
      setState(data);
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  function copyTxt() {
    const v = state?.instructions?.value;
    if (!v) return;
    navigator.clipboard?.writeText(v).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    }).catch(() => {});
  }

  if (loading) return <Card style={{marginBottom:14}}><Spinner/></Card>;

  const tone = {
    monitored:          { color: C.green,  icon: "🛡️" },
    awaiting_hibp:      { color: C.amber,  icon: "⏳" },
    awaiting_ownership: { color: C.accent, icon: "🔑" },
    service_inactive:   { color: C.textSec,icon: "○"  },
    rejected:           { color: C.red,    icon: "⚠️" },
    none:               { color: C.textSec,icon: "＋" },
  }[state?.state] || { color: C.textSec, icon: "○" };

  const ins = state?.instructions;

  return (
    <Card style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <SectionLabel text="Breach & Dark-Web Monitoring"/>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8,
          padding:"4px 10px",borderRadius:20,background:`${tone.color}15`,
          border:`1px solid ${tone.color}38`}}>
          <span style={{fontSize:11}}>{tone.icon}</span>
          <span style={{fontSize:11,fontWeight:700,color:tone.color,letterSpacing:0.3}}>
            {state?.monitored ? "ACTIVE" : "NOT ACTIVE"}
          </span>
        </div>
      </div>

      {error && (
        <div style={{marginBottom:12,padding:"9px 12px",background:`${C.red}15`,
          border:`1px solid ${C.red}33`,borderRadius:7,color:C.red,fontSize:12.5}}>{error}</div>
      )}

      <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:5}}>{state?.headline}</div>
      <p style={{fontSize:12.5,color:C.textSec,lineHeight:1.6,margin:"0 0 14px"}}>{state?.detail}</p>

      {state?.domain && (
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,
          padding:"9px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:7}}>
          <span style={{fontSize:11,color:C.textMut,fontWeight:600}}>DOMAIN</span>
          <span style={{fontSize:13,color:C.text,fontWeight:600,fontFamily:"monospace"}}>{state.domain}</span>
          {state.ownershipVerifiedAt && (
            <span style={{marginLeft:"auto",fontSize:10.5,color:C.green,fontWeight:600}}>✓ ownership verified</span>
          )}
        </div>
      )}

      {/* ── Submit / change the domain ── */}
      {(state?.state === "none" || state?.nextStep === "verify_dns") && (
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:ins?14:0}}>
          <input value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter") submit(); }}
            placeholder="yourcompany.com"
            style={{flex:"1 1 220px",padding:"10px 12px",background:C.surface,
              border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:13,
              fontFamily:"Inter,system-ui,sans-serif"}}/>
          <button onClick={submit} disabled={busy==="submit"||!input.trim()}
            style={{padding:"10px 18px",background:`${C.accent}18`,border:`1px solid ${C.accent}55`,
              borderRadius:8,color:C.accent,fontSize:12.5,fontWeight:700,
              cursor:busy||!input.trim()?"default":"pointer",opacity:busy||!input.trim()?0.5:1}}>
            {busy==="submit" ? "Saving…" : state?.domain ? "Change domain" : "Add domain"}
          </button>
        </div>
      )}

      {/* ── DNS TXT instructions ── */}
      {ins && (
        <div style={{padding:"14px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:9}}>
          <div style={{fontSize:11.5,fontWeight:700,color:C.text,marginBottom:4,letterSpacing:0.3}}>
            STEP 1 · PUBLISH THIS DNS RECORD
          </div>
          <p style={{fontSize:11.5,color:C.textSec,lineHeight:1.55,margin:"0 0 12px"}}>{ins.help}</p>

          <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"7px 14px",
            fontSize:12,marginBottom:12,alignItems:"center"}}>
            <span style={{color:C.textMut,fontWeight:600}}>Type</span>
            <span style={{color:C.text,fontFamily:"monospace"}}>{ins.type}</span>
            <span style={{color:C.textMut,fontWeight:600}}>Host</span>
            <span style={{color:C.text,fontFamily:"monospace"}}>{ins.host}</span>
            <span style={{color:C.textMut,fontWeight:600}}>Value</span>
            <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
              <span style={{color:C.accent,fontFamily:"monospace",fontSize:11.5,
                wordBreak:"break-all",lineHeight:1.4}}>{ins.value}</span>
              <button onClick={copyTxt}
                style={{flexShrink:0,padding:"3px 9px",background:copied?`${C.green}20`:C.card,
                  border:`1px solid ${copied?C.green+"55":C.border}`,borderRadius:5,
                  color:copied?C.green:C.textSec,fontSize:10.5,fontWeight:600,cursor:"pointer"}}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",
            paddingTop:12,borderTop:`1px solid ${C.border}`}}>
            <div style={{fontSize:11.5,fontWeight:700,color:C.text,letterSpacing:0.3}}>STEP 2</div>
            <button onClick={verify} disabled={busy==="verify"}
              style={{padding:"8px 16px",background:`${C.green}18`,border:`1px solid ${C.green}55`,
                borderRadius:7,color:C.green,fontSize:12,fontWeight:700,
                cursor:busy?"default":"pointer",opacity:busy?0.6:1}}>
              {busy==="verify" ? "Checking DNS…" : "Check DNS record"}
            </button>
            {state?.lastCheckedAt && (
              <span style={{fontSize:11,color:C.textMut}}>
                Last checked {new Date(state.lastCheckedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Why we ask ── */}
      {state?.state !== "monitored" && (
        <p style={{fontSize:11,color:C.textMut,lineHeight:1.55,margin:"14px 0 0"}}>
          We verify domain control before monitoring so we never pull breach data for a
          domain that isn't yours.
        </p>
      )}
    </Card>
  );
}

function ThreatIntelSection({ results }) {
  const tl = results?.threatIntel?.threatLandscape;
  // generatedBy lives on the outer threatIntel object (the AI's raw JSON
  // response, tagged server-side with the real provider), one level above tl.
  const genBy = results?.threatIntel?.generatedBy;

  // Breach monitoring is live data and independent of the AI-generated threat
  // landscape, so it renders even when the program hasn't been generated yet.
  if (!tl) {
    return (
      <div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <SectionLabel text="Threat Intelligence"/>
        </div>
        <CveExposureCard/>
        <DomainMonitoringCard/>
        <DarkWebExposureCard/>
        <div style={{color:C.textSec,padding:"16px 4px",fontSize:13}}>
          The AI threat-landscape briefing appears once your security program has been generated. CVE exposure and breach monitoring above are live and don't require it.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <SectionLabel text="Threat Intelligence"/>
        <div style={{marginLeft:"auto"}}><AIChip model={genBy === "openai" ? "gpt4" : (genBy || "claude")}/></div>
      </div>
      {/* Real, HIBP-backed breach monitoring. This replaces the old
          `darkWebMentions` banner, which was model-generated text rather than
          actual breach data — exactly the kind of thing that must never appear
          in a security product. */}
      {/* Live, NVD-backed CVE exposure — real data, replaces the old
          model-generated "recentCVEs" card that used to render here. */}
      <CveExposureCard/>
      <DomainMonitoringCard/>
      <DarkWebExposureCard/>
      <div style={{marginBottom:14}}>
        <Card>
          <SectionLabel text="Industry Threat Landscape"/>
          <div style={{fontSize:11,color:C.textMut,margin:"2px 0 12px"}}>
            AI-generated briefing — context, not live detection.
          </div>
          {(tl.industryThreats||[]).map((t,i)=>(
            <div key={i} style={{marginBottom:12,paddingBottom:12,
              borderBottom:i<(tl.industryThreats.length-1)?`1px solid ${C.border}`:"none"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{color:C.text,fontSize:13,fontWeight:600}}>{t.name}</span>
                <Badge label={t.prevalence}/>
              </div>
              <p style={{color:C.textSec,fontSize:12,margin:"0 0 6px"}}>{t.description}</p>
              {(t.mitigations||[]).map((m,j)=>(
                <div key={j} style={{color:C.green,fontSize:11}}>✓ {m}</div>
              ))}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
function ToolsSection({ results }) {
  const tools = results?.tools?.toolStack || [];
  const categories = [...new Set(tools.map(t=>t.category))];
  const genBy = results?.tools?.generatedBy;

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <SectionLabel text="Recommended Security Tool Stack"/>
        <div style={{marginLeft:"auto"}}><AIChip model={genBy === "openai" ? "gpt4" : (genBy || "claude")}/></div>
      </div>
      {categories.map(cat=>(
        <div key={cat} style={{marginBottom:18}}>
          <div style={{color:C.textSec,fontSize:12,fontWeight:600,
            letterSpacing:1,marginBottom:10,textTransform:"uppercase"}}>{cat}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10}}>
            {tools.filter(t=>t.category===cat).map((t,i)=>(
              <Card key={i} style={{padding:"14px 16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{color:C.accent,fontWeight:700,fontSize:15}}>{t.recommended}</span>
                  <Badge label={t.cost}/>
                </div>
                {t.subcategory && (
                  <div style={{color:C.textMut,fontSize:11,marginBottom:6}}>{t.subcategory}</div>
                )}
                <p style={{color:C.textSec,fontSize:12,margin:"0 0 8px",lineHeight:1.6}}>
                  {t.rationale}
                </p>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <Badge label={t.implementation}/>
                  {t.alternative && (
                    <span style={{color:C.textMut,fontSize:11}}>Alt: {t.alternative}</span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TrainingSection({ results, assessment }) {
  const [activeModule, setActiveModule] = useState(0);
  const prog = results?.training?.trainingProgram;

  // Full curriculum builder state
  const [saved, setSaved] = useState([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [includeManager, setIncludeManager] = useState(true);
  const [curriculum, setCurriculum] = useState(null); // the open full program
  const [currentProgramId, setCurrentProgramId] = useState(null);
  const [openingId, setOpeningId] = useState(null);
  const [error, setError] = useState(null);

  async function loadSaved() {
    setLoadingSaved(true);
    try {
      const res = await authFetch(`${API_BASE}/api/training`);
      if (res.ok) {
        const list = await res.json();
        list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        setSaved(list);
      }
    } catch (e) { console.error(e); } finally { setLoadingSaved(false); }
  }
  useEffect(() => { loadSaved(); }, []);

  async function buildProgram() {
    setGenerating(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/training/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyContext: assessment?.company || null, includeManagerTrack: includeManager }),
      });
      if (!res.ok) throw new Error(`Generation failed: ${res.status}`);
      const data = await res.json();
      setCurriculum(data.curriculum);
      setCurrentProgramId(data.id);
      loadSaved();
    } catch (e) { setError(e.message); } finally { setGenerating(false); }
  }

  async function openProgram(id) {
    setOpeningId(id); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/training/${id}`);
      if (!res.ok) throw new Error("Could not load program");
      const data = await res.json();
      setCurriculum(data.curriculum);
      setCurrentProgramId(data.id);
    } catch (e) { setError(e.message); } finally { setOpeningId(null); }
  }

  async function deleteProgram(id) {
    if (!window.confirm("Delete this training program?")) return;
    try {
      const res = await authFetch(`${API_BASE}/api/training/${id}`, { method: "DELETE" });
      if (res.ok) { if (curriculum) setCurriculum(null); loadSaved(); }
    } catch (e) { setError(e.message); }
  }

  // ── Viewing a full curriculum ──
  if (curriculum) {
    return <FullCurriculumView curriculum={curriculum} company={assessment?.company}
      programId={currentProgramId} onBack={() => setCurriculum(null)}/>;
  }

  return (
    <div>
      {/* ── Full Program Builder ── */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <SectionLabel text="Training Program Builder"/>
        <span style={{fontSize:11,color:C.textMut,padding:"2px 10px",background:C.surface,
          border:`1px solid ${C.border}`,borderRadius:20}}>CISA / NIST aligned</span>
      </div>
      <p style={{color:C.textSec,fontSize:13,marginBottom:14,lineHeight:1.6}}>
        Generate a complete, company-tailored security awareness curriculum — a 3-month
        schedule of modules with objectives, real-world scenarios, and quizzes, built on
        the CISA and NIST small-business frameworks.
      </p>

      {error && (
        <div style={{marginBottom:12,padding:"10px 14px",background:`${C.red}15`,
          border:`1px solid ${C.red}33`,borderRadius:8,color:C.red,fontSize:13}}>{error}</div>
      )}

      <Card style={{marginBottom:20,padding:"18px 20px"}}>
        <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:200}}>
            <div style={{color:C.text,fontWeight:600,fontSize:14,marginBottom:4}}>
              Build a full curriculum{assessment?.company?.name ? ` for ${assessment.company.name}` : ""}
            </div>
            <div style={{color:C.textMut,fontSize:12}}>
              12 core modules across 3 months + quarterly refresher{includeManager ? " + manager track" : ""}.
            </div>
          </div>
          <label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",
            color:C.textSec,fontSize:12}}>
            <input type="checkbox" checked={includeManager}
              onChange={e=>setIncludeManager(e.target.checked)} style={{cursor:"pointer"}}/>
            Include manager / owner track
          </label>
          <button onClick={buildProgram} disabled={generating}
            style={{padding:"10px 20px",background:generating?C.surface:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
              color:generating?C.textMut:C.bg,border:"none",borderRadius:8,fontSize:13,fontWeight:700,
              cursor:generating?"wait":"pointer"}}>
            {generating ? "Building curriculum…" : "✦ Generate Full Program"}
          </button>
        </div>
        {generating && (
          <div style={{marginTop:12,fontSize:12,color:C.textMut}}>
            Tailoring CISA/NIST modules to {assessment?.company?.industry || "your business"} — this takes a moment.
          </div>
        )}
      </Card>

      {/* Saved programs */}
      {loadingSaved ? <Spinner/> : saved.length > 0 && (
        <div style={{marginBottom:24}}>
          <SectionLabel text="Saved Training Programs"/>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:10}}>
            {saved.map(s=>(
              <Card key={s.id} style={{padding:"13px 16px"}}>
                <div style={{display:"flex",alignItems:"center",gap:14}}>
                  <span style={{fontSize:18}}>🎓</span>
                  <div style={{flex:1}}>
                    <div style={{color:C.text,fontWeight:600,fontSize:14}}>
                      {s.companyContext?.name || "Training Program"}
                    </div>
                    <div style={{color:C.textMut,fontSize:11,marginTop:2}}>
                      {s.moduleCount} modules · {new Date(s.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button onClick={()=>openProgram(s.id)} disabled={openingId===s.id}
                    style={{padding:"7px 16px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
                      color:C.bg,border:"none",borderRadius:7,fontSize:12,fontWeight:700,
                      cursor:openingId===s.id?"wait":"pointer"}}>
                    {openingId===s.id?"Opening…":"View"}
                  </button>
                  <button onClick={()=>deleteProgram(s.id)}
                    style={{padding:"7px 12px",background:`${C.red}15`,border:`1px solid ${C.red}33`,
                      borderRadius:7,color:C.red,fontSize:12,cursor:"pointer"}}>Delete</button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ── Auto-generated preview (from the program pipeline) ── */}
      {prog && (
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,marginTop:8}}>
            <SectionLabel text="Quick Preview (from your assessment)"/>
            <div style={{marginLeft:"auto"}}><AIChip model={prog.generatedBy === "openai" ? "gpt4" : (prog.generatedBy || "claude")}/></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"220px 1fr",gap:14}}>
            <div>
              {(prog.modules||[]).map((m,i)=>(
                <button key={i} onClick={()=>setActiveModule(i)}
                  style={{display:"block",width:"100%",padding:"10px 14px",marginBottom:6,
                    background:activeModule===i?`${C.accent}15`:C.surface,
                    border:`1px solid ${activeModule===i?C.accent:C.border}`,
                    borderRadius:8,color:activeModule===i?C.accent:C.textSec,
                    cursor:"pointer",textAlign:"left",fontSize:12}}>
                  <div style={{fontWeight:600,marginBottom:3}}>{m.title}</div>
                  <div style={{fontSize:11,color:C.textMut}}>{m.duration} · {m.audience}</div>
                </button>
              ))}
            </div>
            {prog.modules?.[activeModule] && (() => {
              const mod = prog.modules[activeModule];
              return (
                <Card>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div style={{color:C.text,fontWeight:700,fontSize:16}}>{mod.title}</div>
                    <div style={{display:"flex",gap:6}}>
                      <Badge label={mod.duration} color={C.accent}/>
                      <Badge label={mod.audience} color={C.purple}/>
                    </div>
                  </div>
                  {(mod.keyTakeaways||[]).map((t,i)=>(
                    <div key={i} style={{display:"flex",gap:10,marginBottom:8}}>
                      <span style={{color:C.green,fontSize:14}}>✓</span>
                      <span style={{color:C.textSec,fontSize:13}}>{t}</span>
                    </div>
                  ))}
                </Card>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// Full curriculum viewer
function FullCurriculumView({ curriculum, company, programId, onBack }) {
  const { can } = useCapabilities();
  const canDownload = can("downloadExports");
  const [openPhase, setOpenPhase] = useState(0);
  const [openModule, setOpenModule] = useState(0);

  function downloadCurriculum() {
    let html = "";
    html += `<p>${curriculum.overview || ""}</p>`;
    (curriculum.phases || []).forEach(ph => {
      html += `<h2>${ph.phase}: ${ph.theme}</h2>`;
      if (ph.note) html += `<p class="meta">${ph.note}</p>`;
      (ph.modules || []).forEach(m => {
        html += `<h3>${m.title}</h3><p class="meta">${m.duration} · ${m.audience}</p>`;
        if (m.tailoredIntro) html += `<p>${m.tailoredIntro}</p>`;
        if (m.objectives?.length) { html += `<p><b>Objectives:</b></p><ul>`; m.objectives.forEach(o=>html+=`<li>${o}</li>`); html += `</ul>`; }
        if (m.realWorldScenario) html += `<p><b>Scenario:</b> ${m.realWorldScenario}</p>`;
        if (m.quiz?.[0]) {
          html += `<p><b>Knowledge check:</b> ${m.quiz[0].question}</p><ul>`;
          m.quiz[0].options.forEach((o,i)=>html+=`<li>${String.fromCharCode(65+i)}. ${o}${i===m.quiz[0].correct?" ✓":""}</li>`);
          html += `</ul>`;
        }
      });
    });
    if (curriculum.managerTrack?.length) {
      html += `<h2>Manager / Owner Track</h2>`;
      curriculum.managerTrack.forEach(m => {
        html += `<h3>${m.title}</h3><p class="meta">${m.duration} · ${m.audience}</p>`;
        if (m.tailoredIntro) html += `<p>${m.tailoredIntro}</p>`;
        if (m.objectives?.length) { html += `<ul>`; m.objectives.forEach(o=>html+=`<li>${o}</li>`); html += `</ul>`; }
      });
    }
    if (curriculum.deliveryTips?.length) {
      html += `<h2>Delivery Tips</h2><ul>`; curriculum.deliveryTips.forEach(t=>html+=`<li>${t}</li>`); html += `</ul>`;
    }
    const subtitle = `${company?.name || "Your Business"}${company?.industry ? " · " + company.industry : ""} · Generated ${new Date().toLocaleDateString()}`;
    const full = buildBrandedWordDoc({
      title: "Security Awareness Training Program",
      docKicker: "Security Awareness Training",
      subtitle,
      bodyHtml: `<h1>Security Awareness Training Program</h1>${html}`,
    });
    const blob = new Blob([full], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `Training_Program_${(company?.name||"Company").replace(/\s+/g,"_")}.doc`;
    a.click(); URL.revokeObjectURL(url);
  }

  const phase = curriculum.phases?.[openPhase];
  const mod = phase?.modules?.[openModule];

  return (
    <div>
      <button onClick={onBack} style={{marginBottom:14,padding:"7px 14px",background:C.surface,
        border:`1px solid ${C.border}`,borderRadius:7,color:C.textSec,fontSize:12,cursor:"pointer"}}>
        ← Back to Training
      </button>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
        <SectionLabel text="Security Awareness Training Program"/>
        <button onClick={canDownload ? downloadCurriculum : undefined} disabled={!canDownload}
          title={canDownload ? "" : "Downloads require Pro or higher"}
          style={{marginLeft:"auto",padding:"7px 16px",
          background:canDownload?`${C.accent}15`:C.surface,border:`1px solid ${canDownload?C.accent+"33":C.border}`,borderRadius:7,
          color:canDownload?C.accent:C.textMut,fontSize:12,fontWeight:600,cursor:canDownload?"pointer":"not-allowed"}}>
          {canDownload ? "⬇ Download Word" : "🔒 Download (Pro+)"}</button>
      </div>
      {curriculum.overview && (
        <Card style={{marginBottom:16,padding:"16px 18px"}}>
          <p style={{color:C.textSec,fontSize:13,lineHeight:1.7,margin:0}}>{curriculum.overview}</p>
        </Card>
      )}

      {/* Reflects the ACTUAL generator for whichever phase/track is open —
          not a single top-level badge — since a phase whose GPT-4o call
          failed falls back to Claude independently of its siblings, and a
          badge covering the whole curriculum could misrepresent that mix. */}
      {(() => {
        const genBy = openPhase === "mgr"
          ? curriculum.managerTrackGeneratedBy
          : curriculum.phases?.[openPhase]?.generatedBy;
        if (!genBy) return null;
        return (
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
            <AIChip model={genBy === "openai" ? "gpt4" : genBy}/>
          </div>
        );
      })()}

      {/* Phase tabs */}
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {(curriculum.phases||[]).map((ph,i)=>(
          <button key={i} onClick={()=>{setOpenPhase(i);setOpenModule(0);}}
            style={{padding:"8px 16px",background:openPhase===i?`${C.accent}22`:C.surface,
              border:`1px solid ${openPhase===i?C.accent:C.border}`,borderRadius:8,
              color:openPhase===i?C.accent:C.textSec,fontSize:12,fontWeight:600,cursor:"pointer"}}>
            <div>{ph.phase}</div>
            <div style={{fontSize:10,color:C.textMut,fontWeight:400}}>{ph.theme}</div>
          </button>
        ))}
        {curriculum.managerTrack?.length > 0 && (
          <button onClick={()=>{setOpenPhase("mgr");setOpenModule(0);}}
            style={{padding:"8px 16px",background:openPhase==="mgr"?`${C.purple}22`:C.surface,
              border:`1px solid ${openPhase==="mgr"?C.purple:C.border}`,borderRadius:8,
              color:openPhase==="mgr"?C.purple:C.textSec,fontSize:12,fontWeight:600,cursor:"pointer"}}>
            <div>Manager Track</div>
            <div style={{fontSize:10,color:C.textMut,fontWeight:400}}>Owners & managers</div>
          </button>
        )}
      </div>

      {openPhase === "mgr" ? (
        <div style={{display:"grid",gridTemplateColumns:"240px 1fr",gap:14}}>
          <div>
            {curriculum.managerTrack.map((m,i)=>(
              <button key={i} onClick={()=>setOpenModule(i)}
                style={{display:"block",width:"100%",padding:"10px 14px",marginBottom:6,
                  background:openModule===i?`${C.purple}15`:C.surface,
                  border:`1px solid ${openModule===i?C.purple:C.border}`,borderRadius:8,
                  color:openModule===i?C.purple:C.textSec,cursor:"pointer",textAlign:"left",fontSize:12}}>
                <div style={{fontWeight:600,marginBottom:3}}>{m.title}</div>
                <div style={{fontSize:11,color:C.textMut}}>{m.duration} · {m.audience}</div>
              </button>
            ))}
          </div>
          <ModuleCard mod={curriculum.managerTrack[openModule]} accent={C.purple}
            programId={programId} phaseIndex="mgr" moduleIndex={openModule}/>
        </div>
      ) : (
        <>
          {phase?.note && (
            <div style={{marginBottom:12,padding:"10px 14px",background:`${C.amber}11`,
              border:`1px solid ${C.amber}33`,borderRadius:8,color:C.textSec,fontSize:12}}>
              💡 {phase.note}
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"240px 1fr",gap:14}}>
            <div>
              {(phase?.modules||[]).map((m,i)=>(
                <button key={i} onClick={()=>setOpenModule(i)}
                  style={{display:"block",width:"100%",padding:"10px 14px",marginBottom:6,
                    background:openModule===i?`${C.accent}15`:C.surface,
                    border:`1px solid ${openModule===i?C.accent:C.border}`,borderRadius:8,
                    color:openModule===i?C.accent:C.textSec,cursor:"pointer",textAlign:"left",fontSize:12}}>
                  <div style={{fontWeight:600,marginBottom:3}}>{m.title}</div>
                  <div style={{fontSize:11,color:C.textMut}}>{m.duration} · {m.audience}</div>
                </button>
              ))}
            </div>
            <ModuleCard mod={mod} accent={C.accent}
              programId={programId} phaseIndex={openPhase} moduleIndex={openModule}/>
          </div>
        </>
      )}

      {curriculum.deliveryTips?.length > 0 && (
        <div style={{marginTop:20}}>
          <SectionLabel text="Delivery Tips"/>
          <Card style={{padding:"14px 18px",marginTop:8}}>
            {curriculum.deliveryTips.map((t,i)=>(
              <div key={i} style={{display:"flex",gap:10,marginBottom:8}}>
                <span style={{color:C.accent,fontSize:14}}>→</span>
                <span style={{color:C.textSec,fontSize:13}}>{t}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

// A single training module card (shared by phase + manager views)
function ModuleCard({ mod, accent, programId, phaseIndex, moduleIndex }) {
  const [showAnswer, setShowAnswer] = useState(false);
  const [content, setContent] = useState(null);   // { slides, fullQuiz, generatedBy }
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [mode, setMode] = useState(null);          // null | "slides" | "quiz"

  useEffect(() => {
    setShowAnswer(false);
    // pick up cached content already attached to the module
    setContent(mod && (mod.slides || mod.fullQuiz) ? { slides: mod.slides, fullQuiz: mod.fullQuiz, generatedBy: mod.generatedBy } : null);
    setMode(null); setErr(null);
  }, [mod]);

  if (!mod) return <Card><div style={{color:C.textSec,fontSize:13}}>Select a module.</div></Card>;

  async function generateContent(targetMode) {
    if (content?.slides && content?.fullQuiz) { setMode(targetMode); return; }
    setLoading(true); setErr(null);
    try {
      const res = await authFetch(`${API_BASE}/api/training/module-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId, phaseIndex, moduleIndex }),
      });
      if (!res.ok) throw new Error("Could not generate content");
      const data = await res.json();
      setContent({ slides: data.slides, fullQuiz: data.fullQuiz, generatedBy: data.generatedBy });
      setMode(targetMode);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }

  return (
    <Card>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{color:C.text,fontWeight:700,fontSize:16}}>{mod.title}</div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <Badge label={mod.duration} color={accent}/>
          <Badge label={mod.audience} color={C.purple}/>
          {content?.generatedBy && (
            <AIChip model={content.generatedBy === "openai" ? "gpt4" : content.generatedBy}/>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        <button onClick={()=>mode==="slides"?setMode(null):generateContent("slides")} disabled={loading}
          style={{padding:"7px 14px",background:mode==="slides"?accent:`${accent}15`,
            color:mode==="slides"?C.bg:accent,border:`1px solid ${accent}44`,borderRadius:7,
            fontSize:12,fontWeight:600,cursor:loading?"wait":"pointer"}}>
          🖥 {content?.slides ? "View Slides" : "Generate Slides"}
        </button>
        <button onClick={()=>mode==="quiz"?setMode(null):generateContent("quiz")} disabled={loading}
          style={{padding:"7px 14px",background:mode==="quiz"?C.purple:`${C.purple}15`,
            color:mode==="quiz"?C.bg:C.purple,border:`1px solid ${C.purple}44`,borderRadius:7,
            fontSize:12,fontWeight:600,cursor:loading?"wait":"pointer"}}>
          📝 {content?.fullQuiz ? "Take Quiz" : "Generate Quiz"}
        </button>
        {loading && <span style={{fontSize:12,color:C.textMut,alignSelf:"center"}}>Generating…</span>}
      </div>
      {err && <div style={{marginBottom:12,color:C.red,fontSize:12}}>{err}</div>}

      {/* Slides viewer */}
      {mode==="slides" && content?.slides && (
        <SlideViewer slides={content.slides} title={mod.title} accent={accent}/>
      )}

      {/* Interactive quiz */}
      {mode==="quiz" && content?.fullQuiz && (
        <QuizRunner questions={content.fullQuiz} accent={C.purple}/>
      )}

      {/* Default detail view (when not in slides/quiz mode) */}
      {!mode && (
        <>
          {mod.tailoredIntro && (
            <p style={{color:C.textSec,fontSize:13,lineHeight:1.7,marginTop:0,marginBottom:14}}>{mod.tailoredIntro}</p>
          )}
          {mod.objectives?.length > 0 && (
            <>
              <SectionLabel text="Learning Objectives"/>
              <div style={{marginBottom:14,marginTop:6}}>
                {mod.objectives.map((o,i)=>(
                  <div key={i} style={{display:"flex",gap:10,marginBottom:7}}>
                    <span style={{color:C.green,fontSize:14}}>✓</span>
                    <span style={{color:C.textSec,fontSize:13}}>{o}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {mod.realWorldScenario && (
            <div style={{marginBottom:14,padding:"12px 14px",background:C.surface,borderRadius:8,
              borderLeft:`3px solid ${accent}`}}>
              <div style={{color:accent,fontSize:11,fontWeight:700,marginBottom:5,letterSpacing:0.5}}>REAL-WORLD SCENARIO</div>
              <div style={{color:C.textSec,fontSize:13,lineHeight:1.6}}>{mod.realWorldScenario}</div>
            </div>
          )}
          {mod.quiz?.[0] && (
            <div>
              <SectionLabel text="Knowledge Check"/>
              <div style={{padding:"14px",background:C.surface,borderRadius:8,marginTop:6}}>
                <div style={{color:C.text,fontSize:13,fontWeight:600,marginBottom:10}}>{mod.quiz[0].question}</div>
                {mod.quiz[0].options.map((opt,j)=>(
                  <div key={j} onClick={()=>setShowAnswer(true)}
                    style={{padding:"8px 12px",marginBottom:5,borderRadius:6,cursor:"pointer",
                      background:showAnswer&&j===mod.quiz[0].correct?`${C.green}22`:C.card,
                      border:`1px solid ${showAnswer&&j===mod.quiz[0].correct?C.green:C.border}`,
                      color:showAnswer&&j===mod.quiz[0].correct?C.green:C.textSec,fontSize:12}}>
                    {String.fromCharCode(65+j)}. {opt}
                    {showAnswer&&j===mod.quiz[0].correct?"  ✓":""}
                  </div>
                ))}
                {!showAnswer && <div style={{color:C.textMut,fontSize:11,marginTop:6}}>Click an option to reveal the answer. Use “Generate Quiz” for the full scored quiz.</div>}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// In-app slide viewer with PowerPoint download
function SlideViewer({ slides, title, accent }) {
  const { can } = useCapabilities();
  const canDownload = can("downloadExports");
  const [i, setI] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState(null);
  const s = slides[i];

  // Native .pptx export via PptxGenJS (dynamically imported so it doesn't
  // weigh down the initial bundle). Falls back to the HTML deck if the
  // library can't be loaded.
  async function downloadPptxNative() {
    setExporting(true);
    setExportErr(null);
    try {
      const mod = await import("pptxgenjs");
      const PptxGenJS = mod.default || mod;
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";          // 13.33 x 7.5 in
      pptx.author = "ShieldAI";
      pptx.company = "ShieldAI";
      pptx.title = title;

      // Brand palette (NO leading # — that corrupts the file)
      const NAVY = "080D18", INK = "0B2540", CYAN = "00C8FF", CYANDK = "0284C7",
            WHITE = "FFFFFF", MUTE = "5B7088", LIGHT = "EAF6FC";

      const SLIDE_W = 13.33;

      // ── Title slide ──────────────────────────────────────
      const title0 = pptx.addSlide();
      title0.background = { color: NAVY };
      title0.addShape(pptx.shapes.RECTANGLE, { x:0, y:5.05, w:SLIDE_W, h:0.12, fill:{ color: CYAN } });
      // Shield mark drawn from simple shapes (keeps export self-contained)
      title0.addShape(pptx.shapes.RECTANGLE, { x:0.9, y:2.05, w:0.55, h:0.55, fill:{ color: CYANDK }, line:{ color: CYAN, width:1 } });
      title0.addText("ShieldAI", { x:1.6, y:1.95, w:8, h:0.8, fontSize:40, bold:true, color: WHITE, fontFace:"Arial" });
      title0.addText("AI", { x:5.05, y:1.95, w:2, h:0.8, fontSize:40, bold:true, color: CYAN, fontFace:"Arial" });
      title0.addText(title, { x:0.9, y:2.95, w:11.5, h:1.0, fontSize:24, color: WHITE, fontFace:"Arial" });
      title0.addText("Security Awareness Training", { x:0.9, y:3.85, w:11.5, h:0.5, fontSize:14, color: CYAN, fontFace:"Arial", charSpacing:2 });
      title0.addText(`Generated ${new Date().toLocaleDateString()}  ·  CONFIDENTIAL`,
        { x:0.9, y:5.35, w:11.5, h:0.4, fontSize:10, color: MUTE, fontFace:"Arial" });

      // ── Content slides ───────────────────────────────────
      slides.forEach(sl => {
        const slide = pptx.addSlide();
        slide.background = { color: WHITE };
        // Top accent bar + small logo block
        slide.addShape(pptx.shapes.RECTANGLE, { x:0, y:0, w:SLIDE_W, h:0.55, fill:{ color: INK } });
        slide.addShape(pptx.shapes.RECTANGLE, { x:0, y:0.55, w:SLIDE_W, h:0.06, fill:{ color: CYAN } });
        slide.addText([
          { text:"Shield", options:{ color: WHITE, bold:true } },
          { text:"AI", options:{ color: CYAN, bold:true } },
        ], { x:0.5, y:0.04, w:3, h:0.46, fontSize:16, fontFace:"Arial", valign:"middle" });

        slide.addText((sl.title || ""), { x:0.6, y:0.9, w:12.1, h:0.8, fontSize:26, bold:true, color: INK, fontFace:"Arial" });

        const bullets = (sl.bullets || []).map((b, idx, arr) => ({
          text: String(b || ""),
          options: { bullet: true, breakLine: idx < arr.length - 1, color: "333333", fontSize:18 },
        }));
        if (bullets.length) {
          slide.addText(bullets, { x:0.7, y:1.9, w:11.9, h:4.0, fontFace:"Arial", lineSpacingMultiple:1.3, valign:"top" });
        }

        // Footer
        slide.addText("CONFIDENTIAL · Prepared by ShieldAI", { x:0.5, y:7.0, w:8, h:0.3, fontSize:8, color: MUTE, fontFace:"Arial" });
        if (sl.speakerNotes) slide.addNotes(String(sl.speakerNotes));
      });

      await pptx.writeFile({ fileName: `${title.replace(/\s+/g,"_")}_Slides.pptx` });
    } catch (err) {
      console.error("Native PPTX export failed, falling back to HTML:", err);
      setExportErr("Native PowerPoint export unavailable — downloaded an HTML deck instead. (Add the 'pptxgenjs' package for native .pptx.)");
      downloadPptxHtml();
    } finally {
      setExporting(false);
    }
  }

  function downloadPptxHtml() {
    // Fallback: an HTML deck PowerPoint can open/import. Now brand-styled.
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{margin:0;font-family:Arial,sans-serif;background:#111}
  .slide{width:960px;height:540px;margin:20px auto;background:#fff;color:#0B2540;
    padding:0;box-sizing:border-box;page-break-after:always;box-shadow:0 4px 20px rgba(0,0,0,.4);position:relative;overflow:hidden}
  .bar{height:46px;background:#0B2540;color:#fff;display:flex;align-items:center;padding:0 28px;font-weight:800;font-size:18px}
  .bar .ai{color:#00C8FF}
  .accent{height:5px;background:#00C8FF}
  .body{padding:34px 46px}
  .slide h1{font-size:34px;color:#0B2540;margin:0 0 22px}
  .slide ul{font-size:22px;line-height:1.55;color:#333}
  .notes{position:absolute;bottom:14px;left:46px;right:46px;font-size:13px;color:#8090a5;font-style:italic;border-top:1px solid #eee;padding-top:8px}
  .foot{position:absolute;bottom:6px;left:46px;font-size:9px;color:#8090a5}
  @media print{.slide{margin:0;box-shadow:none}}
</style></head><body>`;
    slides.forEach(sl => {
      html += `<div class="slide"><div class="bar">Shield<span class="ai">AI</span></div><div class="accent"></div><div class="body"><h1>${(sl.title||"").replace(/</g,"&lt;")}</h1><ul>`;
      (sl.bullets||[]).forEach(b => html += `<li>${(b||"").replace(/</g,"&lt;")}</li>`);
      html += `</ul></div>`;
      if (sl.speakerNotes) html += `<div class="notes">Speaker notes: ${sl.speakerNotes.replace(/</g,"&lt;")}</div>`;
      html += `<div class="foot">CONFIDENTIAL · Prepared by ShieldAI</div></div>`;
    });
    html += `</body></html>`;
    const blob = new Blob([html], { type: "application/vnd.ms-powerpoint" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${title.replace(/\s+/g,"_")}_Slides.ppt`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div>
      {/* Slide stage */}
      <div style={{background:"#fff",borderRadius:10,padding:"30px 34px",minHeight:230,
        border:`1px solid ${C.border}`,display:"flex",flexDirection:"column"}}>
        <div style={{fontSize:11,color:"#8090a5",marginBottom:8}}>Slide {i+1} of {slides.length}</div>
        <div style={{fontSize:20,fontWeight:800,color:"#0b2545",marginBottom:16}}>{s.title}</div>
        <ul style={{margin:0,paddingLeft:22,color:"#333",fontSize:14,lineHeight:1.8,flex:1}}>
          {(s.bullets||[]).map((b,bi)=><li key={bi}>{b}</li>)}
        </ul>
        {s.speakerNotes && (
          <div style={{marginTop:16,paddingTop:12,borderTop:"1px solid #eee",
            fontSize:12,color:"#8090a5",fontStyle:"italic"}}>
            Speaker notes: {s.speakerNotes}
          </div>
        )}
      </div>
      {/* Controls */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginTop:12}}>
        <button onClick={()=>setI(Math.max(0,i-1))} disabled={i===0}
          style={{padding:"7px 14px",background:C.surface,border:`1px solid ${C.border}`,
            borderRadius:7,color:i===0?C.textMut:C.textSec,fontSize:12,cursor:i===0?"default":"pointer"}}>‹ Prev</button>
        <div style={{display:"flex",gap:4,flex:1,justifyContent:"center"}}>
          {slides.map((_,si)=>(
            <span key={si} onClick={()=>setI(si)} style={{width:8,height:8,borderRadius:"50%",cursor:"pointer",
              background:si===i?accent:C.border}}/>
          ))}
        </div>
        <button onClick={()=>setI(Math.min(slides.length-1,i+1))} disabled={i===slides.length-1}
          style={{padding:"7px 14px",background:C.surface,border:`1px solid ${C.border}`,
            borderRadius:7,color:i===slides.length-1?C.textMut:C.textSec,fontSize:12,
            cursor:i===slides.length-1?"default":"pointer"}}>Next ›</button>
        <button onClick={canDownload ? downloadPptxNative : undefined} disabled={exporting || !canDownload}
          title={canDownload ? "" : "Downloads require Pro or higher"}
          style={{padding:"7px 14px",background:canDownload?`${accent}15`:C.surface,border:`1px solid ${canDownload?accent+"44":C.border}`,
            borderRadius:7,color:canDownload?accent:C.textMut,fontSize:12,fontWeight:600,
            cursor:!canDownload?"not-allowed":exporting?"wait":"pointer"}}>
          {!canDownload ? "🔒 Download (Pro+)" : exporting ? "Building .pptx…" : "⬇ Download PowerPoint"}
        </button>
      </div>
      {exportErr && (
        <div style={{marginTop:8,fontSize:11,color:C.amber}}>{exportErr}</div>
      )}
    </div>
  );
}

// Interactive, scored quiz
function QuizRunner({ questions, accent }) {
  const [answers, setAnswers] = useState({});   // qIndex -> optionIndex
  const [submitted, setSubmitted] = useState(false);

  const score = questions.reduce((s,q,i)=> s + (answers[i]===q.correct?1:0), 0);
  const pct = Math.round((score/questions.length)*100);
  const passed = pct >= 80;

  function reset() { setAnswers({}); setSubmitted(false); }

  return (
    <div>
      {questions.map((q,qi)=>(
        <div key={qi} style={{marginBottom:16,padding:"14px 16px",background:C.surface,borderRadius:8}}>
          <div style={{color:C.text,fontSize:13,fontWeight:600,marginBottom:10}}>
            {qi+1}. {q.question}
          </div>
          {q.options.map((opt,oi)=>{
            const chosen = answers[qi]===oi;
            const isCorrect = oi===q.correct;
            let bg = C.card, bc = C.border, col = C.textSec;
            if (submitted) {
              if (isCorrect) { bg = `${C.green}22`; bc = C.green; col = C.green; }
              else if (chosen) { bg = `${C.red}22`; bc = C.red; col = C.red; }
            } else if (chosen) { bg = `${accent}22`; bc = accent; col = accent; }
            return (
              <div key={oi} onClick={()=>!submitted && setAnswers(a=>({...a,[qi]:oi}))}
                style={{padding:"8px 12px",marginBottom:5,borderRadius:6,fontSize:12,
                  cursor:submitted?"default":"pointer",background:bg,border:`1px solid ${bc}`,color:col}}>
                {String.fromCharCode(65+oi)}. {opt}
                {submitted && isCorrect ? "  ✓" : ""}
                {submitted && chosen && !isCorrect ? "  ✗" : ""}
              </div>
            );
          })}
          {submitted && q.explanation && (
            <div style={{marginTop:8,fontSize:11,color:C.textMut,fontStyle:"italic"}}>{q.explanation}</div>
          )}
        </div>
      ))}

      {!submitted ? (
        <button onClick={()=>setSubmitted(true)}
          disabled={Object.keys(answers).length < questions.length}
          style={{padding:"10px 20px",background:Object.keys(answers).length<questions.length?C.surface:accent,
            color:Object.keys(answers).length<questions.length?C.textMut:C.bg,border:"none",borderRadius:8,
            fontSize:13,fontWeight:700,cursor:Object.keys(answers).length<questions.length?"default":"pointer"}}>
          Submit Quiz ({Object.keys(answers).length}/{questions.length} answered)
        </button>
      ) : (
        <div style={{padding:"16px 18px",borderRadius:10,
          background:passed?`${C.green}15`:`${C.amber}15`,
          border:`1px solid ${passed?C.green:C.amber}44`}}>
          <div style={{fontSize:22,fontWeight:800,color:passed?C.green:C.amber}}>
            {pct}% — {passed?"Passed":"Review needed"}
          </div>
          <div style={{fontSize:13,color:C.textSec,marginTop:4}}>
            {score} of {questions.length} correct. {passed?"Meets the 80% pass mark.":"A passing score is 80%."}
          </div>
          <button onClick={reset} style={{marginTop:12,padding:"7px 16px",background:C.card,
            border:`1px solid ${C.border}`,borderRadius:7,color:C.textSec,fontSize:12,cursor:"pointer"}}>
            Retake Quiz
          </button>
        </div>
      )}
    </div>
  );
}

function ExecReportSection({ assessment, results }) {
  const rep = results?.execReport?.executiveReport;
  const risk = results?.riskOverview;
  const genBy = results?.execReport?.generatedBy;
  if (!rep) return <div style={{color:C.textSec,padding:20}}>Report not generated.</div>;

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <SectionLabel text="Executive CISO Report"/>
        <div style={{marginLeft:"auto"}}><AIChip model={genBy === "openai" ? "gpt4" : (genBy || "claude")}/></div>
      </div>
      <Card style={{marginBottom:14,padding:"24px"}}>
        <div style={{borderBottom:`1px solid ${C.border}`,paddingBottom:16,marginBottom:16}}>
          <div style={{color:C.textMut,fontSize:11,letterSpacing:2,marginBottom:8}}>
            SHIELDAI · VIRTUAL CISO REPORT
          </div>
          <h2 style={{color:C.text,margin:"0 0 6px",fontSize:22}}>{rep.headline}</h2>
          <div style={{color:C.textSec,fontSize:13}}>
            {assessment?.company?.name||"Your Company"} · Generated {new Date().toLocaleDateString()}
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
          <div>
            <div style={{color:C.textMut,fontSize:11,marginBottom:6}}>SECURITY POSTURE</div>
            <p style={{color:C.textSec,fontSize:13,lineHeight:1.7,margin:0}}>{rep.securityPosture}</p>
          </div>
          <div>
            <div style={{color:C.textMut,fontSize:11,marginBottom:6}}>BUSINESS RISK</div>
            <p style={{color:C.textSec,fontSize:13,lineHeight:1.7,margin:0}}>{rep.businessRisk}</p>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:16}}>
          {[
            {label:"Posture Score",value:`${risk?.postureScore||"–"}/100`,color:C.green},
            {label:"Investment Required",value:rep.investmentRequired,color:C.amber},
            {label:"Expected ROI",value:rep.roi,color:C.green},
          ].map((s,i)=>(
            <div key={i} style={{padding:"14px",background:C.surface,borderRadius:8,textAlign:"center"}}>
              <div style={{color:C.textMut,fontSize:10,marginBottom:6}}>{s.label}</div>
              <div style={{color:s.color,fontWeight:700,fontSize:16}}>{s.value}</div>
            </div>
          ))}
        </div>
      </Card>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <Card>
          <SectionLabel text="Key Findings"/>
          {(rep.keyFindings||[]).map((f,i)=>(
            <div key={i} style={{display:"flex",gap:10,marginBottom:8}}>
              <span style={{color:C.amber}}>⚠</span>
              <span style={{color:C.textSec,fontSize:13}}>{f}</span>
            </div>
          ))}
        </Card>
        <Card>
          <SectionLabel text="Next Steps"/>
          {(rep.nextSteps||[]).map((s,i)=>(
            <div key={i} style={{padding:"8px 12px",marginBottom:6,background:C.surface,
              borderRadius:6,display:"flex",gap:10,alignItems:"flex-start"}}>
              <Badge label={s.priority}/>
              <div>
                <div style={{color:C.text,fontSize:13,fontWeight:600}}>{s.action}</div>
                <div style={{color:C.textMut,fontSize:11}}>
                  {s.owner} · {s.dueDate}
                </div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────
//  Lightweight markdown renderer for policy documents
//  Handles: # / ## / ### headers, **bold**, - and numbered lists,
//  | tables |, --- rules, and paragraphs. Good enough for the
//  structured policy format we generate.
// ─────────────────────────────────────────────────────────────
function MarkdownDoc({ text }) {
  if (!text) return null;
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;

  const renderInline = (s) => {
    // split on **bold**
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, idx) => {
      if (/^\*\*[^*]+\*\*$/.test(p)) {
        return <strong key={idx} style={{color:C.text,fontWeight:700}}>{p.slice(2,-2)}</strong>;
      }
      return <span key={idx}>{p}</span>;
    });
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      blocks.push(<hr key={i} style={{border:"none",borderTop:`1px solid ${C.border}`,margin:"18px 0"}}/>);
      i++; continue;
    }
    // Headers
    if (/^#\s+/.test(trimmed)) {
      blocks.push(<div key={i} style={{fontSize:22,fontWeight:800,color:C.text,margin:"4px 0 14px"}}>{renderInline(trimmed.replace(/^#\s+/,""))}</div>);
      i++; continue;
    }
    if (/^##\s+/.test(trimmed)) {
      blocks.push(<div key={i} style={{fontSize:16,fontWeight:700,color:C.accent,margin:"20px 0 8px"}}>{renderInline(trimmed.replace(/^##\s+/,""))}</div>);
      i++; continue;
    }
    if (/^###\s+/.test(trimmed)) {
      blocks.push(<div key={i} style={{fontSize:14,fontWeight:700,color:C.text,margin:"14px 0 6px"}}>{renderInline(trimmed.replace(/^###\s+/,""))}</div>);
      i++; continue;
    }
    // Table (markdown pipe table)
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      // parse rows; skip separator row (---|---)
      const rows = tableLines
        .filter(r => !/^\|[\s:|-]+\|$/.test(r))
        .map(r => r.slice(1, -1).split("|").map(c => c.trim()));
      if (rows.length) {
        const [head, ...body] = rows;
        blocks.push(
          <table key={i} style={{width:"100%",borderCollapse:"collapse",margin:"10px 0",fontSize:12}}>
            <thead>
              <tr>{head.map((h,hi)=>(
                <th key={hi} style={{textAlign:"left",padding:"8px 10px",background:C.bg,
                  border:`1px solid ${C.border}`,color:C.text,fontWeight:700}}>{renderInline(h)}</th>
              ))}</tr>
            </thead>
            <tbody>{body.map((r,ri)=>(
              <tr key={ri}>{r.map((c,ci)=>(
                <td key={ci} style={{padding:"8px 10px",border:`1px solid ${C.border}`,color:C.textSec}}>{renderInline(c)}</td>
              ))}</tr>
            ))}</tbody>
          </table>
        );
      }
      continue;
    }
    // Bulleted list
    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={i} style={{margin:"6px 0 10px",paddingLeft:22,color:C.textSec,fontSize:13,lineHeight:1.7}}>
          {items.map((it,ii)=><li key={ii}>{renderInline(it)}</li>)}
        </ul>
      );
      continue;
    }
    // Numbered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={i} style={{margin:"6px 0 10px",paddingLeft:22,color:C.textSec,fontSize:13,lineHeight:1.7}}>
          {items.map((it,ii)=><li key={ii}>{renderInline(it)}</li>)}
        </ol>
      );
      continue;
    }
    // Blank line
    if (trimmed === "") { i++; continue; }
    // Paragraph
    blocks.push(<p key={i} style={{margin:"0 0 10px",color:C.textSec,fontSize:13,lineHeight:1.7}}>{renderInline(trimmed)}</p>);
    i++;
  }

  return <div>{blocks}</div>;
}

// Light-theme variant of MarkdownDoc for the white "document paper" preview.
function MarkdownDocLight({ text }) {
  if (!text) return null;
  const ink = "#1a1a1a", head = "#0b3d91", sub = "#444", line = "#ccc", panel = "#f0f3f8";
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;
  const renderInline = (s) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, idx) =>
      /^\*\*[^*]+\*\*$/.test(p)
        ? <strong key={idx} style={{color:ink,fontWeight:700}}>{p.slice(2,-2)}</strong>
        : <span key={idx}>{p}</span>
    );
  };
  while (i < lines.length) {
    const line = lines[i]; const t = line.trim();
    if (/^---+$/.test(t)) { blocks.push(<hr key={i} style={{border:"none",borderTop:`1px solid ${line}`,margin:"18px 0"}}/>); i++; continue; }
    if (/^#\s+/.test(t)) { blocks.push(<div key={i} style={{fontSize:22,fontWeight:800,color:head,margin:"4px 0 14px"}}>{renderInline(t.replace(/^#\s+/,""))}</div>); i++; continue; }
    if (/^##\s+/.test(t)) { blocks.push(<div key={i} style={{fontSize:16,fontWeight:700,color:head,borderBottom:`1px solid ${line}`,paddingBottom:4,margin:"20px 0 8px"}}>{renderInline(t.replace(/^##\s+/,""))}</div>); i++; continue; }
    if (/^###\s+/.test(t)) { blocks.push(<div key={i} style={{fontSize:14,fontWeight:700,color:ink,margin:"14px 0 6px"}}>{renderInline(t.replace(/^###\s+/,""))}</div>); i++; continue; }
    if (t.startsWith("|") && t.endsWith("|")) {
      const tl = []; while (i < lines.length && lines[i].trim().startsWith("|")) { tl.push(lines[i].trim()); i++; }
      const rows = tl.filter(r => !/^\|[\s:|-]+\|$/.test(r)).map(r => r.slice(1,-1).split("|").map(c=>c.trim()));
      if (rows.length) {
        const [h,...b] = rows;
        blocks.push(
          <table key={i} style={{width:"100%",borderCollapse:"collapse",margin:"10px 0",fontSize:12}}>
            <thead><tr>{h.map((c,ci)=><th key={ci} style={{textAlign:"left",padding:"8px 10px",background:panel,border:`1px solid ${line}`,color:ink,fontWeight:700}}>{renderInline(c)}</th>)}</tr></thead>
            <tbody>{b.map((r,ri)=><tr key={ri}>{r.map((c,ci)=><td key={ci} style={{padding:"8px 10px",border:`1px solid ${line}`,color:sub}}>{renderInline(c)}</td>)}</tr>)}</tbody>
          </table>
        );
      }
      continue;
    }
    if (/^[-*]\s+/.test(t)) {
      const items = []; while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^[-*]\s+/,"")); i++; }
      blocks.push(<ul key={i} style={{margin:"6px 0 10px",paddingLeft:22,color:sub,fontSize:13,lineHeight:1.7}}>{items.map((it,ii)=><li key={ii}>{renderInline(it)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      const items = []; while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^\d+\.\s+/,"")); i++; }
      blocks.push(<ol key={i} style={{margin:"6px 0 10px",paddingLeft:22,color:sub,fontSize:13,lineHeight:1.7}}>{items.map((it,ii)=><li key={ii}>{renderInline(it)}</li>)}</ol>);
      continue;
    }
    if (t === "") { i++; continue; }
    blocks.push(<p key={i} style={{margin:"0 0 10px",color:sub,fontSize:13,lineHeight:1.7}}>{renderInline(t)}</p>);
    i++;
  }
  return <div style={{fontFamily:"Georgia,'Times New Roman',serif"}}>{blocks}</div>;
}

// ─────────────────────────────────────────────────────────────
//  CHAT MARKDOWN — compact renderer for AI chat bubbles
//  Same basic parsing as MarkdownDoc/MarkdownDocLight (headers, **bold**,
//  bullets, numbered lists, tables) but sized for a message bubble rather
//  than a document: smaller type, tighter spacing, no serif font, and a
//  `color`/`mutedColor` prop so it can sit correctly in bubbles of different
//  backgrounds (user vs. assistant, light vs. dark console themes).
//
//  This exists because every Mastermind/analyst-chat surface was rendering
//  the AI's raw reply as a single plain-text string — so a response like
//  "## Summary\n\n**Priority 1:** ..." showed the literal characters
//  `## Summary` and `**Priority 1:**` in the bubble instead of a heading and
//  bold text. Claude's replies are always Markdown-formatted prose; a chat
//  surface has to parse that, not print it.
// ─────────────────────────────────────────────────────────────
function ChatMarkdown({ text, color, mutedColor }) {
  if (!text) return null;
  const ink = color || "inherit";
  const sub = mutedColor || color || "inherit";
  const lines = String(text).split("\n");
  const blocks = [];
  let i = 0;

  const renderInline = (s) => {
    // **bold** only — chat replies don't need italics/code-span handling to
    // stop looking like raw markup, and over-parsing risks mangling things
    // like "a**b" in a variable name or an emphasis-free clause.
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, idx) =>
      /^\*\*[^*]+\*\*$/.test(p)
        ? <strong key={idx} style={{color:ink,fontWeight:700}}>{p.slice(2,-2)}</strong>
        : <span key={idx}>{p}</span>
    );
  };

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (/^---+$/.test(t)) {
      blocks.push(<hr key={i} style={{border:"none",borderTop:`1px solid currentColor`,opacity:0.2,margin:"8px 0"}}/>);
      i++; continue;
    }
    if (/^#{1,3}\s+/.test(t)) {
      blocks.push(<div key={i} style={{fontSize:"1.05em",fontWeight:700,color:ink,margin:"6px 0 4px"}}>{renderInline(t.replace(/^#{1,3}\s+/,""))}</div>);
      i++; continue;
    }
    if (/^[-*]\s+/.test(t)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^[-*]\s+/,"")); i++; }
      blocks.push(<ul key={i} style={{margin:"4px 0 8px",paddingLeft:18,color:sub}}>{items.map((it,ii)=><li key={ii} style={{marginBottom:2}}>{renderInline(it)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^\d+\.\s+/,"")); i++; }
      blocks.push(<ol key={i} style={{margin:"4px 0 8px",paddingLeft:18,color:sub}}>{items.map((it,ii)=><li key={ii} style={{marginBottom:2}}>{renderInline(it)}</li>)}</ol>);
      continue;
    }
    if (t === "") { i++; continue; }
    blocks.push(<p key={i} style={{margin:"0 0 6px",color:sub}}>{renderInline(t)}</p>);
    i++;
  }
  return <div style={{marginBottom:-6}}>{blocks}</div>;
}

// ─────────────────────────────────────────────────────────────
//  REPORTS (client-facing)
//  Clients self-generate Status and Update reports, and see/download any
//  Compliance / Insurance / Legal reports their analyst has delivered.
// ─────────────────────────────────────────────────────────────
function ReportsSection() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);   // which action is running
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [since, setSince] = useState("");   // optional "changed since" date for updates

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/reports`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load reports.");
      setReports(Array.isArray(d) ? d : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function flash(msg, tone = C.green) { setToast({ msg, tone }); setTimeout(() => setToast(null), 3200); }

  async function generate(type) {
    setBusy(type); setError(null);
    try {
      const body = { type };
      if (type === "update" && since) body.since = new Date(since).toISOString();
      const res = await authFetch(`${API_BASE}/api/reports/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not generate report.");
      flash(`${REPORT_TYPE_META[type]?.label || "Report"} generated.`);
      await load();
      // Immediately offer the freshly generated document.
      try { await downloadReport(d); } catch { /* user can click Download */ }
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  async function doDownload(r) {
    setBusy(r.id); setError(null);
    try { await downloadReport(r); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  async function remove(r) {
    if (!window.confirm(`Delete "${r.filename}"? This removes the document; your underlying data is untouched.`)) return;
    setBusy(r.id); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/reports/${r.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Delete failed.");
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  const selfCards = ["status", "update"];

  return (
    <div>
      <SectionLabel text="Reports"/>
      <p style={{color:C.textSec,fontSize:13,lineHeight:1.6,margin:"0 0 18px",maxWidth:680}}>
        Generate a plain-language status or update report anytime. Compliance,
        insurance, and legal reports are prepared by your ShieldAI analyst and
        appear here once delivered.
      </p>

      {toast && (
        <div style={{marginBottom:14,padding:"10px 14px",borderRadius:8,fontSize:13,
          background:`${toast.tone}18`,border:`1px solid ${toast.tone}44`,color:toast.tone}}>
          {toast.msg}
        </div>
      )}

      {/* Self-serve generators */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:12}}>
        {selfCards.map(type => {
          const m = REPORT_TYPE_META[type];
          return (
            <Card key={type} style={{padding:"18px 20px"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                <span style={{fontSize:22}}>{m.icon}</span>
                <span style={{color:C.text,fontWeight:700,fontSize:15}}>{m.label}</span>
              </div>
              <p style={{color:C.textSec,fontSize:12.5,lineHeight:1.55,margin:"0 0 14px"}}>{m.blurb}</p>
              {type === "update" && (
                <div style={{marginBottom:12}}>
                  <label style={{display:"block",color:C.textMut,fontSize:11,marginBottom:4}}>
                    Show changes since (optional)
                  </label>
                  <input type="date" value={since} onChange={e=>setSince(e.target.value)}
                    style={{padding:"7px 10px",background:C.surface,border:`1px solid ${C.border}`,
                      borderRadius:8,color:C.text,fontSize:12.5,fontFamily:"Inter,system-ui,sans-serif"}}/>
                </div>
              )}
              <button onClick={()=>generate(type)} disabled={busy===type}
                style={{padding:"9px 18px",background:busy===type?C.border:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
                  color:busy===type?C.textMut:C.bg,border:"none",borderRadius:9,fontSize:13,fontWeight:700,
                  cursor:busy===type?"wait":"pointer"}}>
                {busy===type ? "Generating…" : `Generate ${m.label}`}
              </button>
            </Card>
          );
        })}
      </div>

      {error && <div style={{margin:"12px 0",color:C.red,fontSize:13}}>{error}</div>}

      <SectionLabel text={`Your Reports (${reports.length})`}/>
      {loading ? <Spinner/> : reports.length === 0 ? (
        <Card style={{textAlign:"center",padding:"36px 24px"}}>
          <div style={{fontSize:30,marginBottom:8}}>📋</div>
          <div style={{color:C.text,fontWeight:600,fontSize:15,marginBottom:5}}>No reports yet</div>
          <p style={{color:C.textSec,fontSize:13,margin:0,lineHeight:1.6}}>
            Generate a status or update report above, or ask your analyst for a
            compliance, insurance, or legal report.
          </p>
        </Card>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {reports.map(r => {
            const m = REPORT_TYPE_META[r.type] || { icon:"📄", label:r.type };
            const mine = r.createdByRole === "client_admin";
            return (
              <Card key={r.id} style={{padding:"14px 18px"}}>
                <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                  <span style={{fontSize:20}}>{m.icon}</span>
                  <div style={{flex:"1 1 240px",minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <span style={{color:C.text,fontWeight:600,fontSize:14}}>{m.label}</span>
                      {!mine && <Badge label="From your analyst" color={C.purple}/>}
                    </div>
                    <div style={{color:C.textMut,fontSize:11.5,marginTop:3}}>
                      {new Date(r.createdAt).toLocaleString(undefined,{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"})}
                      {" · "}{r.filename}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>doDownload(r)} disabled={busy===r.id}
                      style={{padding:"7px 15px",background:`${C.accent}18`,border:`1px solid ${C.accent}55`,
                        borderRadius:7,color:C.accent,fontSize:12.5,fontWeight:600,cursor:busy===r.id?"wait":"pointer"}}>
                      {busy===r.id ? "…" : "Download"}
                    </button>
                    {mine && (
                      <button onClick={()=>remove(r)} disabled={busy===r.id}
                        style={{padding:"7px 12px",background:"none",border:`1px solid ${C.border}`,
                          borderRadius:7,color:C.textSec,fontSize:12.5,cursor:busy===r.id?"wait":"pointer"}}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p style={{color:C.textMut,fontSize:11,lineHeight:1.6,margin:"16px 0 0",maxWidth:680}}>
        Reports open in Microsoft Word and can be printed or saved as PDF. Each
        carries a review note — these documents summarize your ShieldAI data and
        are not a substitute for a licensed auditor, attorney, or signed attestation.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  POLICY LIBRARY
// ─────────────────────────────────────────────────────────────

function PolicyLibrarySection({ assessment }) {
  const { can } = useCapabilities();
  const canDownload = can("downloadExports");
  const [catalog, setCatalog] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [selected, setSelected] = useState(null); // policy catalog entry
  const [answers, setAnswers] = useState({});
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(null); // generated policy doc
  const [error, setError] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [savedPolicies, setSavedPolicies] = useState([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [openingSaved, setOpeningSaved] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/policy-catalog`)
      .then(r => r.json())
      .then(data => { setCatalog(data); setLoadingCatalog(false); })
      .catch(err => { console.error(err); setLoadingCatalog(false); });
  }, []);

  async function loadSavedPolicies() {
    setLoadingSaved(true);
    try {
      const res = await authFetch(`${API_BASE}/api/policies`);
      if (res.ok) {
        const list = await res.json();
        list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        setSavedPolicies(list);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSaved(false);
    }
  }

  useEffect(() => { loadSavedPolicies(); }, []);

  async function openSavedPolicy(id) {
    setOpeningSaved(id);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/policies/${id}`);
      if (!res.ok) throw new Error("Could not load policy");
      const doc = await res.json();
      setGenerated(doc);
      // Set `selected` so the detail view renders, using the catalog entry if found
      const catEntry = catalog.find(c => c.id === doc.policyId)
        || { id: doc.policyId, name: doc.policyName, description: "", fields: [] };
      setSelected(catEntry);
    } catch (err) {
      setError(err.message);
    } finally {
      setOpeningSaved(null);
    }
  }

  async function deleteSavedPolicy(id, name) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      const res = await authFetch(`${API_BASE}/api/policies/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not delete policy");
      await loadSavedPolicies();
    } catch (err) {
      setError(err.message);
    }
  }

  function openPolicy(policy) {
    setSelected(policy);
    setAnswers({});
    setGenerated(null);
    setError(null);
  }

  function closePolicy() {
    setSelected(null);
    setGenerated(null);
    setError(null);
    loadSavedPolicies(); // refresh the saved list in case a new one was generated
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/policies/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId: selected.id,
          companyContext: assessment?.company || null,
          answers,
        }),
      });
      if (!res.ok) throw new Error(`Generation failed: ${res.status}`);
      const data = await res.json();
      setGenerated(data);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  function copyToClipboard() {
    if (generated?.content) {
      navigator.clipboard.writeText(generated.content);
    }
  }

  // Convert the markdown policy into a Word-openable .doc (HTML-based).
  // Word opens HTML files saved with a .doc extension and renders the formatting.
  function mdToHtml(md) {
    const lines = md.split("\n");
    let html = "";
    let i = 0;
    const inline = (s) => s
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    while (i < lines.length) {
      const t = lines[i].trim();
      if (/^---+$/.test(t)) { html += "<hr/>"; i++; continue; }
      if (/^#\s+/.test(t)) { html += `<h1>${inline(t.replace(/^#\s+/,""))}</h1>`; i++; continue; }
      if (/^##\s+/.test(t)) { html += `<h2>${inline(t.replace(/^##\s+/,""))}</h2>`; i++; continue; }
      if (/^###\s+/.test(t)) { html += `<h3>${inline(t.replace(/^###\s+/,""))}</h3>`; i++; continue; }
      if (t.startsWith("|") && t.endsWith("|")) {
        const tl = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) { tl.push(lines[i].trim()); i++; }
        const rows = tl.filter(r => !/^\|[\s:|-]+\|$/.test(r)).map(r => r.slice(1,-1).split("|").map(c=>c.trim()));
        if (rows.length) {
          const [head,...body] = rows;
          html += '<table class="content" cellpadding="6" cellspacing="0">';
          html += "<tr>" + head.map(h=>`<th align="left">${inline(h)}</th>`).join("") + "</tr>";
          html += body.map(r=>"<tr>"+r.map(c=>`<td>${inline(c)}</td>`).join("")+"</tr>").join("");
          html += "</table>";
        }
        continue;
      }
      if (/^[-*]\s+/.test(t)) {
        html += "<ul>";
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) { html += `<li>${inline(lines[i].trim().replace(/^[-*]\s+/,""))}</li>`; i++; }
        html += "</ul>"; continue;
      }
      if (/^\d+\.\s+/.test(t)) {
        html += "<ol>";
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) { html += `<li>${inline(lines[i].trim().replace(/^\d+\.\s+/,""))}</li>`; i++; }
        html += "</ol>"; continue;
      }
      if (t === "") { i++; continue; }
      html += `<p>${inline(t)}</p>`; i++;
    }
    return html;
  }

  function downloadAsWord() {
    if (!generated?.content) return;
    const body = mdToHtml(generated.content);
    const companyName = assessment?.company?.name || "";
    const full = buildBrandedWordDoc({
      title: generated.policyName,
      docKicker: "Security Policy",
      subtitle: companyName ? `Prepared for ${companyName}` : "",
      bodyHtml: body,
    });
    const blob = new Blob([full], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${generated.policyName.replace(/\s+/g, "_")}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const categories = ["All", ...new Set(catalog.map(p => p.category))];
  const filtered = categoryFilter === "All" ? catalog : catalog.filter(p => p.category === categoryFilter);

  const allFieldsFilled = selected && selected.fields.every(f => answers[f.id]?.trim());

  // ── Detail / Generation view ──────────────────────────────
  if (selected) {
    return (
      <div>
        <button onClick={closePolicy}
          style={{marginBottom:16,padding:"6px 14px",background:"none",
            border:`1px solid ${C.border}`,borderRadius:6,color:C.textSec,
            fontSize:12,cursor:"pointer"}}>
          ← Back to Policy Library
        </button>

        <Card style={{marginBottom:16}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:8}}>
            <span style={{fontSize:24}}>📄</span>
            <div>
              <div style={{color:C.text,fontWeight:700,fontSize:18}}>{selected.name}</div>
              <div style={{color:C.textSec,fontSize:13,marginTop:4}}>{selected.description}</div>
            </div>
            <div style={{marginLeft:"auto"}}><AIChip model="claude"/></div>
          </div>
        </Card>

        {!generated && (
          <Card style={{marginBottom:16}}>
            <SectionLabel text="A Few Questions to Customize This Policy"/>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              {selected.fields.map(field => (
                <div key={field.id}>
                  <label style={{display:"block",color:C.text,fontSize:13,fontWeight:600,marginBottom:6}}>
                    {field.label}
                  </label>
                  {field.type === "select" ? (
                    <select
                      value={answers[field.id] || ""}
                      onChange={e => setAnswers({...answers, [field.id]: e.target.value})}
                      style={{width:"100%",padding:"10px 12px",background:C.surface,
                        border:`1px solid ${C.border}`,borderRadius:8,color:C.text,
                        fontSize:13,fontFamily:"Inter,system-ui,sans-serif"}}>
                      <option value="">Select an option…</option>
                      {field.options.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={answers[field.id] || ""}
                      onChange={e => setAnswers({...answers, [field.id]: e.target.value})}
                      placeholder="Type your answer…"
                      style={{width:"100%",padding:"10px 12px",background:C.surface,
                        border:`1px solid ${C.border}`,borderRadius:8,color:C.text,
                        fontSize:13,fontFamily:"Inter,system-ui,sans-serif",
                        boxSizing:"border-box"}}/>
                  )}
                </div>
              ))}
            </div>

            {error && (
              <div style={{marginTop:14,padding:"10px 14px",background:`${C.red}15`,
                border:`1px solid ${C.red}33`,borderRadius:8,color:C.red,fontSize:13}}>
                {error}
              </div>
            )}

            <button onClick={handleGenerate} disabled={!allFieldsFilled || generating}
              style={{marginTop:18,padding:"12px 28px",
                background: !allFieldsFilled || generating ? C.border :
                  `linear-gradient(135deg,${C.accent},${C.accentDm})`,
                color: !allFieldsFilled || generating ? C.textMut : C.bg,
                border:"none",borderRadius:10,fontSize:14,fontWeight:700,
                cursor: !allFieldsFilled || generating ? "not-allowed" : "pointer"}}>
              {generating ? "Generating…" : "Generate Policy →"}
            </button>
            {generating && (
              <div style={{marginTop:12}}><Spinner/></div>
            )}
          </Card>
        )}

        {generated && (
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <SectionLabel text="Generated Policy Document"/>
              <div style={{display:"flex",gap:8}}>
                <button onClick={copyToClipboard}
                  style={{padding:"6px 14px",background:C.surface,border:`1px solid ${C.border}`,
                    borderRadius:6,color:C.textSec,fontSize:12,cursor:"pointer"}}>
                  📋 Copy
                </button>
                <button onClick={canDownload ? downloadAsWord : undefined} disabled={!canDownload}
                  title={canDownload ? "" : "Downloads require Pro or higher"}
                  style={{padding:"6px 14px",background:canDownload?`${C.accent}15`:C.surface,border:`1px solid ${canDownload?C.accent+"33":C.border}`,
                    borderRadius:6,color:canDownload?C.accent:C.textMut,fontSize:12,cursor:canDownload?"pointer":"not-allowed"}}>
                  {canDownload ? "⬇ Download Word" : "🔒 Download (Pro+)"}
                </button>
              </div>
            </div>
            <div style={{padding:"24px 28px",background:"#fff",borderRadius:8,
              border:`1px solid ${C.border}`,
              maxHeight:600,overflowY:"auto"}}>
              <div style={{filter:"none"}}>
                <MarkdownDocLight text={generated.content}/>
              </div>
            </div>
            <button onClick={() => { setGenerated(null); setAnswers({}); }}
              style={{marginTop:14,padding:"8px 18px",background:"none",
                border:`1px solid ${C.border}`,borderRadius:8,color:C.textSec,
                fontSize:12,cursor:"pointer"}}>
              ↩ Generate Another Version
            </button>
          </Card>
        )}
      </div>
    );
  }

  // ── Catalog browse view ──────────────────────────────
  return (
    <div>
      {/* My Saved Policies */}
      <div style={{marginBottom:28}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
          <SectionLabel text="My Policies"/>
          {savedPolicies.length > 0 && (
            <span style={{fontSize:11,color:C.textMut,
              padding:"2px 10px",background:C.surface,borderRadius:20}}>
              {savedPolicies.length} saved
            </span>
          )}
        </div>

        {error && (
          <div style={{marginBottom:12,padding:"10px 14px",background:`${C.red}15`,
            border:`1px solid ${C.red}33`,borderRadius:8,color:C.red,fontSize:13}}>{error}</div>
        )}

        {loadingSaved ? (
          <Spinner/>
        ) : savedPolicies.length === 0 ? (
          <Card style={{padding:"20px 22px"}}>
            <p style={{color:C.textSec,fontSize:13,margin:0,lineHeight:1.6}}>
              You haven't generated any policies yet. Pick one from the catalog below to create
              your first — it'll be saved here for you to view and download anytime.
            </p>
          </Card>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {savedPolicies.map(p => (
              <Card key={p.id} style={{padding:"14px 18px"}}>
                <div style={{display:"flex",alignItems:"center",gap:14}}>
                  <span style={{fontSize:20}}>📄</span>
                  <div style={{flex:1}}>
                    <div style={{color:C.text,fontWeight:600,fontSize:14}}>{p.policyName}</div>
                    <div style={{color:C.textMut,fontSize:11,marginTop:2}}>
                      Generated {new Date(p.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button onClick={() => openSavedPolicy(p.id)} disabled={openingSaved===p.id}
                    style={{padding:"8px 18px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
                      color:C.bg,border:"none",borderRadius:8,fontSize:12,fontWeight:700,
                      cursor:openingSaved===p.id?"wait":"pointer",whiteSpace:"nowrap"}}>
                    {openingSaved===p.id ? "Opening…" : "View / Download"}
                  </button>
                  <button onClick={() => deleteSavedPolicy(p.id, p.policyName)}
                    style={{padding:"8px 12px",background:`${C.red}15`,border:`1px solid ${C.red}33`,
                      borderRadius:8,color:C.red,fontSize:12,cursor:"pointer"}}>
                    Delete
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <SectionLabel text="Policy Library — Request a Custom Policy"/>
      <p style={{color:C.textSec,fontSize:13,marginBottom:16,lineHeight:1.6}}>
        Select a policy below, answer a few quick questions, and Claude will generate a
        complete, ready-to-use policy document tailored to your business.
      </p>

      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {categories.map(c => (
          <button key={c} onClick={() => setCategoryFilter(c)}
            style={{padding:"5px 14px",background:categoryFilter===c?`${C.accent}22`:C.surface,
              border:`1px solid ${categoryFilter===c?C.accent:C.border}`,borderRadius:20,
              color:categoryFilter===c?C.accent:C.textSec,fontSize:12,cursor:"pointer"}}>
            {c}
          </button>
        ))}
      </div>

      {loadingCatalog ? (
        <Spinner/>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
          {filtered.map(p => (
            <Card key={p.id} style={{cursor:"pointer",padding:"16px 18px"}}
              onClick={() => openPolicy(p)}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:8}}>
                <span style={{fontSize:20}}>📄</span>
                <div style={{flex:1}}>
                  <div style={{color:C.text,fontWeight:600,fontSize:14}}>{p.name}</div>
                  <div style={{marginTop:4}}><Badge label={p.category} color={C.purple}/></div>
                </div>
              </div>
              <p style={{color:C.textSec,fontSize:12,margin:"0 0 10px",lineHeight:1.6}}>
                {p.description}
              </p>
              <div style={{color:C.accent,fontSize:12,fontWeight:600}}>
                Request this policy →
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
//  DASHBOARD nav — updated badge counts for new section keys
//  (WorkflowsSection, ComplianceSection, ToolsSection, TrainingSection,
//   ExecReportSection are UNCHANGED — keep your existing versions of those)
// ─────────────────────────────────────────────────────────────
function Dashboard({ assessment, results, onReset }) {
  const [section, setSection] = useState("overview");

  const policyCount =
    (results?.policiesCore?.policies?.length || 0) +
    (results?.policiesOps?.policies?.length || 0);

  // A client-access demo (prospect) can't open the analyst console, so we give
  // them a "Your vCISO" explainer showing what a human analyst does for them at
  // each stage. Investor demos and normal accounts don't need it.
  const showVciso = isDemoSession() && demoAccessType() === "client";

  const nav = [
    { id:"overview",    icon:"🎯", label:"Overview",          badge:null },
    { id:"priorities",  icon:"📊", label:"Priorities",        badge:results?.priorities?.priorities?.length },
    { id:"policies",    icon:"📄", label:"Policies",          badge:policyCount || null },
    { id:"workflows",   icon:"🔄", label:"Workflows",         badge:results?.workflows?.workflows?.length },
    { id:"compliance",  icon:"✅", label:"Compliance",        badge:results?.compliance?.frameworks?.length },
    { id:"remediation", icon:"🛠️", label:"Remediation",       badge:null },
    { id:"evidence",    icon:"📎", label:"Evidence",           badge:null },
    { id:"threats",     icon:"🔍", label:"Threat Intel",      badge:null },
    ...(showVciso ? [{ id:"vciso", icon:"🤝", label:"Your vCISO", badge:null }] : []),
    { id:"tools",       icon:"🔧", label:"Tool Stack",        badge:results?.tools?.toolStack?.length },
    { id:"training",    icon:"🎓", label:"Training",          badge:results?.training?.trainingProgram?.modules?.length },
    { id:"trainingmgr", icon:"👥", label:"Training Program",  badge:null },
    { id:"report",      icon:"📋", label:"Exec Report",       badge:null },
    { id:"reports",     icon:"📑", label:"Reports",           badge:null },
    { id:"library",     icon:"📚", label:"Policy Library",    badge:null },
  ];

  const sectionMap = {
    overview:   <OverviewSection assessment={assessment} results={results}/>,
    priorities: <PrioritiesSection results={results}/>,
    policies:   <PoliciesSection results={results}/>,
    workflows:  <WorkflowsSection results={results}/>,
    // The live compliance engine, not the AI's prose. ComplianceSection rendered
    // `results.compliance.frameworks` — text generated during program creation —
    // while 624 computed, cited controls sat unused on the server. This reads
    // /api/compliance/* directly, so what a client sees is what the deterministic
    // engine actually concluded from their answers.
    compliance: <ComplianceWorkspace authFetch={authFetch} apiBase={API_BASE}/>,
    remediation: <RemediationSection/>,
    evidence:    <EvidenceSection/>,
    vciso:       <VirtualCISOSection/>,
    threats:    <ThreatIntelSection results={results}/>,
    tools:      <ToolsSection results={results}/>,
    training:   <TrainingSection results={results} assessment={assessment}/>,
    trainingmgr: <TrainingProgramSection/>,
    report:     <ExecReportSection assessment={assessment} results={results}/>,
    reports:    <ReportsSection/>,
    library:    <PolicyLibrarySection assessment={assessment}/>,
  };


  return (
    <div style={{display:"flex",height:"100vh",background:C.bg,
      fontFamily:"Inter,system-ui,sans-serif",color:C.text}}>

      {/* Sidebar */}
      <div style={{width:220,flexShrink:0,background:C.surface,borderRight:`1px solid ${C.border}`,
        display:"flex",flexDirection:"column",overflowY:"auto"}}>
        <div style={{padding:"18px 16px 14px",borderBottom:`1px solid ${C.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
            <ShieldLockup logoSize={20} textSize={15} ink={C.text}/>
          </div>
          <div style={{fontSize:10,color:C.textMut,letterSpacing:1.5}}>VIRTUAL CISO PLATFORM</div>
        </div>

        <div style={{padding:"12px 14px",borderBottom:`1px solid ${C.border}`}}>
          <div style={{fontSize:10,color:C.textMut,letterSpacing:1.5,marginBottom:8}}>AI ENGINES</div>
          {Object.values(AI_MODELS).map(m=>(
            <div key={m.id} style={{display:"flex",alignItems:"center",gap:7,marginBottom:5}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:C.green}}/>
              <span style={{fontSize:11,color:m.color}}>{m.label.split(" ")[0]}</span>
            </div>
          ))}
        </div>

        <div style={{padding:"10px 6px",flex:1}}>
          {nav.map(n=>(
            <NavTab key={n.id} label={n.label} icon={n.icon}
              active={section===n.id} badge={n.badge}
              onClick={()=>setSection(n.id)}/>
          ))}
        </div>

        <div style={{padding:"12px 14px",borderTop:`1px solid ${C.border}`}}>
          <button onClick={onReset}
            style={{width:"100%",padding:"8px",background:"none",
              border:`1px solid ${C.border}`,borderRadius:6,
              color:C.textSec,fontSize:12,cursor:"pointer"}}>
            ↩ New Assessment
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{flex:1,overflowY:"auto",padding:"24px",display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",marginBottom:16}}>
          <NotificationBell onNavigate={setSection}/>
        </div>
        {sectionMap[section]}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  LANDING PAGE
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
//  MARKETING FRONT PAGE  (public-facing)
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
//  BRAND  — official ShieldAI logo (shield + neural node) & wordmark
// ─────────────────────────────────────────────────────────────
function ShieldLogo({ size = 28, glow = false }) {
  return (
    <svg viewBox="0 0 64 80" width={size} height={size * (80/64)}
      style={{ display:"block", filter: glow ? "drop-shadow(0 0 8px rgba(0,229,255,0.5))" : "none" }}>
      <defs>
        <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0EA5E9"/>
          <stop offset="100%" stopColor="#0284C7"/>
        </linearGradient>
      </defs>
      <path d="M32 4 L56 14 L56 38 C56 56 42 68 32 76 C22 68 8 56 8 38 L8 14 Z" fill="url(#shieldGrad)"/>
      <path d="M32 4 L56 14 L56 38 C56 56 42 68 32 76 L32 4 Z" fill="#00E5FF" opacity="0.2"/>
      <path d="M22 28 L32 38 L42 28 M32 38 L32 54" stroke="#FFFFFF" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="22" cy="28" r="3.5" fill="#FFFFFF"/>
      <circle cx="42" cy="28" r="3.5" fill="#FFFFFF"/>
      <circle cx="32" cy="54" r="3.5" fill="#FFFFFF"/>
      <circle cx="32" cy="38" r="4.5" fill="#00E5FF"/>
      <circle cx="32" cy="38" r="2" fill="#FFFFFF"/>
    </svg>
  );
}

// Wordmark: "Shield" in the current ink color + "AI" in brand cyan
function ShieldWordmark({ size = 18, ink = "#FFFFFF" }) {
  const brand = useBranding();
  // Custom brand: render the product name in one ink color (no "AI" accent
  // split, which is ShieldAI-specific). Default brand keeps the Shield+AI look.
  if (brand && !brand.isDefault && brand.productName && brand.productName !== "ShieldAI") {
    return (
      <span style={{ fontWeight:800, fontSize:size, letterSpacing:-0.3, lineHeight:1, color: ink }}>
        {brand.productName}
      </span>
    );
  }
  return (
    <span style={{ fontWeight:800, fontSize:size, letterSpacing:-0.3, lineHeight:1 }}>
      <span style={{ color: ink }}>Shield</span>
      <span style={{ color: "#00C8FF" }}>AI</span>
    </span>
  );
}

// Logo + wordmark lockup
function ShieldLockup({ logoSize = 28, textSize = 18, ink = "#FFFFFF", gap = 10, glow = false }) {
  const brand = useBranding();
  const customLogo = brand && !brand.isDefault && brand.logoUrl;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap }}>
      {customLogo
        ? <img src={brand.logoUrl} alt="" style={{ height:logoSize, maxWidth:logoSize*4, objectFit:"contain" }}/>
        : <ShieldLogo size={logoSize} glow={glow}/>}
      <ShieldWordmark size={textSize} ink={ink}/>
    </span>
  );
}

// A quietly animated "live" dot. Used to signal the product is actually running
// rather than a mockup — the single most important thing the marketing page has
// to convey to an investor.
function LivePulse({ color = C.green, size = 7 }) {
  return (
    <span style={{position:"relative",display:"inline-flex",width:size,height:size,flexShrink:0}}>
      <style>{`@keyframes shieldai-ping{75%,100%{transform:scale(2.4);opacity:0}}`}</style>
      <span style={{position:"absolute",inset:0,borderRadius:"50%",background:color,opacity:0.65,
        animation:"shieldai-ping 2s cubic-bezier(0,0,0.2,1) infinite"}}/>
      <span style={{position:"relative",width:size,height:size,borderRadius:"50%",background:color}}/>
    </span>
  );
}

// Persistent, unmissable marker that the user is in the sandbox. Without this,
// a visitor could mistake seeded sample companies for real client data.
function DemoBanner({ onExit }) {
  return (
    <div style={{position:"sticky",top:0,zIndex:9999,display:"flex",alignItems:"center",
      justifyContent:"center",gap:14,flexWrap:"wrap",padding:"9px 16px",
      background:"linear-gradient(90deg,#7C3AED,#4F46E5)",color:"#fff",
      fontSize:13,fontWeight:600,letterSpacing:0.2}}>
      <span>
        DEMO SANDBOX — everything works, but the data is sample data and your changes
        are discarded when you leave. Nothing here is a real client.
      </span>
      <button onClick={onExit}
        style={{padding:"4px 12px",background:"rgba(255,255,255,0.16)",
          border:"1px solid rgba(255,255,255,0.4)",borderRadius:6,color:"#fff",
          fontSize:12,fontWeight:700,cursor:"pointer"}}>
        Exit demo
      </button>
    </div>
  );
}

// ── Investor landing page ──
// A tailored entry point for investors: the diligence materials (pitch deck,
// business plan, market analysis, executive summary, demo video) plus a request
// form that lands in leads tagged as an investor request. On approval the admin
// issues an investor access code, which unlocks the full product tour (client +
// analyst views). Documents are served from Vite's /public dir; a doc that
// hasn't been published yet shows as "available on request" rather than a dead
// link.

// Flip to true once /investor/ShieldAI_Demo.mp4 and /investor/demo-poster.jpg
// exist in the public folder. Keeps the page from rendering a broken player.
const DEMO_VIDEO_READY = false;

const INVESTOR_DOCS = [
  { key:"pitch",   icon:"📊", title:"Pitch Deck",         desc:"The 12-slide investor deck — problem, product, market, traction, ask.", href:"/investor/ShieldAI_Pitch_Deck.pdf" },
  { key:"plan",    icon:"📈", title:"Business Plan",       desc:"Full 2026 business plan: strategy, go-to-market, financial model, milestones.", href:"/investor/ShieldAI_Business_Plan.pdf" },
  { key:"market",  icon:"🌐", title:"Market Analysis",     desc:"TAM/SAM/SOM for the SMB vCISO market and competitive landscape.", href:"/investor/ShieldAI_Market_Analysis.pdf" },
  { key:"summary", icon:"📄", title:"Executive Summary",   desc:"A two-page overview of the company, product, and opportunity.", href:"/investor/ShieldAI_Executive_Summary.pdf" },
];

function InvestorPage({ onBack, onOpenCode }) {
  const [form, setForm] = useState({ name:"", email:"", company:"", role:"", message:"" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim());
    if (!form.name.trim() || !emailOk) {
      setErr("Please enter your name and a valid email."); return;
    }
    setSubmitting(true); setErr(null);
    try {
      // Reuse the public leads endpoint; tag the request as investor so it's
      // triaged correctly in the admin leads view.
      const res = await fetch(`${API_BASE}/api/leads`, {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          name: form.name, email: form.email, company: form.company,
          employees: "", // n/a for investors
          message: `[INVESTOR ACCESS REQUEST]${form.role?` Role: ${form.role}.`:""} ${form.message}`.trim(),
        }),
      });
      if (!res.ok) throw new Error("Submission failed");
      setSubmitted(true);
    } catch { setErr("Something went wrong. Please try again."); }
    finally { setSubmitting(false); }
  }

  const ink = C.text, dim = C.textSec, line = C.border, cyan = C.accent, deep = C.bg;
  const field = { width:"100%", padding:"11px 13px", background:C.bg, border:`1px solid ${line}`,
    borderRadius:9, color:ink, fontSize:14, boxSizing:"border-box", marginBottom:11,
    fontFamily:"inherit" };

  return (
    <div style={{minHeight:"100vh",background:deep,color:ink,fontFamily:"Inter,system-ui,sans-serif"}}>
      {/* Nav */}
      <div style={{borderBottom:`1px solid ${line}`,position:"sticky",top:0,zIndex:20,
        background:`${deep}EE`,backdropFilter:"blur(10px)"}}>
        <div style={{maxWidth:1080,margin:"0 auto",padding:"14px 24px",display:"flex",alignItems:"center",gap:12}}>
          <ShieldLockup logoSize={26} textSize={18} ink={ink}/>
          <span style={{fontSize:11,color:cyan,marginLeft:4,letterSpacing:1,fontWeight:700}}>INVESTORS</span>
          <div style={{marginLeft:"auto",display:"flex",gap:12,alignItems:"center"}}>
            <button onClick={onBack} style={{background:"none",border:"none",color:dim,fontSize:13,
              cursor:"pointer",fontFamily:"inherit"}}>← Back to site</button>
            <button onClick={onOpenCode} style={{padding:"8px 16px",background:"none",
              border:`1px solid ${cyan}66`,borderRadius:8,color:cyan,fontSize:13,fontWeight:600,cursor:"pointer"}}>
              I have an access code
            </button>
          </div>
        </div>
      </div>

      <div style={{maxWidth:1080,margin:"0 auto",padding:"48px 24px 80px"}}>
        {/* Hero */}
        <div style={{display:"inline-flex",alignItems:"center",gap:9,padding:"6px 15px",borderRadius:20,
          background:`${C.green}12`,border:`1px solid ${C.green}38`,color:C.green,
          fontSize:12,fontWeight:600,marginBottom:22}}>
          <LivePulse/> Live in production · real customers, real data
        </div>
        <h1 style={{fontSize:44,fontWeight:800,lineHeight:1.1,letterSpacing:-1.2,margin:"0 0 18px",maxWidth:760}}>
          The vCISO platform, built and running — not a pitch for one.
        </h1>
        <p style={{fontSize:17,color:dim,lineHeight:1.6,maxWidth:640,margin:"0 0 30px"}}>
          ShieldAI delivers full security-program management, AI-assisted advisory, real threat
          intelligence, and compliance tracking to the SMB market that can't afford a $200k CISO.
          Review the materials below, then request access to explore the live product yourself.
        </p>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:8}}>
          <button onClick={()=>document.getElementById("inv-request")?.scrollIntoView({behavior:"smooth"})}
            style={{padding:"13px 26px",background:cyan,color:deep,border:"none",borderRadius:10,
              fontSize:15,fontWeight:700,cursor:"pointer",boxShadow:`0 0 40px ${cyan}44`}}>
            Request demo access
          </button>
          <button onClick={onOpenCode}
            style={{padding:"13px 26px",background:"none",border:`1px solid ${line}`,borderRadius:10,
              color:ink,fontSize:15,fontWeight:600,cursor:"pointer"}}>
            Enter with a code →
          </button>
        </div>

        {/* Traction strip */}
        <div style={{display:"flex",gap:28,flexWrap:"wrap",margin:"40px 0 12px",
          padding:"22px 28px",background:C.card,border:`1px solid ${line}`,borderRadius:16}}>
          {[["$200k","Cost of the CISO we replace"],["6","Compliance frameworks live"],
            ["100%","Real threat data — zero fabrication"],["2","Hard product boundaries by design"]].map(([n,l],i)=>(
            <div key={i} style={{flex:"1 1 160px"}}>
              <div style={{fontSize:30,fontWeight:800,color:cyan,lineHeight:1}}>{n}</div>
              <div style={{fontSize:12,color:dim,marginTop:5,lineHeight:1.4}}>{l}</div>
            </div>
          ))}
        </div>

        {/* Documents */}
        <h2 style={{fontSize:24,fontWeight:800,margin:"50px 0 6px"}}>Diligence materials</h2>
        <p style={{fontSize:14,color:dim,margin:"0 0 22px"}}>
          Open a document to view it. Anything not yet published here is available on request with your access approval.
        </p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:14,marginBottom:14}}>
          {INVESTOR_DOCS.map(d => (
            <a key={d.key} href={d.href} target="_blank" rel="noreferrer"
              style={{display:"block",padding:"18px 20px",background:C.card,border:`1px solid ${line}`,
                borderRadius:14,textDecoration:"none",color:ink,transition:"border-color .2s"}}>
              <div style={{fontSize:26,marginBottom:10}}>{d.icon}</div>
              <div style={{fontSize:15,fontWeight:700,marginBottom:5}}>{d.title}</div>
              <div style={{fontSize:12.5,color:dim,lineHeight:1.5}}>{d.desc}</div>
              <div style={{fontSize:12,color:cyan,fontWeight:600,marginTop:12}}>Open →</div>
            </a>
          ))}
        </div>

        {/* Demo video — flip DEMO_VIDEO_READY to true once the mp4 + poster are
            in public/investor/. Until then we show a placeholder that routes to
            the live hands-on demo instead of a broken player. */}
        <h2 style={{fontSize:24,fontWeight:800,margin:"50px 0 18px"}}>Product walkthrough</h2>
        {DEMO_VIDEO_READY ? (
          <div style={{background:C.card,border:`1px solid ${line}`,borderRadius:16,overflow:"hidden"}}>
            <div style={{position:"relative",width:"100%",paddingTop:"56.25%",background:"#000"}}>
              <video controls preload="metadata" poster="/investor/demo-poster.jpg"
                style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"contain",background:"#000"}}>
                <source src="/investor/ShieldAI_Demo.mp4" type="video/mp4"/>
              </video>
            </div>
            <div style={{padding:"14px 20px",fontSize:12.5,color:dim}}>
              A guided tour of the live platform. Prefer to drive it yourself? Request access below for a
              hands-on sandbox with both the client and analyst consoles.
            </div>
          </div>
        ) : (
          <div style={{background:C.card,border:`1px solid ${line}`,borderRadius:16,padding:"40px 32px",
            textAlign:"center"}}>
            <div style={{fontSize:34,marginBottom:12}}>🎥</div>
            <div style={{fontSize:17,fontWeight:700,color:ink,marginBottom:8}}>
              A recorded walkthrough is on the way.
            </div>
            <p style={{fontSize:14,color:dim,lineHeight:1.6,maxWidth:520,margin:"0 auto 20px"}}>
              In the meantime, the best walkthrough is the product itself. Request access below and
              you'll get a hands-on sandbox with both the client and analyst consoles.
            </p>
            <button onClick={()=>document.getElementById("inv-request")?.scrollIntoView({behavior:"smooth"})}
              style={{padding:"11px 22px",background:cyan,color:deep,border:"none",borderRadius:9,
                fontSize:14,fontWeight:700,cursor:"pointer"}}>
              Request demo access
            </button>
          </div>
        )}

        {/* Request form */}
        <div id="inv-request" style={{position:"relative",top:-70}}/>
        <h2 style={{fontSize:24,fontWeight:800,margin:"50px 0 6px"}}>Request demo access</h2>
        <p style={{fontSize:14,color:dim,margin:"0 0 22px",maxWidth:640}}>
          Tell us who you are. On approval you'll receive an access code that opens the full product —
          both the client experience and the analyst console — no account or password required.
        </p>

        {submitted ? (
          <div style={{padding:"26px",background:`${C.green}12`,border:`1px solid ${C.green}44`,
            borderRadius:14,maxWidth:560}}>
            <div style={{fontSize:17,fontWeight:700,color:C.green,marginBottom:8}}>Request received</div>
            <p style={{fontSize:14,color:dim,lineHeight:1.6,margin:0}}>
              Thanks — your request is in our queue. Once approved, we'll email you an access code you can
              enter from the button in the top bar. It's the only credential you'll need, and it stays valid
              for 96 hours so you can explore at your own pace.
            </p>
          </div>
        ) : (
          <div style={{maxWidth:560,background:C.card,border:`1px solid ${line}`,borderRadius:14,padding:"24px"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11}}>
              <input style={field} placeholder="Full name *" value={form.name}
                onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
              <input style={field} placeholder="Work email *" value={form.email}
                onChange={e=>setForm(f=>({...f,email:e.target.value}))}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11}}>
              <input style={field} placeholder="Firm / fund" value={form.company}
                onChange={e=>setForm(f=>({...f,company:e.target.value}))}/>
              <input style={field} placeholder="Role (e.g. Partner)" value={form.role}
                onChange={e=>setForm(f=>({...f,role:e.target.value}))}/>
            </div>
            <textarea style={{...field,minHeight:84,resize:"vertical"}} placeholder="Anything you'd like us to know (optional)"
              value={form.message} onChange={e=>setForm(f=>({...f,message:e.target.value}))}/>
            {err && <p style={{fontSize:13,color:"#F87171",margin:"0 0 10px"}}>{err}</p>}
            <button onClick={submit} disabled={submitting}
              style={{padding:"13px 26px",background:cyan,color:deep,border:"none",borderRadius:10,
                fontSize:15,fontWeight:700,cursor:submitting?"default":"pointer",opacity:submitting?0.6:1}}>
              {submitting ? "Submitting…" : "Request access"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  LEARNER PAGE — the public, token-gated employee training experience.
//  No login: the employee opens /train/<token>. They see assigned training,
//  work through each module's objectives, and mark it complete (with a short
//  self-check). Talks only to the public /api/train/:token endpoints.
// ─────────────────────────────────────────────────────────────
function LearnerPage({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openMod, setOpenMod] = useState(null); // { assignmentId, topicId }
  const [busy, setBusy] = useState(false);

  const ink = C.text, dim = C.textSec, line = C.border, cyan = C.accent, deep = C.bg;

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/train/${encodeURIComponent(token)}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "This training link isn't valid.");
      setData(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [token]);

  async function complete(assignmentId, topicId, score) {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/train/${encodeURIComponent(token)}/complete`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId, topicId, score }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save your progress.");
      setOpenMod(null);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{minHeight:"100vh",background:deep,color:ink,fontFamily:"Inter,system-ui,sans-serif"}}>
      <div style={{borderBottom:`1px solid ${line}`,padding:"16px 24px"}}>
        <div style={{maxWidth:760,margin:"0 auto",display:"flex",alignItems:"center",gap:12}}>
          <ShieldLockup logoSize={26} textSize={18} ink={ink}/>
          <span style={{fontSize:11,color:dim,marginLeft:4,letterSpacing:1,fontWeight:600}}>SECURITY TRAINING</span>
        </div>
      </div>

      <div style={{maxWidth:760,margin:"0 auto",padding:"36px 24px 80px"}}>
        {loading ? <Spinner/> : error ? (
          <div style={{padding:"26px",background:`${C.red}12`,border:`1px solid ${C.red}40`,
            borderRadius:14,color:C.red,fontSize:14}}>{error}</div>
        ) : (
          <>
            <h1 style={{fontSize:26,fontWeight:800,margin:"0 0 6px"}}>
              Welcome{data?.learner?.name ? `, ${data.learner.name.split(" ")[0]}` : ""}.
            </h1>
            <p style={{fontSize:14.5,color:dim,lineHeight:1.6,margin:"0 0 28px"}}>
              Here's your assigned security training. Work through each module and mark it complete.
              Your progress is saved automatically.
            </p>

            {(data?.assignments || []).length === 0 ? (
              <div style={{padding:"24px",background:C.card,border:`1px solid ${line}`,borderRadius:14,
                color:dim,fontSize:14}}>You have no training assigned right now. Nice — you're all caught up.</div>
            ) : (data.assignments || []).map(a => (
              <div key={a.assignmentId} style={{marginBottom:20,background:C.card,
                border:`1px solid ${line}`,borderRadius:16,overflow:"hidden"}}>
                <div style={{padding:"16px 20px",borderBottom:`1px solid ${line}`,
                  display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:15,fontWeight:700}}>{a.title}</div>
                    {a.dueDate && <div style={{fontSize:12,color:dim,marginTop:2}}>Due {new Date(a.dueDate).toLocaleDateString()}</div>}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:80,height:7,borderRadius:6,background:deep,overflow:"hidden"}}>
                      <div style={{width:`${a.progress}%`,height:"100%",
                        background:a.status==="completed"?C.green:cyan}}/>
                    </div>
                    <span style={{fontSize:12,fontWeight:700,
                      color:a.status==="completed"?C.green:cyan}}>{a.progress}%</span>
                  </div>
                </div>
                <div style={{padding:"8px 12px"}}>
                  {a.modules.map(m => {
                    const isOpen = openMod?.assignmentId === a.assignmentId && openMod?.topicId === m.topicId;
                    return (
                      <div key={m.topicId} style={{margin:"6px 0"}}>
                        <div onClick={()=>setOpenMod(isOpen?null:{assignmentId:a.assignmentId,topicId:m.topicId})}
                          style={{display:"flex",alignItems:"center",gap:12,padding:"12px 12px",cursor:"pointer",
                            background:isOpen?deep:"transparent",borderRadius:10}}>
                          <span style={{width:24,height:24,borderRadius:"50%",flexShrink:0,display:"flex",
                            alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,
                            background:m.completed?C.green:`${cyan}22`,color:m.completed?"#04121F":cyan}}>
                            {m.completed ? "✓" : ""}
                          </span>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13.5,fontWeight:600,color:ink}}>{m.title}</div>
                            <div style={{fontSize:11,color:dim}}>{m.audience} · {m.duration}</div>
                          </div>
                          {m.completed && m.score != null && (
                            <span style={{fontSize:11,color:C.green,fontWeight:600}}>Score {m.score}%</span>
                          )}
                          <span style={{color:dim,fontSize:12}}>{isOpen?"▲":"▼"}</span>
                        </div>
                        {isOpen && (
                          <LearnerModule module={m} busy={busy}
                            onComplete={(score)=>complete(a.assignmentId, m.topicId, score)}/>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
        <div style={{marginTop:30,textAlign:"center",fontSize:11,color:C.textMut}}>
          Powered by ShieldAI · Your progress is private to your organization.
        </div>
      </div>
    </div>
  );
}

// A single module: objectives + a one-question knowledge check → mark complete.
function LearnerModule({ module, onComplete, busy }) {
  const [answered, setAnswered] = useState(module.completed);
  const line = C.border, dim = C.textSec, cyan = C.accent, deep = C.bg;

  return (
    <div style={{padding:"6px 12px 16px 48px"}}>
      {module.source && (
        <div style={{fontSize:11,color:C.textMut,marginBottom:10}}>Source: {module.source}</div>
      )}
      <div style={{fontSize:11,color:C.textMut,letterSpacing:1,fontWeight:600,marginBottom:8}}>
        WHAT YOU'LL LEARN
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:18}}>
        {(module.objectives || []).map((o,i)=>(
          <div key={i} style={{display:"flex",gap:9,fontSize:13,color:C.text,lineHeight:1.5}}>
            <span style={{color:cyan,flexShrink:0}}>›</span>{o}
          </div>
        ))}
        {(!module.objectives || module.objectives.length === 0) && (
          <div style={{fontSize:13,color:dim}}>Review this topic and confirm you understand the key practices.</div>
        )}
      </div>

      {module.completed ? (
        <div style={{fontSize:12.5,color:C.green,fontWeight:600}}>
          ✓ Completed{module.completedAt ? ` on ${new Date(module.completedAt).toLocaleDateString()}` : ""}
        </div>
      ) : (
        <div style={{padding:"14px 16px",background:deep,borderRadius:10,border:`1px solid ${line}`}}>
          <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:10}}>
            Knowledge check: Confirm you've reviewed and understand the objectives above.
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <button onClick={()=>onComplete(100)} disabled={busy}
              style={{padding:"10px 18px",borderRadius:8,border:"none",background:cyan,color:deep,
                fontSize:13,fontWeight:700,cursor:busy?"default":"pointer",opacity:busy?0.6:1}}>
              {busy ? "Saving…" : "I understand — mark complete"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Access-code entry. The code is the only credential a demo visitor needs;
// redeeming it drops them into the correct scoped sandbox (investor vs client).
function AccessCodeModal({ onClose, onRedeem }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    const c = code.trim();
    if (!c) { setErr("Enter your access code."); return; }
    setBusy(true); setErr(null);
    try { await onRedeem(c); }              // on success the app navigates away
    catch (e) { setErr(e.message || "That code isn't valid."); setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(4,10,20,0.72)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:420,background:C.card,
        border:`1px solid ${C.borderHi}`,borderRadius:16,padding:"28px 26px",
        boxShadow:"0 24px 70px rgba(0,0,0,0.55)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
          <ShieldLogo size={26}/>
          <span style={{fontSize:17,fontWeight:800,color:C.text}}>Enter the demo</span>
        </div>
        <p style={{fontSize:13,color:C.textSec,lineHeight:1.6,margin:"0 0 18px"}}>
          Paste the access code from your approval email. It's the only credential you need —
          no account, no password.
        </p>
        <input autoFocus value={code} onChange={e=>setCode(e.target.value.toUpperCase())}
          onKeyDown={e=>{ if(e.key==="Enter") submit(); }}
          placeholder="SHLD-XXXX-XXXX"
          style={{width:"100%",padding:"12px 14px",background:C.bg,border:`1px solid ${C.border}`,
            borderRadius:10,color:C.text,fontSize:16,letterSpacing:1.5,textAlign:"center",
            boxSizing:"border-box",fontFamily:"ui-monospace,SFMono-Regular,Menlo,monospace"}}/>
        {err && <p style={{fontSize:12.5,color:"#F87171",margin:"10px 0 0"}}>{err}</p>}
        <div style={{display:"flex",gap:10,marginTop:20}}>
          <button onClick={submit} disabled={busy}
            style={{flex:1,padding:"12px",borderRadius:10,border:"none",background:C.accent,
              color:C.bg,fontSize:14,fontWeight:700,cursor:busy?"default":"pointer",opacity:busy?0.6:1}}>
            {busy ? "Verifying…" : "Enter demo"}
          </button>
          <button onClick={onClose} disabled={busy}
            style={{padding:"12px 18px",borderRadius:10,border:`1px solid ${C.border}`,
              background:"none",color:C.textSec,fontSize:14,cursor:"pointer"}}>
            Cancel
          </button>
        </div>
        <p style={{fontSize:11.5,color:C.textMut,margin:"16px 0 0",lineHeight:1.6,textAlign:"center"}}>
          Don't have a code? Request access from the Investors page or the contact form below.
        </p>
      </div>
    </div>
  );
}

function MarketingPage({ onEnterApp, onLogin, onStartDemo, onRedeemCode, onOpenInvestor,
                        openCodeEntry, onCodeEntryOpened }) {
  const [form, setForm] = useState({ name: "", email: "", company: "", employees: "", message: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formErr, setFormErr] = useState(null);
  const [demoState, setDemoState] = useState({ seeded: null, personas: [] });
  const [demoBusy, setDemoBusy] = useState(null);
  const [demoErr, setDemoErr] = useState(null);
  const [showCodeEntry, setShowCodeEntry] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

  // Returning from the investor page's "I have a code" button opens the modal.
  useEffect(() => {
    if (openCodeEntry) { setShowCodeEntry(true); onCodeEntryOpened && onCodeEntryOpened(); }
  }, [openCodeEntry]);

  // Ask the backend whether the sandbox is seeded before offering the button —
  // better to hide the entry point than to hand someone a broken demo.
  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/demo/status`)
      .then(r => r.json())
      .then(d => { if (alive && d && Array.isArray(d.personas)) setDemoState({ seeded: !!d.seeded, personas: d.personas }); })
      .catch(() => { if (alive) setDemoState({ seeded: false, personas: [] }); });
    return () => { alive = false; };
  }, []);

  async function enterDemo(persona) {
    setDemoBusy(persona); setDemoErr(null);
    try { await onStartDemo(persona); }
    catch (e) { setDemoErr(e.message || "Could not start the demo."); }
    finally { setDemoBusy(null); }
  }

  async function submitLead() {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim());
    if (!form.name.trim()) { setFormErr("Please enter your name."); return; }
    if (!emailOk) { setFormErr("Please enter a valid work email address."); return; }
    setSubmitting(true); setFormErr(null);
    try {
      const res = await fetch(`${API_BASE}/api/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Submission failed");
      setSubmitted(true);
    } catch (e) {
      setFormErr("Something went wrong. Please try again.");
    } finally { setSubmitting(false); }
  }

  const ink = C.text, dim = C.textSec, line = C.border, cyan = C.accent, deep = C.bg;
  const navy = "#0A1428";

  const Eyebrow = ({ children }) => (
    <div style={{fontSize:12,fontWeight:700,letterSpacing:2,textTransform:"uppercase",
      color:cyan,marginBottom:14}}>{children}</div>
  );
  const Section = ({ children, style }) => (
    <section style={{maxWidth:1080,margin:"0 auto",padding:"0 24px",...style}}>{children}</section>
  );

  const steps = [
    { n:"01", t:"Assess",  d:"Answer a short, structured assessment about your business and current security posture.",
      out:"Takes about 15 minutes" },
    { n:"02", t:"Score",   d:"A deterministic engine scores you against the NIST Cybersecurity Framework — explainable, not guesswork.",
      out:"Every point traceable to a control" },
    { n:"03", t:"Program", d:"Get a complete security program: policies, roadmap, compliance mapping, and staff training.",
      out:"Documents you can hand to an auditor" },
    { n:"04", t:"Manage",  d:"Our engineers run your program continuously, amplified by AI — for a fraction of a full-time hire.",
      out:"Ongoing, not a one-time report" },
  ];

  const tiers = [
    { name:"Self-Serve", tag:"Get started", price:"Free to start", points:["Automated assessment & NIST score","Full security program & policies","Generate and download documents"], cta:"Start free" },
    { name:"Guided", tag:"Most popular", featured:true, price:"Contact for pricing", points:["Everything in Self-Serve","Periodic expert review","Compliance tracking & check-ins"], cta:"Contact us" },
    { name:"Managed vCISO", tag:"Full service", price:"Below a human-only firm", points:["A dedicated security engineer","Runs your program end-to-end","Below the cost of human-only firms"], cta:"Contact us" },
  ];

  const trust = ["NIST Cybersecurity Framework","CISA Guidance","HIPAA","SOC 2","CMMC","PCI-DSS"];

  return (
    <div className="mkt-root" style={{background:deep,color:ink,fontFamily:"Inter,system-ui,sans-serif",minHeight:"100vh"}}>
      {/* Responsive rules — this page is otherwise all inline styles, so a small
          scoped stylesheet handles the breakpoints inline styles can't. */}
      <style>{`
        .mkt-nav-links { display:flex; gap:14px; align-items:center; margin-left:auto; }
        .mkt-nav-toggle { display:none; margin-left:auto; background:none; border:1px solid ${line};
          border-radius:8px; color:${ink}; width:38px; height:38px; cursor:pointer; font-size:16px; }
        .mkt-mobile-menu { display:none; }
        .mkt-hero-h1 { font-size:52px; }
        .mkt-hero-sub { font-size:18px; }
        @media (max-width: 720px) {
          .mkt-nav-links { display:none; }
          .mkt-nav-links.open { display:flex; }
          .mkt-nav-toggle { display:inline-flex; align-items:center; justify-content:center; }
          .mkt-mobile-menu.open { display:flex; flex-direction:column; gap:4px; padding:8px 24px 16px; }
          .mkt-hero-h1 { font-size:34px; }
          .mkt-hero-sub { font-size:16px; }
          .mkt-cta-row { flex-direction:column; align-items:stretch; }
          .mkt-cta-row > button { width:100%; }
        }
        .mkt-root button:focus-visible, .mkt-root a:focus-visible,
        .mkt-root input:focus-visible, .mkt-root select:focus-visible,
        .mkt-root textarea:focus-visible {
          outline: 2px solid ${cyan}; outline-offset: 2px; border-radius: 6px;
        }
      `}</style>

      {/* NAV */}
      <div style={{borderBottom:`1px solid ${line}`,position:"sticky",top:0,zIndex:20,
        background:`${deep}EE`,backdropFilter:"blur(10px)"}}>
        <div style={{maxWidth:1080,margin:"0 auto",padding:"14px 24px",display:"flex",alignItems:"center",gap:12}}>
          <ShieldLockup logoSize={26} textSize={18} ink={ink}/>
          <span style={{fontSize:11,color:dim,marginLeft:4}}>Virtual CISO</span>
          <div className="mkt-nav-links">
            <a href="#how" style={{color:dim,fontSize:13,textDecoration:"none"}}>How it works</a>
            <a href="#pricing" style={{color:dim,fontSize:13,textDecoration:"none"}}>Pricing</a>
            <button onClick={onOpenInvestor}
              style={{background:"none",border:"none",padding:0,color:cyan,fontSize:13,fontWeight:600,
                cursor:"pointer",fontFamily:"inherit"}}>
              Investors
            </button>
            <a href="#contact" style={{color:dim,fontSize:13,textDecoration:"none"}}>Contact</a>
            <button onClick={onLogin} style={{padding:"8px 16px",background:"none",
              border:`1px solid ${line}`,borderRadius:8,color:ink,fontSize:13,fontWeight:600,cursor:"pointer"}}>
              Client Login
            </button>
          </div>
          <button className="mkt-nav-toggle" aria-label="Menu" onClick={()=>setMobileMenu(o=>!o)}>
            {mobileMenu ? "✕" : "☰"}
          </button>
        </div>
        {/* Mobile dropdown */}
        <div className={`mkt-mobile-menu${mobileMenu?" open":""}`}
          style={{borderTop:`1px solid ${line}`,background:deep}}>
          <a href="#how" onClick={()=>setMobileMenu(false)} style={{color:dim,fontSize:15,textDecoration:"none",padding:"10px 0"}}>How it works</a>
          <a href="#pricing" onClick={()=>setMobileMenu(false)} style={{color:dim,fontSize:15,textDecoration:"none",padding:"10px 0"}}>Pricing</a>
          <button onClick={()=>{setMobileMenu(false);onOpenInvestor();}}
            style={{background:"none",border:"none",padding:"10px 0",color:cyan,fontSize:15,fontWeight:600,textAlign:"left",cursor:"pointer",fontFamily:"inherit"}}>Investors</button>
          <a href="#contact" onClick={()=>setMobileMenu(false)} style={{color:dim,fontSize:15,textDecoration:"none",padding:"10px 0"}}>Contact</a>
          <button onClick={()=>{setMobileMenu(false);onLogin();}}
            style={{marginTop:8,padding:"11px",background:"none",border:`1px solid ${line}`,borderRadius:8,
              color:ink,fontSize:15,fontWeight:600,cursor:"pointer"}}>Client Login</button>
        </div>
      </div>

      {/* HERO */}
      <Section style={{paddingTop:64,paddingBottom:70,textAlign:"center"}}>
        <div style={{display:"flex",justifyContent:"center",marginBottom:28}}>
          <ShieldLogo size={64} glow/>
        </div>
        <div style={{display:"inline-flex",alignItems:"center",gap:9,padding:"6px 15px",borderRadius:20,
          background:`${C.green}12`,border:`1px solid ${C.green}38`,color:C.green,
          fontSize:12,fontWeight:600,marginBottom:24,letterSpacing:0.2}}>
          <LivePulse/>
          Built and running in production today
        </div>
        <h1 className="mkt-hero-h1" style={{fontWeight:800,lineHeight:1.08,letterSpacing:-1.5,margin:"0 0 20px",
          maxWidth:820,marginLeft:"auto",marginRight:"auto"}}>
          The cybersecurity expert<br/>your business is required to have.
        </h1>
        <p className="mkt-hero-sub" style={{color:dim,lineHeight:1.6,maxWidth:640,margin:"0 auto 36px"}}>
          A full-time CISO costs $200,000 a year. ShieldAI delivers the same protection —
          real threat intelligence, prioritized remediation, audit-ready evidence, and compliance
          tracking, with a human analyst in the loop — for the price of a subscription.
        </p>
        <div className="mkt-cta-row" style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
          {/* One primary action — starting the assessment is the strongest
              self-serve hook. Everything else is visually secondary. */}
          <button onClick={onEnterApp}
            style={{padding:"14px 28px",background:`linear-gradient(135deg,${cyan},${C.accentDm})`,
              color:deep,border:"none",borderRadius:10,fontSize:15,fontWeight:700,cursor:"pointer",
              boxShadow:`0 0 40px ${cyan}44`}}>
            Try the assessment →
          </button>
          <button onClick={()=>document.getElementById("contact")?.scrollIntoView({behavior:"smooth"})}
            style={{padding:"14px 28px",background:"none",border:`1px solid ${line}`,
              borderRadius:10,color:ink,fontSize:15,fontWeight:600,cursor:"pointer"}}>
            Request information
          </button>
          {demoState.seeded && (
            <button onClick={()=>setShowCodeEntry(true)}
              style={{padding:"14px 28px",background:"none",border:`1px solid ${cyan}66`,
                borderRadius:10,color:cyan,fontSize:15,fontWeight:600,cursor:"pointer"}}>
              Enter demo with access code →
            </button>
          )}
        </div>
        {demoState.seeded && (
          <div style={{display:"inline-flex",alignItems:"center",gap:10,marginTop:18,padding:"9px 16px",
            borderRadius:10,background:`${C.purple}0E`,border:`1px solid ${C.purple}30`,
            maxWidth:600,textAlign:"left"}}>
            <LivePulse color={C.purple} size={6}/>
            <span style={{fontSize:12.5,color:dim,lineHeight:1.5}}>
              <strong style={{color:C.text,fontWeight:600}}>The demo is access-controlled.</strong>{" "}
              Investors and prospective clients receive a code after requesting access. Your code is
              the only credential you need — it opens a private, isolated sandbox with sample data.
            </span>
          </div>
        )}
        {demoErr && (
          <p style={{fontSize:13,color:"#F87171",marginTop:10}}>{demoErr}</p>
        )}
        {showCodeEntry && (
          <AccessCodeModal
            onClose={()=>setShowCodeEntry(false)}
            onRedeem={onRedeemCode}/>
        )}

        {/* Signature: an inline product preview. Self-contained (no image asset)
            so it can't 404, and it shows the actual dashboard motifs a visitor
            sees inside — posture score, live CVE exposure, remediation gain. */}
        <div style={{marginTop:56,maxWidth:720,marginLeft:"auto",marginRight:"auto",
          background:C.card,border:`1px solid ${line}`,borderRadius:18,overflow:"hidden",
          boxShadow:`0 30px 80px rgba(0,0,0,0.4)`,textAlign:"left"}}>
          {/* Window chrome */}
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"12px 16px",
            borderBottom:`1px solid ${line}`,background:navy}}>
            <span style={{width:10,height:10,borderRadius:"50%",background:"#FF5F57"}}/>
            <span style={{width:10,height:10,borderRadius:"50%",background:"#FEBC2E"}}/>
            <span style={{width:10,height:10,borderRadius:"50%",background:"#28C840"}}/>
            <span style={{marginLeft:10,fontSize:11,color:dim}}>ShieldAI · Security Dashboard</span>
            <span style={{marginLeft:"auto",display:"inline-flex",alignItems:"center",gap:6,
              fontSize:10,color:C.green,fontWeight:600}}><LivePulse size={5}/> LIVE</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:20,padding:"22px 24px"}}>
            {/* Posture ring */}
            <div style={{textAlign:"center"}}>
              <div style={{position:"relative",width:104,height:104}}>
                <svg viewBox="0 0 100 100" width="104" height="104">
                  <circle cx="50" cy="50" r="42" fill="none" stroke={line} strokeWidth="8"/>
                  <circle cx="50" cy="50" r="42" fill="none" stroke={C.green} strokeWidth="8"
                    strokeLinecap="round" strokeDasharray={`${2*Math.PI*42*0.91} ${2*Math.PI*42}`}
                    transform="rotate(-90 50 50)"/>
                </svg>
                <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",
                  alignItems:"center",justifyContent:"center"}}>
                  <span style={{fontSize:30,fontWeight:800,color:C.green,lineHeight:1}}>91</span>
                  <span style={{fontSize:8,color:dim,letterSpacing:1}}>POSTURE</span>
                </div>
              </div>
              <div style={{fontSize:11,color:C.green,fontWeight:600,marginTop:8}}>Strong</div>
            </div>
            {/* Live tiles */}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <div style={{display:"flex",gap:10}}>
                <div style={{flex:1,padding:"10px 12px",background:navy,borderRadius:10,border:`1px solid ${line}`}}>
                  <div style={{fontSize:9,color:dim,letterSpacing:1,marginBottom:4}}>CVE EXPOSURE · NVD</div>
                  <div style={{display:"flex",gap:8,alignItems:"baseline"}}>
                    <span style={{fontSize:18,fontWeight:800,color:C.red}}>3</span>
                    <span style={{fontSize:11,color:dim}}>High</span>
                    <span style={{fontSize:18,fontWeight:800,color:C.amber,marginLeft:6}}>7</span>
                    <span style={{fontSize:11,color:dim}}>Medium</span>
                  </div>
                </div>
                <div style={{flex:1,padding:"10px 12px",background:navy,borderRadius:10,border:`1px solid ${line}`}}>
                  <div style={{fontSize:9,color:dim,letterSpacing:1,marginBottom:4}}>AUDIT COVERAGE</div>
                  <div style={{display:"flex",gap:8,alignItems:"baseline"}}>
                    <span style={{fontSize:18,fontWeight:800,color:C.green}}>86%</span>
                    <span style={{fontSize:11,color:dim}}>evidence on file</span>
                  </div>
                </div>
              </div>
              <div style={{padding:"10px 12px",background:navy,borderRadius:10,border:`1px solid ${line}`,
                display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:9,color:dim,letterSpacing:1}}>TOP FIX</span>
                <span style={{fontSize:12,color:ink,flex:1}}>Enable MFA on remote access</span>
                <span style={{fontSize:12,fontWeight:700,color:C.green}}>+6 posture</span>
              </div>
            </div>
          </div>
          <div style={{padding:"12px 24px",borderTop:`1px solid ${line}`,fontSize:12,color:dim}}>
            Every point traces to a specific control — the evidence insurers and auditors trust.
          </div>
        </div>
      </Section>

      {/* PROBLEM */}
      <div style={{background:navy,borderTop:`1px solid ${line}`,borderBottom:`1px solid ${line}`,padding:"64px 0"}}>
        <Section>
          <Eyebrow>The problem</Eyebrow>
          <h2 style={{fontSize:34,fontWeight:800,letterSpacing:-0.8,margin:"0 0 30px",maxWidth:680}}>
            Too big to ignore security. Too small to afford it.
          </h2>
          <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
            {[
              { stat:"47%", label:"of businesses under 50 employees have no cybersecurity budget at all.", src:"StrongDM, 2025" },
              { stat:"$200K+", label:"per year for a full-time CISO — out of reach for most.", src:"Industry salary benchmarks" },
              { stat:"43%", label:"of all cyberattacks target small businesses.", src:"Verizon DBIR" },
            ].map((b,i)=>(
              <div key={i} style={{flex:"1 1 240px",background:C.card,border:`1px solid ${line}`,
                borderRadius:14,padding:"26px 24px"}}>
                <div style={{fontSize:40,fontWeight:800,color:cyan,lineHeight:1,marginBottom:10}}>{b.stat}</div>
                <div style={{fontSize:14,color:dim,lineHeight:1.5,marginBottom:10}}>{b.label}</div>
                <div style={{fontSize:11,color:C.textMut,letterSpacing:0.3}}>Source: {b.src}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* HOW IT WORKS */}
      <Section style={{paddingTop:72,paddingBottom:72}}>
        <div id="how" style={{position:"relative",top:-70}}/>
        <Eyebrow>How it works</Eyebrow>
        <h2 style={{fontSize:34,fontWeight:800,letterSpacing:-0.8,margin:"0 0 40px",maxWidth:620}}>
          From assessment to managed program in four steps.
        </h2>
        <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
          {steps.map((s,i)=>(
            <div key={i} style={{flex:"1 1 220px",position:"relative",display:"flex",flexDirection:"column",
              padding:"22px 20px 20px",background:C.card,border:`1px solid ${line}`,borderRadius:14}}>
              {/* Step rail — a thin accent that fades along the sequence */}
              <div style={{position:"absolute",top:0,left:20,right:20,height:2,borderRadius:2,
                background:`linear-gradient(90deg,${cyan}${i===0?"CC":"66"},${cyan}${i===steps.length-1?"22":"55"})`}}/>
              <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:12}}>
                <div style={{width:26,height:26,borderRadius:7,display:"flex",alignItems:"center",
                  justifyContent:"center",background:`${cyan}18`,border:`1px solid ${cyan}33`,
                  fontSize:11,fontWeight:800,color:cyan,letterSpacing:0.5}}>{s.n}</div>
                <div style={{fontSize:17,fontWeight:700}}>{s.t}</div>
              </div>
              <div style={{fontSize:13.5,color:dim,lineHeight:1.6,flex:1}}>{s.d}</div>
              <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${line}`,
                fontSize:11.5,fontWeight:600,color:C.green,letterSpacing:0.2}}>
                {s.out}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* PLATFORM CAPABILITIES — the working feature set, kept honest: these are
          all live in the product, not roadmap. Mirrors what a demo visitor
          actually sees inside the client dashboard. */}
      <div style={{background:navy,borderTop:`1px solid ${line}`,borderBottom:`1px solid ${line}`,padding:"56px 0"}}>
        <Section>
          <Eyebrow>Inside the platform</Eyebrow>
          <h2 style={{fontSize:32,fontWeight:800,letterSpacing:-0.8,margin:"0 0 10px",maxWidth:640}}>
            A complete security program, not a report you file and forget.
          </h2>
          <p style={{fontSize:15,color:dim,lineHeight:1.6,maxWidth:620,margin:"0 0 34px"}}>
            Every capability below is live in the product today — the same views a client or investor
            sees when they enter the demo.
          </p>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14}}>
            {[
              { icon:"🔍", t:"Real threat intelligence",
                d:"Live CVE matching against your actual software via the NVD feed, plus breach exposure from Have I Been Pwned. Real data — nothing fabricated." },
              { icon:"🛠️", t:"Prioritized remediation",
                d:"Gaps ranked by how much each fix moves your NIST posture score. Turn any gap into a tracked task; completing it re-scores you automatically." },
              { icon:"📎", t:"Evidence & audit readiness",
                d:"Attach proof to completed work and see a live audit-coverage score — the evidence insurers and auditors ask for, ready when they do." },
              { icon:"✅", t:"Compliance tracking",
                d:"Six real frameworks with hundreds of controls, mapped to your answers and tracked in a client-facing workspace." },
              { icon:"🔔", t:"Notifications & review",
                d:"When your analyst approves a policy or requests changes, you know immediately — with a direct link to what changed." },
              { icon:"🤝", t:"A human vCISO in the loop",
                d:"AI drafts and monitors; a dedicated analyst reviews and advises at every stage. AI advises, humans act — by design." },
            ].map((f,i)=>(
              <div key={i} style={{padding:"20px 22px",background:C.card,border:`1px solid ${line}`,borderRadius:14}}>
                <div style={{fontSize:26,marginBottom:11}}>{f.icon}</div>
                <div style={{fontSize:15.5,fontWeight:700,marginBottom:7}}>{f.t}</div>
                <div style={{fontSize:13,color:dim,lineHeight:1.6}}>{f.d}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:26,display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:13,color:dim}}>Also available for MSPs:</span>
            <span style={{padding:"5px 12px",borderRadius:20,background:`${cyan}14`,
              border:`1px solid ${cyan}44`,color:cyan,fontSize:12,fontWeight:600}}>White-label branding</span>
            <span style={{padding:"5px 12px",borderRadius:20,background:`${cyan}14`,
              border:`1px solid ${cyan}44`,color:cyan,fontSize:12,fontWeight:600}}>Analyst console with client isolation</span>
            <span style={{padding:"5px 12px",borderRadius:20,background:`${cyan}14`,
              border:`1px solid ${cyan}44`,color:cyan,fontSize:12,fontWeight:600}}>Read-only endpoint monitoring</span>
          </div>
        </Section>
      </div>
      {/* Deliberately does not name model vendors. Naming them invites the
          "you're just a wrapper" objection, and would tie the pitch to
          providers we may swap. The differentiator is the boundary, not the
          brand of the model. */}
      <div style={{background:navy,borderTop:`1px solid ${line}`,borderBottom:`1px solid ${line}`,padding:"52px 0"}}>
        <Section>
          <div style={{display:"flex",gap:40,flexWrap:"wrap",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{flex:"1 1 380px",minWidth:280}}>
              <Eyebrow>The engine</Eyebrow>
              <h2 style={{fontSize:26,fontWeight:800,letterSpacing:-0.5,margin:"0 0 12px",maxWidth:460}}>
                A multi-model engine. Every output human-reviewed.
              </h2>
              <p style={{fontSize:14.5,color:dim,lineHeight:1.65,maxWidth:480,margin:0}}>
                ShieldAI routes each task to the model best suited to it, with automatic
                failover so the platform keeps working when a provider doesn't. The AI
                drafts, maps, and monitors — but it never acts on your systems, and a
                security engineer reviews what reaches you.
              </p>
            </div>
            <div style={{flex:"0 1 380px",minWidth:280,display:"flex",flexDirection:"column",gap:10}}>
              {[
                { t:"AI advises, humans act",
                  d:"The AI is advisory only. It has no ability to change your systems." },
                { t:"Read-only monitoring",
                  d:"Our endpoint agent reports posture. It accepts no inbound commands." },
                { t:"Provider-independent",
                  d:"Multiple engines behind one layer — no single vendor is a dependency." },
              ].map((x,i)=>(
                <div key={i} style={{display:"flex",gap:11,alignItems:"flex-start",padding:"12px 14px",
                  background:C.card,border:`1px solid ${line}`,borderRadius:10}}>
                  <div style={{width:16,height:16,borderRadius:5,flexShrink:0,marginTop:1,
                    background:`${C.green}1A`,border:`1px solid ${C.green}44`,display:"flex",
                    alignItems:"center",justifyContent:"center",fontSize:9,color:C.green,fontWeight:800}}>✓</div>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,marginBottom:3}}>{x.t}</div>
                    <div style={{fontSize:12,color:dim,lineHeight:1.5}}>{x.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>
      </div>

      {/* WHY NOW */}
      <div style={{background:deep,borderTop:`1px solid ${line}`,borderBottom:`1px solid ${line}`,padding:"64px 0"}}>
        <Section>
          <Eyebrow>Why now</Eyebrow>
          <h2 style={{fontSize:34,fontWeight:800,letterSpacing:-0.8,margin:"0 0 16px",maxWidth:680}}>
            You may already be required to have this.
          </h2>
          <p style={{fontSize:16,color:dim,lineHeight:1.6,maxWidth:640,margin:"0 0 30px"}}>
            Security is no longer optional for small businesses — three forces are making it mandatory.
          </p>
          <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
            {[
              { icon:"🛡️", t:"Cyber insurance", d:"Insurers now require proof of controls — MFA, incident response, monitoring — before they'll issue or renew a policy." },
              { icon:"🤝", t:"Customer requirements", d:"Larger customers push security questionnaires down to their vendors. No program can mean no contract." },
              { icon:"⚖️", t:"Regulation", d:"HIPAA, CMMC, the FTC Safeguards Rule and state privacy laws now reach deep into the small-business tier." },
            ].map((b,i)=>(
              <div key={i} style={{flex:"1 1 260px",background:C.card,border:`1px solid ${line}`,borderRadius:14,padding:"24px"}}>
                <div style={{fontSize:24,marginBottom:12}}>{b.icon}</div>
                <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>{b.t}</div>
                <div style={{fontSize:14,color:dim,lineHeight:1.6}}>{b.d}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* PRICING */}
      <Section style={{paddingTop:72,paddingBottom:72}}>
        <div id="pricing" style={{position:"relative",top:-70}}/>
        <Eyebrow>Plans</Eyebrow>
        <h2 style={{fontSize:34,fontWeight:800,letterSpacing:-0.8,margin:"0 0 12px"}}>
          Start self-serve. Grow into a managed program.
        </h2>
        <p style={{fontSize:16,color:dim,margin:"0 0 40px",maxWidth:560}}>
          Three tiers that scale with your needs. Contact us for pricing tailored to your size and obligations.
        </p>
        <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
          {tiers.map((t,i)=>(
            <div key={i} style={{flex:"1 1 280px",background:t.featured?`${cyan}0C`:C.card,
              border:`1px solid ${t.featured?cyan:line}`,borderRadius:16,padding:"28px 26px",position:"relative"}}>
              {t.featured && (
                <div style={{position:"absolute",top:-11,left:26,padding:"3px 12px",borderRadius:20,
                  background:cyan,color:deep,fontSize:11,fontWeight:700}}>{t.tag}</div>
              )}
              <div style={{fontSize:13,color:dim,marginBottom:4}}>{!t.featured && t.tag}</div>
              <div style={{fontSize:22,fontWeight:800,marginBottom:4}}>{t.name}</div>
              <div style={{fontSize:14,color:t.featured?cyan:C.green,fontWeight:600,marginBottom:16}}>{t.price}</div>
              <div style={{display:"flex",flexDirection:"column",gap:11,marginBottom:24}}>
                {t.points.map((p,j)=>(
                  <div key={j} style={{display:"flex",gap:9,fontSize:14,color:dim,lineHeight:1.4}}>
                    <span style={{color:C.green,flexShrink:0}}>✓</span>{p}
                  </div>
                ))}
              </div>
              <button onClick={()=> t.cta==="Start free" ? onEnterApp() : document.getElementById("contact")?.scrollIntoView({behavior:"smooth"})}
                style={{width:"100%",padding:"11px",borderRadius:9,fontSize:14,fontWeight:700,cursor:"pointer",
                  background:t.featured?`linear-gradient(135deg,${cyan},${C.accentDm})`:"none",
                  color:t.featured?deep:ink,border:t.featured?"none":`1px solid ${line}`}}>
                {t.cta}
              </button>
            </div>
          ))}
        </div>
      </Section>

      {/* TRUST */}
      <div style={{borderTop:`1px solid ${line}`,borderBottom:`1px solid ${line}`,padding:"40px 0",background:navy}}>
        <Section>
          <div style={{fontSize:12,color:dim,letterSpacing:1.5,textTransform:"uppercase",textAlign:"center",marginBottom:20}}>
            Built on the standards that matter
          </div>
          <div style={{display:"flex",gap:14,flexWrap:"wrap",justifyContent:"center"}}>
            {trust.map((t,i)=>(
              <div key={i} style={{padding:"8px 18px",border:`1px solid ${line}`,borderRadius:8,
                color:dim,fontSize:13,fontWeight:600}}>{t}</div>
            ))}
          </div>
        </Section>
      </div>

      {/* CONTACT FORM */}
      <Section style={{paddingTop:72,paddingBottom:72}}>
        <div id="contact" style={{position:"relative",top:-70}}/>
        <div style={{display:"flex",gap:48,flexWrap:"wrap",alignItems:"flex-start"}}>
          <div style={{flex:"1 1 320px"}}>
            <Eyebrow>Get in touch</Eyebrow>
            <h2 style={{fontSize:32,fontWeight:800,letterSpacing:-0.8,margin:"0 0 16px"}}>
              See what ShieldAI can do for your business.
            </h2>
            <p style={{fontSize:15,color:dim,lineHeight:1.7,margin:"0 0 24px"}}>
              Tell us a little about your business and we'll show you where you stand and how we can help.
              No pressure, no jargon.
            </p>
            <div style={{fontSize:14,color:dim,lineHeight:2}}>
              <div>✓ A clear picture of your security posture</div>
              <div>✓ Guidance tailored to your industry & obligations</div>
              <div>✓ Pricing matched to your size</div>
            </div>
          </div>

          <div style={{flex:"1 1 360px",background:C.card,border:`1px solid ${line}`,borderRadius:16,padding:"28px"}}>
            {submitted ? (
              <div style={{textAlign:"center",padding:"30px 10px"}}>
                <div style={{fontSize:40,marginBottom:14}}>✓</div>
                <div style={{fontSize:18,fontWeight:700,marginBottom:8}}>Thanks — we'll be in touch.</div>
                <div style={{fontSize:14,color:dim,lineHeight:1.6}}>
                  Your request is in. A member of our team will reach out to {form.email} shortly.
                </div>
              </div>
            ) : (
              <>
                {[
                  { k:"name", label:"Your name", ph:"Jane Smith" },
                  { k:"email", label:"Work email *", ph:"jane@company.com" },
                  { k:"company", label:"Company", ph:"Acme Inc." },
                ].map(f=>(
                  <div key={f.k} style={{marginBottom:14}}>
                    <label style={{display:"block",fontSize:12,color:dim,marginBottom:5}}>{f.label}</label>
                    <input value={form[f.k]} onChange={e=>setForm({...form,[f.k]:e.target.value})}
                      placeholder={f.ph}
                      style={{width:"100%",boxSizing:"border-box",padding:"11px 13px",background:deep,
                        border:`1px solid ${line}`,borderRadius:9,color:ink,fontSize:14,
                        fontFamily:"Inter,system-ui,sans-serif"}}/>
                  </div>
                ))}
                <div style={{marginBottom:14}}>
                  <label style={{display:"block",fontSize:12,color:dim,marginBottom:5}}>Company size</label>
                  <select value={form.employees} onChange={e=>setForm({...form,employees:e.target.value})}
                    style={{width:"100%",boxSizing:"border-box",padding:"11px 13px",background:deep,
                      border:`1px solid ${line}`,borderRadius:9,color:form.employees?ink:dim,fontSize:14}}>
                    <option value="">Select…</option>
                    <option value="1-10">1–10 employees</option>
                    <option value="11-50">11–50 employees</option>
                    <option value="51-200">51–200 employees</option>
                    <option value="200+">200+ employees</option>
                  </select>
                </div>
                <div style={{marginBottom:18}}>
                  <label style={{display:"block",fontSize:12,color:dim,marginBottom:5}}>How can we help?</label>
                  <textarea value={form.message} onChange={e=>setForm({...form,message:e.target.value})}
                    rows={3} placeholder="Tell us about your situation…"
                    style={{width:"100%",boxSizing:"border-box",padding:"11px 13px",background:deep,
                      border:`1px solid ${line}`,borderRadius:9,color:ink,fontSize:14,resize:"vertical",
                      fontFamily:"Inter,system-ui,sans-serif"}}/>
                </div>
                {formErr && <div style={{color:C.red,fontSize:13,marginBottom:12}}>{formErr}</div>}
                <button onClick={submitLead} disabled={submitting}
                  style={{width:"100%",padding:"13px",background:`linear-gradient(135deg,${cyan},${C.accentDm})`,
                    color:deep,border:"none",borderRadius:9,fontSize:15,fontWeight:700,
                    cursor:submitting?"wait":"pointer"}}>
                  {submitting ? "Sending…" : "Request information"}
                </button>
                <div style={{fontSize:11,color:dim,textAlign:"center",marginTop:10}}>
                  We'll only use your details to follow up. No spam.
                </div>
              </>
            )}
          </div>
        </div>
      </Section>

      {/* FOOTER */}
      <div style={{borderTop:`1px solid ${line}`,padding:"32px 0",background:navy}}>
        <Section style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
          <ShieldLockup logoSize={24} textSize={16} ink={ink}/>
          <span style={{fontSize:12,color:dim}}>Virtual CISO for small business</span>
          <div style={{marginLeft:"auto",display:"flex",gap:18,alignItems:"center",flexWrap:"wrap"}}>
            <a href="/legal/privacy.pdf" target="_blank" rel="noreferrer"
              style={{color:dim,fontSize:13,textDecoration:"none"}}>Privacy</a>
            <a href="/legal/terms.pdf" target="_blank" rel="noreferrer"
              style={{color:dim,fontSize:13,textDecoration:"none"}}>Terms</a>
            <button onClick={onOpenInvestor} style={{background:"none",border:"none",color:dim,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Investors</button>
            <button onClick={onLogin} style={{background:"none",border:"none",color:dim,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Client Login</button>
            <span style={{fontSize:12,color:dim}}>© 2026 Xandu Ltd</span>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Landing({ onStart }) {
  const features = [
    { icon:"🤖", title:"Multi-AI Architecture", desc:"Claude handles risk & policy, Gemini powers threat intel, GPT-4o writes executive reports." },
    { icon:"📋", title:"Complete Security Program", desc:"Priorities, policies, workflows, compliance mapping — all in one customized package." },
    { icon:"🔍", title:"Live Threat Intelligence", desc:"Real-time CVE tracking, dark web monitoring, and industry-specific attack vector analysis." },
    { icon:"✅", title:"Compliance Frameworks", desc:"Automatic gap analysis for HIPAA, PCI-DSS, SOC2, GDPR, CMMC, and more." },
    { icon:"🎓", title:"Awareness Training", desc:"AI-generated training modules, phishing simulations, and quizzes for your team." },
    { icon:"📊", title:"Executive Reporting", desc:"Board-ready CISO reports with risk scores, ROI analysis, and prioritized roadmaps." },
  ];

  return (
    <div style={{minHeight:"100vh",background:C.bg,
      fontFamily:"Inter,system-ui,sans-serif",overflowX:"hidden"}}>
      {/* Nav */}
      <div style={{padding:"16px 40px",borderBottom:`1px solid ${C.border}`,
        display:"flex",alignItems:"center",gap:12,background:C.surface}}>
        <ShieldLockup logoSize={22} textSize={16} ink={C.text}/>
        <span style={{fontSize:11,color:C.textSec,letterSpacing:2}}>VIRTUAL CISO</span>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          {Object.values(AI_MODELS).map(m=>(
            <span key={m.id} style={{fontSize:11,color:m.color,
              padding:"3px 10px",borderRadius:20,background:m.color+"15"}}>{m.icon} {m.label.split(" ")[0]}</span>
          ))}
        </div>
      </div>

      {/* Hero */}
      <div style={{maxWidth:900,margin:"0 auto",padding:"80px 40px 60px",textAlign:"center"}}>
        <div style={{display:"inline-block",padding:"6px 18px",borderRadius:20,
          background:`${C.accent}15`,border:`1px solid ${C.accent}33`,
          color:C.accent,fontSize:12,fontWeight:600,letterSpacing:1.5,marginBottom:24}}>
          POWERED BY CLAUDE · GEMINI · GPT-4O
        </div>
        <h1 style={{fontSize:52,fontWeight:800,lineHeight:1.1,margin:"0 0 22px",
          background:`linear-gradient(135deg,${C.text},${C.accent})`,
          WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
          Your AI-Powered<br/>Chief Information Security Officer
        </h1>
        <p style={{fontSize:18,color:C.textSec,lineHeight:1.75,margin:"0 0 40px",maxWidth:620,
          marginLeft:"auto",marginRight:"auto"}}>
          Enterprise-grade cybersecurity programs for small businesses.
          Three AI models working in concert to protect what you've built.
        </p>
        <button onClick={onStart}
          style={{padding:"18px 52px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
            color:C.bg,border:"none",borderRadius:12,fontSize:17,fontWeight:700,
            cursor:"pointer",boxShadow:`0 0 60px ${C.accent}44`,letterSpacing:0.5}}>
          Start Free Assessment →
        </button>
        <div style={{marginTop:14,color:C.textMut,fontSize:13}}>
          No credit card required · 5 minute intake · Full program generated in seconds
        </div>
      </div>

      {/* Features */}
      <div style={{maxWidth:1000,margin:"0 auto",padding:"0 40px 80px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
          {features.map((f,i)=>(
            <div key={i} style={{padding:"22px",background:C.card,
              border:`1px solid ${C.border}`,borderRadius:12}}>
              <div style={{fontSize:28,marginBottom:12}}>{f.icon}</div>
              <div style={{color:C.text,fontWeight:600,fontSize:15,marginBottom:8}}>{f.title}</div>
              <p style={{color:C.textSec,fontSize:13,lineHeight:1.7,margin:0}}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  STRUCTURED SECURITY CHECKLIST
// ─────────────────────────────────────────────────────────────
// Fallback only — the real checklist comes from GET /api/tasks/controls.
//
// This was a hardcoded duplicate of the backend's securityChecklist.js, frozen
// at the original 13 scoring questions. The backend now has 35: those 13 plus 22
// evidence-only questions covering access reviews, encryption, vendor diligence,
// media disposal, physical security, and privacy rights.
//
// Those 22 are what make ISO's cryptography controls assessable, what let State
// Privacy exist at all, and what the agent corroborates against. They unlocked
// +187 controls across the frameworks — and none of it mattered, because this
// list is what the client actually sees, and it never asked them.
//
// A duplicated catalogue in the frontend silently rots the moment the backend
// moves. useSecurityChecklist() fetches the live set; this array renders only if
// that request fails.
const SECURITY_CHECKLIST_FALLBACK = [
  { id:"mfa", nistFunction:"Protect", question:"Does your organization use multi-factor authentication (MFA)?",
    options:["Yes, required on all accounts","Yes, but only on some accounts (e.g., admin)","No, but planning to add it","No / not sure"] },
  { id:"endpoint", nistFunction:"Protect", question:"What endpoint/antivirus protection is on your computers?",
    options:["Advanced EDR (CrowdStrike, SentinelOne, etc.)","Built-in protection (Windows Defender, etc.)","Basic/free antivirus","None / not sure"] },
  { id:"training", nistFunction:"Protect", question:"Do employees receive security awareness training?",
    options:["Yes, regular training + phishing simulations","Yes, occasional/annual training","Informal or one-time only","No training"] },
  { id:"itManagement", nistFunction:"Protect", question:"Who manages your IT and security?",
    options:["Dedicated in-house IT/security staff","Outsourced IT provider (MSP)","One person handles it part-time","No one specifically / ad-hoc"] },
  { id:"dataInventory", nistFunction:"Identify", question:"Do you know exactly what sensitive data you store and where?",
    options:["Yes, fully documented inventory","Mostly — we have a general idea","Vague understanding only","No / never assessed"] },
  { id:"priorAudit", nistFunction:"Identify", question:"When was your last security assessment or audit?",
    options:["Within the last year (or formally certified)","1-2 years ago","More than 2 years ago","Never"] },
  { id:"documentedPolicies", nistFunction:"Identify", question:"Do you have written security policies?",
    options:["Yes, a full set of documented policies","A few key policies","One or two informal documents","None"] },
  { id:"monitoring", nistFunction:"Detect", question:"Do you have security monitoring or logging in place?",
    options:["Yes, active monitoring (SIEM/SOC or managed)","Some logging, reviewed occasionally","Minimal / only what comes built-in","No monitoring"] },
  { id:"emailSecurity", nistFunction:"Detect", question:"What email security / spam filtering do you use?",
    options:["Advanced email security (Proofpoint, Mimecast, etc.)","Built-in filtering (Microsoft 365 / Google Workspace)","Basic spam filter only","None / not sure"] },
  { id:"incidentResponse", nistFunction:"Respond", question:"Do you have an incident response plan?",
    options:["Yes, documented and tested","Yes, documented but not tested","Informal / in our heads only","No plan"] },
  { id:"responseSupport", nistFunction:"Respond", question:"If a serious breach happened today, who would respond?",
    options:["Retained security firm / MSP on call","Internal IT staff","We'd figure it out / call someone","Not sure"] },
  { id:"backups", nistFunction:"Recover", question:"How are your critical data and systems backed up?",
    options:["Automated, offsite/cloud backups (tested)","Automated backups, not regularly tested","Manual or occasional backups","No backups / not sure"] },
  { id:"disasterRecovery", nistFunction:"Recover", question:"Do you have a disaster recovery / business continuity plan?",
    options:["Yes, documented with recovery time goals","Yes, a basic plan","Informal understanding only","No plan"] },
];

const NIST_COLORS = {
  Identify: "#A855F7", Protect: "#00C8FF", Detect: "#FFB800",
  Respond: "#FF8C00", Recover: "#00E5A0",
};

// Compliance frameworks the user can select in the assessment. These flow
// into the AI-generated compliance mapping. CIS Controls additionally offers
// an Implementation Group choice (IG1/IG2/IG3).
// Fallback only — the real list comes from GET /api/compliance/frameworks.
//
// This was the framework picker's hardcoded source: 7 frameworks, last edited
// when that was true. The backend now serves 12 (NIST 800-53, 800-171, CMMC,
// FTC Safeguards and State Privacy were all built and then unreachable at the
// one place a client selects them). A hardcoded product catalogue in the UI
// silently rots every time the backend ships something.
//
// useFrameworkCatalog() fetches the live list. This array is what renders if the
// request fails — better a stale picker than an empty one.
const COMPLIANCE_FRAMEWORKS_FALLBACK = [
  { id:"nist-csf", name:"NIST CSF",      desc:"NIST Cybersecurity Framework — always applied as the scoring baseline.", always:true },
  { id:"cis",      name:"CIS Controls v8.1", desc:"18 prioritized controls for small & mid-sized businesses.", hasIG:true },
  { id:"hipaa",    name:"HIPAA",         desc:"Health data privacy & security (US healthcare)." },
  { id:"pci-dss",  name:"PCI DSS",       desc:"Payment card data security." },
  { id:"soc2",     name:"SOC 2",         desc:"Trust Services Criteria for service organizations." },
  { id:"gdpr",     name:"GDPR",          desc:"EU personal data protection." },
  { id:"iso27001", name:"ISO 27001",     desc:"International information security management standard." },
];

const CIS_IG_OPTIONS = [
  { id:"IG1", label:"IG1", sub:"Essential cyber hygiene — small businesses (56 safeguards)" },
  { id:"IG2", label:"IG2", sub:"Adds risk-based safeguards — sensitive data / regulated (130)" },
  { id:"IG3", label:"IG3", sub:"Full set — high-value / targeted-threat orgs (153)" },
];

// The live checklist — all 35 questions, straight from the engine that scores
// them.
//
// Two kinds come back, distinguished by `affectsPostureScore`:
//   true  — the 13 NIST-weighted questions that drive the posture score.
//   false — 22 evidence questions that frameworks read but scoring ignores.
//
// The split matters and must be preserved in the UI. The posture score is
// normalised across only the scoring questions; if the evidence answers ever
// leaked into that calculation, every historical client's score would shift.
// The backend enforces this (SCORING_CHECKLIST vs SECURITY_CHECKLIST), so the
// UI just needs to collect all 35 and let the server sort it out.
let _checklistCache = null;
function useSecurityChecklist() {
  const [list, setList] = useState(_checklistCache);
  useEffect(() => {
    if (_checklistCache) return;
    let live = true;
    fetch(`${API_BASE}/api/tasks/controls`, {
      headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {},
    })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => {
        const rows = (Array.isArray(d) ? d : []).map(q => ({
          id: q.id,
          question: q.question,
          nistFunction: q.nistFunction,
          factor: q.factor,
          options: q.options,
          section: q.section || q.nistFunction,
          affectsPostureScore: q.affectsPostureScore !== false,
        }));
        if (live && rows.length) { _checklistCache = rows; setList(rows); }
      })
      .catch(() => { /* fall back to the static 13 */ });
    return () => { live = false; };
  }, []);
  return list || SECURITY_CHECKLIST_FALLBACK;
}
// The live framework catalogue, straight from the registry that actually
// assesses them. Depth ("control-mapped" vs "ai-assisted") comes through so the
// picker can be honest about which frameworks get a real control walkthrough and
// which get an AI gap analysis — a client choosing GDPR should know before they
// pick it, not after.
let _fwCatalogCache = null;
function useFrameworkCatalog() {
  const [list, setList] = useState(_fwCatalogCache);
  useEffect(() => {
    if (_fwCatalogCache) return;
    let live = true;
    fetch(`${API_BASE}/api/compliance/frameworks`, {
      headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {},
    })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => {
        const rows = (Array.isArray(d) ? d : []).map(f => ({
          id: f.id,
          name: f.short || f.name,
          desc: f.description || "",
          depth: f.depth,
          // Carried through so the picker can show what a client is choosing:
          // "93 controls" vs "AI gap analysis" is the difference between a
          // control-by-control walkthrough and the model's interpretation.
          requirementCount: f.requirementCount,
          note: f.note || null,
          legalReviewRequired: f.legalReviewRequired || false,
          always: f.id === "nist-csf",
          hasIG: f.id === "cis",
        }));
        if (live && rows.length) { _fwCatalogCache = rows; setList(rows); }
      })
      .catch(() => { /* fall back to the static list */ });
    return () => { live = false; };
  }, []);
  return list || COMPLIANCE_FRAMEWORKS_FALLBACK;
}

// ── Framework foundation: NIST, CIS, or both ──────────────────
// Shown once, before the checklist. The client picks the lens their posture
// score and program are framed in. This is a real choice with real
// consequences (it changes how the score is grouped and labelled), so it gets
// its own screen with an honest explanation rather than being buried as a
// checkbox — most SMB owners have heard "NIST" and "CIS" and don't know the
// difference, and guessing costs them nothing to fix but shapes everything that
// follows.
function FrameworkFoundationScreen({ onComplete, onBack, initial = "nist" }) {
  const [choice, setChoice] = useState(initial);

  const options = [
    {
      id: "nist",
      name: "NIST Cybersecurity Framework",
      tag: "Most widely recognized",
      body: "The framework insurers, auditors, and government contracts ask about most often. Organizes security into five functions — Identify, Protect, Detect, Respond, Recover. A safe default if you're not sure.",
      best: "Best if you want the most portable, widely-understood score.",
    },
    {
      id: "cis",
      name: "CIS Controls v8.1",
      tag: "Most actionable for SMBs",
      body: "A prioritized, practical checklist built from real attack data. Its Implementation Group 1 is designed specifically for small businesses with limited IT resources — it tells you what to do first.",
      best: "Best if you want a concrete, do-this-next roadmap.",
    },
    {
      id: "both",
      name: "Both",
      tag: "Most complete",
      body: "Score and track against both. Your headline posture number stays in NIST terms (so it's comparable everywhere), with the full CIS view alongside. More to work through, but nothing left out.",
      best: "Best if you're pursuing certification or answering to multiple parties.",
    },
  ];

  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.bg, fontFamily: "Inter,system-ui,sans-serif", padding: "32px 24px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h2 style={{ color: C.text, fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>Choose your framework foundation</h2>
        <p style={{ color: C.textSec, fontSize: 13, lineHeight: 1.7, margin: "0 0 4px" }}>
          Security frameworks are different lenses on the same question: is this business protected?
          Your answers won't change — this decides how your posture score is grouped and which
          standard your program is framed in. You can change it later; it isn't locked in.
        </p>
        <p style={{ color: C.textMut, fontSize: 12, lineHeight: 1.6, margin: "0 0 22px" }}>
          Whatever you pick, all 12 compliance frameworks (HIPAA, PCI, SOC 2, and the rest) remain
          available to assess against — this choice is only about your core posture score.
        </p>

        <div style={{ display: "grid", gap: 12 }}>
          {options.map(o => {
            const sel = choice === o.id;
            return (
              <button key={o.id} onClick={() => setChoice(o.id)}
                style={{
                  textAlign: "left", padding: "18px 20px", borderRadius: 12, cursor: "pointer",
                  background: sel ? `${C.accent}14` : C.card,
                  border: `1.5px solid ${sel ? C.accent : C.border}`,
                  transition: "all .12s",
                }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                    border: `2px solid ${sel ? C.accent : C.borderHi}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {sel && <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.accent }} />}
                  </div>
                  <span style={{ color: C.text, fontSize: 15, fontWeight: 700 }}>{o.name}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: "2px 8px", borderRadius: 999,
                    background: `${C.accent}1A`, color: C.accent, marginLeft: "auto",
                  }}>{o.tag}</span>
                </div>
                <p style={{ color: C.textSec, fontSize: 12.5, lineHeight: 1.6, margin: "0 0 6px", paddingLeft: 28 }}>{o.body}</p>
                <p style={{ color: sel ? C.accent : C.textMut, fontSize: 11.5, margin: 0, paddingLeft: 28, fontWeight: 500 }}>{o.best}</p>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
          <button onClick={onBack} style={{
            padding: "10px 18px", borderRadius: 8, cursor: "pointer",
            background: "transparent", border: `1px solid ${C.border}`, color: C.textSec, fontSize: 13,
          }}>← Back</button>
          <button onClick={() => onComplete(choice)} style={{
            padding: "10px 22px", borderRadius: 8, cursor: "pointer", border: "none",
            background: `linear-gradient(135deg,${C.accent},${C.accentDm})`, color: C.bg, fontSize: 13, fontWeight: 700,
            marginLeft: "auto",
          }}>Continue →</button>
        </div>
      </div>
    </div>
  );
}

function ChecklistScreen({ onComplete, onBack, frameworkLens = "nist" }) {
  // Live catalogue, not the stale 7-item constant.
  const COMPLIANCE_FRAMEWORKS = useFrameworkCatalog();
  // All 35 questions, not the frozen 13. The 22 evidence questions are what
  // make most of the framework catalogue assessable — without them the backend
  // scores what it can and reports "not yet assessed" for the rest.
  const SECURITY_CHECKLIST = useSecurityChecklist();
  const [answers, setAnswers] = useState({});
  // Foundation frameworks come from the lens the client chose on the previous
  // screen: NIST → nist-csf, CIS → cis, both → both. These are the posture
  // foundation and can't be toggled off here (that choice was already made);
  // additional compliance frameworks stack on top.
  const foundationIds =
    frameworkLens === "cis" ? ["cis"]
    : frameworkLens === "both" ? ["nist-csf", "cis"]
    : ["nist-csf"];
  const [frameworks, setFrameworks] = useState(foundationIds);
  const isFoundation = (id) => foundationIds.includes(id);
  const [cisIG, setCisIG] = useState("IG1");
  // The gate is the 13 SCORING questions, not all 35.
  //
  // The posture score needs all 13 — it's normalised across them, and a missing
  // answer would silently reweight the rest. The 22 evidence questions are
  // different: the engine reports an unanswered one as "not yet assessed"
  // rather than assuming it met or failed, so a partial answer set produces a
  // partial assessment, which is honest and useful.
  //
  // Blocking submission on all 35 would turn a 13-question intake into a
  // 35-question wall. People abandon those, and an abandoned assessment scores
  // nothing at all. Answer what you can; every extra answer makes more of the
  // framework catalogue assessable, and the UI says so.
  const required = SECURITY_CHECKLIST.filter(q => q.affectsPostureScore !== false);
  const optional = SECURITY_CHECKLIST.filter(q => q.affectsPostureScore === false);
  const total = SECURITY_CHECKLIST.length;
  const answered = Object.keys(answers).length;
  const requiredAnswered = required.filter(q => answers[q.id] !== undefined).length;
  const optionalAnswered = optional.filter(q => answers[q.id] !== undefined).length;
  const allAnswered = requiredAnswered === required.length;

  function selectAnswer(qId, option) {
    setAnswers(prev => ({ ...prev, [qId]: option }));
  }

  function toggleFramework(id) {
    // Foundation frameworks (the lens the client picked) can't be toggled off
    // here — that decision was made on the previous screen. Everything else
    // stacks freely.
    if (isFoundation(id)) return;
    setFrameworks(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  }

  // Build the structured selection passed to onComplete alongside answers.
  function buildComplianceSelection() {
    return frameworks.map(id => {
      const fw = COMPLIANCE_FRAMEWORKS.find(f => f.id === id);
      const entry = { id, name: fw?.name || id };
      if (id === "cis") entry.implementationGroup = cisIG;
      return entry;
    });
  }

  // Scoring questions group under their NIST function; evidence questions under
  // their own section (Access & Identity, Data Protection, Vendors, Governance,
  // Privacy). Grouping evidence questions by nistFunction would file them all
  // under "undefined" — they deliberately have no NIST weight.
  const grouped = SECURITY_CHECKLIST.reduce((acc, q) => {
    const key = q.affectsPostureScore === false
      ? (q.section || "Additional detail")
      : q.nistFunction;
    (acc[key] = acc[key] || []).push(q);
    return acc;
  }, {});

  return (
    <div style={{flex:1,overflowY:"auto",background:C.bg,
      fontFamily:"Inter,system-ui,sans-serif",padding:"24px"}}>
      <div style={{maxWidth:760,margin:"0 auto"}}>
        <div style={{marginBottom:8}}>
          <button onClick={onBack}
            style={{padding:"6px 14px",background:"none",border:`1px solid ${C.border}`,
              borderRadius:6,color:C.textSec,fontSize:12,cursor:"pointer"}}>
            ← Back to Interview
          </button>
        </div>

        <h2 style={{color:C.text,fontSize:22,margin:"8px 0 6px"}}>Security Checklist</h2>
        <p style={{color:C.textSec,fontSize:14,lineHeight:1.6,margin:"0 0 16px"}}>
          A few precise questions to accurately score your security posture. These map
          directly to the NIST Cybersecurity Framework. Answer all {total} to continue.
        </p>

        {/* ── Compliance framework selector ─────────────────────── */}
        <div style={{marginBottom:24,padding:"18px 18px 20px",background:C.card,
          border:`1px solid ${C.border}`,borderRadius:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <span style={{color:C.accent,fontSize:12,fontWeight:700,letterSpacing:1.5,
              textTransform:"uppercase"}}>Compliance Frameworks</span>
          </div>
          <p style={{color:C.textSec,fontSize:13,lineHeight:1.5,margin:"0 0 14px"}}>
            Your posture foundation is locked in from your framework choice. Add any
            compliance frameworks your business needs to map against — we'll generate a
            tailored gap analysis for each.
          </p>

          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {COMPLIANCE_FRAMEWORKS.map(fw => {
              const on = frameworks.includes(fw.id);
              const locked = isFoundation(fw.id);
              return (
                <button key={fw.id} onClick={() => toggleFramework(fw.id)}
                  title={locked ? "Your posture foundation — chosen on the previous screen" : fw.desc}
                  disabled={locked}
                  style={{textAlign:"left",padding:"9px 13px",borderRadius:9,
                    cursor: locked ? "default" : "pointer",
                    background: on ? `${C.accent}18` : C.surface,
                    border:`1px solid ${on ? C.accent : C.border}`,
                    color: on ? C.text : C.textSec,
                    fontFamily:"Inter,system-ui,sans-serif",
                    display:"flex",alignItems:"center",gap:9,transition:"all 0.15s"}}>
                  <span style={{width:15,height:15,borderRadius:4,flexShrink:0,
                    border:`2px solid ${on ? C.accent : C.textMut}`,
                    background: on ? C.accent : "transparent",
                    display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {on && <span style={{color:C.bg,fontSize:10,fontWeight:900,lineHeight:1}}>✓</span>}
                  </span>
                  <span>
                    <span style={{fontSize:13,fontWeight:600,display:"block"}}>{fw.name}</span>
                    {/* What the client is actually choosing. "AI-assisted" means
                        a contextual gap analysis, not a control-by-control
                        walkthrough — they should know that before they pick it,
                        not discover it in the report. */}
                    {locked ? (
                      <span style={{fontSize:10,color:C.accent,fontWeight:600}}>your foundation</span>
                    ) : fw.depth === "ai-assisted" ? (
                      <span style={{fontSize:10,color:C.amber}}>AI gap analysis</span>
                    ) : typeof fw.requirementCount === "number" ? (
                      <span style={{fontSize:10,color:C.textMut}}>{fw.requirementCount} controls</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>

          {/* CIS Implementation Group sub-selector, only when CIS is selected */}
          {frameworks.includes("cis") && (
            <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${C.border}`}}>
              <div style={{color:C.text,fontSize:13,fontWeight:600,marginBottom:4}}>
                CIS Implementation Group
              </div>
              <p style={{color:C.textSec,fontSize:12,lineHeight:1.5,margin:"0 0 10px"}}>
                Implementation Groups are cumulative — IG2 includes IG1, IG3 includes all.
                Most small businesses start at IG1.
              </p>
              <div style={{display:"flex",flexDirection:"column",gap:7}}>
                {CIS_IG_OPTIONS.map(ig => {
                  const sel = cisIG === ig.id;
                  return (
                    <button key={ig.id} onClick={() => setCisIG(ig.id)}
                      style={{textAlign:"left",padding:"10px 14px",borderRadius:8,cursor:"pointer",
                        background: sel ? `${C.accent}18` : C.surface,
                        border:`1px solid ${sel ? C.accent : C.border}`,
                        color: sel ? C.text : C.textSec,
                        fontFamily:"Inter,system-ui,sans-serif",
                        display:"flex",alignItems:"center",gap:10,transition:"all 0.15s"}}>
                      <span style={{width:16,height:16,borderRadius:"50%",flexShrink:0,
                        border:`2px solid ${sel ? C.accent : C.textMut}`,
                        background: sel ? C.accent : "transparent",
                        display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {sel && <span style={{width:6,height:6,borderRadius:"50%",background:C.bg}}/>}
                      </span>
                      <span>
                        <span style={{fontSize:13,fontWeight:700}}>{ig.label}</span>
                        <span style={{fontSize:12,color:C.textSec,marginLeft:8}}>{ig.sub}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div style={{position:"sticky",top:0,zIndex:5,background:C.bg,
          padding:"10px 0 14px",marginBottom:6}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{color:C.textSec,fontSize:12}}>
              {requiredAnswered} of {required.length} required
              {optionalAnswered > 0 && <span style={{color:C.textMut}}> · {optionalAnswered} of {optional.length} optional</span>}
            </span>
            <span style={{color:C.accent,fontSize:12,fontWeight:700}}>
              {Math.round((requiredAnswered/required.length)*100)}%
            </span>
          </div>
          <ProgressBar value={(requiredAnswered/required.length)*100} color={C.accent}/>
        </div>

        {Object.entries(grouped).map(([fn, questions]) => {
          // Evidence sections have no NIST colour because they carry no NIST
          // weight — that's the point. They're marked optional and told why:
          // a client skipping them isn't failing, they're leaving controls
          // unassessed, and they should know which trade they're making.
          const isEvidence = questions[0]?.affectsPostureScore === false;
          const color = isEvidence ? C.textSec : NIST_COLORS[fn];
          return (
          <div key={fn} style={{marginBottom:24}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:color}}/>
              <span style={{color,fontSize:12,fontWeight:700,
                letterSpacing:1.5,textTransform:"uppercase"}}>{fn}</span>
              {isEvidence && (
                <span style={{fontSize:10,color:C.textMut,textTransform:"none",letterSpacing:0}}>
                  optional — doesn't change your posture score, but makes more compliance controls assessable
                </span>
              )}
            </div>

            {questions.map(q => (
              <div key={q.id} style={{marginBottom:16,padding:"16px 18px",background:C.card,
                border:`1px solid ${answers[q.id] ? NIST_COLORS[fn]+"44" : C.border}`,
                borderRadius:12,transition:"border-color 0.2s"}}>
                <div style={{color:C.text,fontSize:14,fontWeight:600,marginBottom:12}}>
                  {q.question}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:7}}>
                  {q.options.map(opt => {
                    const selected = answers[q.id] === opt;
                    return (
                      <button key={opt} onClick={() => selectAnswer(q.id, opt)}
                        style={{textAlign:"left",padding:"10px 14px",borderRadius:8,cursor:"pointer",
                          background: selected ? `${NIST_COLORS[fn]}18` : C.surface,
                          border:`1px solid ${selected ? NIST_COLORS[fn] : C.border}`,
                          color: selected ? C.text : C.textSec,
                          fontSize:13,fontWeight: selected ? 600 : 400,
                          fontFamily:"Inter,system-ui,sans-serif",
                          display:"flex",alignItems:"center",gap:10,transition:"all 0.15s"}}>
                        <span style={{width:16,height:16,borderRadius:"50%",flexShrink:0,
                          border:`2px solid ${selected ? NIST_COLORS[fn] : C.textMut}`,
                          background: selected ? NIST_COLORS[fn] : "transparent",
                          display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {selected && <span style={{width:6,height:6,borderRadius:"50%",background:C.bg}}/>}
                        </span>
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ); })}

        <div style={{position:"sticky",bottom:0,background:C.bg,padding:"16px 0",
          borderTop:`1px solid ${C.border}`,marginTop:8}}>
          <button onClick={() => onComplete(answers, buildComplianceSelection())} disabled={!allAnswered}
            style={{width:"100%",padding:"14px",borderRadius:10,border:"none",
              background: allAnswered ? `linear-gradient(135deg,${C.accent},${C.accentDm})` : C.border,
              color: allAnswered ? C.bg : C.textMut,
              fontSize:15,fontWeight:700,
              cursor: allAnswered ? "pointer" : "not-allowed"}}>
            {allAnswered
              ? (optionalAnswered < optional.length
                  ? `Generate Security Program → (${optional.length - optionalAnswered} optional left)`
                  : "Generate Security Program →")
              : `Answer the required questions (${required.length - requiredAnswered} remaining)`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  ADMIN — HIBP domain enrollment queue
// ─────────────────────────────────────────────────────────────
// HIBP has no API to enroll a domain: a human must add it at
// haveibeenpwned.com/DomainSearch and complete their verification. This queue
// is the bridge between that manual step and ShieldAI's state — it shows what
// is actionable right now and records what happened.
//
// The backend refuses to mark a domain "verified" until the client has proved
// ownership via DNS, so this UI can't be used to switch monitoring on for a
// domain nobody proved they control.
// ─────────────────────────────────────────────────────────────
//  ADMIN — threat intelligence service status
// ─────────────────────────────────────────────────────────────
// Shows which external intel services are wired up and, more usefully, what
// each gap actually costs. Distinguishes a BLOCKER (no HIBP key = no breach
// data at all) from an ADVISORY (no NVD key = slow, but still accurate) —
// because treating those the same would train you to ignore both.
//
// The probe button really calls each API. A key being set is not proof the
// service answers, and during a demo "configured" is a much weaker claim than
// "responded in 240ms".
// Admin / Mastermind fleet-wide training snapshot across all clients.
function AdminTrainingOverview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/training-program/overview`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load training overview.");
      setData(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (loading) return <Spinner/>;
  if (error) return <div style={{padding:"9px 12px",background:`${C.red}15`,border:`1px solid ${C.red}33`,
    borderRadius:7,color:C.red,fontSize:12.5}}>{error}</div>;

  const per = data?.perClient || [];
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <SectionLabel text="Training — Fleet Overview"/>
        <button onClick={load} style={{padding:"5px 12px",background:C.surface,border:`1px solid ${C.border}`,
          borderRadius:6,color:C.textSec,fontSize:12,cursor:"pointer"}}>↻ Refresh</button>
      </div>

      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:18}}>
        {[
          ["Learners", data?.totalLearners ?? 0, C.accent],
          ["Assignments", data?.totalAssignments ?? 0, C.text],
          ["Completed", data?.completed ?? 0, C.green],
          ["Overdue", data?.overdue ?? 0, data?.overdue ? C.red : C.textSec],
        ].map(([l,v,t],i)=>(
          <div key={i} style={{flex:"1 1 150px",padding:"16px 18px",background:C.card,
            border:`1px solid ${C.border}`,borderRadius:12}}>
            <div style={{fontSize:28,fontWeight:800,color:t,lineHeight:1}}>{v}</div>
            <div style={{fontSize:11,color:C.textMut,letterSpacing:0.5,marginTop:5}}>{l}</div>
          </div>
        ))}
      </div>

      <SectionLabel text="By Client"/>
      <div style={{marginTop:10}}>
        {per.length === 0 ? (
          <div style={{color:C.textSec,fontSize:13,padding:"8px 2px"}}>No training activity across the fleet yet.</div>
        ) : per.map((c,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",
            background:C.card,borderRadius:8,border:`1px solid ${C.border}`,marginBottom:7}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:C.text}}>{c.company}</div>
              <div style={{fontSize:11,color:C.textMut}}>{c.assigned} assigned · {c.completed} completed{c.overdue?` · ${c.overdue} overdue`:""}</div>
            </div>
            <div style={{width:110,height:7,borderRadius:6,background:C.surface,overflow:"hidden"}}>
              <div style={{width:`${c.completionRate}%`,height:"100%",
                background:c.completionRate>=80?C.green:c.completionRate>=50?C.amber:C.red}}/>
            </div>
            <span style={{fontSize:12,fontWeight:700,minWidth:44,textAlign:"right",
              color:c.completionRate>=80?C.green:c.completionRate>=50?C.amber:C.red}}>{c.completionRate}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminThreatIntelStatus() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [probes, setProbes] = useState(null);
  const [probing, setProbing] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/threat-intel/status`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load service status.");
      setData(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function probe() {
    setProbing(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/threat-intel/probe`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Probe failed.");
      setProbes(d.probes);
    } catch (e) { setError(e.message); }
    finally { setProbing(false); }
  }

  if (loading) return <Spinner/>;

  const s = data?.summary || {};

  return (
    <div>
      {error && (
        <div style={{marginBottom:16,padding:"10px 14px",background:`${C.red}15`,
          border:`1px solid ${C.red}33`,borderRadius:8,color:C.red,fontSize:13}}>{error}</div>
      )}

      {/* Blockers — things that mean a feature is simply off */}
      {(s.blockers || []).map((b,i)=>(
        <div key={i} style={{marginBottom:10,padding:"11px 14px",background:`${C.red}12`,
          border:`1px solid ${C.red}38`,borderRadius:8,color:C.red,fontSize:12.5,lineHeight:1.55}}>
          ⛔ {b}
        </div>
      ))}
      {/* Advisories — degraded, not broken */}
      {(s.advisories || []).map((a,i)=>(
        <div key={i} style={{marginBottom:10,padding:"11px 14px",background:`${C.amber}12`,
          border:`1px solid ${C.amber}38`,borderRadius:8,color:C.amber,fontSize:12.5,lineHeight:1.55}}>
          ⚠️ {a}
        </div>
      ))}
      {!(s.blockers||[]).length && !(s.advisories||[]).length && (
        <div style={{marginBottom:10,padding:"11px 14px",background:`${C.green}12`,
          border:`1px solid ${C.green}38`,borderRadius:8,color:C.green,fontSize:12.5}}>
          ✓ All threat-intelligence services are configured.
        </div>
      )}

      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:14}}>
        <button onClick={probe} disabled={probing}
          style={{padding:"8px 15px",background:`${C.accent}18`,border:`1px solid ${C.accent}55`,
            borderRadius:7,color:C.accent,fontSize:12,fontWeight:700,
            cursor:probing?"default":"pointer",opacity:probing?0.6:1}}>
          {probing ? "Probing live services…" : "Run live probe"}
        </button>
      </div>

      {(data?.services || []).map(svc => {
        const p = probes?.[svc.id];
        const tone = svc.configured ? (svc.required ? C.green : C.accent) : (svc.required ? C.red : C.amber);
        return (
          <Card key={svc.id} style={{marginBottom:12,borderColor:`${tone}33`}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:12,flexWrap:"wrap",marginBottom:12}}>
              <div style={{flex:"1 1 280px",minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:5,flexWrap:"wrap"}}>
                  <span style={{fontSize:14.5,fontWeight:700,color:C.text}}>{svc.name}</span>
                  <Badge label={svc.configured ? "CONFIGURED" : "NOT CONFIGURED"} color={tone}/>
                  <Badge label={svc.required ? "REQUIRED" : "OPTIONAL"}
                    color={svc.required ? C.purple : C.textMut}/>
                </div>
                <div style={{fontSize:12,color:C.textSec,lineHeight:1.55}}>{svc.purpose}</div>
              </div>
              {!svc.configured && (
                <a href={svc.keyUrl} target="_blank" rel="noopener noreferrer"
                  style={{padding:"7px 13px",background:`${tone}15`,border:`1px solid ${tone}44`,
                    borderRadius:6,color:tone,fontSize:11.5,fontWeight:700,textDecoration:"none",
                    whiteSpace:"nowrap"}}>
                  Get a key ↗
                </a>
              )}
            </div>

            <div style={{padding:"10px 12px",background:C.surface,border:`1px solid ${C.border}`,
              borderRadius:7,marginBottom:10}}>
              <div style={{fontSize:12,color:C.text,marginBottom:5}}>{svc.impact}</div>
              <div style={{fontSize:11,color:C.textMut,lineHeight:1.5}}>{svc.degradesTo}</div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10}}>
              <IntelStat label="Env var" value={svc.envVar} mono/>
              <IntelStat label="Rate limit" value={`${(svc.minIntervalMs/1000).toFixed(1)}s / request`}/>
              <IntelStat label="Cached" value={`${svc.cacheEntries} (${svc.cacheTtlHours}h TTL)`}/>
              {svc.id === "nvd" && (
                <IntelStat label="Full refresh" value={`~${svc.worstCaseRefreshSec}s`}
                  color={svc.configured ? C.green : C.amber}/>
              )}
              {svc.id === "hibp" && (
                <IntelStat label="Domains live" value={`${svc.domainsMonitored} / ${svc.domainsRegistered}`}
                  color={svc.domainsMonitored ? C.green : C.textMut}/>
              )}
            </div>

            {p && (
              <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`,
                display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <Badge label={p.ok ? "RESPONDING" : p.reachable === null ? "NOT PROBED" : "FAILED"}
                  color={p.ok ? C.green : p.reachable === null ? C.textMut : C.red}/>
                <span style={{fontSize:12,color:C.textSec,flex:"1 1 200px"}}>{p.detail}</span>
                {p.latencyMs > 0 && (
                  <span style={{fontSize:11.5,color:C.textMut,fontFamily:"monospace"}}>{p.latencyMs}ms</span>
                )}
              </div>
            )}
          </Card>
        );
      })}

      <div style={{fontSize:11,color:C.textMut,lineHeight:1.6,marginTop:4}}>
        Keys are read from the environment at startup. After changing one on Railway,
        redeploy for it to take effect.
      </div>
    </div>
  );
}

// Small labelled figure used by the threat-intel status cards. Named distinctly
// because AnalystConsole defines its own local `Stat` with a different API —
// relying on shadowing to keep them apart would be a trap for the next edit.
function IntelStat({ label, value, color, mono }) {
  return (
    <div style={{padding:"9px 11px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:7}}>
      <div style={{fontSize:10,color:C.textMut,fontWeight:600,letterSpacing:0.3,marginBottom:4}}>
        {label.toUpperCase()}
      </div>
      <div style={{fontSize:12.5,fontWeight:700,color:color||C.text,
        fontFamily:mono?"monospace":"inherit",wordBreak:"break-word"}}>{value}</div>
    </div>
  );
}

function AdminDomainQueue() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [noteFor, setNoteFor] = useState(null);
  const [noteText, setNoteText] = useState("");

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/domains`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load domains.");
      setData(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function setStatus(userId, status, note = "") {
    setBusy(userId + status); setError(null); setNotice(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/domains/${userId}/hibp-status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not update status.");
      setNotice(`${d.domain} → ${status.replace("_"," ")}`);
      setNoteFor(null); setNoteText("");
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  async function recheck(userId) {
    setBusy(userId + "recheck"); setError(null); setNotice(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/domains/${userId}/recheck`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Recheck failed.");
      setNotice(`DNS recheck: ${d.ownership}`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  if (loading) return <Spinner/>;

  const c = data?.counts || {};
  const stats = [
    { label:"Ready to enroll",  value:c.readyToEnroll||0, color:C.green },
    { label:"Awaiting HIBP",    value:c.awaitingHibp||0,  color:C.amber },
    { label:"Awaiting client",  value:c.awaitingClient||0,color:C.accent },
    { label:"Monitored",        value:c.monitored||0,     color:C.purple },
  ];

  const ownershipBadge = (o) =>
    o === "verified" ? { label:"OWNERSHIP VERIFIED", color:C.green }
    : o === "failed"  ? { label:"DNS CHECK FAILED",   color:C.red }
    : { label:"AWAITING DNS", color:C.textMut };

  const hibpBadge = (h) => ({
    verified:      { label:"MONITORING LIVE", color:C.green },
    submitted:     { label:"SUBMITTED",       color:C.amber },
    rejected:      { label:"REJECTED",        color:C.red },
    not_submitted: { label:"NOT ENROLLED",    color:C.textMut },
  }[h] || { label:h, color:C.textMut });

  return (
    <div>
      {!data?.serviceConfigured && (
        <div style={{marginBottom:16,padding:"11px 14px",background:`${C.amber}15`,
          border:`1px solid ${C.amber}38`,borderRadius:8,color:C.amber,fontSize:12.5,lineHeight:1.55}}>
          ⚠️ <strong>HIBP_API_KEY isn't set on this deployment.</strong> Breach monitoring stays
          inactive for every client regardless of the statuses below.
        </div>
      )}
      {notice && (
        <div style={{marginBottom:16,padding:"10px 14px",background:`${C.green}15`,
          border:`1px solid ${C.green}33`,borderRadius:8,color:C.green,fontSize:13}}>{notice}</div>
      )}
      {error && (
        <div style={{marginBottom:16,padding:"10px 14px",background:`${C.red}15`,
          border:`1px solid ${C.red}33`,borderRadius:8,color:C.red,fontSize:13}}>{error}</div>
      )}

      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:16}}>
        {stats.map((s,i)=>(
          <div key={i} style={{flex:"1 1 120px",padding:"12px 14px",background:C.card,
            border:`1px solid ${C.border}`,borderRadius:9}}>
            <div style={{fontSize:22,fontWeight:800,color:s.color,lineHeight:1}}>{s.value}</div>
            <div style={{fontSize:11,color:C.textSec,marginTop:5}}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{marginBottom:16,padding:"11px 14px",background:C.surface,
        border:`1px solid ${C.border}`,borderRadius:8,fontSize:12,color:C.textSec,lineHeight:1.6}}>
        {data?.note}{" "}
        <a href={data?.dashboardUrl} target="_blank" rel="noopener noreferrer"
          style={{color:C.accent,fontWeight:600,textDecoration:"none"}}>
          Open HIBP Domain Search ↗
        </a>
      </div>

      {(data?.domains || []).length === 0 ? (
        <Card><div style={{color:C.textSec,fontSize:13,padding:"8px 0"}}>
          No client has registered a company domain yet.
        </div></Card>
      ) : (data.domains).map(d => {
        const ob = ownershipBadge(d.ownership);
        const hb = hibpBadge(d.hibpStatus);
        return (
          <Card key={d.id} style={{marginBottom:10,
            borderColor: d.actionable ? `${C.green}44` : C.border}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
              <div style={{flex:"1 1 260px",minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:5,flexWrap:"wrap"}}>
                  <span style={{fontSize:14,fontWeight:700,color:C.text,fontFamily:"monospace"}}>{d.domain}</span>
                  {d.actionable && <Badge label="READY TO ENROLL" color={C.green}/>}
                </div>
                <div style={{fontSize:12,color:C.textSec,marginBottom:8}}>
                  {d.companyName} · {d.email}
                </div>
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  <Badge label={ob.label} color={ob.color}/>
                  <Badge label={hb.label} color={hb.color}/>
                </div>
                {d.lastCheckError && d.ownership !== "verified" && (
                  <div style={{fontSize:11,color:C.textMut,marginTop:8,lineHeight:1.5}}>
                    {d.lastCheckError}
                  </div>
                )}
                {d.hibpNote && (
                  <div style={{fontSize:11,color:C.textMut,marginTop:6,fontStyle:"italic"}}>
                    Note: {d.hibpNote}
                  </div>
                )}
              </div>

              <div style={{display:"flex",gap:7,flexWrap:"wrap",alignItems:"flex-start"}}>
                <button onClick={()=>recheck(d.userId)} disabled={!!busy}
                  style={{padding:"7px 12px",background:C.surface,border:`1px solid ${C.border}`,
                    borderRadius:6,color:C.textSec,fontSize:11.5,cursor:busy?"default":"pointer"}}>
                  {busy===d.userId+"recheck" ? "Checking…" : "Recheck DNS"}
                </button>

                {d.ownership === "verified" && d.hibpStatus === "not_submitted" && (
                  <button onClick={()=>setStatus(d.userId,"submitted","added to HIBP dashboard")} disabled={!!busy}
                    style={{padding:"7px 12px",background:`${C.amber}18`,border:`1px solid ${C.amber}55`,
                      borderRadius:6,color:C.amber,fontSize:11.5,fontWeight:600,cursor:busy?"default":"pointer"}}>
                    Mark submitted
                  </button>
                )}
                {d.ownership === "verified" && d.hibpStatus === "submitted" && (
                  <button onClick={()=>setStatus(d.userId,"verified")} disabled={!!busy}
                    style={{padding:"7px 12px",background:`${C.green}18`,border:`1px solid ${C.green}55`,
                      borderRadius:6,color:C.green,fontSize:11.5,fontWeight:600,cursor:busy?"default":"pointer"}}>
                    Mark verified — go live
                  </button>
                )}
                {d.hibpStatus !== "rejected" && d.ownership === "verified" && (
                  <button onClick={()=>{ setNoteFor(noteFor===d.userId?null:d.userId); setNoteText(""); }}
                    style={{padding:"7px 12px",background:"none",border:`1px solid ${C.border}`,
                      borderRadius:6,color:C.textMut,fontSize:11.5,cursor:"pointer"}}>
                    Reject
                  </button>
                )}
              </div>
            </div>

            {noteFor === d.userId && (
              <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`,
                display:"flex",gap:8,flexWrap:"wrap"}}>
                <input value={noteText} onChange={e=>setNoteText(e.target.value)}
                  placeholder="Why is monitoring not possible for this domain?"
                  style={{flex:"1 1 260px",padding:"9px 11px",background:C.surface,
                    border:`1px solid ${C.border}`,borderRadius:7,color:C.text,fontSize:12.5,
                    fontFamily:"Inter,system-ui,sans-serif"}}/>
                <button onClick={()=>setStatus(d.userId,"rejected",noteText)} disabled={!!busy||!noteText.trim()}
                  style={{padding:"9px 14px",background:`${C.red}18`,border:`1px solid ${C.red}55`,
                    borderRadius:7,color:C.red,fontSize:12,fontWeight:600,
                    cursor:busy||!noteText.trim()?"default":"pointer",opacity:!noteText.trim()?0.5:1}}>
                  Confirm reject
                </button>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function AdminPanel({ onClose }) {
  const [view, setView] = useState("list");   // list | user | program
  const [listTab, setListTab] = useState("accounts"); // accounts | leads
  const [users, setUsers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [leadsLoaded, setLeadsLoaded] = useState(false);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [resetFor, setResetFor] = useState(null);
  const [newPw, setNewPw] = useState("");
  const [notice, setNotice] = useState(null);

  // drill-down state
  const [userDetail, setUserDetail] = useState(null);   // full user record w/ programs
  const [programData, setProgramData] = useState(null); // { program, assessment }
  const [detailLoading, setDetailLoading] = useState(false);

  // account-control state (Stage 3)
  const [accountCtl, setAccountCtl] = useState(null);   // rich account record from /api/admin/accounts/:id
  const [ctlBusy, setCtlBusy] = useState(false);
  const [tierChoice, setTierChoice] = useState(null);
  const [audit, setAudit] = useState([]);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  // billing state (Stage 5)
  const [billing, setBilling] = useState(null);          // portfolio overview
  const [billingLoaded, setBillingLoaded] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [acctBilling, setAcctBilling] = useState(null);  // one account's billing detail

  // assignments state
  const [assignments, setAssignments] = useState(null);
  const [assignLoaded, setAssignLoaded] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignAnalyst, setAssignAnalyst] = useState("");
  const [assignClient, setAssignClient] = useState("");

  // create-account state
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ email:"", companyName:"", role:"analyst", tempPassword:"" });
  const [createBusy, setCreateBusy] = useState(false);
  const [createResult, setCreateResult] = useState(null); // { email, tempPassword? }

  async function createAccount() {
    const email = createForm.email.trim();
    if (!email.includes("@")) { setError("Enter a valid email."); return; }
    setCreateBusy(true); setError(null); setCreateResult(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/accounts`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          email, companyName: createForm.companyName,
          role: createForm.role,
          tempPassword: createForm.tempPassword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCreateResult({ email, tempPassword: data.tempPassword });
      setCreateForm({ email:"", companyName:"", role:"analyst", tempPassword:"" });
      load();
    } catch (e) { setError(e.message); } finally { setCreateBusy(false); }
  }

  async function loadAssignments() {
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/assignments`);
      if (!res.ok) throw new Error("Failed to load assignments.");
      setAssignments(await res.json());
      setAssignLoaded(true);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { if (listTab === "assignments" && !assignLoaded) loadAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listTab]);

  async function assignClientToAnalyst(analystUserId, clientUserId) {
    if (!analystUserId || !clientUserId) return;
    setAssignBusy(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/assignments`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ analystUserId, clientUserId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAssignClient(""); setNotice("Client assigned."); loadAssignments();
    } catch (e) { setError(e.message); } finally { setAssignBusy(false); }
  }

  async function unassign(analystUserId, clientUserId) {
    setAssignBusy(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/assignments`, {
        method:"DELETE", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ analystUserId, clientUserId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadAssignments();
    } catch (e) { setError(e.message); } finally { setAssignBusy(false); }
  }

  async function loadBilling() {
    setBillingLoading(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/billing/overview`);
      if (!res.ok) throw new Error("Failed to load billing overview.");
      setBilling(await res.json());
      setBillingLoaded(true);
    } catch (e) { setError(e.message); } finally { setBillingLoading(false); }
  }
  useEffect(() => { if (listTab === "billing" && !billingLoaded) loadBilling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listTab]);

  async function loadAcctBilling(id) {
    try {
      const res = await authFetch(`${API_BASE}/api/admin/accounts/${id}/billing`);
      if (res.ok) setAcctBilling(await res.json());
    } catch { /* ignore */ }
  }

  const money = (cents) => cents == null ? "—" : `$${(cents/100).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2})}`;

  const TIER_LIST = [
    { id:"free", name:"Free", price:"$0" },
    { id:"starter", name:"Starter", price:"$159/mo" },
    { id:"growth", name:"Growth", price:"$349/mo" },
    { id:"guided", name:"Guided", price:"$699/mo" },
    { id:"managed", name:"Managed vCISO", price:"$1,950/mo" },
  ];

  // Load the rich account-control record for a user.
  async function loadAccountCtl(id) {
    try {
      const res = await authFetch(`${API_BASE}/api/admin/accounts/${id}`);
      if (res.ok) { const a = await res.json(); setAccountCtl(a); setTierChoice(a.tier); }
    } catch { /* surfaced via banners on action */ }
  }

  async function setRole(id, role, value) {
    setCtlBusy(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/accounts/${id}/role`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ role, value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAccountCtl(data); setNotice("Role updated."); load();
    } catch (e) { setError(e.message); } finally { setCtlBusy(false); }
  }

  async function changeTier(id, tier) {
    setCtlBusy(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/accounts/${id}/tier`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAccountCtl(data); setNotice(`Tier changed to ${tier}.`);
    } catch (e) { setError(e.message); } finally { setCtlBusy(false); }
  }

  async function setSuspended(id, suspended) {
    setCtlBusy(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/accounts/${id}/suspend`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ suspended }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAccountCtl(data); setNotice(suspended ? "Account suspended." : "Account reactivated.");
    } catch (e) { setError(e.message); } finally { setCtlBusy(false); }
  }

  async function repairAccount(id, actions) {
    if (!window.confirm(`Run repair actions (${actions.join(", ")})? This modifies the account's data.`)) return;
    setCtlBusy(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/accounts/${id}/repair`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ actions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const parts = Object.entries(data.result || {}).map(([k,v])=>`${k}: ${v}`).join(", ");
      setNotice(`Repair complete. ${parts}`); load();
    } catch (e) { setError(e.message); } finally { setCtlBusy(false); }
  }

  async function loadAudit() {
    setAuditLoading(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/audit`);
      if (!res.ok) throw new Error("Failed to load audit log.");
      const data = await res.json();
      setAudit(Array.isArray(data) ? data : []);
      setAuditLoaded(true);
    } catch (e) { setError(e.message); } finally { setAuditLoading(false); }
  }
  useEffect(() => { if (listTab === "audit" && !auditLoaded) loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listTab]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [uRes, sRes] = await Promise.all([
        authFetch(`${API_BASE}/api/admin/users`),
        authFetch(`${API_BASE}/api/admin/stats`),
      ]);
      if (!uRes.ok) throw new Error("Failed to load users (are you an admin?)");
      setUsers(await uRes.json());
      setStats(await sRes.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function loadLeads() {
    setLeadsLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/leads`);
      if (!res.ok) throw new Error("Failed to load leads.");
      const data = await res.json();
      setLeads(Array.isArray(data) ? data : []);
      setLeadsLoaded(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLeadsLoading(false);
    }
  }

  // Fetch leads the first time the Leads tab is opened.
  useEffect(() => {
    if (listTab === "leads" && !leadsLoaded) loadLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listTab]);

  async function setLeadStatus(id, status) {
    setBusy(id);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  // Approve a lead → mint an access code (investor or client) and mark the lead
  // qualified. Returns the generated code so the admin can send it to the person.
  async function approveLead(id, type) {
    setBusy(id);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/leads/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not approve.");
      const code = data.accessCode?.code;
      const expiresAt = data.accessCode?.expiresAt;
      const ttlHours = data.accessCode?.ttlHours;
      setLeads(prev => prev.map(l => l.id === id
        ? { ...l, status: "qualified", accessCode: code, accessType: type, accessExpiresAt: expiresAt, accessTtlHours: ttlHours } : l));
      setNotice(`Approved · ${type} code ${code} (valid ${ttlHours||""}h)`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteLead(id, email) {
    if (!window.confirm(`Delete the lead from ${email}? This cannot be undone.`)) return;
    setBusy(id);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/leads/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLeads(prev => prev.filter(l => l.id !== id));
      setNotice("Lead deleted.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function clearStuck() {
    const count = stats?.stuckPrograms || 0;
    if (count === 0) return;
    if (!window.confirm(`Delete all ${count} stuck program(s) (status "running")? This frees them up so those users can regenerate. This cannot be undone.`)) return;
    setBusy("clear-stuck");
    try {
      const res = await authFetch(`${API_BASE}/api/admin/clear-stuck`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNotice(`Cleared ${data.cleared} stuck program(s).`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function openUser(id) {
    setDetailLoading(true);
    setError(null);
    setView("user");
    setAccountCtl(null);
    loadAccountCtl(id);
    setAcctBilling(null);
    loadAcctBilling(id);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/users/${id}`);
      if (!res.ok) throw new Error("Failed to load user detail");
      setUserDetail(await res.json());
    } catch (err) {
      setError(err.message);
      setView("list");
    } finally {
      setDetailLoading(false);
    }
  }

  async function openProgram(programId) {
    setDetailLoading(true);
    setError(null);
    setView("program");
    try {
      const res = await authFetch(`${API_BASE}/api/admin/programs/${programId}`);
      if (!res.ok) throw new Error("Failed to load program");
      setProgramData(await res.json());
    } catch (err) {
      setError(err.message);
      setView("user");
    } finally {
      setDetailLoading(false);
    }
  }

  async function deleteProgram(programId) {
    if (!window.confirm("Delete this program? This cannot be undone.")) return;
    setBusy(programId);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/programs/${programId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNotice("Program deleted.");
      // refresh the user detail view
      if (userDetail) await openUser(userDetail.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteUser(id, email) {
    if (!window.confirm(`Delete ${email} and ALL their data? This frees a testing slot and cannot be undone.`)) return;
    setBusy(id);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/users/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNotice(`Deleted ${email}.`);
      setView("list");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword(id, email) {
    if (newPw.length < 8) { setError("New password must be at least 8 characters."); return; }
    setBusy(id);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/users/${id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: newPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNotice(`Password reset for ${email}.`);
      setResetFor(null);
      setNewPw("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const Header = ({ title, backTo }) => (
    <div style={{padding:"14px 24px",background:C.surface,borderBottom:`1px solid ${C.border}`,
      display:"flex",alignItems:"center",gap:12}}>
      <span style={{fontSize:20}}>⚙️</span>
      <span style={{fontWeight:700,fontSize:16}}>{title}</span>
      <span style={{fontSize:11,color:C.purple,letterSpacing:1.5,
        padding:"2px 10px",background:`${C.purple}22`,borderRadius:20}}>ADMINISTRATOR</span>
      <div style={{marginLeft:"auto",display:"flex",gap:8}}>
        {backTo && (
          <button onClick={backTo.fn}
            style={{padding:"6px 14px",background:C.surface,border:`1px solid ${C.border}`,
              borderRadius:6,color:C.textSec,fontSize:12,cursor:"pointer"}}>
            ← {backTo.label}
          </button>
        )}
        <button onClick={onClose}
          style={{padding:"6px 16px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
            color:C.bg,border:"none",borderRadius:6,fontSize:12,fontWeight:700,cursor:"pointer"}}>
          Exit Admin
        </button>
      </div>
    </div>
  );

  const banners = (
    <>
      {notice && (
        <div style={{marginBottom:16,padding:"10px 14px",background:`${C.green}15`,
          border:`1px solid ${C.green}33`,borderRadius:8,color:C.green,fontSize:13}}>{notice}</div>
      )}
      {error && (
        <div style={{marginBottom:16,padding:"10px 14px",background:`${C.red}15`,
          border:`1px solid ${C.red}33`,borderRadius:8,color:C.red,fontSize:13}}>{error}</div>
      )}
    </>
  );

  // ── PROGRAM INSPECTOR VIEW ──────────────────────────────
  if (view === "program") {
    const prog = programData?.program;
    const sections = prog?.sections || {};
    return (
      <div style={{minHeight:"100vh",background:C.bg,fontFamily:"Inter,system-ui,sans-serif",color:C.text}}>
        <Header title="Program Inspector" backTo={{ label:"Back to User", fn:()=>setView("user") }}/>
        <div style={{maxWidth:900,margin:"0 auto",padding:"24px"}}>
          {banners}
          {detailLoading ? <Spinner/> : prog ? (
            <>
              <Card style={{marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{color:C.text,fontWeight:700,fontSize:15}}>
                      {programData?.assessment?.company?.name || "Program"}
                    </div>
                    <div style={{color:C.textMut,fontSize:11,marginTop:3,fontFamily:"monospace"}}>{prog.id}</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <Badge label={prog.status} color={prog.status==="complete"?C.green:prog.status==="running"?C.amber:C.red}/>
                    <button onClick={()=>deleteProgram(prog.id)}
                      style={{padding:"6px 12px",background:`${C.red}15`,border:`1px solid ${C.red}33`,
                        borderRadius:6,color:C.red,fontSize:12,cursor:"pointer"}}>
                      Delete Program
                    </button>
                  </div>
                </div>
              </Card>

              <SectionLabel text={`Sections (${Object.keys(sections).length})`}/>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {Object.entries(sections).map(([key, val]) => (
                  <Card key={key} style={{padding:"12px 16px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom: val?8:0}}>
                      <span style={{color:C.accent,fontSize:13,fontWeight:700}}>{key}</span>
                      {val ? <Badge label="OK" color={C.green}/> : <Badge label="FAILED / NULL" color={C.red}/>}
                    </div>
                    {val && (
                      <pre style={{margin:0,padding:"10px 12px",background:C.bg,borderRadius:6,
                        color:C.textSec,fontSize:11,lineHeight:1.5,overflowX:"auto",
                        maxHeight:200,overflowY:"auto",whiteSpace:"pre-wrap",
                        fontFamily:"monospace"}}>
                        {JSON.stringify(val, null, 2)}
                      </pre>
                    )}
                  </Card>
                ))}
              </div>
            </>
          ) : <div style={{color:C.textSec}}>No program data.</div>}
        </div>
      </div>
    );
  }

  // ── USER DETAIL VIEW ────────────────────────────────────
  if (view === "workspace" && userDetail) {
    return <WorkspaceViewer
      client={{ id:userDetail.id, name:userDetail.companyName||userDetail.email, email:userDetail.email, tier:userDetail.tier }}
      onBack={()=>setView("user")}/>;
  }

  if (view === "user") {
    const u = userDetail;
    return (
      <div style={{minHeight:"100vh",background:C.bg,fontFamily:"Inter,system-ui,sans-serif",color:C.text}}>
        <Header title="User Detail" backTo={{ label:"All Accounts", fn:()=>{setView("list");setUserDetail(null);} }}/>
        <div style={{maxWidth:900,margin:"0 auto",padding:"24px"}}>
          {banners}
          {detailLoading ? <Spinner/> : u ? (
            <>
              <Card style={{marginBottom:20}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:14}}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                      <span style={{color:C.text,fontWeight:700,fontSize:16}}>
                        {u.companyName || "(no company name)"}
                      </span>
                      {u.isAdmin && <Badge label="ADMIN" color={C.purple}/>}
                          {u.isAnalyst && <Badge label="ANALYST" color={C.accent}/>}
                    </div>
                    <div style={{color:C.textSec,fontSize:13}}>{u.email}</div>
                    <div style={{color:C.textMut,fontSize:11,marginTop:4}}>
                      Joined {new Date(u.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  {!u.isAdmin && (
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {!u.isAnalyst && (
                        <button onClick={() => setView("workspace")}
                          style={{padding:"6px 14px",background:`${C.green||"#00E5A0"}18`,border:`1px solid ${C.green||"#00E5A0"}55`,
                            borderRadius:6,color:C.green||"#00E5A0",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>
                          View Workspace →
                        </button>
                      )}
                      <button onClick={() => { setResetFor(resetFor===u.id?null:u.id); setNewPw(""); }}
                        style={{padding:"6px 14px",background:C.surface,border:`1px solid ${C.border}`,
                          borderRadius:6,color:C.textSec,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
                        Reset Password
                      </button>
                      <button onClick={() => deleteUser(u.id, u.email)} disabled={busy===u.id}
                        style={{padding:"6px 14px",background:`${C.red}15`,border:`1px solid ${C.red}33`,
                          borderRadius:6,color:C.red,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
                        {busy===u.id?"...":"Delete & Free Slot"}
                      </button>
                    </div>
                  )}
                </div>
                {resetFor === u.id && (
                  <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`,
                    display:"flex",gap:8,alignItems:"center"}}>
                    <input type="text" value={newPw} onChange={e=>setNewPw(e.target.value)}
                      placeholder="New password (min 8 chars)"
                      style={{flex:1,padding:"9px 12px",background:C.surface,border:`1px solid ${C.border}`,
                        borderRadius:8,color:C.text,fontSize:13,fontFamily:"Inter,system-ui,sans-serif"}}/>
                    <button onClick={() => resetPassword(u.id, u.email)}
                      style={{padding:"9px 18px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
                        color:C.bg,border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>
                      Set Password
                    </button>
                  </div>
                )}
              </Card>

              {/* ── Account Controls (Stage 3) ───────────────── */}
              <Card style={{marginBottom:20,border:`1px solid ${C.accent}33`}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                  <span style={{color:C.accent,fontSize:12,fontWeight:700,letterSpacing:1.2,
                    textTransform:"uppercase"}}>Account Controls</span>
                  {accountCtl?.suspended && <Badge label="SUSPENDED" color={C.red}/>}
                </div>

                {!accountCtl ? <div style={{color:C.textMut,fontSize:13}}>Loading controls…</div> : (
                  <div style={{display:"flex",flexDirection:"column",gap:18}}>

                    {/* Role */}
                    <div>
                      <div style={{color:C.textSec,fontSize:12,fontWeight:600,marginBottom:8}}>Role & Access</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <button onClick={()=>setRole(accountCtl.id,"admin",!accountCtl.isAdmin)} disabled={ctlBusy}
                          style={{padding:"7px 14px",borderRadius:7,cursor:ctlBusy?"wait":"pointer",fontSize:12,fontWeight:600,
                            background: accountCtl.isAdmin?`${C.purple}22`:"transparent",
                            border:`1px solid ${accountCtl.isAdmin?C.purple:C.border}`,
                            color: accountCtl.isAdmin?C.purple:C.textSec}}>
                          {accountCtl.isAdmin?"✓ Admin":"Make Admin"}
                        </button>
                        <button onClick={()=>setRole(accountCtl.id,"analyst",!accountCtl.isAnalyst)} disabled={ctlBusy}
                          style={{padding:"7px 14px",borderRadius:7,cursor:ctlBusy?"wait":"pointer",fontSize:12,fontWeight:600,
                            background: accountCtl.isAnalyst?`${C.accent}22`:"transparent",
                            border:`1px solid ${accountCtl.isAnalyst?C.accent:C.border}`,
                            color: accountCtl.isAnalyst?C.accent:C.textSec}}>
                          {accountCtl.isAnalyst?"✓ Analyst":"Make Analyst"}
                        </button>
                        {(accountCtl.isAdmin || accountCtl.isAnalyst) && (
                          <button onClick={()=>setRole(accountCtl.id,"client",false)} disabled={ctlBusy}
                            style={{padding:"7px 14px",borderRadius:7,cursor:"pointer",fontSize:12,
                              background:"none",border:`1px solid ${C.border}`,color:C.textMut}}>
                            Reset to standard client
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Tier */}
                    <div>
                      <div style={{color:C.textSec,fontSize:12,fontWeight:600,marginBottom:8}}>
                        Subscription Tier <span style={{color:C.textMut,fontWeight:400}}>· current: {accountCtl.tier}</span>
                      </div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                        {TIER_LIST.map(t=>{
                          const cur = accountCtl.tier===t.id;
                          return (
                            <button key={t.id} onClick={()=>setTierChoice(t.id)} disabled={ctlBusy}
                              style={{padding:"7px 13px",borderRadius:7,cursor:"pointer",fontSize:12,fontWeight:600,textAlign:"left",
                                background: tierChoice===t.id?`${C.accent}18`:"transparent",
                                border:`1px solid ${tierChoice===t.id?C.accent:(cur?C.green:C.border)}`,
                                color: tierChoice===t.id?C.accent:(cur?C.green:C.textSec)}}>
                              {t.name} <span style={{opacity:0.7,fontWeight:400}}>{t.price}</span>{cur?" ·current":""}
                            </button>
                          );
                        })}
                        {tierChoice && tierChoice!==accountCtl.tier && (
                          <button onClick={()=>changeTier(accountCtl.id,tierChoice)} disabled={ctlBusy}
                            style={{padding:"7px 16px",borderRadius:7,cursor:"pointer",fontSize:12,fontWeight:700,
                              background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,color:C.bg,border:"none"}}>
                            Apply: {accountCtl.tier} → {tierChoice}
                          </button>
                        )}
                      </div>
                      {accountCtl.subscription && (
                        <div style={{color:C.textMut,fontSize:11,marginTop:8}}>
                          Billing status: {accountCtl.subscription.status}
                          {accountCtl.subscription.stripeCustomerId ? " · Stripe-linked" : " · not yet linked to Stripe"}
                        </div>
                      )}
                    </div>

                    {/* Usage vs limits */}
                    <div>
                      <div style={{color:C.textSec,fontSize:12,fontWeight:600,marginBottom:8}}>Current Usage</div>
                      <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:12.5,color:C.textSec}}>
                        <span>Endpoints: <span style={{color:C.text,fontWeight:600}}>{accountCtl.counts.endpoints}</span></span>
                        <span>Assessments: <span style={{color:C.text,fontWeight:600}}>{accountCtl.counts.assessments}</span></span>
                        <span>Programs: <span style={{color:C.text,fontWeight:600}}>{accountCtl.counts.programs}</span></span>
                        <span>Policies: <span style={{color:C.text,fontWeight:600}}>{accountCtl.counts.policies}</span></span>
                      </div>
                    </div>

                    {/* Repair & state */}
                    <div>
                      <div style={{color:C.textSec,fontSize:12,fontWeight:600,marginBottom:8}}>Repair & State</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <button onClick={()=>repairAccount(accountCtl.id,["clear_stuck_programs"])} disabled={ctlBusy}
                          style={{padding:"7px 13px",borderRadius:7,cursor:"pointer",fontSize:12,
                            background:C.surface,border:`1px solid ${C.border}`,color:C.textSec}}>
                          Clear stuck programs
                        </button>
                        <button onClick={()=>repairAccount(accountCtl.id,["clear_orphans"])} disabled={ctlBusy}
                          style={{padding:"7px 13px",borderRadius:7,cursor:"pointer",fontSize:12,
                            background:C.surface,border:`1px solid ${C.border}`,color:C.textSec}}>
                          Remove orphaned data
                        </button>
                        <button onClick={()=>repairAccount(accountCtl.id,["reset_endpoints"])} disabled={ctlBusy}
                          style={{padding:"7px 13px",borderRadius:7,cursor:"pointer",fontSize:12,
                            background:`${C.amber}12`,border:`1px solid ${C.amber}40`,color:C.amber}}>
                          Reset endpoints (revoke all)
                        </button>
                        {!accountCtl.suspended ? (
                          <button onClick={()=>setSuspended(accountCtl.id,true)} disabled={ctlBusy}
                            style={{padding:"7px 13px",borderRadius:7,cursor:"pointer",fontSize:12,
                              background:`${C.red}12`,border:`1px solid ${C.red}33`,color:C.red}}>
                            Suspend account
                          </button>
                        ) : (
                          <button onClick={()=>setSuspended(accountCtl.id,false)} disabled={ctlBusy}
                            style={{padding:"7px 13px",borderRadius:7,cursor:"pointer",fontSize:12,
                              background:`${C.green}12`,border:`1px solid ${C.green}40`,color:C.green}}>
                            Reactivate account
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </Card>

              {/* ── Billing detail (Stage 5) ─────────────────── */}
              <Card style={{marginBottom:20}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                  <span style={{color:C.green,fontSize:12,fontWeight:700,letterSpacing:1.2,
                    textTransform:"uppercase"}}>Billing</span>
                </div>
                {!acctBilling ? <div style={{color:C.textMut,fontSize:13}}>Loading billing…</div> : (
                  <div>
                    <div style={{display:"flex",gap:20,flexWrap:"wrap",marginBottom:14}}>
                      <div>
                        <div style={{color:C.textMut,fontSize:11}}>Tier</div>
                        <div style={{color:C.text,fontSize:14,fontWeight:600}}>{acctBilling.tier}</div>
                      </div>
                      <div>
                        <div style={{color:C.textMut,fontSize:11}}>Subscription status</div>
                        <div style={{color:C.text,fontSize:14,fontWeight:600}}>
                          {acctBilling.subscription?.status || "—"}
                        </div>
                      </div>
                      <div>
                        <div style={{color:C.textMut,fontSize:11}}>Lifetime collected</div>
                        <div style={{color:C.green,fontSize:14,fontWeight:600}}>{money(acctBilling.lifetimePaidCents)}</div>
                      </div>
                      {acctBilling.subscription?.currentPeriodEnd && (
                        <div>
                          <div style={{color:C.textMut,fontSize:11}}>Renews</div>
                          <div style={{color:C.text,fontSize:14,fontWeight:600}}>
                            {new Date(acctBilling.subscription.currentPeriodEnd).toLocaleDateString()}
                          </div>
                        </div>
                      )}
                      {acctBilling.subscription?.stripeCustomerId && (
                        <div>
                          <div style={{color:C.textMut,fontSize:11}}>Stripe customer</div>
                          <div style={{color:C.textSec,fontSize:12,fontFamily:"monospace"}}>{acctBilling.subscription.stripeCustomerId}</div>
                        </div>
                      )}
                    </div>

                    <div style={{color:C.textSec,fontSize:12,fontWeight:600,marginBottom:8}}>
                      Transactions ({acctBilling.transactions?.length || 0})
                    </div>
                    {(acctBilling.transactions || []).length === 0 ? (
                      <div style={{color:C.textMut,fontSize:12.5}}>No transactions recorded.</div>
                    ) : (
                      <div style={{display:"flex",flexDirection:"column",gap:5}}>
                        {acctBilling.transactions.map(t=>(
                          <div key={t.id} style={{display:"flex",gap:10,padding:"8px 12px",
                            background:C.surface,borderRadius:6,alignItems:"center"}}>
                            <Badge label={t.status} color={t.status==="paid"?C.green:C.red}/>
                            <span style={{flex:1,color:C.text,fontSize:12.5}}>{t.description}</span>
                            <span style={{color:C.text,fontSize:12.5,fontWeight:600}}>{money(t.amountCents)}</span>
                            <span style={{color:C.textMut,fontSize:11}}>{new Date(t.createdAt).toLocaleDateString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>

              <SectionLabel text={`Programs (${u.programs?.length || 0})`}/>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:24}}>
                {(u.programs || []).length === 0 && (
                  <div style={{color:C.textMut,fontSize:13,padding:12}}>No programs generated yet.</div>
                )}
                {(u.programs || []).map(p => (
                  <Card key={p.id} style={{padding:"12px 16px",cursor:"pointer"}}
                    onClick={()=>openProgram(p.id)}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{flex:1}}>
                        <div style={{color:C.text,fontSize:13,fontWeight:600}}>
                          Program · {p.sectionCount} sections
                        </div>
                        <div style={{color:C.textMut,fontSize:11,marginTop:2}}>
                          {new Date(p.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <Badge label={p.status} color={p.status==="complete"?C.green:p.status==="running"?C.amber:C.red}/>
                      <span style={{color:C.accent,fontSize:12,fontWeight:600}}>Inspect →</span>
                    </div>
                  </Card>
                ))}
              </div>

              <SectionLabel text={`Assessments (${u.assessments?.length || 0})`}/>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:24}}>
                {(u.assessments || []).length === 0 && (
                  <div style={{color:C.textMut,fontSize:13,padding:12}}>No assessments completed yet.</div>
                )}
                {(u.assessments || []).map(a => (
                  <Card key={a.id} style={{padding:"12px 16px"}}>
                    <div style={{color:C.text,fontSize:13,fontWeight:600}}>
                      {a.company?.name || "(unnamed company)"}
                    </div>
                    <div style={{color:C.textMut,fontSize:11,marginTop:2}}>
                      {a.company?.industry || ""} · {new Date(a.createdAt).toLocaleDateString()}
                    </div>
                  </Card>
                ))}
              </div>

              <SectionLabel text={`Policies (${u.policies?.length || 0})`}/>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {(u.policies || []).length === 0 && (
                  <div style={{color:C.textMut,fontSize:13,padding:12}}>No policies generated yet.</div>
                )}
                {(u.policies || []).map(p => (
                  <Card key={p.id} style={{padding:"10px 16px"}}>
                    <span style={{color:C.text,fontSize:13}}>{p.policyName}</span>
                    <span style={{color:C.textMut,fontSize:11,marginLeft:8}}>
                      {new Date(p.createdAt).toLocaleDateString()}
                    </span>
                  </Card>
                ))}
              </div>
            </>
          ) : <div style={{color:C.textSec}}>No user data.</div>}
        </div>
      </div>
    );
  }

  // ── LIST VIEW (default) ─────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"Inter,system-ui,sans-serif",color:C.text}}>
      <Header title="Admin Panel"/>
      <div style={{maxWidth:1000,margin:"0 auto",padding:"24px"}}>
        {stats && (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",
            gap:12,marginBottom:24}}>
            {[
              { label:"Testing Accounts", value:`${stats.testingUsers}/${stats.maxTestingUsers}`, color: stats.slotsAvailable===0?C.amber:C.green },
              { label:"Slots Available", value:stats.slotsAvailable, color:C.accent },
              { label:"Assessments", value:stats.totalAssessments, color:C.textSec },
              { label:"Programs", value:stats.totalPrograms, color:C.textSec },
              { label:"Stuck Programs", value:stats.stuckPrograms, color: stats.stuckPrograms>0?C.red:C.green },
              { label:"Policies", value:stats.totalPolicies, color:C.textSec },
            ].map((s,i)=>(
              <Card key={i} style={{padding:"14px 16px",textAlign:"center"}}>
                <div style={{fontSize:24,fontWeight:700,color:s.color}}>{s.value}</div>
                <div style={{fontSize:11,color:C.textMut,marginTop:4}}>{s.label}</div>
              </Card>
            ))}
          </div>
        )}

        {stats && stats.stuckPrograms > 0 && (
          <div style={{marginBottom:20,padding:"14px 18px",background:`${C.red}12`,
            border:`1px solid ${C.red}33`,borderRadius:10,
            display:"flex",alignItems:"center",gap:14}}>
            <div style={{flex:1}}>
              <div style={{color:C.red,fontWeight:600,fontSize:14}}>
                {stats.stuckPrograms} stuck program{stats.stuckPrograms>1?"s":""} detected
              </div>
              <div style={{color:C.textSec,fontSize:12,marginTop:2}}>
                These never finished generating (status "running"). Clearing them lets those users regenerate.
              </div>
            </div>
            <button onClick={clearStuck} disabled={busy==="clear-stuck"}
              style={{padding:"9px 18px",background:busy==="clear-stuck"?C.border:`${C.red}`,
                color:busy==="clear-stuck"?C.textMut:"#fff",border:"none",borderRadius:8,
                fontSize:13,fontWeight:700,cursor:busy==="clear-stuck"?"not-allowed":"pointer",
                whiteSpace:"nowrap"}}>
              {busy==="clear-stuck" ? "Clearing…" : "Clear Stuck Programs"}
            </button>
          </div>
        )}

        {banners}

        {/* Sub-tabs: Accounts | Leads */}
        <div style={{display:"flex",gap:8,marginBottom:16,borderBottom:`1px solid ${C.border}`}}>
          {[
            { id:"accounts", label:"Accounts" },
            { id:"billing", label:"Billing" },
            { id:"assignments", label:"Assignments" },
            { id:"domains", label:"Domains" },
            { id:"intel", label:"Threat Intel" },
            { id:"training", label:"Training" },
            { id:"leads", label:`Leads${leadsLoaded ? ` (${leads.length})` : ""}` },
            { id:"audit", label:"Audit Log" },
          ].map(t => {
            const on = listTab === t.id;
            return (
              <button key={t.id} onClick={()=>setListTab(t.id)}
                style={{padding:"10px 18px",background:"none",border:"none",cursor:"pointer",
                  borderBottom:`2px solid ${on ? C.accent : "transparent"}`,
                  color: on ? C.text : C.textSec, fontSize:14,
                  fontWeight: on ? 700 : 500, marginBottom:-1,
                  fontFamily:"Inter,system-ui,sans-serif"}}>
                {t.label}
              </button>
            );
          })}
        </div>

        {listTab === "accounts" && (
          <>
            {/* Create account */}
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
              <SectionLabel text="All Accounts — Click to Inspect"/>
              <button onClick={()=>{setShowCreate(s=>!s);setCreateResult(null);}}
                style={{marginLeft:"auto",padding:"7px 16px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
                  color:C.bg,border:"none",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer"}}>
                {showCreate ? "Close" : "+ Create Account"}
              </button>
            </div>

            {showCreate && (
              <Card style={{marginBottom:16,padding:"18px",border:`1px solid ${C.accent}33`}}>
                <div style={{color:C.accent,fontSize:12,fontWeight:700,letterSpacing:1.2,
                  textTransform:"uppercase",marginBottom:12}}>Create New Account</div>
                {createResult ? (
                  <div>
                    <div style={{color:C.green,fontSize:14,fontWeight:600,marginBottom:8}}>
                      ✓ Account created: {createResult.email}
                    </div>
                    {createResult.tempPassword ? (
                      <div style={{padding:"12px 14px",background:`${C.amber}12`,border:`1px solid ${C.amber}40`,
                        borderRadius:9,marginBottom:10}}>
                        <div style={{color:C.amber,fontSize:12,fontWeight:600,marginBottom:6}}>
                          Temporary password — shown once. Share it securely; the user must change it on first login.
                        </div>
                        <code style={{color:C.text,fontSize:14,fontWeight:700,letterSpacing:0.5}}>{createResult.tempPassword}</code>
                        <button onClick={()=>{navigator.clipboard.writeText(createResult.tempPassword);setNotice("Copied.");}}
                          style={{marginLeft:12,padding:"4px 10px",background:C.surface,border:`1px solid ${C.border}`,
                            borderRadius:6,color:C.textSec,fontSize:11,cursor:"pointer"}}>Copy</button>
                      </div>
                    ) : (
                      <div style={{color:C.textSec,fontSize:13,marginBottom:10}}>
                        The temp password you set is active. The user must change it on first login.
                      </div>
                    )}
                    <button onClick={()=>setCreateResult(null)}
                      style={{padding:"7px 14px",background:C.surface,border:`1px solid ${C.border}`,
                        borderRadius:7,color:C.textSec,fontSize:12,cursor:"pointer"}}>Create another</button>
                  </div>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                      <input value={createForm.email} onChange={e=>setCreateForm({...createForm,email:e.target.value})}
                        placeholder="Email address"
                        style={{flex:"1 1 220px",padding:"10px 12px",background:C.surface,border:`1px solid ${C.border}`,
                          borderRadius:8,color:C.text,fontSize:13,fontFamily:"Inter,system-ui,sans-serif"}}/>
                      <input value={createForm.companyName} onChange={e=>setCreateForm({...createForm,companyName:e.target.value})}
                        placeholder="Name / company (optional)"
                        style={{flex:"1 1 200px",padding:"10px 12px",background:C.surface,border:`1px solid ${C.border}`,
                          borderRadius:8,color:C.text,fontSize:13,fontFamily:"Inter,system-ui,sans-serif"}}/>
                    </div>
                    <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                      <div style={{display:"flex",gap:6}}>
                        {[{id:"analyst",label:"Analyst"},{id:"admin",label:"Admin"},{id:"client",label:"Client"}].map(rl=>(
                          <button key={rl.id} onClick={()=>setCreateForm({...createForm,role:rl.id})}
                            style={{padding:"8px 14px",borderRadius:7,cursor:"pointer",fontSize:12,fontWeight:600,
                              background:createForm.role===rl.id?`${C.accent}18`:"transparent",
                              border:`1px solid ${createForm.role===rl.id?C.accent:C.border}`,
                              color:createForm.role===rl.id?C.accent:C.textSec}}>{rl.label}</button>
                        ))}
                      </div>
                      <input value={createForm.tempPassword} onChange={e=>setCreateForm({...createForm,tempPassword:e.target.value})}
                        placeholder="Temp password (blank = auto-generate)"
                        style={{flex:"1 1 220px",padding:"10px 12px",background:C.surface,border:`1px solid ${C.border}`,
                          borderRadius:8,color:C.text,fontSize:13,fontFamily:"Inter,system-ui,sans-serif"}}/>
                      <button onClick={createAccount} disabled={createBusy||!createForm.email.includes("@")}
                        style={{padding:"10px 20px",background:createForm.email.includes("@")?`linear-gradient(135deg,${C.accent},${C.accentDm})`:C.border,
                          color:createForm.email.includes("@")?C.bg:C.textMut,border:"none",borderRadius:8,
                          fontSize:13,fontWeight:700,cursor:createForm.email.includes("@")?"pointer":"default"}}>
                        {createBusy?"Creating…":"Create"}
                      </button>
                    </div>
                    {createForm.role==="admin" && (
                      <div style={{color:C.amber,fontSize:12}}>
                        ⚠ Admins have full platform control (accounts, billing, tiers). Grant sparingly.
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )}

            {loading ? <Spinner/> : users.length === 0 ? (
              <Card style={{textAlign:"center",padding:"40px 24px"}}>
                <div style={{color:C.text,fontWeight:600,fontSize:15,marginBottom:6}}>
                  No data to report
                </div>
                <p style={{color:C.textSec,fontSize:13,margin:0,lineHeight:1.6}}>
                  No accounts exist yet. New client, analyst, and admin accounts will appear here
                  as they're created.
                </p>
              </Card>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                {users.map(u => (
                  <Card key={u.id} style={{padding:"16px 18px",cursor:"pointer"}}
                    onClick={()=>openUser(u.id)}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:14}}>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                          <span style={{color:C.text,fontWeight:600,fontSize:14}}>
                            {u.companyName || "(no company name)"}
                          </span>
                          {u.isAdmin && <Badge label="ADMIN" color={C.purple}/>}
                          {u.isAnalyst && <Badge label="ANALYST" color={C.accent}/>}
                        </div>
                        <div style={{color:C.textSec,fontSize:12,marginBottom:8}}>{u.email}</div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          <Badge label={`${u.stats.assessments} assessments`} color={C.textSec}/>
                          <Badge label={`${u.stats.completePrograms} programs`} color={C.green}/>
                          {u.stats.stuckPrograms > 0 &&
                            <Badge label={`${u.stats.stuckPrograms} stuck`} color={C.red}/>}
                          <Badge label={`${u.stats.policies} policies`} color={C.textSec}/>
                        </div>
                      </div>
                      <span style={{color:C.accent,fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>
                        Inspect →
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {listTab === "domains" && <AdminDomainQueue/>}

        {listTab === "intel" && <AdminThreatIntelStatus/>}

        {listTab === "training" && <AdminTrainingOverview/>}

        {listTab === "leads" && (
          <LeadsPanel
            leads={leads}
            loading={leadsLoading}
            busy={busy}
            onRefresh={loadLeads}
            onSetStatus={setLeadStatus}
            onApprove={approveLead}
            onDelete={deleteLead}
          />
        )}

        {listTab === "audit" && (
          <div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
              <SectionLabel text="Admin Audit Log"/>
              <button onClick={loadAudit}
                style={{padding:"5px 12px",background:C.surface,border:`1px solid ${C.border}`,
                  borderRadius:6,color:C.textSec,fontSize:12,cursor:"pointer"}}>↻ Refresh</button>
            </div>
            {auditLoading ? <Spinner/> : audit.length === 0 ? (
              <Card style={{textAlign:"center",padding:"36px 24px"}}>
                <div style={{color:C.textSec,fontSize:13}}>No admin actions recorded yet.</div>
              </Card>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {audit.map(a=>{
                  const actColor = a.action==="role_change"?C.purple
                    : a.action==="tier_change"?C.accent
                    : a.action==="repair"?C.amber
                    : a.action==="suspend"?C.red
                    : a.action==="reactivate"?C.green : C.textSec;
                  const target = users.find(u=>u.id===a.targetUserId);
                  return (
                    <div key={a.id} style={{display:"flex",gap:12,padding:"10px 14px",
                      background:C.surface,borderRadius:8,alignItems:"flex-start"}}>
                      <Badge label={a.action.replace("_"," ")} color={actColor}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{color:C.text,fontSize:13}}>{a.detail}</div>
                        <div style={{color:C.textMut,fontSize:11,marginTop:3}}>
                          by {a.actorEmail || a.actorUserId}
                          {target && ` · on ${target.companyName || target.email}`}
                          {" · "}{new Date(a.at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {listTab === "billing" && (
          <div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
              <SectionLabel text="Financial Overview"/>
              <button onClick={loadBilling}
                style={{padding:"5px 12px",background:C.surface,border:`1px solid ${C.border}`,
                  borderRadius:6,color:C.textSec,fontSize:12,cursor:"pointer"}}>↻ Refresh</button>
            </div>

            {billingLoading ? <Spinner/> : !billing ? (
              <Card style={{textAlign:"center",padding:"36px"}}>
                <div style={{color:C.textSec,fontSize:13}}>No billing data.</div>
              </Card>
            ) : (
              <>
                {!billing.configured && (
                  <div style={{marginBottom:16,padding:"10px 14px",background:`${C.amber}12`,
                    border:`1px solid ${C.amber}40`,borderRadius:9,color:C.amber,fontSize:12.5,lineHeight:1.5}}>
                    Stripe is not yet configured — figures below reflect internal tiers and any
                    manually-recorded transactions. See BILLING_SETUP.md to connect Stripe.
                  </div>
                )}

                {/* KPI cards */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",
                  gap:12,marginBottom:22}}>
                  <Card style={{padding:"16px 18px"}}>
                    <div style={{color:C.textMut,fontSize:11,textTransform:"uppercase",letterSpacing:1,fontWeight:700}}>Est. MRR</div>
                    <div style={{color:C.green,fontSize:26,fontWeight:700,marginTop:4}}>{money(billing.mrrCents)}</div>
                    <div style={{color:C.textMut,fontSize:11,marginTop:2}}>monthly recurring</div>
                  </Card>
                  <Card style={{padding:"16px 18px"}}>
                    <div style={{color:C.textMut,fontSize:11,textTransform:"uppercase",letterSpacing:1,fontWeight:700}}>Lifetime Collected</div>
                    <div style={{color:C.text,fontSize:26,fontWeight:700,marginTop:4}}>{money(billing.totalPaidCents)}</div>
                    <div style={{color:C.textMut,fontSize:11,marginTop:2}}>all paid invoices</div>
                  </Card>
                  <Card style={{padding:"16px 18px"}}>
                    <div style={{color:C.textMut,fontSize:11,textTransform:"uppercase",letterSpacing:1,fontWeight:700}}>Paying Clients</div>
                    <div style={{color:C.text,fontSize:26,fontWeight:700,marginTop:4}}>
                      {billing.rows.filter(r=>r.priceCents>0 && ["active","trialing","manual","past_due"].includes(r.status)).length}
                    </div>
                    <div style={{color:C.textMut,fontSize:11,marginTop:2}}>of {billing.rows.length} accounts</div>
                  </Card>
                </div>

                {/* Per-client rollup */}
                <SectionLabel text="Per-Client Billing"/>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {billing.rows.sort((a,b)=>b.priceCents-a.priceCents).map(r=>{
                    const tierColor = r.tier==="managed"?C.purple:r.tier==="guided"?C.purple
                      :r.tier==="growth"?C.accent:r.tier==="starter"?C.green:C.textMut;
                    const stColor = ["active","manual","trialing"].includes(r.status)?C.green
                      :r.status==="past_due"?C.amber:r.status==="free"?C.textMut:C.red;
                    return (
                      <div key={r.id} onClick={()=>{ const u=users.find(x=>x.id===r.id); if(u) openUser(r.id); }}
                        style={{display:"flex",gap:12,padding:"11px 14px",background:C.surface,
                          borderRadius:8,alignItems:"center",cursor:"pointer"}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{color:C.text,fontSize:13,fontWeight:600}}>{r.companyName || r.email}</div>
                          <div style={{color:C.textMut,fontSize:11,marginTop:2}}>{r.email}</div>
                        </div>
                        <Badge label={r.tier} color={tierColor}/>
                        <Badge label={r.status} color={stColor}/>
                        <div style={{textAlign:"right",minWidth:90}}>
                          <div style={{color:C.text,fontSize:13,fontWeight:600}}>{r.priceCents?money(r.priceCents)+"/mo":"—"}</div>
                          <div style={{color:C.textMut,fontSize:11}}>lifetime {money(r.lifetimePaidCents)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {listTab === "assignments" && (
          <div>
            <SectionLabel text="Analyst Assignments"/>
            <p style={{color:C.textSec,fontSize:13,lineHeight:1.6,margin:"0 0 16px"}}>
              Assign clients to analysts. An analyst has full control over the security work of
              their assigned clients (endpoints, recommendations, analysis, action history) but not
              administrative functions, which stay with admins.
            </p>

            {!assignments ? <Spinner/> : (
              <>
                {/* Assign form */}
                <Card style={{marginBottom:18,padding:"16px 18px"}}>
                  <div style={{color:C.textSec,fontSize:12,fontWeight:600,marginBottom:10}}>New Assignment</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                    <select value={assignAnalyst} onChange={e=>setAssignAnalyst(e.target.value)}
                      style={{flex:"1 1 200px",padding:"10px 12px",background:C.surface,border:`1px solid ${C.border}`,
                        borderRadius:8,color:C.text,fontSize:13,fontFamily:"Inter,system-ui,sans-serif"}}>
                      <option value="">Select analyst…</option>
                      {assignments.analysts.map(a=>(
                        <option key={a.analystUserId} value={a.analystUserId}>{a.analyst} ({a.clients.length} clients)</option>
                      ))}
                    </select>
                    <select value={assignClient} onChange={e=>setAssignClient(e.target.value)}
                      style={{flex:"1 1 200px",padding:"10px 12px",background:C.surface,border:`1px solid ${C.border}`,
                        borderRadius:8,color:C.text,fontSize:13,fontFamily:"Inter,system-ui,sans-serif"}}>
                      <option value="">Select client…</option>
                      {/* unassigned + already-assigned-to-others both selectable */}
                      {[...assignments.unassigned, ...assignments.analysts.flatMap(a=>a.clients)]
                        .filter((c,i,arr)=>arr.findIndex(x=>x.id===c.id)===i)
                        .map(c=>(<option key={c.id} value={c.id}>{c.name}</option>))}
                    </select>
                    <button onClick={()=>assignClientToAnalyst(assignAnalyst,assignClient)}
                      disabled={assignBusy||!assignAnalyst||!assignClient}
                      style={{padding:"10px 20px",background:(assignAnalyst&&assignClient)?`linear-gradient(135deg,${C.accent},${C.accentDm})`:C.border,
                        color:(assignAnalyst&&assignClient)?C.bg:C.textMut,border:"none",borderRadius:8,
                        fontSize:13,fontWeight:700,cursor:(assignAnalyst&&assignClient)?"pointer":"default"}}>
                      Assign
                    </button>
                  </div>
                </Card>

                {/* Per-analyst rollup */}
                {assignments.analysts.map(a=>(
                  <Card key={a.analystUserId} style={{marginBottom:12,padding:"14px 16px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                      <Badge label="ANALYST" color={C.accent}/>
                      <span style={{color:C.text,fontWeight:600,fontSize:14}}>{a.analyst}</span>
                      <span style={{color:C.textMut,fontSize:12}}>{a.email}</span>
                      <span style={{marginLeft:"auto",color:C.textMut,fontSize:12}}>{a.clients.length} client(s)</span>
                    </div>
                    {a.clients.length===0 ? (
                      <div style={{color:C.textMut,fontSize:12.5}}>No clients assigned.</div>
                    ) : (
                      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                        {a.clients.map(c=>(
                          <div key={c.id} style={{display:"flex",alignItems:"center",gap:8,
                            padding:"6px 10px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:20}}>
                            <span style={{color:C.text,fontSize:12.5}}>{c.name}</span>
                            <button onClick={()=>unassign(a.analystUserId,c.id)} disabled={assignBusy}
                              title="Unassign"
                              style={{background:"none",border:"none",color:C.red,fontSize:14,cursor:"pointer",lineHeight:1}}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}

                {assignments.unassigned.length>0 && (
                  <Card style={{padding:"14px 16px",border:`1px solid ${C.amber}33`}}>
                    <div style={{color:C.amber,fontSize:12,fontWeight:600,marginBottom:8}}>
                      Unassigned Clients ({assignments.unassigned.length})
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                      {assignments.unassigned.map(c=>(
                        <span key={c.id} style={{padding:"6px 10px",background:C.surface,
                          border:`1px solid ${C.border}`,borderRadius:20,color:C.textSec,fontSize:12.5}}>{c.name}</span>
                      ))}
                    </div>
                  </Card>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  LEADS PANEL — admin view of marketing-form submissions
// ─────────────────────────────────────────────────────────────
const LEAD_STATUSES = [
  { id:"new",       label:"New",       color:C.accent },
  { id:"contacted", label:"Contacted", color:C.amber },
  { id:"qualified", label:"Qualified", color:C.green },
  { id:"closed",    label:"Closed",    color:C.textMut },
];

function LeadsPanel({ leads, loading, busy, onRefresh, onSetStatus, onApprove, onDelete }) {
  const [filter, setFilter] = useState("all");

  const counts = leads.reduce((acc,l)=>{ const s=l.status||"new"; acc[s]=(acc[s]||0)+1; return acc; }, {});
  const shown = filter === "all" ? leads : leads.filter(l => (l.status||"new") === filter);

  function fmtDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString(undefined,
        { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit" });
    } catch { return iso; }
  }

  if (loading) return <Spinner/>;

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
        <SectionLabel text="Inbound Leads"/>
        <button onClick={onRefresh}
          style={{padding:"5px 12px",background:C.surface,border:`1px solid ${C.border}`,
            borderRadius:6,color:C.textSec,fontSize:12,cursor:"pointer"}}>
          ↻ Refresh
        </button>
        <div style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap"}}>
          {[{id:"all",label:`All (${leads.length})`}, ...LEAD_STATUSES.map(s=>({
            id:s.id, label:`${s.label} (${counts[s.id]||0})`, color:s.color }))].map(f=>{
            const on = filter === f.id;
            return (
              <button key={f.id} onClick={()=>setFilter(f.id)}
                style={{padding:"5px 12px",borderRadius:20,cursor:"pointer",fontSize:12,fontWeight:600,
                  background: on ? `${f.color||C.accent}22` : "transparent",
                  border:`1px solid ${on ? (f.color||C.accent) : C.border}`,
                  color: on ? (f.color||C.text) : C.textSec,
                  fontFamily:"Inter,system-ui,sans-serif"}}>
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <Card style={{textAlign:"center",padding:"40px 24px"}}>
          <div style={{color:C.text,fontWeight:600,fontSize:15,marginBottom:6}}>
            {leads.length === 0 ? "No leads yet" : "No leads in this filter"}
          </div>
          <p style={{color:C.textSec,fontSize:13,margin:0,lineHeight:1.6}}>
            {leads.length === 0
              ? "Submissions from the marketing page contact form will appear here."
              : "Try a different status filter."}
          </p>
        </Card>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {shown.map(l => {
            const status = l.status || "new";
            const sMeta = LEAD_STATUSES.find(s=>s.id===status) || LEAD_STATUSES[0];
            return (
              <Card key={l.id} style={{padding:"16px 18px"}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:14,flexWrap:"wrap"}}>
                  <div style={{flex:"1 1 240px",minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                      <span style={{color:C.text,fontWeight:700,fontSize:15}}>{l.name || "(no name)"}</span>
                      <Badge label={sMeta.label} color={sMeta.color}/>
                    </div>
                    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:8}}>
                      <a href={`mailto:${l.email}`}
                        style={{color:C.accent,fontSize:13,textDecoration:"none"}}>{l.email}</a>
                      {l.company && <span style={{color:C.textSec,fontSize:13}}>· {l.company}</span>}
                      {l.employees && <span style={{color:C.textMut,fontSize:13}}>· {l.employees} employees</span>}
                    </div>
                    {l.message && (
                      <div style={{color:C.textSec,fontSize:13,lineHeight:1.55,
                        padding:"8px 12px",background:C.surface,borderRadius:8,
                        whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
                        {l.message}
                      </div>
                    )}
                    <div style={{color:C.textMut,fontSize:11,marginTop:8}}>{fmtDate(l.createdAt)}</div>
                  </div>

                  <div style={{display:"flex",flexDirection:"column",gap:8,alignItems:"flex-end"}}>
                    <div style={{display:"flex",gap:5,flexWrap:"wrap",justifyContent:"flex-end"}}>
                      {LEAD_STATUSES.map(s => {
                        const active = status === s.id;
                        return (
                          <button key={s.id}
                            onClick={()=>onSetStatus(l.id, s.id)}
                            disabled={busy===l.id || active}
                            title={`Mark ${s.label}`}
                            style={{padding:"5px 10px",borderRadius:6,fontSize:11,fontWeight:600,
                              cursor: active ? "default" : (busy===l.id ? "wait" : "pointer"),
                              background: active ? `${s.color}22` : "transparent",
                              border:`1px solid ${active ? s.color : C.border}`,
                              color: active ? s.color : C.textSec,
                              fontFamily:"Inter,system-ui,sans-serif"}}>
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                    {/* Approve → mint access code. Investor = client+analyst
                        tour; Client = client views only. */}
                    <div style={{display:"flex",gap:5,justifyContent:"flex-end"}}>
                      <button onClick={()=>onApprove(l.id, "investor")} disabled={busy===l.id}
                        title="Approve as investor (client + analyst views)"
                        style={{padding:"5px 10px",borderRadius:6,fontSize:11,fontWeight:600,
                          background:`${C.purple}18`,border:`1px solid ${C.purple}55`,color:C.purple,
                          cursor:busy===l.id?"wait":"pointer"}}>
                        ✓ Investor
                      </button>
                      <button onClick={()=>onApprove(l.id, "client")} disabled={busy===l.id}
                        title="Approve as client demo (client views only)"
                        style={{padding:"5px 10px",borderRadius:6,fontSize:11,fontWeight:600,
                          background:`${C.accent}18`,border:`1px solid ${C.accent}55`,color:C.accent,
                          cursor:busy===l.id?"wait":"pointer"}}>
                        ✓ Client
                      </button>
                    </div>
                    <button onClick={()=>onDelete(l.id, l.email)} disabled={busy===l.id}
                      style={{padding:"5px 12px",background:`${C.red}12`,border:`1px solid ${C.red}33`,
                        borderRadius:6,color:C.red,fontSize:11,fontWeight:600,
                        cursor: busy===l.id ? "wait" : "pointer"}}>
                      Delete
                    </button>
                  </div>
                </div>

                {/* Issued access code (after approval) */}
                {l.accessCode && (
                  <div style={{marginTop:12,padding:"10px 14px",background:`${C.green}10`,
                    border:`1px solid ${C.green}33`,borderRadius:8,display:"flex",
                    alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <span style={{fontSize:11,color:C.textMut,letterSpacing:1,fontWeight:600}}>
                      {(l.accessType||"").toUpperCase()} ACCESS CODE
                    </span>
                    <code style={{fontSize:15,fontWeight:700,color:C.green,letterSpacing:1.5,
                      fontFamily:"ui-monospace,Menlo,monospace"}}>{l.accessCode}</code>
                    <button onClick={()=>{ try { navigator.clipboard.writeText(l.accessCode); } catch { /* ignore */ } }}
                      style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${C.border}`,
                        background:C.surface,color:C.textSec,fontSize:11,cursor:"pointer"}}>
                      Copy
                    </button>
                    <span style={{fontSize:11,color:C.textMut}}>Send this to {l.email} — it's their only credential.</span>
                    {l.accessExpiresAt && (
                      <span style={{fontSize:11,color:C.amber,fontWeight:600,width:"100%"}}>
                        Expires {new Date(l.accessExpiresAt).toLocaleString()} ({l.accessTtlHours||( l.accessType==="investor"?96:48)}h window)
                      </span>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  HOME SCREEN — returning user's dashboard of saved assessments
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
//  COMPANY ADMIN CONSOLE
//  Customer-facing overview of THEIR security program. Every figure
//  below is real or explicitly a "no data yet" state — nothing here
//  is invented to fill a slot. Posture score and company info come
//  from the generated program; trend comes from the real posture-
//  history endpoint; training comes from the real training-program
//  overview; the analyst channel points at real notifications
//  rather than simulating a conversation that isn't happening.
// ─────────────────────────────────────────────────────────────
function CompanyConsole({ assessmentId, programId, user, onClose, onOpenProgram }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);   // { company, results }
  const [history, setHistory] = useState(null);       // /api/client/posture-history — null while loading
  const [training, setTraining] = useState(null);      // /api/training-program/overview — null while loading
  const [notifications, setNotifications] = useState(null); // /api/notifications — null while loading
  const [compliance, setCompliance] = useState(null);  // /api/compliance/overview — null while loading

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const aRes = await authFetch(`${API_BASE}/api/assessments/${assessmentId}`);
        if (!aRes.ok) throw new Error("Could not load your program");
        const assessment = await aRes.json();
        const pRes = await authFetch(`${API_BASE}/api/programs/${programId}`);
        if (!pRes.ok) throw new Error("Could not load your program");
        const program = await pRes.json();
        setData({ company: assessment.company || {}, results: program.sections || {} });
      } catch (e) { setError(e.message); } finally { setLoading(false); }
    })();
    // Real trend, training, and notifications — each independently loaded so a
    // failure or "nothing yet" on one doesn't block the others. Every one of
    // these defaults to an explicit empty state, never a fabricated number.
    authFetch(`${API_BASE}/api/client/posture-history`)
      .then(r => r.ok ? r.json() : null).then(setHistory).catch(() => setHistory(null));
    authFetch(`${API_BASE}/api/training-program/overview`)
      .then(r => r.ok ? r.json() : null).then(setTraining).catch(() => setTraining(null));
    authFetch(`${API_BASE}/api/notifications`)
      .then(r => r.ok ? r.json() : null).then(setNotifications).catch(() => setNotifications(null));
    authFetch(`${API_BASE}/api/compliance/overview`)
      .then(r => r.ok ? r.json() : null).then(setCompliance).catch(() => setCompliance(null));
  }, [assessmentId, programId]);

  if (loading) return (
    <div style={{minHeight:"calc(100vh - 56px)",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <Spinner/>
    </div>
  );
  if (error) return (
    <div style={{minHeight:"calc(100vh - 56px)",background:C.bg,padding:"40px 24px",color:C.text}}>
      <button onClick={onClose} style={{marginBottom:16,padding:"8px 16px",background:C.surface,
        border:`1px solid ${C.border}`,borderRadius:8,color:C.textSec,fontSize:13,cursor:"pointer"}}>← Back</button>
      <div style={{color:C.red}}>{error}</div>
    </div>
  );

  const risk = data.results?.riskOverview || {};
  const score = risk.postureScore || 0;
  const level = risk.postureLevel || "Developing";
  const company = data.company || {};
  const scoreColor = score>=80?C.green:score>=60?"#7ED957":score>=40?C.amber:C.red;

  // Real trend points only — from the client's own posture-history endpoint.
  // No fallback series is generated: fewer than 2 points means there's no
  // trend to draw yet, and the panel says so instead of showing one.
  const trendPoints = (history?.points || [])
    .map(p => p.score).filter(v => typeof v === "number");

  const sections = data.results || {};
  const progItems = [
    { label: "Risk Assessment", done: !!sections.riskOverview },
    { label: "Security Policies", done: !!sections.policiesCore },
    { label: "Priorities & Roadmap", done: !!sections.priorities },
    { label: "Compliance Mapping", done: !!sections.compliance },
    { label: "Training Program", done: !!sections.training },
    { label: "Incident Response", done: !!sections.workflows },
  ];
  const progPct = Math.round(progItems.filter(p=>p.done).length / progItems.length * 100);

  const Panel = ({ title, children, action, flex }) => (
    <div style={{flex:flex||"1 1 300px",minWidth:0,background:C.card,border:`1px solid ${C.border}`,
      borderRadius:12,padding:"16px 18px"}}>
      <div style={{display:"flex",alignItems:"center",marginBottom:12}}>
        <span style={{color:C.text,fontSize:12,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase"}}>{title}</span>
        {action && <span style={{marginLeft:"auto"}}>{action}</span>}
      </div>
      {children}
    </div>
  );

  return (
    <div style={{minHeight:"calc(100vh - 56px)",background:C.bg,fontFamily:"Inter,system-ui,sans-serif",color:C.text}}>
      <div style={{maxWidth:1080,margin:"0 auto",padding:"28px 24px"}}>

        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:24}}>
          <div style={{width:46,height:46,borderRadius:11,background:`${C.accent}15`,
            border:`1px solid ${C.accent}33`,display:"flex",alignItems:"center",justifyContent:"center"}}><ShieldLogo size={28}/></div>
          <div style={{flex:1}}>
            <h1 style={{fontSize:22,fontWeight:700,margin:0,color:C.text}}>{company.name || "Your"} Security Console</h1>
            <p style={{color:C.textSec,fontSize:13,margin:"3px 0 0"}}>
              {company.industry ? `${company.industry} · ` : ""}{company.employees ? `${company.employees} employees · ` : ""}Managed by ShieldAI
            </p>
          </div>
          <button onClick={()=>onOpenProgram(assessmentId, programId)}
            style={{padding:"9px 18px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
              color:C.bg,border:"none",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            Open Full Program →
          </button>
          <button onClick={onClose} style={{padding:"9px 16px",background:C.surface,
            border:`1px solid ${C.border}`,borderRadius:9,color:C.textSec,fontSize:13,cursor:"pointer"}}>
            ← Home
          </button>
        </div>

        <div style={{display:"flex",gap:14,marginBottom:14,flexWrap:"wrap"}}>
          <Panel title="Security Posture" flex="0 0 220px">
            <div style={{textAlign:"center",padding:"6px 0"}}>
              <div style={{fontSize:48,fontWeight:800,color:scoreColor,lineHeight:1}}>{score}</div>
              <div style={{fontSize:10,color:C.textMut,letterSpacing:1,marginTop:4}}>OUT OF 100</div>
              <div style={{marginTop:10,padding:"4px 16px",borderRadius:20,background:scoreColor+"22",
                color:scoreColor,fontSize:12,fontWeight:700,display:"inline-block"}}>{level.toUpperCase()}</div>
            </div>
          </Panel>
          <Panel title="Posture Trend" flex="1 1 400px"
            action={trendPoints.length >= 2 ? (() => {
              const delta = trendPoints[trendPoints.length-1] - trendPoints[0];
              return (
                <span style={{fontSize:11,color: delta>0?C.green:delta<0?C.red:C.textMut}}>
                  {delta>0?"▲ improving":delta<0?"▼ declining":"— steady"}
                </span>
              );
            })() : null}>
            {history === null ? (
              <div style={{color:C.textSec,fontSize:13,padding:"20px 0",textAlign:"center"}}>No data to report</div>
            ) : trendPoints.length < 2 ? (
              <div style={{color:C.textSec,fontSize:13,padding:"20px 0",textAlign:"center"}}>
                Not enough history yet to chart a trend. This builds up as your program is rescored over time.
              </div>
            ) : (
              <TrendChartLight data={trendPoints} color={scoreColor}/>
            )}
          </Panel>
        </div>

        <div style={{display:"flex",gap:14,marginBottom:14,flexWrap:"wrap"}}>
          <Panel title="Program Status">
            <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:10}}>
              <span style={{fontSize:28,fontWeight:800,color:C.accent}}>{progPct}%</span>
              <span style={{fontSize:11,color:C.textMut}}>complete</span>
            </div>
            {progItems.map((p,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:9,marginBottom:7}}>
                <span style={{width:16,height:16,borderRadius:"50%",flexShrink:0,
                  background:p.done?`${C.green}22`:C.surface,border:`1px solid ${p.done?C.green:C.border}`,
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,
                  color:p.done?C.green:C.textMut}}>{p.done?"✓":""}</span>
                <span style={{fontSize:12,color:p.done?C.textSec:C.textMut}}>{p.label}</span>
              </div>
            ))}
          </Panel>

          <Panel title="Compliance Progress">
            {compliance === null ? (
              <div style={{color:C.textSec,fontSize:13,padding:"10px 0",textAlign:"center"}}>No data to report</div>
            ) : !compliance.hasAssessment || !(compliance.frameworks||[]).length ? (
              <div style={{color:C.textSec,fontSize:12.5,lineHeight:1.6}}>
                {compliance.note || "No assessment on file. Compliance can't be determined without answers."}
              </div>
            ) : (() => {
              // Lead with the weakest framework — same convention as the
              // analyst's rollup, so client and analyst never see conflicting
              // "which framework needs attention" answers.
              const rows = compliance.frameworks.filter(f => !f.notControlMapped && f.assessed > 0);
              if (!rows.length) return (
                <div style={{color:C.textSec,fontSize:13,padding:"10px 0",textAlign:"center"}}>No data to report</div>
              );
              const worst = [...rows].sort((a,b)=>(a.readinessPct??101)-(b.readinessPct??101))[0];
              const cur = worst.readinessPct ?? 0;
              return (
                <div>
                  <div style={{fontSize:12,color:C.textSec,marginBottom:4}}>{worst.short || worst.name}</div>
                  <div style={{fontSize:28,fontWeight:800,color:C.purple,marginBottom:8}}>{cur}%</div>
                  <div style={{height:7,background:C.surface,borderRadius:4,overflow:"hidden"}}>
                    <div style={{width:`${cur}%`,height:"100%",background:`linear-gradient(90deg,${C.purple},${C.accent})`}}/>
                  </div>
                  <div style={{fontSize:11,color:C.textMut,marginTop:6}}>
                    {rows.length > 1 ? `Weakest of ${rows.length} tracked frameworks` : "readiness"}
                  </div>
                </div>
              );
            })()}
          </Panel>

          <Panel title="Team Training">
            {training === null ? (
              <div style={{color:C.textSec,fontSize:13,padding:"10px 0",textAlign:"center"}}>No data to report</div>
            ) : !training.learnerCount ? (
              <div style={{color:C.textSec,fontSize:12.5,lineHeight:1.6}}>
                No learners set up yet. Add your team under Training to start tracking completion.
              </div>
            ) : (
              <>
                <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:8}}>
                  <span style={{fontSize:28,fontWeight:800,color:C.green}}>{training.completionRate}%</span>
                  <span style={{fontSize:11,color:C.textMut}}>staff completed</span>
                </div>
                <div style={{height:7,background:C.surface,borderRadius:4,overflow:"hidden",marginBottom:10}}>
                  <div style={{width:`${training.completionRate}%`,height:"100%",background:`linear-gradient(90deg,${C.accent},${C.green})`}}/>
                </div>
                <div style={{fontSize:11,color:C.textSec,lineHeight:1.6}}>
                  {training.assignmentCount} assignment{training.assignmentCount===1?"":"s"} ·{" "}
                  {training.overdue > 0
                    ? <span style={{color:C.amber}}>{training.overdue} overdue</span>
                    : "none overdue"}
                </div>
              </>
            )}
          </Panel>
        </div>

        <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
          <Panel title="Open Action Items" flex="1 1 380px">
            {(() => {
              const pr = data.results?.priorities?.priorities || [];
              const items = pr.slice(0,4);
              if (items.length === 0) return <div style={{color:C.textSec,fontSize:13}}>No open items — you're all caught up.</div>;
              return items.map((it,i)=>(
                <div key={i} style={{display:"flex",gap:10,padding:"9px 0",
                  borderBottom:i<items.length-1?`1px solid ${C.border}`:"none"}}>
                  <span style={{width:22,height:22,borderRadius:6,flexShrink:0,fontSize:11,fontWeight:700,
                    background:`${C.accent}18`,color:C.accent,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {it.rank||i+1}
                  </span>
                  <div style={{flex:1}}>
                    <div style={{color:C.text,fontSize:13,fontWeight:600}}>{it.title}</div>
                    <div style={{color:C.textMut,fontSize:11,marginTop:2}}>
                      {it.effort ? it.effort : ""}{it.impact ? ` · ${it.impact} impact` : ""}
                    </div>
                  </div>
                </div>
              ));
            })()}
          </Panel>

          <Panel title="Analyst Activity" flex="1 1 380px">
            {/* Real, read-only feed of what your analyst has actually sent —
                review decisions, notes on your program. There is no live chat
                channel yet, so this does not simulate one; it shows what's real. */}
            {notifications === null ? (
              <div style={{color:C.textSec,fontSize:13,padding:"20px 0",textAlign:"center"}}>No data to report</div>
            ) : !(notifications.notifications||[]).length ? (
              <div style={{color:C.textSec,fontSize:12.5,lineHeight:1.6,padding:"10px 0"}}>
                No activity from your analyst yet. Updates on your program and any notes they leave
                will appear here.
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:220,overflowY:"auto"}}>
                {notifications.notifications.slice(0,8).map(n=>(
                  <div key={n.id} style={{padding:"9px 11px",borderRadius:9,fontSize:12,lineHeight:1.5,
                    background:C.surface,border:`1px solid ${n.read?C.border:C.accent+"55"}`}}>
                    <div style={{color:C.text,fontWeight:600,marginBottom:2}}>{n.title}</div>
                    <div style={{color:C.textSec}}>{n.body}</div>
                    <div style={{fontSize:10,color:C.textMut,marginTop:4}}>
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div style={{marginTop:18,padding:"11px 16px",background:`${C.accent}0A`,
          border:`1px dashed ${C.accent}33`,borderRadius:10,textAlign:"center"}}>
          <span style={{color:C.textSec,fontSize:11}}>
            Every figure on this page reflects your real data — posture score, trend, compliance,
            training, and analyst activity. Where something hasn't been set up or scored yet, it says
            so instead of showing a placeholder number.
          </span>
        </div>
      </div>
    </div>
  );
}

// Light-theme trend chart for the company console
function TrendChartLight({ data, color }) {
  const w = 560, h = 130, pad = 8;
  const min = Math.min(...data) - 5, max = Math.max(...data) + 5;
  const range = max - min || 1;
  const pts = data.map((v,i)=>{
    const x = pad + (i/(data.length-1))*(w-pad*2);
    const y = h - pad - ((v-min)/range)*(h-pad*2);
    return [x,y];
  });
  const path = pts.map((p,i)=>`${i===0?"M":"L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${path} L${pts[pts.length-1][0].toFixed(1)},${h-pad} L${pts[0][0].toFixed(1)},${h-pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{width:"100%",height:"auto"}}>
      <defs>
        <linearGradient id="ccTrend" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      {[0,0.5,1].map((g,i)=>(
        <line key={i} x1={pad} y1={pad+g*(h-pad*2)} x2={w-pad} y2={pad+g*(h-pad*2)}
          stroke={C.border} strokeWidth="1"/>
      ))}
      <path d={area} fill="url(#ccTrend)"/>
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round"/>
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="4" fill={color}/>
    </svg>
  );
}

function HomeScreen({ user, onNewAssessment, onOpenProgram, onEditAssessment, onOpenConsole }) {
  const [assessments, setAssessments] = useState([]);
  const [programsByAssessment, setProgramsByAssessment] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [opening, setOpening] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/assessments`);
      if (!res.ok) throw new Error("Failed to load your assessments");
      const list = await res.json();
      // newest first
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setAssessments(list);

      // For each assessment, fetch its programs (to know if one exists + its status)
      const map = {};
      await Promise.all(list.map(async (a) => {
        try {
          const pRes = await authFetch(`${API_BASE}/api/assessments/${a.id}/programs`);
          if (pRes.ok) {
            const programs = await pRes.json();
            programs.sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));
            map[a.id] = programs;
          }
        } catch { map[a.id] = []; }
      }));
      setProgramsByAssessment(map);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function openLatestProgram(assessmentId) {
    const programs = programsByAssessment[assessmentId] || [];
    const complete = programs.find(p => p.status === "complete");
    const target = complete || programs[0];
    if (!target) return;
    setOpening(assessmentId);
    try {
      await onOpenProgram(assessmentId, target.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setOpening(null);
    }
  }

  return (
    <div style={{minHeight:"calc(100vh - 56px)",background:C.bg,
      fontFamily:"Inter,system-ui,sans-serif",color:C.text}}>
      <div style={{maxWidth:900,margin:"0 auto",padding:"32px 24px"}}>

        {/* Welcome header */}
        <div style={{display:"flex",alignItems:"flex-start",gap:16,marginBottom:28}}>
          <div style={{flex:1}}>
            <h1 style={{fontSize:26,fontWeight:700,margin:"0 0 6px",color:C.text}}>
              Welcome back{user.companyName ? `, ${user.companyName}` : ""}
            </h1>
            <p style={{color:C.textSec,fontSize:14,margin:0}}>
              Your saved security assessments and programs.
            </p>
          </div>
          <button onClick={onNewAssessment}
            style={{padding:"12px 22px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
              color:C.bg,border:"none",borderRadius:10,fontSize:14,fontWeight:700,
              cursor:"pointer",whiteSpace:"nowrap",boxShadow:`0 0 30px ${C.accent}33`}}>
            + New Assessment
          </button>
        </div>

        {error && (
          <div style={{marginBottom:16,padding:"10px 14px",background:`${C.red}15`,
            border:`1px solid ${C.red}33`,borderRadius:8,color:C.red,fontSize:13}}>{error}</div>
        )}

        {loading ? (
          <Spinner/>
        ) : assessments.length === 0 ? (
          /* Empty state */
          <Card style={{textAlign:"center",padding:"48px 24px"}}>
            <div style={{display:"flex",justifyContent:"center",marginBottom:14}}><ShieldLogo size={44}/></div>
            <div style={{color:C.text,fontWeight:600,fontSize:16,marginBottom:8}}>
              No assessments yet
            </div>
            <p style={{color:C.textSec,fontSize:14,margin:"0 0 20px",lineHeight:1.6}}>
              Run your first security assessment to generate a customized
              cybersecurity program for your business.
            </p>
            <button onClick={onNewAssessment}
              style={{padding:"12px 28px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
                color:C.bg,border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer"}}>
              Start Your First Assessment →
            </button>
          </Card>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <SectionLabel text={`Your Assessments (${assessments.length})`}/>
            {assessments.map(a => {
              const programs = programsByAssessment[a.id] || [];
              const complete = programs.find(p => p.status === "complete");
              const running = programs.find(p => p.status === "running");
              const company = a.company || {};
              return (
                <Card key={a.id} style={{padding:"18px 20px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:16}}>
                    <div style={{width:44,height:44,borderRadius:10,flexShrink:0,
                      background:`${C.accent}15`,border:`1px solid ${C.accent}33`,
                      display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>
                      🏢
                    </div>
                    <div style={{flex:1}}>
                      <div style={{color:C.text,fontWeight:600,fontSize:15}}>
                        {company.name || "(unnamed company)"}
                      </div>
                      <div style={{color:C.textSec,fontSize:12,marginTop:3}}>
                        {company.industry ? `${company.industry} · ` : ""}
                        Created {new Date(a.createdAt).toLocaleDateString()}
                      </div>
                      <div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
                        {complete && <Badge label="Program ready" color={C.green}/>}
                        {running && !complete && <Badge label="Generating…" color={C.amber}/>}
                        {!complete && !running && <Badge label="No program yet" color={C.textSec}/>}
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:8,alignItems:"stretch"}}>
                      {complete ? (
                        <>
                          <button onClick={() => onOpenConsole(a.id, complete.id)}
                            style={{padding:"10px 20px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
                              color:C.bg,border:"none",borderRadius:8,fontSize:13,fontWeight:700,
                              cursor:"pointer",whiteSpace:"nowrap"}}>
                            📊 My Console
                          </button>
                          <button onClick={() => openLatestProgram(a.id)} disabled={opening===a.id}
                            style={{padding:"8px 20px",background:"none",border:`1px solid ${C.borderHi}`,
                              borderRadius:8,color:C.accent,fontSize:12,fontWeight:600,
                              cursor:opening===a.id?"wait":"pointer",whiteSpace:"nowrap"}}>
                            {opening===a.id ? "Opening…" : "Open Program →"}
                          </button>
                        </>
                      ) : (
                        <span style={{color:C.textMut,fontSize:12,textAlign:"center"}}>—</span>
                      )}
                      <button onClick={() => onEditAssessment(a.id)}
                        style={{padding:"8px 20px",background:"none",border:`1px solid ${C.border}`,
                          borderRadius:8,color:C.textSec,fontSize:12,fontWeight:600,
                          cursor:"pointer",whiteSpace:"nowrap"}}>
                        ✎ Edit
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  EDIT ASSESSMENT — revise company info + checklist, optionally regenerate
// ─────────────────────────────────────────────────────────────
function EditAssessmentScreen({ assessmentId, onCancel, onSaved, onRegenerate }) {
  // Live catalogue, not the stale 7-item constant.
  const COMPLIANCE_FRAMEWORKS = useFrameworkCatalog();
  const SECURITY_CHECKLIST = useSecurityChecklist();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [company, setCompany] = useState({ name: "", industry: "", employees: "" });
  const [answers, setAnswers] = useState({});
  const [frameworks, setFrameworks] = useState(["nist-csf"]);
  const [cisIG, setCisIG] = useState("IG1");
  const [hasProgram, setHasProgram] = useState(false);
  const [showRegenChoice, setShowRegenChoice] = useState(false);

  function toggleFrameworkEdit(id) {
    const fw = COMPLIANCE_FRAMEWORKS.find(f => f.id === id);
    if (fw?.always) return;
    setFrameworks(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch(`${API_BASE}/api/assessments/${assessmentId}`);
        if (!res.ok) throw new Error("Could not load assessment");
        const rec = await res.json();
        const data = rec.data || {};
        setCompany({
          name: data.company?.name || "",
          industry: data.company?.industry || "",
          employees: data.company?.employees || "",
        });
        setAnswers(data.checklist || {});
        // Restore previously selected compliance frameworks (NIST CSF always on)
        const savedFw = Array.isArray(data.selectedFrameworks) ? data.selectedFrameworks : [];
        const ids = savedFw.map(f => f.id).filter(Boolean);
        setFrameworks(ids.includes("nist-csf") ? ids : ["nist-csf", ...ids]);
        const cisEntry = savedFw.find(f => f.id === "cis");
        if (cisEntry?.implementationGroup) setCisIG(cisEntry.implementationGroup);

        const pRes = await authFetch(`${API_BASE}/api/assessments/${assessmentId}/programs`);
        if (pRes.ok) {
          const programs = await pRes.json();
          setHasProgram(programs.some(p => p.status === "complete"));
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [assessmentId]);

  const total = SECURITY_CHECKLIST.length;
  const answered = Object.keys(answers).length;
  const allAnswered = answered === total;

  function buildUpdatedData() {
    return {
      company: { name: company.name, industry: company.industry, employees: company.employees },
      checklist: answers,
      selectedFrameworks: frameworks.map(id => {
        const fw = COMPLIANCE_FRAMEWORKS.find(f => f.id === id);
        const entry = { id, name: fw?.name || id };
        if (id === "cis") entry.implementationGroup = cisIG;
        return entry;
      }),
    };
  }

  async function saveOnly() {
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/assessments/${assessmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: buildUpdatedData() }),
      });
      if (!res.ok) throw new Error("Failed to save changes");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveThenRegenerate(replaceOld) {
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/assessments/${assessmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: buildUpdatedData() }),
      });
      if (!res.ok) throw new Error("Failed to save changes");
      // Hand off to the root regenerate handler (it manages the program lifecycle)
      await onRegenerate(assessmentId, replaceOld);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  // Scoring questions group under their NIST function; evidence questions under
  // their own section (Access & Identity, Data Protection, Vendors, Governance,
  // Privacy). Grouping evidence questions by nistFunction would file them all
  // under "undefined" — they deliberately have no NIST weight.
  const grouped = SECURITY_CHECKLIST.reduce((acc, q) => {
    const key = q.affectsPostureScore === false
      ? (q.section || "Additional detail")
      : q.nistFunction;
    (acc[key] = acc[key] || []).push(q);
    return acc;
  }, {});

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",background:C.bg,
      fontFamily:"Inter,system-ui,sans-serif",color:C.text}}>
      <div style={{padding:"12px 20px",background:C.surface,borderBottom:`1px solid ${C.border}`,
        display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontWeight:600,color:C.text}}>Edit Assessment</span>
        <button onClick={onCancel} style={{marginLeft:"auto",padding:"5px 12px",background:"none",
          border:`1px solid ${C.border}`,borderRadius:6,color:C.textSec,fontSize:11,cursor:"pointer"}}>
          ← Cancel
        </button>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"24px"}}>
        <div style={{maxWidth:760,margin:"0 auto"}}>
          {loading ? <Spinner/> : (
            <>
              {error && (
                <div style={{marginBottom:16,padding:"10px 14px",background:`${C.red}15`,
                  border:`1px solid ${C.red}33`,borderRadius:8,color:C.red,fontSize:13}}>{error}</div>
              )}

              {/* Company info */}
              <SectionLabel text="Company Information"/>
              <Card style={{marginBottom:24}}>
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  <div>
                    <label style={{display:"block",color:C.textSec,fontSize:12,marginBottom:6}}>Company Name</label>
                    <input value={company.name} onChange={e=>setCompany({...company,name:e.target.value})}
                      style={inputStyle}/>
                  </div>
                  <div style={{display:"flex",gap:12}}>
                    <div style={{flex:1}}>
                      <label style={{display:"block",color:C.textSec,fontSize:12,marginBottom:6}}>Industry</label>
                      <input value={company.industry} onChange={e=>setCompany({...company,industry:e.target.value})}
                        style={inputStyle}/>
                    </div>
                    <div style={{flex:1}}>
                      <label style={{display:"block",color:C.textSec,fontSize:12,marginBottom:6}}>Employees</label>
                      <input value={company.employees} onChange={e=>setCompany({...company,employees:e.target.value})}
                        style={inputStyle}/>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Compliance frameworks */}
              <SectionLabel text="Compliance Frameworks"/>
              <Card style={{padding:"16px 18px",marginBottom:20}}>
                <p style={{color:C.textSec,fontSize:13,lineHeight:1.5,margin:"0 0 12px"}}>
                  Frameworks to map against. NIST CSF is always the scoring baseline.
                </p>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {COMPLIANCE_FRAMEWORKS.map(fw => {
                    const on = frameworks.includes(fw.id);
                    return (
                      <button key={fw.id} onClick={() => toggleFrameworkEdit(fw.id)}
                        title={fw.desc} disabled={fw.always}
                        style={{padding:"8px 12px",borderRadius:9,
                          cursor: fw.always ? "default" : "pointer",
                          background: on ? `${C.accent}18` : C.surface,
                          border:`1px solid ${on ? C.accent : C.border}`,
                          color: on ? C.text : C.textSec,
                          fontFamily:"Inter,system-ui,sans-serif",fontSize:13,fontWeight:600,
                          display:"flex",alignItems:"center",gap:8,transition:"all 0.15s"}}>
                        <span style={{width:14,height:14,borderRadius:4,flexShrink:0,
                          border:`2px solid ${on ? C.accent : C.textMut}`,
                          background: on ? C.accent : "transparent",
                          display:"flex",alignItems:"center",justifyContent:"center"}}>
                          {on && <span style={{color:C.bg,fontSize:9,fontWeight:900,lineHeight:1}}>✓</span>}
                        </span>
                        <span style={{display:"flex",flexDirection:"column",alignItems:"flex-start",lineHeight:1.25}}>
                          <span>{fw.name}</span>
                          {/* Same honesty as the intake picker: an AI-assisted
                              framework is a gap analysis, not a control
                              walkthrough, and the client picks with that known. */}
                          {fw.depth === "ai-assisted" ? (
                            <span style={{fontSize:9.5,color:C.amber,fontWeight:400}}>AI gap analysis</span>
                          ) : typeof fw.requirementCount === "number" ? (
                            <span style={{fontSize:9.5,color:C.textMut,fontWeight:400}}>{fw.requirementCount} controls</span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {frameworks.includes("cis") && (
                  <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
                    <div style={{color:C.text,fontSize:12,fontWeight:600,marginBottom:8}}>
                      CIS Implementation Group
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      {CIS_IG_OPTIONS.map(ig => {
                        const sel = cisIG === ig.id;
                        return (
                          <button key={ig.id} onClick={() => setCisIG(ig.id)} title={ig.sub}
                            style={{padding:"7px 14px",borderRadius:8,cursor:"pointer",
                              background: sel ? `${C.accent}18` : C.surface,
                              border:`1px solid ${sel ? C.accent : C.border}`,
                              color: sel ? C.text : C.textSec,
                              fontFamily:"Inter,system-ui,sans-serif",fontSize:13,fontWeight:700,
                              transition:"all 0.15s"}}>
                            {ig.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Card>

              {/* Checklist */}
              <SectionLabel text={`Security Checklist (${answered}/${total} answered)`}/>
              {Object.entries(grouped).map(([fn, questions]) => (
                <div key={fn} style={{marginBottom:20}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:NIST_COLORS[fn]}}/>
                    <span style={{color:NIST_COLORS[fn],fontSize:12,fontWeight:700,
                      letterSpacing:1.5,textTransform:"uppercase"}}>{fn}</span>
                  </div>
                  {questions.map(q => (
                    <div key={q.id} style={{marginBottom:14,padding:"14px 16px",background:C.card,
                      border:`1px solid ${answers[q.id] ? NIST_COLORS[fn]+"44" : C.border}`,borderRadius:12}}>
                      <div style={{color:C.text,fontSize:14,fontWeight:600,marginBottom:10}}>{q.question}</div>
                      <div style={{display:"flex",flexDirection:"column",gap:6}}>
                        {q.options.map(opt => {
                          const selected = answers[q.id] === opt;
                          return (
                            <button key={opt} onClick={()=>setAnswers({...answers,[q.id]:opt})}
                              style={{textAlign:"left",padding:"9px 12px",borderRadius:8,cursor:"pointer",
                                background: selected ? `${NIST_COLORS[fn]}18` : C.surface,
                                border:`1px solid ${selected ? NIST_COLORS[fn] : C.border}`,
                                color: selected ? C.text : C.textSec,
                                fontSize:13,fontWeight: selected ? 600 : 400,
                                fontFamily:"Inter,system-ui,sans-serif",display:"flex",alignItems:"center",gap:10}}>
                              <span style={{width:15,height:15,borderRadius:"50%",flexShrink:0,
                                border:`2px solid ${selected ? NIST_COLORS[fn] : C.textMut}`,
                                background: selected ? NIST_COLORS[fn] : "transparent",
                                display:"flex",alignItems:"center",justifyContent:"center"}}>
                                {selected && <span style={{width:5,height:5,borderRadius:"50%",background:C.bg}}/>}
                              </span>
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              {/* Actions */}
              {!showRegenChoice ? (
                <div style={{display:"flex",gap:12,marginTop:8,marginBottom:40}}>
                  <button onClick={saveOnly} disabled={saving || !allAnswered}
                    style={{flex:1,padding:"13px",borderRadius:10,border:`1px solid ${C.border}`,
                      background:C.surface,color: saving||!allAnswered ? C.textMut : C.text,
                      fontSize:14,fontWeight:600,cursor: saving||!allAnswered ? "not-allowed":"pointer"}}>
                    {saving ? "Saving…" : "Save Changes Only"}
                  </button>
                  <button onClick={()=> hasProgram ? setShowRegenChoice(true) : saveThenRegenerate(true)}
                    disabled={saving || !allAnswered}
                    style={{flex:1,padding:"13px",borderRadius:10,border:"none",
                      background: saving||!allAnswered ? C.border : `linear-gradient(135deg,${C.accent},${C.accentDm})`,
                      color: saving||!allAnswered ? C.textMut : C.bg,
                      fontSize:14,fontWeight:700,cursor: saving||!allAnswered ? "not-allowed":"pointer"}}>
                    Save &amp; Regenerate Program →
                  </button>
                </div>
              ) : (
                <Card style={{marginTop:8,marginBottom:40,border:`1px solid ${C.accent}44`}}>
                  <div style={{color:C.text,fontWeight:600,fontSize:14,marginBottom:6}}>
                    You already have a program for this assessment
                  </div>
                  <p style={{color:C.textSec,fontSize:13,margin:"0 0 14px",lineHeight:1.6}}>
                    Regenerating will create a new program with your updated answers. What should
                    happen to the existing one?
                  </p>
                  <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                    <button onClick={()=>saveThenRegenerate(false)} disabled={saving}
                      style={{flex:1,minWidth:200,padding:"12px",borderRadius:10,border:`1px solid ${C.border}`,
                        background:C.surface,color:C.text,fontSize:13,fontWeight:600,cursor:"pointer"}}>
                      Keep both (new one in history)
                    </button>
                    <button onClick={()=>saveThenRegenerate(true)} disabled={saving}
                      style={{flex:1,minWidth:200,padding:"12px",borderRadius:10,border:"none",
                        background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
                        color:C.bg,fontSize:13,fontWeight:700,cursor:"pointer"}}>
                      Replace the old program
                    </button>
                  </div>
                  <button onClick={()=>setShowRegenChoice(false)} disabled={saving}
                    style={{marginTop:10,padding:"6px 0",background:"none",border:"none",
                      color:C.textSec,fontSize:12,cursor:"pointer"}}>
                    ← Back
                  </button>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  ANALYST CONSOLE — SOC-style command center (MOCKUP)
//  The internal console where ShieldAI's cybersecurity engineers
//  run CISO programs for a portfolio of clients. Vision mockup:
//  every panel shows what the platform makes possible, populated
//  with believable sample data.
// ─────────────────────────────────────────────────────────────

const ANALYST_EMAIL = "analyst@xandultd.com";

// SOC palette (dark, data-dense)
const SOC = {
  bg: "#070B14",
  panel: "#0C1322",
  panelHi: "#111B2E",
  border: "#1A2840",
  grid: "#152133",
  text: "#E6EEFB",
  textSec: "#8AA0C0",
  textMut: "#56688A",
  cyan: "#00E5FF",
  green: "#00E5A0",
  amber: "#FFB020",
  red: "#FF4D5E",
  purple: "#9B7CFF",
  blue: "#3B82F6",
};

function pColor(s) {
  // null/undefined means we haven't scored this client. It must NOT fall through
  // to the red branch — an unscored client is not a critical one, and painting
  // it red is as much a fabrication as painting it green. Neutral says "unknown",
  // which is the truth and prompts someone to go and look.
  if (typeof s !== "number") return SOC.textMut;
  return s >= 80 ? SOC.green : s >= 60 ? "#7ED957" : s >= 40 ? SOC.amber : SOC.red;
}

// Three-state agent health indicator
//  healthy  → green  (working properly)
//  degraded → yellow (partially degraded — reduced coverage / intermittent)
//  offline  → red    (no communication — not detected)
//  pending  → grey   (not yet deployed)
function agentMeta(status) {
  switch (status) {
    case "healthy":  return { color: SOC.green,  dot: SOC.green,  label: "AGENT HEALTHY",  short: "Healthy",  glow: true };
    case "degraded": return { color: SOC.amber,  dot: SOC.amber,  label: "AGENT DEGRADED", short: "Degraded", glow: true };
    case "offline":  return { color: SOC.red,    dot: SOC.red,    label: "NO COMMS",       short: "Offline",  glow: true };
    default:         return { color: SOC.textMut, dot: SOC.textMut, label: "NO AGENT",      short: "Pending",  glow: false };
  }
}

// 12 months of posture history per client (trend story)
// SAMPLE_CLIENTS deleted.
//
// 143 lines of hardcoded fake clients — "Meridian Dental Group", posture 53,
// $1,800 MRR, invented phishing alerts — that drove the analyst console's
// landing page and its KPI tiles, including Monthly Recurring Revenue and
// Average Posture. Real client data was already being fetched from
// /api/analyst/clients and rendered only in a secondary tab.
//
// The console now reads /api/analyst/portfolio. Every field is real or
// explicitly null, and null renders as "—".

// ── Small SVG sparkline / trend chart ──
function TrendChart({ data, color, height = 120 }) {
  const w = 520, h = height, pad = 8;
  const min = Math.min(...data) - 5, max = Math.max(...data) + 5;
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y];
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${path} L${pts[pts.length-1][0].toFixed(1)},${h-pad} L${pts[0][0].toFixed(1)},${h-pad} Z`;
  const months = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun"];
  return (
    <svg viewBox={`0 0 ${w} ${h+20}`} style={{width:"100%",height:"auto"}}>
      <defs>
        <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      {[0,0.25,0.5,0.75,1].map((g,i)=>(
        <line key={i} x1={pad} y1={pad+g*(h-pad*2)} x2={w-pad} y2={pad+g*(h-pad*2)} stroke={SOC.grid} strokeWidth="1"/>
      ))}
      <path d={area} fill="url(#tg)"/>
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round"/>
      {pts.map((p,i)=>(
        <circle key={i} cx={p[0]} cy={p[1]} r={i===pts.length-1?4:0} fill={color}/>
      ))}
      {months.map((m,i)=>(
        i % 2 === 0 ? <text key={i} x={pad+(i/(data.length-1))*(w-pad*2)} y={h+14} fill={SOC.textMut} fontSize="9" textAnchor="middle">{m}</text> : null
      ))}
    </svg>
  );
}

// ── Analyst drilldown: read a client's actual assessments, programs, policies ──
// The portfolio gives posture/alerts/review-queue, but an analyst couldn't open
// the underlying documents. These read /api/analyst/clients/:id/{assessments,
// programs,policies} (list) and .../:docId (full detail), all assignment-scoped
// server-side. Read-only: analysts review, they don't edit client content here.
function ClientDocuments({ clientId }) {
  const [tab, setTab] = useState("assessments"); // assessments | programs | policies
  const [lists, setLists] = useState({ assessments: null, programs: null, policies: null });
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);   // { kind, id }
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const endpoints = {
    assessments: `/api/analyst/clients/${clientId}/assessments`,
    programs:    `/api/analyst/clients/${clientId}/programs`,
    policies:    `/api/analyst/clients/${clientId}/policies`,
  };

  async function loadList(kind) {
    if (lists[kind] != null) return;
    try {
      const res = await authFetch(`${API_BASE}${endpoints[kind]}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `Could not load ${kind}.`);
      setLists(prev => ({ ...prev, [kind]: Array.isArray(d) ? d : [] }));
    } catch (e) { setError(e.message); setLists(prev => ({ ...prev, [kind]: [] })); }
  }
  useEffect(() => { loadList(tab); /* eslint-disable-next-line */ }, [tab, clientId]);

  async function openDoc(kind, id) {
    setOpen({ kind, id }); setDetail(null); setDetailLoading(true); setError(null);
    const path = kind === "assessments" ? `${endpoints.assessments}/${id}`
      : kind === "programs" ? `${endpoints.programs}/${id}`
      : `${endpoints.policies}/${id}`;
    try {
      const res = await authFetch(`${API_BASE}${path}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load document.");
      setDetail(d);
    } catch (e) { setError(e.message); }
    finally { setDetailLoading(false); }
  }

  const rows = lists[tab];
  const tabs = [["assessments","Assessments"],["programs","Programs"],["policies","Policies"]];

  function reviewChip(status) {
    if (!status) return null;
    const m = { approved:{c:SOC.green,l:"Approved"}, awaiting_review:{c:SOC.amber,l:"In Review"},
      changes_requested:{c:SOC.red,l:"Changes Requested"}, draft:{c:SOC.textMut,l:"Draft"} }[status]
      || { c:SOC.textMut, l:status };
    return <span style={{fontSize:9,fontWeight:700,color:m.c,textTransform:"uppercase",
      padding:"2px 8px",borderRadius:20,background:`${m.c}18`}}>{m.l}</span>;
  }

  return (
    <SocPanel title="Client Documents" accent={SOC.purple}
      action={<span style={{fontSize:9,color:SOC.textMut}}>READ-ONLY · ASSIGNMENT-SCOPED</span>}>
      {/* tabs */}
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        {tabs.map(([id,label]) => {
          const n = lists[id]?.length;
          return (
            <button key={id} onClick={()=>{setTab(id);setOpen(null);setDetail(null);}}
              style={{padding:"6px 14px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",
                border:`1px solid ${tab===id?SOC.purple:SOC.border}`,
                background:tab===id?`${SOC.purple}1A`:SOC.bg,
                color:tab===id?SOC.purple:SOC.textSec}}>
              {label}{n!=null?` (${n})`:""}
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{marginBottom:10,padding:"8px 11px",background:`${SOC.red}15`,
          border:`1px solid ${SOC.red}33`,borderRadius:7,color:SOC.red,fontSize:12}}>{error}</div>
      )}

      {/* list */}
      {rows == null ? <Spinner/> : rows.length === 0 ? (
        <div style={{color:SOC.textSec,fontSize:12,padding:"16px 0",textAlign:"center"}}>
          No {tab} on file for this client.
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {rows.map(r => {
            const isOpen = open?.kind === tab && open?.id === r.id;
            const title = tab === "assessments" ? (r.company || "Security Assessment")
              : tab === "programs" ? `Program · ${r.postureLevel || "generated"}`
              : (r.policyName || r.policyId || "Policy");
            const sub = tab === "assessments" ? (r.compliance || []).join(", ")
              : tab === "programs" ? (r.postureScore != null ? `Posture ${r.postureScore}` : r.status)
              : r.policyId;
            return (
              <div key={r.id}>
                <div onClick={()=>isOpen?setOpen(null):openDoc(tab, r.id)}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",cursor:"pointer",
                    background:isOpen?SOC.panelHi:SOC.bg,borderRadius:8,
                    border:`1px solid ${isOpen?SOC.purple+"55":SOC.border}`}}>
                  <span style={{fontSize:15}}>{tab==="assessments"?"📋":tab==="programs"?"🗂️":"📄"}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{color:SOC.text,fontSize:12.5,fontWeight:600}}>{title}</div>
                    {sub && <div style={{color:SOC.textMut,fontSize:10,marginTop:1}}>{sub}</div>}
                  </div>
                  {reviewChip(r.reviewStatus)}
                  <span style={{fontSize:10,color:SOC.textMut}}>{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ""}</span>
                  <span style={{color:SOC.textMut,fontSize:11}}>{isOpen?"▲":"▼"}</span>
                </div>

                {/* inline detail */}
                {isOpen && (
                  <div style={{padding:"12px 14px",background:SOC.bg,borderRadius:8,marginTop:4,
                    border:`1px solid ${SOC.border}`}}>
                    {detailLoading ? <Spinner/> : detail ? (
                      <ClientDocDetail kind={tab} doc={detail}/>
                    ) : (
                      <div style={{color:SOC.textSec,fontSize:12}}>Nothing to display.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SocPanel>
  );
}

// Renders the full detail of an opened client document, shaped by kind.
function ClientDocDetail({ kind, doc }) {
  const label = { color:SOC.textMut, fontSize:10, letterSpacing:1, fontWeight:600, marginBottom:4 };
  if (kind === "assessments") {
    const data = doc.data || {};
    const checklist = data.checklist || data.securityChecklist || {};
    const entries = Object.entries(checklist);
    return (
      <div style={{fontSize:12,color:SOC.textSec,lineHeight:1.6}}>
        <div style={label}>COMPANY</div>
        <div style={{color:SOC.text,marginBottom:10}}>{data.company || "—"}</div>
        {(data.compliance || []).length > 0 && (
          <>
            <div style={label}>FRAMEWORKS</div>
            <div style={{marginBottom:10,display:"flex",gap:6,flexWrap:"wrap"}}>
              {data.compliance.map((f,i)=>(
                <span key={i} style={{padding:"2px 9px",borderRadius:6,background:`${SOC.cyan}15`,
                  border:`1px solid ${SOC.cyan}33`,color:SOC.cyan,fontSize:11}}>{f}</span>
              ))}
            </div>
          </>
        )}
        <div style={label}>RESPONSES ({entries.length})</div>
        {entries.length === 0 ? <div>No answers recorded.</div> : (
          <div style={{display:"flex",flexDirection:"column",gap:5,marginTop:4}}>
            {entries.map(([k,v])=>(
              <div key={k} style={{display:"flex",gap:8,paddingBottom:5,borderBottom:`1px solid ${SOC.border}`}}>
                <span style={{color:SOC.textMut,minWidth:150,fontSize:11}}>{k}</span>
                <span style={{color:SOC.text,fontSize:11.5}}>{String(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (kind === "programs") {
    const sections = doc.sections || {};
    const keys = Object.keys(sections);
    return (
      <div style={{fontSize:12,color:SOC.textSec,lineHeight:1.6}}>
        <div style={label}>PROGRAM SECTIONS ({keys.length})</div>
        {keys.length === 0 ? <div>No sections generated.</div> : (
          <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:6}}>
            {keys.map(k => {
              const sec = sections[k];
              const preview = typeof sec === "string" ? sec
                : sec?.summary || sec?.overview
                || (Array.isArray(sec) ? `${sec.length} item(s)` : JSON.stringify(sec).slice(0,220));
              return (
                <div key={k} style={{padding:"8px 10px",background:SOC.panel,borderRadius:7}}>
                  <div style={{color:SOC.text,fontSize:11.5,fontWeight:600,textTransform:"capitalize",marginBottom:3}}>
                    {k.replace(/([A-Z])/g," $1").trim()}
                  </div>
                  <div style={{fontSize:11,color:SOC.textSec}}>{String(preview).slice(0,260)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  // policies
  const content = doc.content || doc.policyText || doc.body || "";
  return (
    <div style={{fontSize:12,color:SOC.textSec,lineHeight:1.6}}>
      <div style={label}>{doc.policyName || doc.policyId || "POLICY"}</div>
      {doc.status && <div style={{fontSize:11,color:SOC.textMut,marginBottom:8}}>Status: {doc.status}</div>}
      {content ? (
        <div style={{whiteSpace:"pre-wrap",maxHeight:340,overflowY:"auto",padding:"10px 12px",
          background:SOC.panel,borderRadius:7,color:SOC.text,fontSize:11.5,lineHeight:1.7}}>
          {typeof content === "string" ? content : JSON.stringify(content, null, 2)}
        </div>
      ) : <div>No document content stored.</div>}
    </div>
  );
}

// ── White-label branding manager (analyst/admin) ──
// Staff edit their own brand (clients inherit it); admins additionally set the
// platform default and see white-label coverage. All writes go through
// /api/branding/mine and /api/admin/branding/*; logos become base64 data URIs
// capped at 512KB to match the backend validator.
const BRANDING_LOGO_MAX = 512 * 1024;
const BRAND_FIELDS = { productName: "", companyName: "", tagline: "", primaryColor: "#2E5EAA",
  accentColor: "#22D3EE", supportEmail: "", supportUrl: "", footerNote: "", logoUrl: null };

function brandInput(v) { return v == null ? "" : v; }

function BrandLivePreview({ b }) {
  return (
    <div style={{border:`1px solid ${SOC.border}`,borderRadius:12,overflow:"hidden"}}>
      <div style={{padding:"14px 18px",background:b.primaryColor||"#2E5EAA",
        display:"flex",alignItems:"center",gap:12}}>
        {b.logoUrl
          ? <img src={b.logoUrl} alt="" style={{height:28,maxWidth:120,objectFit:"contain"}}/>
          : <span style={{fontSize:17,fontWeight:800,color:"#fff"}}>{b.productName||"ShieldAI"}</span>}
        <span style={{marginLeft:"auto",fontSize:11,color:"#ffffffcc"}}>{b.tagline||"Virtual CISO Platform"}</span>
      </div>
      <div style={{padding:"16px 18px",background:SOC.panel}}>
        <div style={{fontSize:13,color:SOC.text,fontWeight:700,marginBottom:6}}>{b.companyName||"ShieldAI"}</div>
        <button style={{padding:"7px 14px",borderRadius:7,border:"none",cursor:"default",
          background:b.accentColor||"#22D3EE",color:"#04121F",fontSize:12,fontWeight:700}}>
          Sample Action
        </button>
        <div style={{marginTop:12,fontSize:10,color:SOC.textMut}}>
          {b.footerNote || "Powered by ShieldAI"}
          {b.supportEmail && <> · {b.supportEmail}</>}
        </div>
      </div>
    </div>
  );
}

function BrandingManager({ isAdmin }) {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [overview, setOverview] = useState(null);
  const [scope, setScope] = useState("mine"); // mine | platform (admin only)
  const logoRef = useRef(null);

  async function loadMine() {
    setLoading(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/branding/mine`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load branding.");
      setForm({ ...BRAND_FIELDS, ...d, logoUrl: d.logoUrl || null });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  async function loadOverview() {
    if (!isAdmin) return;
    try {
      const res = await authFetch(`${API_BASE}/api/admin/branding`);
      if (res.ok) setOverview(await res.json());
    } catch { /* non-fatal */ }
  }
  useEffect(() => { loadMine(); loadOverview(); /* eslint-disable-next-line */ }, []);

  function flash(msg, tone = SOC.green) { setToast({ msg, tone }); setTimeout(() => setToast(null), 3000); }
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function onLogo(file) {
    if (!file) return;
    if (file.size > BRANDING_LOGO_MAX) { setError(`Logo is ${(file.size/1024).toFixed(0)}KB — the limit is 512KB.`); return; }
    const okTypes = ["image/png","image/jpeg","image/jpg","image/svg+xml","image/webp"];
    if (!okTypes.includes(file.type)) { setError("Logo must be PNG, JPEG, SVG, or WebP."); return; }
    try {
      const dataUri = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Could not read the logo."));
        r.readAsDataURL(file);
      });
      set("logoUrl", dataUri);
      setError(null);
    } catch (e) { setError(e.message); }
  }

  function buildPatch() {
    // Only send the editable fields; empty strings become null server-side.
    const p = {};
    for (const k of Object.keys(BRAND_FIELDS)) {
      let v = form[k];
      if (typeof v === "string") v = v.trim();
      p[k] = v === "" ? null : v;
    }
    // productName/companyName can't be null on the backend — fall back sensibly.
    if (!p.productName) p.productName = "ShieldAI";
    if (!p.companyName) p.companyName = p.productName;
    return p;
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      const path = (isAdmin && scope === "platform")
        ? `/api/admin/branding/platform` : `/api/branding/mine`;
      const res = await authFetch(`${API_BASE}${path}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPatch()),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Save failed.");
      setForm({ ...BRAND_FIELDS, ...d, logoUrl: d.logoUrl || null });
      // Reflect a saved *own* brand in the live app chrome immediately.
      if (scope !== "platform") setBrand(d);
      flash(scope === "platform" ? "Platform default brand saved." : "Your brand was saved.");
      loadOverview();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function reset() {
    if (scope === "platform") { setError("Platform default can't be deleted — edit its fields instead."); return; }
    if (!window.confirm("Reset your brand back to the platform/default? Clients will see the default brand.")) return;
    setBusy(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/branding/mine`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Reset failed.");
      await loadMine();
      setBrand(DEFAULT_BRAND);
      if (logoRef.current) logoRef.current.value = "";
      flash("Brand reset to default.");
      loadOverview();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (loading || !form) return <Spinner/>;

  const lbl = { fontSize:10, color:SOC.textMut, letterSpacing:1, fontWeight:600, marginBottom:5, display:"block" };
  const inp = { width:"100%", padding:"9px 12px", background:SOC.bg, border:`1px solid ${SOC.border}`,
    borderRadius:8, color:SOC.text, fontSize:13, boxSizing:"border-box", fontFamily:"Inter,system-ui,sans-serif" };

  return (
    <div>
      {toast && (
        <div style={{marginBottom:12,padding:"10px 14px",background:`${toast.tone}18`,
          border:`1px solid ${toast.tone}44`,borderRadius:8,color:toast.tone,fontSize:13,fontWeight:600}}>{toast.msg}</div>
      )}
      {error && (
        <div style={{marginBottom:12,padding:"9px 12px",background:`${SOC.red}15`,
          border:`1px solid ${SOC.red}33`,borderRadius:7,color:SOC.red,fontSize:12.5}}>{error}</div>
      )}

      {isAdmin && (
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          {[["mine","My Brand"],["platform","Platform Default"]].map(([id,label]) => (
            <button key={id} onClick={()=>{setScope(id); if(id==="platform"){ /* keep current form as starting point */ }}}
              style={{padding:"7px 16px",borderRadius:8,fontSize:12.5,fontWeight:700,cursor:"pointer",
                border:`1px solid ${scope===id?SOC.cyan:SOC.border}`,
                background:scope===id?`${SOC.cyan}1A`:SOC.bg,color:scope===id?SOC.cyan:SOC.textSec}}>{label}</button>
          ))}
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
        {/* form */}
        <SocPanel title={scope==="platform"?"Platform Default Brand":"Your Brand"} accent={SOC.cyan}>
          <div style={{display:"grid",gap:12}}>
            <div>
              <label style={lbl}>PRODUCT NAME</label>
              <input style={inp} value={brandInput(form.productName)} maxLength={40}
                onChange={e=>set("productName",e.target.value)} placeholder="ShieldAI"/>
            </div>
            <div>
              <label style={lbl}>COMPANY NAME</label>
              <input style={inp} value={brandInput(form.companyName)} maxLength={80}
                onChange={e=>set("companyName",e.target.value)} placeholder="Your MSP, LLC"/>
            </div>
            <div>
              <label style={lbl}>TAGLINE</label>
              <input style={inp} value={brandInput(form.tagline)} maxLength={90}
                onChange={e=>set("tagline",e.target.value)} placeholder="Virtual CISO Platform"/>
            </div>
            <div style={{display:"flex",gap:12}}>
              <div style={{flex:1}}>
                <label style={lbl}>PRIMARY COLOR</label>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(form.primaryColor)?form.primaryColor:"#2E5EAA"}
                    onChange={e=>set("primaryColor",e.target.value)}
                    style={{width:38,height:38,border:"none",borderRadius:8,background:"none",cursor:"pointer"}}/>
                  <input style={{...inp,flex:1}} value={brandInput(form.primaryColor)} maxLength={7}
                    onChange={e=>set("primaryColor",e.target.value)} placeholder="#2E5EAA"/>
                </div>
              </div>
              <div style={{flex:1}}>
                <label style={lbl}>ACCENT COLOR</label>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(form.accentColor)?form.accentColor:"#22D3EE"}
                    onChange={e=>set("accentColor",e.target.value)}
                    style={{width:38,height:38,border:"none",borderRadius:8,background:"none",cursor:"pointer"}}/>
                  <input style={{...inp,flex:1}} value={brandInput(form.accentColor)} maxLength={7}
                    onChange={e=>set("accentColor",e.target.value)} placeholder="#22D3EE"/>
                </div>
              </div>
            </div>
            <div>
              <label style={lbl}>LOGO (PNG/JPEG/SVG/WebP · max 512KB)</label>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={e=>onLogo(e.target.files?.[0])} style={{fontSize:12,color:SOC.textSec}}/>
                {form.logoUrl && (
                  <button onClick={()=>{set("logoUrl",null); if(logoRef.current) logoRef.current.value="";}}
                    style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${SOC.border}`,
                      background:SOC.bg,color:SOC.textSec,fontSize:11,cursor:"pointer"}}>Remove</button>
                )}
              </div>
            </div>
            <div style={{display:"flex",gap:12}}>
              <div style={{flex:1}}>
                <label style={lbl}>SUPPORT EMAIL</label>
                <input style={inp} value={brandInput(form.supportEmail)} maxLength={120}
                  onChange={e=>set("supportEmail",e.target.value)} placeholder="support@yourmsp.com"/>
              </div>
              <div style={{flex:1}}>
                <label style={lbl}>SUPPORT URL (https)</label>
                <input style={inp} value={brandInput(form.supportUrl)} maxLength={200}
                  onChange={e=>set("supportUrl",e.target.value)} placeholder="https://yourmsp.com/support"/>
              </div>
            </div>
            <div>
              <label style={lbl}>FOOTER NOTE</label>
              <input style={inp} value={brandInput(form.footerNote)} maxLength={200}
                onChange={e=>set("footerNote",e.target.value)} placeholder="© Your MSP. All rights reserved."/>
            </div>

            <div style={{display:"flex",gap:10,marginTop:4}}>
              <button onClick={save} disabled={busy}
                style={{padding:"10px 20px",borderRadius:8,border:"none",background:SOC.cyan,color:SOC.bg,
                  fontSize:13,fontWeight:700,cursor:busy?"default":"pointer",opacity:busy?0.6:1}}>
                {busy ? "Saving…" : (scope==="platform" ? "Save Platform Default" : "Save Brand")}
              </button>
              {scope !== "platform" && (
                <button onClick={reset} disabled={busy}
                  style={{padding:"10px 18px",borderRadius:8,border:`1px solid ${SOC.border}`,
                    background:SOC.bg,color:SOC.textSec,fontSize:13,cursor:busy?"default":"pointer"}}>
                  Reset to Default
                </button>
              )}
            </div>
          </div>
        </SocPanel>

        {/* preview + coverage */}
        <div style={{display:"flex",flexDirection:"column",gap:18}}>
          <SocPanel title="Live Preview" accent={SOC.purple}>
            <BrandLivePreview b={form}/>
            <div style={{marginTop:10,fontSize:11,color:SOC.textMut}}>
              {scope==="platform"
                ? "Clients with no assigned analyst brand see this."
                : "Clients assigned to you see this brand instead of ShieldAI's default."}
            </div>
          </SocPanel>

          {isAdmin && overview && (
            <SocPanel title="White-Label Coverage" accent={SOC.green}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                <div style={{padding:"10px",background:SOC.bg,borderRadius:8,textAlign:"center"}}>
                  <div style={{fontSize:22,fontWeight:800,color:SOC.cyan}}>{overview.clientsWhiteLabelled}</div>
                  <div style={{fontSize:9,color:SOC.textMut,letterSpacing:1}}>WHITE-LABELLED</div>
                </div>
                <div style={{padding:"10px",background:SOC.bg,borderRadius:8,textAlign:"center"}}>
                  <div style={{fontSize:22,fontWeight:800,color:SOC.textSec}}>{overview.clientsOnDefaultBrand}</div>
                  <div style={{fontSize:9,color:SOC.textMut,letterSpacing:1}}>ON DEFAULT</div>
                </div>
              </div>
              {(overview.brands||[]).map((b,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",
                  background:SOC.bg,borderRadius:7,marginBottom:6}}>
                  <span style={{width:12,height:12,borderRadius:3,background:b.primaryColor,flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{color:SOC.text,fontSize:12,fontWeight:600}}>{b.productName}</div>
                    <div style={{color:SOC.textMut,fontSize:10}}>{b.owner}</div>
                  </div>
                  <span style={{fontSize:11,color:SOC.textSec}}>{b.clientsBranded} client{b.clientsBranded!==1?"s":""}</span>
                </div>
              ))}
            </SocPanel>
          )}
        </div>
      </div>
    </div>
  );
}

// Analyst/admin report generator for one client. Produces compliance,
// insurance, and legal reports, and delivers them to the client. Reads/acts
// via ?clientId= / clientId in the body; the server enforces assignment scope.
function ClientReportsPanel({ clientId }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/reports?clientId=${encodeURIComponent(clientId)}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load reports.");
      setReports(Array.isArray(d) ? d : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [clientId]);

  function flash(msg, tone = SOC.green) { setToast({ msg, tone }); setTimeout(() => setToast(null), 3200); }

  async function generate(type) {
    setBusy(type); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/reports/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, clientId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not generate report.");
      flash(`${REPORT_TYPE_META[type]?.label || "Report"} generated — not yet delivered.`);
      await load();
      try { await downloadReport(d); } catch { /* can download from the list */ }
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  async function deliver(r) {
    setBusy(r.id); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/reports/${r.id}/deliver`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Delivery failed.");
      flash("Delivered to the client.");
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  async function doDownload(r) {
    setBusy(r.id); setError(null);
    try { await downloadReport(r); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  const staffTypes = ["compliance", "insurance", "legal"];

  return (
    <SocPanel title="Reports" accent={SOC.cyan}>
      {toast && (
        <div style={{marginBottom:12,padding:"9px 12px",background:`${toast.tone}18`,
          border:`1px solid ${toast.tone}44`,borderRadius:7,color:toast.tone,fontSize:12.5,fontWeight:600}}>{toast.msg}</div>
      )}
      {error && (
        <div style={{marginBottom:12,padding:"9px 12px",background:`${SOC.red}15`,
          border:`1px solid ${SOC.red}33`,borderRadius:7,color:SOC.red,fontSize:12.5}}>{error}</div>
      )}

      <p style={{color:SOC.textSec,fontSize:12.5,lineHeight:1.55,margin:"0 0 14px"}}>
        Generate a report from this client's live data, then deliver it. Delivered
        reports appear in the client's own Reports area. Each document carries a
        qualified-review disclaimer.
      </p>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10,marginBottom:16}}>
        {staffTypes.map(type => {
          const m = REPORT_TYPE_META[type];
          return (
            <div key={type} style={{background:SOC.bg,border:`1px solid ${SOC.border}`,borderRadius:9,padding:"13px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                <span style={{fontSize:18}}>{m.icon}</span>
                <span style={{color:SOC.text,fontSize:13,fontWeight:700}}>{m.label}</span>
              </div>
              <p style={{color:SOC.textMut,fontSize:11.5,lineHeight:1.5,margin:"0 0 12px",minHeight:32}}>{m.blurb}</p>
              <button onClick={()=>generate(type)} disabled={busy===type}
                style={{width:"100%",padding:"8px",background:busy===type?SOC.border:`${SOC.cyan}1A`,
                  border:`1px solid ${SOC.cyan}55`,borderRadius:7,color:busy===type?SOC.textMut:SOC.cyan,
                  fontSize:12,fontWeight:700,cursor:busy===type?"wait":"pointer"}}>
                {busy===type ? "Generating…" : "Generate"}
              </button>
            </div>
          );
        })}
      </div>

      <div style={{fontSize:10,color:SOC.textMut,letterSpacing:1,fontWeight:600,marginBottom:8}}>
        GENERATED REPORTS ({reports.length})
      </div>
      {loading ? <div style={{color:SOC.textMut,fontSize:12,padding:12}}>Loading…</div> :
       reports.length === 0 ? (
        <div style={{color:SOC.textMut,fontSize:12.5,padding:"10px 0"}}>None yet. Generate one above.</div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {reports.map(r => {
            const m = REPORT_TYPE_META[r.type] || { icon:"📄", label:r.type };
            const delivered = !!r.deliveredAt;
            return (
              <div key={r.id} style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",
                background:SOC.bg,border:`1px solid ${SOC.border}`,borderRadius:8,padding:"10px 13px"}}>
                <span style={{fontSize:17}}>{m.icon}</span>
                <div style={{flex:"1 1 200px",minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <span style={{color:SOC.text,fontSize:13,fontWeight:600}}>{m.label}</span>
                    <span style={{padding:"1px 7px",borderRadius:5,fontSize:9.5,fontWeight:700,
                      background: delivered ? `${SOC.green}22` : `${SOC.amber}22`,
                      color: delivered ? SOC.green : SOC.amber}}>
                      {delivered ? "DELIVERED" : "DRAFT"}
                    </span>
                  </div>
                  <div style={{color:SOC.textMut,fontSize:10.5,marginTop:2}}>
                    {new Date(r.createdAt).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}
                    {" · "}{r.filename}
                  </div>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>doDownload(r)} disabled={busy===r.id}
                    style={{padding:"6px 12px",background:`${SOC.cyan}15`,border:`1px solid ${SOC.cyan}44`,
                      borderRadius:6,color:SOC.cyan,fontSize:11.5,fontWeight:600,cursor:busy===r.id?"wait":"pointer"}}>
                    Download
                  </button>
                  {!delivered && (
                    <button onClick={()=>deliver(r)} disabled={busy===r.id}
                      style={{padding:"6px 12px",background:`${SOC.green}15`,border:`1px solid ${SOC.green}44`,
                        borderRadius:6,color:SOC.green,fontSize:11.5,fontWeight:600,cursor:busy===r.id?"wait":"pointer"}}>
                      Deliver →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SocPanel>
  );
}

// Analyst view of a client's training program. Reads/acts via ?clientId=, so
// the analyst can assign, remind, and track completion for their assigned
// client. Read + act, assignment-scoped server-side.
function ClientTrainingPanel({ clientId }) {
  const [overview, setOverview] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [learners, setLearners] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [pickLearners, setPickLearners] = useState([]);
  const [pickTopics, setPickTopics] = useState([]);

  const q = `?clientId=${encodeURIComponent(clientId)}`;

  async function loadAll() {
    setLoading(true); setError(null);
    try {
      const [o, a, l, c] = await Promise.all([
        authFetch(`${API_BASE}/api/training-program/overview${q}`).then(r => r.json()),
        authFetch(`${API_BASE}/api/training-program/assignments${q}`).then(r => r.json()),
        authFetch(`${API_BASE}/api/training-program/learners${q}`).then(r => r.json()),
        authFetch(`${API_BASE}/api/training-program/catalog`).then(r => r.json()),
      ]);
      setOverview(o && !o.error ? o : null);
      setAssignments(Array.isArray(a) ? a : []);
      setLearners(Array.isArray(l) ? l : []);
      setCatalog(Array.isArray(c) ? c : []);
    } catch (e) { setError("Could not load training."); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); }, [clientId]);

  async function assign() {
    if (!pickLearners.length || !pickTopics.length) { setError("Pick learners and topics."); return; }
    setBusy(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/training-program/assignments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, learnerIds: pickLearners, topicIds: pickTopics }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Assign failed.");
      setShowAssign(false); setPickLearners([]); setPickTopics([]);
      await loadAll();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function act(a, kind) {
    setBusy(true); setError(null);
    try {
      if (kind === "remind") {
        const res = await authFetch(`${API_BASE}/api/training-program/assignments/${a.id}/remind`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed.");
      } else if (kind === "waive") {
        const res = await authFetch(`${API_BASE}/api/training-program/assignments/${a.id}${q}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, status: "waived" }),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed.");
        await loadAll();
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function tog(list, set, id) { set(list.includes(id) ? list.filter(x => x !== id) : [...list, id]); }
  function socTone(s) {
    return { completed: SOC.green, in_progress: SOC.cyan, overdue: SOC.red, waived: SOC.textMut, assigned: SOC.textSec }[s] || SOC.textSec;
  }

  return (
    <SocPanel title="Training Program" accent={SOC.amber}
      action={
        <button onClick={()=>setShowAssign(s=>!s)}
          style={{background:"none",border:`1px solid ${SOC.amber}55`,color:SOC.amber,fontSize:11,
            fontWeight:700,padding:"4px 10px",borderRadius:6,cursor:"pointer"}}>
          {showAssign ? "Close" : "+ Assign"}
        </button>}>
      {error && <div style={{marginBottom:10,padding:"7px 10px",background:`${SOC.red}15`,
        border:`1px solid ${SOC.red}33`,borderRadius:7,color:SOC.red,fontSize:12}}>{error}</div>}

      {loading ? <Spinner/> : (
        <>
          {/* stat strip */}
          <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:14}}>
            {[
              ["Learners", overview?.learnerCount ?? 0, SOC.cyan],
              ["Completion", `${overview?.completionRate ?? 0}%`, SOC.green],
              ["Overdue", overview?.overdue ?? 0, overview?.overdue ? SOC.red : SOC.textSec],
              ["Avg Score", overview?.avgScore != null ? overview.avgScore : "—", SOC.amber],
            ].map(([l,v,t],i)=>(
              <div key={i}>
                <div style={{fontSize:22,fontWeight:800,color:t,lineHeight:1}}>{v}</div>
                <div style={{fontSize:9,color:SOC.textMut,letterSpacing:1,marginTop:3}}>{String(l).toUpperCase()}</div>
              </div>
            ))}
          </div>

          {/* inline assign */}
          {showAssign && (
            <div style={{marginBottom:14,padding:"12px",background:SOC.bg,borderRadius:8,border:`1px solid ${SOC.border}`}}>
              {learners.length === 0 ? (
                <div style={{fontSize:12,color:SOC.textSec}}>This client has no learners yet — the client admin adds them from their dashboard.</div>
              ) : (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                  <div>
                    <div style={{fontSize:10,color:SOC.textMut,letterSpacing:1,fontWeight:600,marginBottom:6}}>LEARNERS</div>
                    <div style={{maxHeight:150,overflowY:"auto"}}>
                      {learners.map(l=>(
                        <label key={l.id} style={{display:"flex",gap:8,alignItems:"center",padding:"4px 0",cursor:"pointer",fontSize:12,color:SOC.text}}>
                          <input type="checkbox" checked={pickLearners.includes(l.id)} onChange={()=>tog(pickLearners,setPickLearners,l.id)}/>
                          {l.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:SOC.textMut,letterSpacing:1,fontWeight:600,marginBottom:6}}>TOPICS</div>
                    <div style={{maxHeight:150,overflowY:"auto"}}>
                      {catalog.map(t=>(
                        <label key={t.id} style={{display:"flex",gap:8,alignItems:"center",padding:"4px 0",cursor:"pointer",fontSize:12,color:SOC.text}}>
                          <input type="checkbox" checked={pickTopics.includes(t.id)} onChange={()=>tog(pickTopics,setPickTopics,t.id)}/>
                          {t.title}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {learners.length > 0 && (
                <button onClick={assign} disabled={busy}
                  style={{marginTop:10,padding:"8px 16px",borderRadius:7,border:"none",background:SOC.amber,
                    color:SOC.bg,fontSize:12,fontWeight:700,cursor:busy?"default":"pointer",opacity:busy?0.6:1}}>
                  {busy ? "Assigning…" : `Assign to ${pickLearners.length}`}
                </button>
              )}
            </div>
          )}

          {/* assignments */}
          {assignments.length === 0 ? (
            <div style={{fontSize:12,color:SOC.textSec,padding:"8px 0"}}>No training assigned yet.</div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {assignments.slice(0,10).map(a=>{
                const t = socTone(a.status);
                return (
                  <div key={a.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 11px",
                    background:SOC.bg,borderRadius:7,border:`1px solid ${SOC.border}`}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:SOC.text}}>{a.learnerName}</div>
                      <div style={{fontSize:10,color:SOC.textMut}}>{a.title}</div>
                    </div>
                    <span style={{fontSize:10,fontWeight:700,color:t,padding:"2px 8px",borderRadius:20,
                      background:`${t}18`}}>{a.progress}%</span>
                    {a.status !== "completed" && a.status !== "waived" && (
                      <>
                        <button onClick={()=>act(a,"remind")} disabled={busy}
                          style={{background:"none",border:`1px solid ${SOC.cyan}44`,color:SOC.cyan,fontSize:10,
                            fontWeight:600,padding:"3px 8px",borderRadius:5,cursor:"pointer"}}>Remind</button>
                        <button onClick={()=>act(a,"waive")} disabled={busy}
                          style={{background:"none",border:`1px solid ${SOC.border}`,color:SOC.textMut,fontSize:10,
                            fontWeight:600,padding:"3px 8px",borderRadius:5,cursor:"pointer"}}>Waive</button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </SocPanel>
  );
}

function SocPanel({ title, action, children, accent }) {
  return (
    <div style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderRadius:12,padding:"16px 18px"}}>
      <div style={{display:"flex",alignItems:"center",marginBottom:12}}>
        <div style={{width:3,height:14,background:accent||SOC.cyan,borderRadius:2,marginRight:9}}/>
        <span style={{color:SOC.text,fontSize:12,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>{title}</span>
        {action && <span style={{marginLeft:"auto"}}>{action}</span>}
      </div>
      {children}
    </div>
  );
}

const sevColor = (s) => s === "high" ? SOC.red : s === "medium" ? SOC.amber : SOC.cyan;

// Real HIBP-backed breach exposure for one client, styled for the analyst
// console. Same endpoint and data contract as the client-facing
// DarkWebExposureCard — reused here rather than duplicated logic, just a
// different visual shell (SocPanel/SOC.* instead of Card/C.*) to match this
// console's theme. Analysts previously had no way to see this at all; only
// Mastermind's get_darkweb_exposure tool could reach it.
function AnalystDarkWebPanel({ clientId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    authFetch(`${API_BASE}/api/client/darkweb-exposure?userId=${encodeURIComponent(clientId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (live) setData(d); })
      .catch(() => { if (live) setData(null); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [clientId]);

  const exp = data?.exposure;
  const statusColor = {
    "High alert": SOC.red, "Elevated": SOC.amber, "Low risk": SOC.green,
    "No intel": SOC.green,
  }[exp?.statusLevel] || SOC.textMut;

  return (
    <SocPanel title="Breach & Dark-Web Exposure" accent={SOC.purple}
      action={(exp?.simulated || exp?.demo) ? (
        <span style={{fontSize:9,fontWeight:700,color:SOC.purple,letterSpacing:0.5}}>SIMULATED — DEMO</span>
      ) : null}>
      {loading ? (
        <div style={{color:SOC.textMut,fontSize:12,padding:"10px 0"}}>Loading…</div>
      ) : !exp ? (
        <div style={{color:SOC.textSec,fontSize:12,padding:"10px 0",textAlign:"center"}}>No data to report</div>
      ) : !exp.monitored ? (
        <div style={{color:SOC.textSec,fontSize:11.5,lineHeight:1.6,padding:"6px 0"}}>
          <div style={{color:SOC.text,fontWeight:600,marginBottom:4}}>{exp.statusLevel || "Not monitored"}</div>
          {exp.reason || "This client hasn't verified a company domain yet."}
        </div>
      ) : (
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <span style={{fontSize:13,fontWeight:700,color:statusColor}}>{exp.statusLevel}</span>
            <span style={{fontSize:11,color:SOC.textSec}}>
              {exp.breachedAccounts ?? 0} account{(exp.breachedAccounts ?? 0)===1?"":"s"} · {exp.distinctBreaches ?? 0} breach{(exp.distinctBreaches ?? 0)===1?"":"es"}
            </span>
          </div>
          {(exp.breaches || []).length > 0 && (
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {exp.breaches.map((b,i) => (
                <span key={i} style={{padding:"3px 9px",borderRadius:6,background:SOC.bg,
                  border:`1px solid ${SOC.border}`,color:SOC.textSec,fontSize:11}}>{b}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </SocPanel>
  );
}

// ── Training Manager overlay (analyst-side training management for a client) ──
function TrainingManager({ client, onClose }) {
  const t = client.training || {};
  const hasProgram = (t.enrolled || 0) > 0;
  const [tab, setTab] = useState("overview"); // overview | modules | campaigns
  const [building, setBuilding] = useState(false);
  const [built, setBuilt] = useState(false);

  function buildProgram() {
    setBuilding(true);
    setTimeout(() => { setBuilding(false); setBuilt(true); }, 1100);
  }

  const Stat = ({ label, value, color }) => (
    <div style={{flex:1,background:SOC.bg,border:`1px solid ${SOC.border}`,borderRadius:10,padding:"14px",textAlign:"center"}}>
      <div style={{fontSize:24,fontWeight:800,color:color||SOC.cyan}}>{value}</div>
      <div style={{fontSize:10,color:SOC.textMut,marginTop:3}}>{label}</div>
    </div>
  );

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(3,7,18,0.75)",
      zIndex:60,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"40px 20px",overflowY:"auto"}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:760,background:SOC.panel,
        border:`1px solid ${SOC.border}`,borderRadius:14,overflow:"hidden"}}>
        {/* Header */}
        <div style={{padding:"16px 20px",borderBottom:`1px solid ${SOC.border}`,
          display:"flex",alignItems:"center",gap:10,background:`linear-gradient(135deg,${SOC.cyan}18,transparent)`}}>
          <span style={{fontSize:18}}>🎓</span>
          <div style={{flex:1}}>
            <div style={{color:SOC.text,fontWeight:700,fontSize:15}}>Training Management</div>
            <div style={{color:SOC.textMut,fontSize:11}}>{client.name} · {client.employees} employees</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:SOC.textMut,fontSize:20,cursor:"pointer"}}>×</button>
        </div>

        {/* No program yet → build CTA */}
        {!hasProgram && !built ? (
          <div style={{padding:"40px 24px",textAlign:"center"}}>
            <div style={{fontSize:36,marginBottom:12}}>📚</div>
            <div style={{color:SOC.text,fontWeight:700,fontSize:16,marginBottom:8}}>No training program deployed</div>
            <div style={{color:SOC.textSec,fontSize:13,lineHeight:1.6,maxWidth:440,margin:"0 auto 20px"}}>
              Generate a CISA/NIST-aligned awareness program tailored to {client.name}'s industry
              ({client.industry}) and roll it out to all {client.employees} employees.
            </div>
            <button onClick={buildProgram} disabled={building}
              style={{padding:"11px 24px",background:building?SOC.bg:SOC.cyan,color:building?SOC.textMut:SOC.bg,
                border:building?`1px solid ${SOC.border}`:"none",borderRadius:9,fontSize:13,fontWeight:700,
                cursor:building?"wait":"pointer"}}>
              {building ? "Building tailored program…" : "✦ Build & Assign Training Program"}
            </button>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div style={{display:"flex",gap:6,padding:"12px 20px 0"}}>
              {[["overview","Overview"],["modules","Module Progress"],["campaigns","Phishing Campaigns"]].map(([id,label])=>(
                <button key={id} onClick={()=>setTab(id)}
                  style={{padding:"8px 14px",background:tab===id?`${SOC.cyan}22`:"transparent",
                    border:"none",borderBottom:`2px solid ${tab===id?SOC.cyan:"transparent"}`,
                    color:tab===id?SOC.cyan:SOC.textSec,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                  {label}
                </button>
              ))}
            </div>

            <div style={{padding:"18px 20px 24px"}}>
              {tab==="overview" && (
                <>
                  <div style={{display:"flex",gap:10,marginBottom:16}}>
                    <Stat label="Enrolled" value={t.enrolled || client.employees} color={SOC.cyan}/>
                    <Stat label="Completion" value={`${built?12:t.completion}%`} color={SOC.green}/>
                    <Stat label="Modules" value={(t.modules||[]).length || 12} color={SOC.purple}/>
                    <Stat label="Avg Quiz Score" value={`${avgScore(t)}%`} color={SOC.amber}/>
                  </div>
                  <div style={{background:SOC.bg,border:`1px solid ${SOC.border}`,borderRadius:10,padding:"14px 16px"}}>
                    <div style={{color:SOC.text,fontSize:13,fontWeight:600,marginBottom:6}}>
                      {built ? "CISA/NIST Awareness Program (just deployed)" : t.active}
                    </div>
                    <div style={{color:SOC.textSec,fontSize:12,lineHeight:1.6}}>
                      {built
                        ? `A tailored program for ${client.name} has been generated and assigned to all ${client.employees} employees. Completion tracking begins as staff work through the modules.`
                        : `Active program with a completion deadline of ${t.nextDue}. ${t.enrolled} employees enrolled across ${(t.modules||[]).length} modules.`}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:16}}>
                    <button style={{flex:1,padding:"9px",background:`${SOC.cyan}18`,border:`1px solid ${SOC.cyan}44`,
                      borderRadius:8,color:SOC.cyan,fontSize:12,fontWeight:600,cursor:"pointer"}}>Send Reminder to Incomplete</button>
                    <button style={{flex:1,padding:"9px",background:`${SOC.purple}18`,border:`1px solid ${SOC.purple}44`,
                      borderRadius:8,color:SOC.purple,fontSize:12,fontWeight:600,cursor:"pointer"}}>Push New Campaign</button>
                  </div>
                </>
              )}

              {tab==="modules" && (
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {(t.modules||[]).length === 0 ? (
                    <div style={{color:SOC.textSec,fontSize:13,padding:"10px 0"}}>Modules will populate once the program is deployed.</div>
                  ) : t.modules.map((m,i)=>{
                    const pct = Math.round((m.done/(t.enrolled||1))*100);
                    return (
                      <div key={i} style={{background:SOC.bg,border:`1px solid ${SOC.border}`,borderRadius:9,padding:"12px 14px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:7}}>
                          <span style={{color:SOC.text,fontSize:13,fontWeight:600}}>{m.name}</span>
                          <span style={{color:SOC.textMut,fontSize:11}}>{m.done}/{t.enrolled} done · avg {m.avgScore}%</span>
                        </div>
                        <div style={{height:6,background:SOC.grid,borderRadius:3,overflow:"hidden"}}>
                          <div style={{width:`${pct}%`,height:"100%",
                            background:`linear-gradient(90deg,${SOC.cyan},${SOC.green})`}}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {tab==="campaigns" && (
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <button style={{alignSelf:"flex-start",padding:"8px 16px",background:SOC.purple,color:SOC.bg,
                    border:"none",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>
                    + Launch Phishing Simulation
                  </button>
                  {(t.campaigns||[]).length === 0 ? (
                    <div style={{color:SOC.textSec,fontSize:13,padding:"4px 0"}}>No campaigns run yet.</div>
                  ) : t.campaigns.map((c,i)=>{
                    const clickRate = Math.round((c.clicked/c.sent)*100);
                    const reportRate = Math.round((c.reported/c.sent)*100);
                    return (
                      <div key={i} style={{background:SOC.bg,border:`1px solid ${SOC.border}`,borderRadius:10,padding:"13px 15px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                          <span style={{color:SOC.text,fontSize:13,fontWeight:600}}>{c.name}</span>
                          <span style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:10,
                            background:c.status==="active"?`${SOC.green}22`:`${SOC.textMut}22`,
                            color:c.status==="active"?SOC.green:SOC.textMut,textTransform:"uppercase"}}>{c.status}</span>
                        </div>
                        <div style={{display:"flex",gap:16,fontSize:11}}>
                          <span style={{color:SOC.textSec}}>Sent: <b style={{color:SOC.text}}>{c.sent}</b></span>
                          <span style={{color:clickRate>15?SOC.red:SOC.textSec}}>Clicked: <b style={{color:clickRate>15?SOC.red:SOC.amber}}>{c.clicked}</b> ({clickRate}%)</span>
                          <span style={{color:SOC.textSec}}>Reported: <b style={{color:SOC.green}}>{c.reported}</b> ({reportRate}%)</span>
                          <span style={{color:SOC.textMut,marginLeft:"auto"}}>{c.date}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
        <div style={{padding:"10px 20px",borderTop:`1px solid ${SOC.border}`,
          fontSize:10,color:SOC.textMut,textAlign:"center"}}>
          Vision mockup · live program generation uses ShieldAI's CISA/NIST training engine
        </div>
      </div>
    </div>
  );
}
function avgScore(t) {
  const mods = t.modules || [];
  if (!mods.length) return 0;
  return Math.round(mods.reduce((s,m)=>s+(m.avgScore||0),0)/mods.length);
}

// ── ShieldAI Mastermind — scripted diagnostic-AI responses ──
// Context-aware canned exchanges for the demo. Each quick-action returns
// an expert-sounding, structured response. Some are tailored per client.
const MASTERMIND_QUICK = [
  { id: "triage",     icon: "🚨", label: "Triage active alerts", category: "Threat Response" },
  { id: "compliance", icon: "✅", label: "Compliance gap analysis", category: "Compliance" },
  { id: "troubleshoot", icon: "🔧", label: "Diagnose agent / coverage issue", category: "Troubleshooting" },
  { id: "nextsteps",  icon: "🎯", label: "What should I prioritize?", category: "Advisory" },
];


// ─────────────────────────────────────────────────────────────
//  WORKSPACE VIEWER — "View as client" drill-in for staff
//  Works for both admin and analyst: both hit /api/staff/clients/:cid/*
//  Read the client's assessments, programs, policies, training; edit a
//  policy or assessment on their behalf; generate a program (respecting the
//  CLIENT's tier limit — shows an upgrade notice on 402); delete a program.
//  Self-contained: renders its own header bar (the console Header is local).
// ─────────────────────────────────────────────────────────────
const PROGRAM_SECTION_LABELS = {
  riskOverview: "Risk overview & top threats",
  priorities: "Prioritized roadmap & quick wins",
  policiesCore: "Core security policies",
  policiesOps: "Operational security policies",
  compliance: "Compliance framework gap analysis",
  workflows: "Incident response workflows",
  threatIntel: "Threat intelligence",
  tools: "Recommended tool stack",
  training: "Awareness training program",
  execReport: "Executive summary report",
};

function WorkspaceViewer({ client, onBack }) {
  const cid = client.id;
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [banner, setBanner] = useState(null);

  const [openProgram, setOpenProgram] = useState(null);
  const [openPolicy, setOpenPolicy] = useState(null);
  const [policyEdit, setPolicyEdit] = useState(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const [genFor, setGenFor] = useState(null);
  const [genProgress, setGenProgress] = useState(null);

  async function loadOverview() {
    setLoading(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/staff/clients/${cid}/overview`);
      if (!res.ok) { setError(`Failed to load workspace (${res.status})`); return; }
      setOverview(await res.json());
    } catch { setError("Network error loading workspace."); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadOverview(); /* eslint-disable-next-line */ }, [cid]);

  async function openProgramDetail(id) {
    setDetailLoading(true); setOpenProgram(null);
    try {
      const res = await authFetch(`${API_BASE}/api/staff/clients/${cid}/programs/${id}`);
      if (res.ok) setOpenProgram(await res.json());
      else setBanner({ kind: "error", text: `Could not open program (${res.status}).` });
    } catch { setBanner({ kind: "error", text: "Network error opening program." }); }
    finally { setDetailLoading(false); }
  }

  async function openPolicyDetail(id) {
    setDetailLoading(true); setOpenPolicy(null); setPolicyEdit(null);
    try {
      const res = await authFetch(`${API_BASE}/api/staff/clients/${cid}/policies/${id}`);
      if (res.ok) setOpenPolicy(await res.json());
      else setBanner({ kind: "error", text: `Could not open policy (${res.status}).` });
    } catch { setBanner({ kind: "error", text: "Network error opening policy." }); }
    finally { setDetailLoading(false); }
  }

  async function savePolicy() {
    if (openPolicy == null || policyEdit == null) return;
    setSavingPolicy(true);
    try {
      const res = await authFetch(`${API_BASE}/api/staff/clients/${cid}/policies/${openPolicy.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: policyEdit }),
      });
      if (res.ok) {
        const upd = await res.json();
        setOpenPolicy({ ...openPolicy, content: upd.content });
        setPolicyEdit(null);
        setBanner({ kind: "info", text: "Policy saved on behalf of the client." });
      } else setBanner({ kind: "error", text: `Save failed (${res.status}).` });
    } catch { setBanner({ kind: "error", text: "Network error saving policy." }); }
    finally { setSavingPolicy(false); }
  }

  async function deleteProgram(id) {
    if (!window.confirm("Delete this program on behalf of the client? They can regenerate it.")) return;
    try {
      const res = await authFetch(`${API_BASE}/api/staff/clients/${cid}/programs/${id}`, { method: "DELETE" });
      if (res.ok) { setBanner({ kind: "info", text: "Program deleted." }); if (openProgram?.id === id) setOpenProgram(null); loadOverview(); }
      else setBanner({ kind: "error", text: `Delete failed (${res.status}).` });
    } catch { setBanner({ kind: "error", text: "Network error deleting program." }); }
  }

  async function generateFor(assessmentId) {
    setGenFor(assessmentId); setGenProgress({ label: "Starting…", status: "running", step: 0, total: 10 }); setBanner(null);
    try {
      const res = await authFetch(`${API_BASE}/api/staff/clients/${cid}/programs/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessmentId }),
      });
      if (res.status === 402) {
        const body = await res.json().catch(() => ({}));
        setBanner({ kind: "warn", text: body.error || "This client's plan doesn't allow more programs. Upgrade the client from the Admin console." });
        setGenFor(null); setGenProgress(null); return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setBanner({ kind: "error", text: body.error || `Generation failed (${res.status}).` });
        setGenFor(null); setGenProgress(null); return;
      }
      const { programId } = await res.json();
      while (true) {
        await new Promise(r => setTimeout(r, 2000));
        const st = await authFetch(`${API_BASE}/api/programs/${programId}/status`);
        if (!st.ok) throw new Error(`status ${st.status}`);
        const p = await st.json();
        setGenProgress(p);
        if (p.status === "complete") break;
        if (p.status === "error") throw new Error(p.error || "Pipeline failed");
      }
      setBanner({ kind: "info", text: "Program generated on behalf of the client." });
      setGenFor(null); setGenProgress(null); loadOverview();
    } catch (e) {
      setBanner({ kind: "error", text: `Generation error: ${e.message}` });
      setGenFor(null); setGenProgress(null);
    }
  }

  const bannerColor = banner?.kind === "error" ? SOC.red : banner?.kind === "warn" ? SOC.amber : SOC.cyan;
  const tabs = [["overview","Overview"],["assessments","Assessments"],["programs","Programs"],["policies","Policies"],["training","Training"]];
  const panel = { background:SOC.panel, border:`1px solid ${SOC.border}`, borderRadius:10 };
  const chip = (active) => ({
    padding:"7px 14px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer",
    background: active ? `${SOC.cyan}18` : "transparent",
    border: `1px solid ${active ? SOC.cyan+"55" : SOC.border}`,
    color: active ? SOC.cyan : SOC.textSec,
  });

  return (
    <div style={{minHeight:"100vh",background:SOC.bg,fontFamily:"Inter,system-ui,sans-serif",color:SOC.text}}>
      <div style={{borderBottom:`1px solid ${SOC.border}`,padding:"16px 20px",background:SOC.panel}}>
        <span style={{fontSize:15,fontWeight:700,color:SOC.text}}>Workspace · {client.name || client.email}</span>
      </div>
      <div style={{maxWidth:1000,margin:"0 auto",padding:"20px"}}>
        <button onClick={onBack}
          style={{marginBottom:14,padding:"6px 14px",background:SOC.panelHi,border:`1px solid ${SOC.border}`,
            borderRadius:6,color:SOC.textSec,fontSize:12,cursor:"pointer"}}>← Back to clients</button>

        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6,flexWrap:"wrap"}}>
          <span style={{fontSize:15,fontWeight:700,color:SOC.text}}>{client.name || client.email}</span>
          <span style={{padding:"2px 8px",borderRadius:5,fontSize:10,fontWeight:700,background:`${SOC.purple}22`,color:SOC.purple}}>
            {(overview?.client?.tier || client.tier || "free").toUpperCase()}
          </span>
          <span style={{fontSize:11,color:SOC.textMut}}>Acting on behalf of the client — changes are logged.</span>
        </div>

        {banner && (
          <div style={{...panel,borderColor:`${bannerColor}55`,background:`${bannerColor}12`,
            padding:"10px 14px",marginBottom:12,color:bannerColor,fontSize:13,display:"flex",justifyContent:"space-between",gap:10}}>
            <span>{banner.text}</span>
            <span onClick={()=>setBanner(null)} style={{cursor:"pointer",opacity:.7}}>✕</span>
          </div>
        )}

        <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          {tabs.map(([id,label]) => (
            <button key={id} onClick={()=>{ setTab(id); setOpenProgram(null); setOpenPolicy(null); }} style={chip(tab===id)}>
              {label}{overview?.counts?.[id] != null ? ` (${overview.counts[id]})` : ""}
            </button>
          ))}
        </div>

        {loading ? <div style={{color:SOC.textMut,padding:24}}>Loading workspace…</div> :
         error ? <div style={{...panel,padding:20,color:SOC.red}}>{error}</div> :
         !overview ? null : (
          <>
            {tab==="overview" && (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
                {[["Assessments",overview.counts.assessments,SOC.cyan],["Programs",overview.counts.programs,SOC.green],
                  ["Policies",overview.counts.policies,SOC.purple],["Training",overview.counts.training,SOC.amber],
                  ["Endpoints",overview.counts.endpoints,SOC.blue],["Open recs",overview.counts.openRecommendations,SOC.red]
                ].map(([label,n,col]) => (
                  <div key={label} style={{...panel,padding:"16px"}}>
                    <div style={{fontSize:26,fontWeight:800,color:col}}>{n}</div>
                    <div style={{fontSize:11,color:SOC.textMut,textTransform:"uppercase",letterSpacing:1,marginTop:2}}>{label}</div>
                  </div>
                ))}
              </div>
            )}

            {tab==="assessments" && (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {overview.assessments.length===0 ? (
                  <div style={{...panel,padding:30,textAlign:"center",color:SOC.textMut}}>No assessments yet.</div>
                ) : overview.assessments.map(a => (
                  <div key={a.id} style={{...panel,padding:"14px 16px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{color:SOC.text,fontWeight:600,fontSize:14}}>{a.company?.name || "Untitled assessment"}</div>
                        <div style={{color:SOC.textMut,fontSize:12,marginTop:2}}>
                          {a.company?.industry || "—"} · created {new Date(a.createdAt).toLocaleDateString()}
                          {a.updatedAt ? ` · edited ${new Date(a.updatedAt).toLocaleDateString()}` : ""}
                        </div>
                      </div>
                      {genFor===a.id ? (
                        <span style={{fontSize:12,color:SOC.cyan}}>
                          {genProgress?.label || "Generating…"} {genProgress?.total ? `(${genProgress.step}/${genProgress.total})` : ""}
                        </span>
                      ) : (
                        <button onClick={()=>generateFor(a.id)}
                          style={{padding:"7px 14px",background:`${SOC.green}18`,border:`1px solid ${SOC.green}55`,
                            borderRadius:7,color:SOC.green,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                          Generate Program →
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab==="programs" && (
              openProgram ? (
                <div style={{...panel,padding:"18px"}}>
                  <button onClick={()=>setOpenProgram(null)}
                    style={{marginBottom:12,padding:"5px 12px",background:SOC.panelHi,border:`1px solid ${SOC.border}`,
                      borderRadius:6,color:SOC.textSec,fontSize:12,cursor:"pointer"}}>← All programs</button>
                  <div style={{fontSize:12,color:SOC.textMut,marginBottom:14}}>
                    Program {openProgram.id.slice(0,8)} · {openProgram.status}
                    {openProgram.generatedByRole ? ` · generated by ${openProgram.generatedByRole}` : ""}
                  </div>
                  {Object.keys(openProgram.sections || {}).length===0 ? (
                    <div style={{color:SOC.textMut}}>No sections (program may still be running or errored).</div>
                  ) : Object.entries(openProgram.sections).map(([key,val]) => (
                    <div key={key} style={{marginBottom:18}}>
                      <div style={{fontSize:12,fontWeight:700,color:SOC.cyan,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>
                        {PROGRAM_SECTION_LABELS[key] || key}
                      </div>
                      <div style={{background:"#fff",borderRadius:8,padding:"12px 14px"}}>
                        <MarkdownDocLight text={typeof val === "string" ? val : (val?.content || JSON.stringify(val, null, 2))}/>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {detailLoading && <div style={{color:SOC.textMut}}>Loading…</div>}
                  {overview.programs.length===0 ? (
                    <div style={{...panel,padding:30,textAlign:"center",color:SOC.textMut}}>
                      No programs yet. Generate one from the Assessments tab.
                    </div>
                  ) : overview.programs.map(p => {
                    const col = p.status==="complete"?SOC.green : p.status==="error"?SOC.red : SOC.amber;
                    return (
                      <div key={p.id} style={{...panel,padding:"14px 16px",display:"flex",alignItems:"center",gap:12}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{color:SOC.text,fontWeight:600,fontSize:14}}>Program {p.id.slice(0,8)}</div>
                          <div style={{color:SOC.textMut,fontSize:12,marginTop:2}}>created {new Date(p.createdAt).toLocaleDateString()}</div>
                        </div>
                        <span style={{padding:"2px 8px",borderRadius:5,fontSize:10,fontWeight:700,background:`${col}22`,color:col}}>{p.status}</span>
                        <button onClick={()=>openProgramDetail(p.id)}
                          style={{padding:"6px 12px",background:`${SOC.cyan}18`,border:`1px solid ${SOC.cyan}55`,
                            borderRadius:7,color:SOC.cyan,fontSize:12,fontWeight:600,cursor:"pointer"}}>Open</button>
                        <button onClick={()=>deleteProgram(p.id)}
                          style={{padding:"6px 12px",background:`${SOC.red}14`,border:`1px solid ${SOC.red}44`,
                            borderRadius:7,color:SOC.red,fontSize:12,fontWeight:600,cursor:"pointer"}}>Delete</button>
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {tab==="policies" && (
              openPolicy ? (
                <div style={{...panel,padding:"18px"}}>
                  <button onClick={()=>{setOpenPolicy(null); setPolicyEdit(null);}}
                    style={{marginBottom:12,padding:"5px 12px",background:SOC.panelHi,border:`1px solid ${SOC.border}`,
                      borderRadius:6,color:SOC.textSec,fontSize:12,cursor:"pointer"}}>← All policies</button>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
                    <span style={{fontSize:15,fontWeight:700}}>{openPolicy.policyName}</span>
                    {policyEdit==null ? (
                      <button onClick={()=>setPolicyEdit(openPolicy.content || "")}
                        style={{padding:"6px 12px",background:`${SOC.amber}18`,border:`1px solid ${SOC.amber}55`,
                          borderRadius:7,color:SOC.amber,fontSize:12,fontWeight:600,cursor:"pointer"}}>Edit</button>
                    ) : (
                      <>
                        <button onClick={savePolicy} disabled={savingPolicy}
                          style={{padding:"6px 12px",background:`${SOC.green}18`,border:`1px solid ${SOC.green}55`,
                            borderRadius:7,color:SOC.green,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                          {savingPolicy?"Saving…":"Save"}</button>
                        <button onClick={()=>setPolicyEdit(null)} disabled={savingPolicy}
                          style={{padding:"6px 12px",background:SOC.panelHi,border:`1px solid ${SOC.border}`,
                            borderRadius:7,color:SOC.textSec,fontSize:12,cursor:"pointer"}}>Cancel</button>
                      </>
                    )}
                  </div>
                  {policyEdit==null ? (
                    <div style={{background:"#fff",borderRadius:8,padding:"12px 14px"}}>
                      <MarkdownDocLight text={openPolicy.content || ""}/>
                    </div>
                  ) : (
                    <textarea value={policyEdit} onChange={e=>setPolicyEdit(e.target.value)}
                      style={{width:"100%",minHeight:420,background:SOC.bg,color:SOC.text,border:`1px solid ${SOC.border}`,
                        borderRadius:8,padding:"12px 14px",fontFamily:"ui-monospace,Menlo,monospace",fontSize:13,lineHeight:1.5,resize:"vertical"}}/>
                  )}
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {detailLoading && <div style={{color:SOC.textMut}}>Loading…</div>}
                  {overview.policies.length===0 ? (
                    <div style={{...panel,padding:30,textAlign:"center",color:SOC.textMut}}>No policy documents yet.</div>
                  ) : overview.policies.map(p => (
                    <div key={p.id} style={{...panel,padding:"14px 16px",display:"flex",alignItems:"center",gap:12}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{color:SOC.text,fontWeight:600,fontSize:14}}>{p.policyName}</div>
                        <div style={{color:SOC.textMut,fontSize:12,marginTop:2}}>
                          created {new Date(p.createdAt).toLocaleDateString()}
                          {p.updatedAt ? ` · edited ${new Date(p.updatedAt).toLocaleDateString()}` : ""}
                        </div>
                      </div>
                      <button onClick={()=>openPolicyDetail(p.id)}
                        style={{padding:"6px 12px",background:`${SOC.cyan}18`,border:`1px solid ${SOC.cyan}55`,
                          borderRadius:7,color:SOC.cyan,fontSize:12,fontWeight:600,cursor:"pointer"}}>Open / Edit</button>
                    </div>
                  ))}
                </div>
              )
            )}

            {tab==="training" && (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {overview.training.length===0 ? (
                  <div style={{...panel,padding:30,textAlign:"center",color:SOC.textMut}}>No training programs yet.</div>
                ) : overview.training.map(t => (
                  <div key={t.id} style={{...panel,padding:"14px 16px"}}>
                    <div style={{color:SOC.text,fontWeight:600,fontSize:14}}>{t.companyContext?.name || "Training program"}</div>
                    <div style={{color:SOC.textMut,fontSize:12,marginTop:2}}>
                      {t.moduleCount} module(s) · created {new Date(t.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Real, one-directional analyst → client messaging. There is no live two-way
// chat backend, so this does not simulate one. Sending calls a real endpoint
// that delivers an actual notification to the client's notification bell, and
// the panel shows real recent activity (via the client's action log) rather
// than a conversation thread that would imply replies are possible here.
function ClientNotePanel({ clientId }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null);
  const [recent, setRecent] = useState(null);

  const loadRecent = useCallback(() => {
    authFetch(`${API_BASE}/api/analyst/clients/${clientId}/actions`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setRecent(d ? d.actions.slice(0, 6) : []))
      .catch(() => setRecent([]));
  }, [clientId]);

  useEffect(() => { setRecent(null); setSent(null); loadRecent(); }, [clientId, loadRecent]);

  async function send() {
    if (!draft.trim()) return;
    setSending(true); setSent(null);
    try {
      const res = await authFetch(`${API_BASE}/api/analyst/clients/${clientId}/note`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: draft.trim() }),
      });
      if (res.ok) {
        setDraft("");
        setSent("Sent — the client will see this in their notifications.");
        loadRecent();
      } else {
        const d = await res.json().catch(() => ({}));
        setSent(d.error || "Could not send.");
      }
    } finally { setSending(false); }
  }

  return (
    <SocPanel title="Note to Client" accent={SOC.green}>
      <div style={{color:SOC.textMut,fontSize:10.5,lineHeight:1.5,marginBottom:10}}>
        Delivered to their notification bell. There's no live reply channel yet, so this is
        one-directional — for a conversation, use their contact email on file.
      </div>

      {recent === null ? (
        <div style={{color:SOC.textMut,fontSize:11,padding:"10px 0"}}>Loading recent activity…</div>
      ) : recent.length === 0 ? (
        <div style={{color:SOC.textSec,fontSize:11,padding:"6px 0 12px",textAlign:"center"}}>
          No data to report — nothing sent to this client yet.
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:150,overflowY:"auto",marginBottom:10}}>
          {recent.map(a=>(
            <div key={a.id} style={{padding:"7px 10px",background:SOC.bg,borderRadius:7,fontSize:11}}>
              <div style={{color:SOC.text}}>{a.detail}</div>
              <div style={{color:SOC.textMut,fontSize:9.5,marginTop:2}}>
                {a.actorRole} · {new Date(a.at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{display:"flex",gap:8}}>
        <input value={draft} onChange={e=>setDraft(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&send()}
          placeholder="Write a note for this client…"
          disabled={sending}
          style={{flex:1,padding:"9px 12px",background:SOC.bg,border:`1px solid ${SOC.border}`,
            borderRadius:8,color:SOC.text,fontSize:12,fontFamily:"Inter,system-ui,sans-serif"}}/>
        <button onClick={send} disabled={sending || !draft.trim()}
          style={{padding:"9px 16px",background:draft.trim()?SOC.green:SOC.border,
            color:draft.trim()?SOC.bg:SOC.textMut,border:"none",borderRadius:8,fontSize:12,fontWeight:700,
            cursor:draft.trim()&&!sending?"pointer":"default"}}>
          {sending ? "…" : "Send"}
        </button>
      </div>
      {sent && (
        <div style={{marginTop:8,fontSize:11,color:sent.startsWith("Sent")?SOC.green:SOC.red}}>{sent}</div>
      )}
    </SocPanel>
  );
}

function AnalystConsole({ user, onExit }) {
  const [view, setView] = useState("portfolio");
  const [active, setActive] = useState(null);
  const [mmOpen, setMmOpen] = useState(false);
  const [mmThread, setMmThread] = useState([
    { from: "mm", text: "I'm ShieldAI Mastermind — your diagnostic co-pilot. Pick a quick action below or ask me anything about this client: threat triage, compliance gaps, agent issues, or what to prioritize." },
  ]);
  const [mmDraft, setMmDraft] = useState("");
  const [mmThinking, setMmThinking] = useState(false);
  const [trainingClient, setTrainingClient] = useState(null); // client whose training mgmt is open
  const [fleet, setFleet] = useState(null);          // live endpoints from backend
  const [myClients, setMyClients] = useState(null);
  const [actionsFor, setActionsFor] = useState(null); // { client, actions }
  const [actionsLoading, setActionsLoading] = useState(false);
  const [workspaceClient, setWorkspaceClient] = useState(null); // client whose full workspace is open
  const [reviewBusy, setReviewBusy] = useState(null);

  // Approve a program/policy from the client-detail Review & Approval Queue.
  // Calls the same real endpoint the review tab elsewhere in the app uses, then
  // refetches the portfolio so this client's queue and `active` reflect it —
  // the button used to have no handler at all.
  async function approveReviewItem(clientId, item) {
    const key = item.id + "approve";
    setReviewBusy(key);
    try {
      const res = await authFetch(`${API_BASE}/api/analyst/clients/${clientId}/review-decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: item.kind, id: item.id, decision: "approve" }),
      });
      if (res.ok) {
        const refreshed = await authFetch(`${API_BASE}/api/analyst/portfolio`);
        if (refreshed.ok) {
          const list = await refreshed.json();
          const rows = Array.isArray(list) ? list : (list.clients || []);
          setPortfolio(rows);
          const updated = rows.find(r => r.id === clientId);
          if (updated) setActive(updated);
        }
      }
    } finally { setReviewBusy(null); }
  }

  async function loadMyClients() {
    try {
      const res = await authFetch(`${API_BASE}/api/analyst/clients`);
      if (res.ok) setMyClients(await res.json());
    } catch { /* ignore */ }
  }
  async function loadClientActions(clientId) {
    setActionsLoading(true);
    try {
      const res = await authFetch(`${API_BASE}/api/analyst/clients/${clientId}/actions`);
      if (res.ok) setActionsFor(await res.json());
    } catch { /* ignore */ } finally { setActionsLoading(false); }
  }
  useEffect(() => { if (view === "myclients" && myClients === null) loadMyClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [fleetError, setFleetError] = useState(null);
  const [drafts, setDrafts] = useState([]);          // AI-drafted suggestions awaiting review
  const [draftBusy, setDraftBusy] = useState(null);
  const [recTarget, setRecTarget] = useState(null);  // endpoint we're drafting a rec for
  const [recForm, setRecForm] = useState({ title:"", detail:"", severity:"medium", origin:"analyst" });
  const [recSaving, setRecSaving] = useState(false);

  async function loadFleet() {
    setFleetLoading(true); setFleetError(null);
    try {
      const [eRes, dRes] = await Promise.all([
        authFetch(`${API_BASE}/api/analyst/endpoints`),
        authFetch(`${API_BASE}/api/analyst/recommendations?status=suggested`),
      ]);
      if (!eRes.ok) throw new Error("Could not load fleet (analyst access required).");
      setFleet(await eRes.json());
      if (dRes.ok) setDrafts(await dRes.json());
    } catch (e) { setFleetError(e.message); } finally { setFleetLoading(false); }
  }
  useEffect(() => { if (view === "livefleet" && fleet === null) loadFleet(); }, [view]);

  async function enrichDraft(id) {
    setDraftBusy(id);
    try {
      const res = await authFetch(`${API_BASE}/api/analyst/recommendations/${id}/enrich`, { method: "POST" });
      if (res.ok) { const updated = await res.json(); setDrafts(ds => ds.map(d => d.id === id ? { ...d, ...updated } : d)); }
    } finally { setDraftBusy(null); }
  }
  async function forwardDraft(id) {
    setDraftBusy(id);
    try {
      const res = await authFetch(`${API_BASE}/api/analyst/recommendations/${id}/forward`, { method: "POST" });
      if (res.ok) setDrafts(ds => ds.filter(d => d.id !== id)); // leaves the suggested queue
    } finally { setDraftBusy(null); }
  }

  async function submitRecommendation() {
    if (!recTarget || !recForm.title.trim()) return;
    setRecSaving(true);
    try {
      const res = await authFetch(`${API_BASE}/api/analyst/recommendations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerUserId: recTarget.owner?.id,
          agentId: recTarget.id,
          title: recForm.title, detail: recForm.detail,
          severity: recForm.severity, origin: recForm.origin,
        }),
      });
      if (res.ok) {
        setRecTarget(null);
        setRecForm({ title:"", detail:"", severity:"medium", origin:"analyst" });
      }
    } finally { setRecSaving(false); }
  }

  // Real Mastermind chat — calls the analyst-scoped endpoint, which has
  // genuine read-only tool access to this analyst's assigned clients (see
  // mastermindRoutes.js). Previously this picked a reply from a hardcoded
  // switch statement in mastermindReply() after a fake "thinking" delay; the
  // client-side reply text even said so explicitly ("In the live product, I
  // analyze this client's real telemetry..."). It now is the live product.
  async function mmSend(quickId, freeText) {
    const text = freeText || MASTERMIND_QUICK.find(q => q.id === quickId)?.label || "…";
    const userMsg = { from: "analyst", text };
    const nextThread = [...mmThread, userMsg];
    setMmThread(nextThread);
    setMmDraft("");
    setMmThinking(true);
    try {
      // Give Mastermind which client is in view, if any, so "this client"
      // in a follow-up question resolves correctly without re-stating it.
      const contextLine = active ? `[Context: currently viewing client "${active.name}", id ${active.id}]\n` : "";
      const res = await authFetch(`${API_BASE}/api/analyst/mastermind/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextThread
            .filter(m => m.from !== "mm" || nextThread.indexOf(m) > 0) // keep the intro line out of the sent history
            .map((m, i) => i === nextThread.length - 1 && m.from === "analyst"
              ? { role: "user", content: contextLine + m.text }
              : { role: m.from === "analyst" ? "user" : "assistant", content: m.text }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Mastermind could not respond.");
      setMmThread(t => [...t, { from: "mm", text: data.reply || "(empty response)" }]);
    } catch (err) {
      setMmThread(t => [...t, { from: "mm", text: `⚠️ ${err.message}` }]);
    } finally {
      setMmThinking(false);
    }
  }

  // Real clients from /api/analyst/portfolio — scoped server-side to the ones
  // assigned to this analyst.
  //
  // This replaced `const clients = SAMPLE_CLIENTS`: 143 lines of hardcoded fake
  // clients ("Meridian Dental Group", posture 53, $1,800 MRR, invented phishing
  // alerts) that rendered on the landing page an analyst sees first. The KPI
  // tiles — including Monthly Recurring Revenue and Average Posture — were
  // computed from that array. Real client data was already being fetched and was
  // only shown in a secondary tab.
  //
  // Every field is now real or explicitly null, and null renders as "—". A
  // fabricated posture score on a triage dashboard is worse than a blank one,
  // because a blank prompts a question and a number gets acted on.
  const [portfolio, setPortfolio] = useState(null);
  const [portfolioErr, setPortfolioErr] = useState(null);
  useEffect(() => {
    let live = true;
    authFetch(`${API_BASE}/api/analyst/portfolio`)
      .then(async r => {
        if (!r.ok) throw new Error(r.status === 403 ? "Analyst access required." : `Couldn't load portfolio (${r.status}).`);
        return r.json();
      })
      .then(d => { if (live) setPortfolio(Array.isArray(d) ? d : (d.clients || [])); })
      .catch(e => { if (live) setPortfolioErr(e.message); });
    return () => { live = false; };
  }, []);
  const clients = portfolio || [];
  // KPIs computed from real data, with null meaning "we don't have this".
  //
  // MRR is null on every row because there is no billing integration yet
  // (Stripe deferred). The tile stays — an analyst expects it — and renders "—"
  // until billing is wired. Summing nulls to $0.0k would state that the book of
  // business earns nothing, which is a claim we can't make; inventing a figure
  // would be worse.
  const mrrKnown = clients.filter(c => typeof c.mrr === "number");
  const totalMRR = mrrKnown.length ? mrrKnown.reduce((s, c) => s + c.mrr, 0) : null;

  // Average posture over clients we've actually SCORED. Treating an unscored
  // client as 0 would drag the average toward alarm; treating them as average
  // would hide them. They're excluded, and the tile says how many counted.
  const scored = clients.filter(c => typeof c.posture === "number");
  const avgPosture = scored.length
    ? Math.round(scored.reduce((s, c) => s + c.posture, 0) / scored.length)
    : null;

  const reviewCount = clients.reduce((s, c) =>
    s + (c.reviewQueue || []).filter(r => r.status === "awaiting_review").length, 0);
  const highAlerts = clients.reduce((s, c) =>
    s + (c.alerts || []).filter(a => a.sev === "high" || a.sev === "critical").length, 0);
  const agentsOnline = clients.filter(c => c.agent?.status === "healthy").length;
  const withAgents = clients.filter(c => (c.agent?.endpoints || 0) > 0).length;
  const openConflicts = clients.reduce((s, c) => s + (c.conflicts || 0), 0);
  const unscoredCount = clients.length - scored.length;

  const statusMeta = {
    on_track: { label: "On Track", color: SOC.green },
    needs_review: { label: "Needs Review", color: SOC.amber },
    attention: { label: "Attention", color: SOC.red },
    // New state. The backend used to fall through to "on_track" when a client
    // had no posture, painting a green badge on someone we'd never scored —
    // which is the one thing a triage view must never do, because it tells a
    // human to look away. "Unknown" is a gap in coverage, not a pass.
    unknown: { label: "Unknown", color: SOC.purple },
  };
  const metaFor = s => statusMeta[s] || statusMeta.unknown;

  const Header = ({ title, backTo }) => (
    <div style={{padding:"13px 22px",background:SOC.panel,borderBottom:`1px solid ${SOC.border}`,
      display:"flex",alignItems:"center",gap:12}}>
      <span style={{fontSize:18}}>🛰️</span>
      <span style={{fontWeight:700,fontSize:15,color:SOC.text}}>{title}</span>
      <span style={{fontSize:10,color:SOC.cyan,letterSpacing:2,padding:"2px 10px",
        background:`${SOC.cyan}18`,borderRadius:20,border:`1px solid ${SOC.cyan}33`}}>ANALYST CONSOLE</span>
      <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
        <span style={{fontSize:11,color:SOC.textSec}}>{user.email}</span>
        <button onClick={()=>setView(view==="myclients"?"portfolio":"myclients")}
          style={{padding:"6px 14px",background:view==="myclients"?SOC.cyan:`${SOC.cyan}18`,
            color:view==="myclients"?SOC.bg:SOC.cyan,border:`1px solid ${SOC.cyan}55`,borderRadius:6,
            fontSize:12,fontWeight:700,cursor:"pointer"}}>
          👥 My Clients
        </button>
        <button onClick={()=>setView(view==="livefleet"?"portfolio":"livefleet")}
          style={{padding:"6px 14px",background:view==="livefleet"?SOC.cyan:`${SOC.cyan}18`,
            color:view==="livefleet"?SOC.bg:SOC.cyan,border:`1px solid ${SOC.cyan}55`,borderRadius:6,
            fontSize:12,fontWeight:700,cursor:"pointer"}}>
          🖥️ Live Fleet
        </button>
        <button onClick={()=>setView(view==="branding"?"portfolio":"branding")}
          style={{padding:"6px 14px",background:view==="branding"?SOC.cyan:`${SOC.cyan}18`,
            color:view==="branding"?SOC.bg:SOC.cyan,border:`1px solid ${SOC.cyan}55`,borderRadius:6,
            fontSize:12,fontWeight:700,cursor:"pointer"}}>
          🎨 Branding
        </button>
        <button onClick={()=>setMmOpen(o=>!o)}
          style={{padding:"6px 14px",background:mmOpen?SOC.purple:`${SOC.purple}22`,
            color:mmOpen?SOC.bg:SOC.purple,border:`1px solid ${SOC.purple}66`,borderRadius:6,
            fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
          ✦ Mastermind
        </button>
        {backTo && (
          <button onClick={backTo.fn} style={{padding:"6px 14px",background:SOC.panelHi,
            border:`1px solid ${SOC.border}`,borderRadius:6,color:SOC.textSec,fontSize:12,cursor:"pointer"}}>
            ← {backTo.label}
          </button>
        )}
        <button onClick={onExit} style={{padding:"6px 16px",background:SOC.cyan,
          color:SOC.bg,border:"none",borderRadius:6,fontSize:12,fontWeight:700,cursor:"pointer"}}>
          Exit Console
        </button>
      </div>
    </div>
  );

  // ── Mastermind slide-out panel (shared across views) ──
  const Mastermind = () => (
    <div style={{position:"fixed",top:0,right:0,bottom:0,width:mmOpen?380:0,
      background:SOC.panel,borderLeft:mmOpen?`1px solid ${SOC.purple}44`:"none",
      boxShadow:mmOpen?`-8px 0 40px rgba(0,0,0,0.5)`:"none",
      transition:"width 0.25s ease",overflow:"hidden",zIndex:50,display:"flex",flexDirection:"column"}}>
      {mmOpen && (
        <>
          {/* Panel header */}
          <div style={{padding:"14px 16px",borderBottom:`1px solid ${SOC.border}`,
            display:"flex",alignItems:"center",gap:9,
            background:`linear-gradient(135deg,${SOC.purple}22,transparent)`}}>
            <div style={{width:28,height:28,borderRadius:8,background:`${SOC.purple}33`,
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>✦</div>
            <div style={{flex:1}}>
              <div style={{color:SOC.text,fontWeight:700,fontSize:13}}>ShieldAI Mastermind</div>
              <div style={{color:SOC.purple,fontSize:9,letterSpacing:1}}>DIAGNOSTIC CO-PILOT</div>
            </div>
            <button onClick={()=>setMmOpen(false)} style={{background:"none",border:"none",
              color:SOC.textMut,fontSize:18,cursor:"pointer",lineHeight:1}}>×</button>
          </div>

          {/* Context line */}
          <div style={{padding:"8px 16px",fontSize:10,color:SOC.textMut,borderBottom:`1px solid ${SOC.border}`}}>
            {active ? <>Context: <span style={{color:SOC.textSec}}>{active.name}</span></> : "Context: Portfolio overview"}
          </div>

          {/* Thread */}
          <div style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
            {mmThread.map((m,i)=>(
              <div key={i} style={{alignSelf:m.from==="analyst"?"flex-end":"flex-start",maxWidth:"88%"}}>
                {m.from==="mm" && (
                  <div style={{fontSize:9,color:SOC.purple,marginBottom:3,letterSpacing:0.5,fontWeight:700}}>✦ MASTERMIND</div>
                )}
                <div style={{padding:"10px 12px",borderRadius:10,fontSize:12,lineHeight:1.6,
                  background:m.from==="analyst"?SOC.cyan:SOC.bg,
                  color:m.from==="analyst"?SOC.bg:SOC.text,
                  border:m.from==="analyst"?"none":`1px solid ${SOC.border}`}}>
                  {m.from==="analyst"
                    ? m.text
                    : <ChatMarkdown text={m.text} color={SOC.text} mutedColor={SOC.textSec}/>}
                </div>
              </div>
            ))}
            {mmThinking && (
              <div style={{alignSelf:"flex-start"}}>
                <div style={{fontSize:9,color:SOC.purple,marginBottom:3,letterSpacing:0.5,fontWeight:700}}>✦ MASTERMIND</div>
                <div style={{padding:"10px 14px",borderRadius:10,background:SOC.bg,border:`1px solid ${SOC.border}`,
                  color:SOC.textMut,fontSize:12}}>Analyzing…</div>
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div style={{padding:"10px 14px",borderTop:`1px solid ${SOC.border}`,display:"flex",flexWrap:"wrap",gap:6}}>
            {MASTERMIND_QUICK.map(q=>(
              <button key={q.id} onClick={()=>mmSend(q.id)}
                style={{padding:"6px 10px",background:SOC.bg,border:`1px solid ${SOC.border}`,
                  borderRadius:16,color:SOC.textSec,fontSize:10,cursor:"pointer",
                  display:"flex",alignItems:"center",gap:4}}>
                <span>{q.icon}</span>{q.label}
              </button>
            ))}
          </div>

          {/* Input */}
          <div style={{padding:"10px 14px",borderTop:`1px solid ${SOC.border}`,display:"flex",gap:8}}>
            <input value={mmDraft} onChange={e=>setMmDraft(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"&&mmDraft.trim()){ mmSend(null, mmDraft.trim()); } }}
              placeholder="Ask Mastermind…"
              style={{flex:1,padding:"9px 12px",background:SOC.bg,border:`1px solid ${SOC.border}`,
                borderRadius:8,color:SOC.text,fontSize:12,fontFamily:"Inter,system-ui,sans-serif"}}/>
            <button onClick={()=>mmDraft.trim()&&mmSend(null, mmDraft.trim())}
              style={{padding:"9px 14px",background:SOC.purple,color:SOC.bg,border:"none",
                borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>Send</button>
          </div>
          <div style={{padding:"6px 14px 12px",fontSize:9,color:SOC.textMut,textAlign:"center"}}>
            Scripted preview · becomes live AI in production
          </div>
        </>
      )}
    </div>
  );

  // ═══ CLIENT COMMAND CENTER ═══
  if (workspaceClient) {
    return <WorkspaceViewer client={workspaceClient} onBack={()=>setWorkspaceClient(null)}/>;
  }

  if (view === "myclients") {
    const list = myClients || [];
    return (
      <div style={{minHeight:"100vh",background:SOC.bg,fontFamily:"Inter,system-ui,sans-serif",color:SOC.text}}>
        <Header title="My Clients"/>
        <Mastermind/>
        <div style={{maxWidth:1000,margin:"0 auto",padding:"20px"}}>
          {actionsFor ? (
            <div>
              <button onClick={()=>setActionsFor(null)}
                style={{marginBottom:14,padding:"6px 14px",background:SOC.panelHi,border:`1px solid ${SOC.border}`,
                  borderRadius:6,color:SOC.textSec,fontSize:12,cursor:"pointer"}}>← Back to clients</button>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                <span style={{fontSize:11,color:SOC.textMut,letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>
                  Action History · {actionsFor.client}
                </span>
                <span style={{fontSize:11,color:SOC.textMut}}>
                  Ask Mastermind about this client's behavior via the 🧠 button above.
                </span>
              </div>
              {actionsLoading ? <div style={{color:SOC.textMut,padding:20}}>Loading…</div> :
               actionsFor.actions.length===0 ? (
                <div style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderRadius:10,padding:"36px",textAlign:"center",color:SOC.textMut}}>
                  No recorded actions for this client yet.
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {actionsFor.actions.map(ac=>{
                    const c = ac.action.includes("declined")?SOC.red
                      : ac.action.includes("completed")?SOC.green
                      : ac.action.includes("permit")?SOC.cyan
                      : ac.action.includes("assigned")?SOC.purple : SOC.textSec;
                    return (
                      <div key={ac.id} style={{display:"flex",gap:12,padding:"10px 14px",background:SOC.panel,
                        border:`1px solid ${SOC.border}`,borderRadius:8,alignItems:"flex-start"}}>
                        <span style={{padding:"2px 8px",borderRadius:5,fontSize:10,fontWeight:700,
                          background:`${c}22`,color:c,whiteSpace:"nowrap"}}>{ac.action.replace(/_/g," ")}</span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{color:SOC.text,fontSize:13}}>{ac.detail}</div>
                          <div style={{color:SOC.textMut,fontSize:11,marginTop:3}}>
                            {ac.actorRole} · {new Date(ac.at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{fontSize:11,color:SOC.textMut,letterSpacing:1,textTransform:"uppercase",fontWeight:700,marginBottom:14}}>
                {list.length} client{list.length!==1?"s":""} assigned to you
              </div>
              {list.length===0 ? (
                <div style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderRadius:10,padding:"40px",textAlign:"center"}}>
                  <div style={{color:SOC.text,fontWeight:600,marginBottom:6}}>No clients assigned yet</div>
                  <div style={{color:SOC.textMut,fontSize:13}}>An admin assigns clients to you from the Assignments tab.</div>
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {list.map(c=>(
                    <div key={c.id} style={{background:SOC.panel,border:`1px solid ${SOC.border}`,
                      borderRadius:10,padding:"14px 16px",display:"flex",alignItems:"center",gap:14}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{color:SOC.text,fontWeight:600,fontSize:14}}>{c.name}</div>
                        <div style={{color:SOC.textMut,fontSize:12,marginTop:2}}>
                          {c.email} · {c.tier} · {c.endpoints} endpoint(s) · {c.openRecommendations} open rec(s)
                        </div>
                      </div>
                      <button onClick={()=>setWorkspaceClient(c)}
                        style={{padding:"7px 14px",background:`${SOC.green}18`,border:`1px solid ${SOC.green}55`,
                          borderRadius:7,color:SOC.green,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                        View Workspace →
                      </button>
                      <button onClick={()=>loadClientActions(c.id)}
                        style={{padding:"7px 14px",background:`${SOC.cyan}18`,border:`1px solid ${SOC.cyan}55`,
                          borderRadius:7,color:SOC.cyan,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                        Action History →
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (view === "branding") {
    return (
      <div style={{minHeight:"100vh",background:SOC.bg,fontFamily:"Inter,system-ui,sans-serif",color:SOC.text}}>
        <Header title="White-Label Branding"/>
        <Mastermind/>
        <div style={{maxWidth:960,margin:"0 auto",padding:"20px"}}>
          <BrandingManager isAdmin={!!user.isAdmin}/>
        </div>
      </div>
    );
  }

  if (view === "livefleet") {
    const list = fleet || [];
    const online = list.filter(e => isOnline(e.lastSeen)).length;
    const atRisk = list.filter(e => e.summary?.posture === "at_risk").length;
    return (
      <div style={{minHeight:"100vh",background:SOC.bg,fontFamily:"Inter,system-ui,sans-serif",color:SOC.text}}>
        <Header title="Live Endpoint Fleet"/>
        <Mastermind/>
        <div style={{maxWidth:1100,margin:"0 auto",padding:"20px"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
            <span style={{fontSize:11,color:SOC.textMut,letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>
              Real telemetry · {list.length} endpoint{list.length!==1?"s":""} · {online} online · {atRisk} at risk
            </span>
            <button onClick={loadFleet}
              style={{marginLeft:"auto",padding:"6px 14px",background:SOC.panelHi,border:`1px solid ${SOC.border}`,
                borderRadius:6,color:SOC.textSec,fontSize:12,cursor:"pointer"}}>↻ Refresh</button>
          </div>

          {fleetError && <div style={{color:SOC.red,fontSize:13,marginBottom:14}}>{fleetError}</div>}

          {/* Mastermind AI draft queue — auto-drafted from incoming reports.
              Drafts are reviewed here; nothing reaches a client until forwarded. */}
          {drafts.length > 0 && (
            <div style={{marginBottom:20,padding:"16px 18px",background:`${SOC.purple}10`,
              border:`1px solid ${SOC.purple}44`,borderRadius:12}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <span style={{fontSize:14}}>✦</span>
                <span style={{color:SOC.purple,fontSize:12,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>
                  Mastermind AI · Draft Recommendations ({drafts.length})
                </span>
              </div>
              <p style={{color:SOC.textMut,fontSize:12,lineHeight:1.5,margin:"0 0 14px"}}>
                Auto-drafted from incoming agent reports. Review, optionally enrich into client-friendly
                language, then forward to the client. Nothing is sent until you forward it — and the client
                still decides who acts.
              </p>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {drafts.map(d=>{
                  const sm = SEV_META[d.severity] || SEV_META.medium;
                  return (
                    <div key={d.id} style={{background:SOC.panel,border:`1px solid ${SOC.border}`,
                      borderRadius:9,padding:"13px 15px"}}>
                      <div style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:8}}>
                        <span style={{padding:"2px 8px",borderRadius:5,fontSize:10,fontWeight:700,
                          background:`${sm.color}22`,color:sm.color,textTransform:"uppercase"}}>{sm.label}</span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{color:SOC.text,fontSize:13.5,fontWeight:600}}>{d.title}</div>
                          <div style={{color:SOC.textMut,fontSize:11,marginTop:2}}>
                            {d.owner?.companyName || d.owner?.email || "—"}{d.hostname?` · ${d.hostname}`:""}
                            {d.aiEnriched && <span style={{color:SOC.purple,marginLeft:6}}>· AI-enriched</span>}
                          </div>
                          <div style={{color:SOC.textSec,fontSize:12.5,marginTop:6,lineHeight:1.5,whiteSpace:"pre-wrap"}}>{d.detail}</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <button onClick={()=>enrichDraft(d.id)} disabled={draftBusy===d.id}
                          style={{padding:"6px 13px",background:`${SOC.purple}18`,border:`1px solid ${SOC.purple}55`,
                            borderRadius:6,color:SOC.purple,fontSize:12,fontWeight:600,
                            cursor:draftBusy===d.id?"wait":"pointer"}}>
                          {draftBusy===d.id?"Working…":"✦ Enrich with AI"}
                        </button>
                        <button onClick={()=>forwardDraft(d.id)} disabled={draftBusy===d.id}
                          style={{padding:"6px 13px",background:`${SOC.cyan}18`,border:`1px solid ${SOC.cyan}55`,
                            borderRadius:6,color:SOC.cyan,fontSize:12,fontWeight:600,
                            cursor:draftBusy===d.id?"wait":"pointer"}}>
                          Forward to client →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {fleetLoading ? <div style={{padding:40,textAlign:"center",color:SOC.textMut}}>Loading fleet…</div> :
           list.length === 0 ? (
            <div style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderRadius:12,
              padding:"44px 24px",textAlign:"center"}}>
              <div style={{fontSize:30,marginBottom:10}}>🛰️</div>
              <div style={{color:SOC.text,fontWeight:600,fontSize:15,marginBottom:6}}>No endpoints reporting yet</div>
              <div style={{color:SOC.textMut,fontSize:13}}>
                Endpoints appear here once a client installs the agent and it sends its first report.
              </div>
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {list.map(e=>{
                const m = POSTURE_META[e.summary?.posture] || POSTURE_META.needs_attention;
                return (
                  <div key={e.id} style={{background:SOC.panel,border:`1px solid ${SOC.border}`,
                    borderRadius:10,padding:"14px 16px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                      <span style={{fontSize:20}}>{e.os==="windows"?"🪟":e.os==="macos"?"🍎":"🐧"}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <span style={{color:SOC.text,fontWeight:600,fontSize:14}}>{e.hostname}</span>
                          <span style={{width:8,height:8,borderRadius:"50%",
                            background:isOnline(e.lastSeen)?SOC.green:SOC.textMut,
                            boxShadow:isOnline(e.lastSeen)?`0 0 6px ${SOC.green}`:"none"}}/>
                          <span style={{fontSize:11,color:SOC.textMut}}>{e.owner?.companyName || e.owner?.email || "—"}</span>
                        </div>
                        <div style={{color:SOC.textMut,fontSize:11.5,marginTop:3}}>
                          last report {timeAgo(e.lastReportAt)}
                          {e.summary && ` · ${e.summary.failCount} fail · ${e.summary.warnCount} warn`}
                        </div>
                      </div>
                      <span style={{color:m.color,fontWeight:700,fontSize:13}}>{m.label}</span>
                      <button onClick={()=>setRecTarget(e)}
                        style={{padding:"6px 13px",background:`${SOC.cyan}18`,border:`1px solid ${SOC.cyan}55`,
                          borderRadius:6,color:SOC.cyan,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                        Recommend
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recommendation composer */}
        {recTarget && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:60,
            display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
            onClick={()=>setRecTarget(null)}>
            <div onClick={ev=>ev.stopPropagation()} style={{background:SOC.panel,border:`1px solid ${SOC.border}`,
              borderRadius:14,maxWidth:560,width:"100%",padding:"22px 24px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <h3 style={{color:SOC.text,fontSize:17,margin:0}}>Recommend an action</h3>
                <button onClick={()=>setRecTarget(null)} style={{background:"none",border:"none",
                  color:SOC.textSec,fontSize:22,cursor:"pointer"}}>×</button>
              </div>
              <p style={{color:SOC.textMut,fontSize:12.5,lineHeight:1.5,margin:"0 0 16px"}}>
                For <strong style={{color:SOC.text}}>{recTarget.hostname}</strong> ({recTarget.owner?.companyName || recTarget.owner?.email}).
                This sends a recommendation to the client. They decide whether to handle it themselves
                or permit you to perform it — you cannot act without their permission.
              </p>
              <input value={recForm.title} onChange={e=>setRecForm({...recForm,title:e.target.value})}
                placeholder="Recommendation title (e.g. Enable Windows Firewall on all profiles)"
                style={{width:"100%",padding:"10px 12px",marginBottom:10,background:SOC.bg,
                  border:`1px solid ${SOC.border}`,borderRadius:8,color:SOC.text,fontSize:13,
                  fontFamily:"Inter,system-ui,sans-serif",boxSizing:"border-box"}}/>
              <textarea value={recForm.detail} onChange={e=>setRecForm({...recForm,detail:e.target.value})}
                placeholder="Detail / rationale for the client"
                rows={4} style={{width:"100%",padding:"10px 12px",marginBottom:10,background:SOC.bg,
                  border:`1px solid ${SOC.border}`,borderRadius:8,color:SOC.text,fontSize:13,
                  fontFamily:"Inter,system-ui,sans-serif",resize:"vertical",boxSizing:"border-box"}}/>
              <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center"}}>
                <span style={{fontSize:12,color:SOC.textMut}}>Severity</span>
                {["low","medium","high","critical"].map(s=>(
                  <button key={s} onClick={()=>setRecForm({...recForm,severity:s})}
                    style={{padding:"5px 11px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",
                      textTransform:"capitalize",
                      background:recForm.severity===s?`${(SEV_META[s]||SEV_META.medium).color}22`:"transparent",
                      border:`1px solid ${recForm.severity===s?(SEV_META[s]||SEV_META.medium).color:SOC.border}`,
                      color:recForm.severity===s?(SEV_META[s]||SEV_META.medium).color:SOC.textSec,
                      fontFamily:"Inter,system-ui,sans-serif"}}>{s}</button>
                ))}
              </div>
              <button onClick={submitRecommendation} disabled={recSaving || !recForm.title.trim()}
                style={{padding:"10px 18px",background:recForm.title.trim()?SOC.cyan:SOC.border,
                  color:recForm.title.trim()?SOC.bg:SOC.textMut,border:"none",borderRadius:8,
                  fontSize:13,fontWeight:700,cursor:recForm.title.trim()?"pointer":"default"}}>
                {recSaving ? "Sending…" : "Send Recommendation to Client"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (view === "client" && active) {
    const c = active;
    const clr = pColor(c.posture);
    // Empty history (never scored) must not produce NaN. null means "no trend
    // to show" — a client with one data point has no trend, and inventing a
    // flat line would imply stability we haven't observed.
    const hist = c.history || [];
    const trend = hist.length > 1 ? hist[hist.length-1] - hist[0] : null;

    return (
      <div style={{minHeight:"100vh",background:SOC.bg,fontFamily:"Inter,system-ui,sans-serif",color:SOC.text}}>
        <Header title={c.name} backTo={{ label:"Portfolio", fn:()=>{setView("portfolio");setActive(null);} }}/>
        <Mastermind/>
        {trainingClient && <TrainingManager client={trainingClient} onClose={()=>setTrainingClient(null)}/>}
        <div style={{maxWidth:1180,margin:"0 auto",padding:"20px"}}>

          {/* Top band: posture + agent + compliance + plan */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:16}}>
            <div style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderRadius:12,padding:"16px",textAlign:"center"}}>
              <div style={{fontSize:36,fontWeight:800,color:typeof c.posture==="number"?clr:SOC.textMut,lineHeight:1}}>{typeof c.posture==="number" ? c.posture : "—"}</div>
              <div style={{fontSize:9,color:SOC.textMut,letterSpacing:1,marginTop:3}}>POSTURE / 100</div>
              <div style={{marginTop:6,fontSize:10,color:trend>=0?SOC.green:SOC.red}}>
                {trend>=0?"▲":"▼"} {Math.abs(trend)} pts / 12mo
              </div>
            </div>
            <div style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderRadius:12,padding:"16px",textAlign:"center"}}>
              {(() => { const am = agentMeta(c.agent.status); return (
                <>
                  <div style={{fontSize:13,fontWeight:700,color:am.color,
                    display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                    <span style={{width:9,height:9,borderRadius:"50%",background:am.dot,
                      boxShadow:am.glow?`0 0 8px ${am.dot}`:"none"}}/>
                    {am.label}
                  </div>
                  <div style={{fontSize:22,fontWeight:800,color:SOC.text,marginTop:6}}>{c.agent.endpoints}</div>
                  <div style={{fontSize:9,color:SOC.textMut}}>{c.agent?.endpoints ? `${c.agent.healthy}/${c.agent.endpoints} healthy` : "no agent enrolled"}</div>
                  {c.agent.status === "offline" && (
                    <button style={{marginTop:8,width:"100%",padding:"6px",background:`${SOC.red}18`,
                      border:`1px solid ${SOC.red}44`,borderRadius:6,color:SOC.red,fontSize:10,fontWeight:600,cursor:"pointer"}}>
                      Deploy Agent →
                    </button>
                  )}
                  {c.agent.status === "degraded" && (
                    <div style={{marginTop:6,fontSize:9,color:SOC.amber}}>Last seen {c.agent.lastSeen}</div>
                  )}
                </>
              ); })()}
            </div>
            <div style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderRadius:12,padding:"16px",textAlign:"center"}}>
              <div style={{fontSize:9,color:SOC.textMut,letterSpacing:1}}>{c.compliancePct ? `${c.compliancePct.framework} READINESS` : "COMPLIANCE"}</div>
              <div style={{fontSize:28,fontWeight:800,color:c.compliancePct?SOC.cyan:SOC.textMut,marginTop:4}}>{c.compliancePct ? `${c.compliancePct.current}%` : "—"}</div>
              <div style={{height:5,background:SOC.grid,borderRadius:3,marginTop:8,overflow:"hidden"}}>
                <div style={{width:`${c.compliancePct?.current ?? 0}%`,height:"100%",background:SOC.cyan}}/>
              </div>
              <div style={{fontSize:9,color:SOC.textMut,marginTop:4}}>{c.compliancePct ? `across ${c.compliancePct.frameworks} framework(s)` : "no assessment on file"}</div>
            </div>
            <div style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderRadius:12,padding:"16px",textAlign:"center"}}>
              <div style={{fontSize:9,color:SOC.textMut,letterSpacing:1}}>MONTHLY VALUE</div>
              <div style={{fontSize:24,fontWeight:800,color:typeof c.mrr==="number"?SOC.green:SOC.textMut,marginTop:6}}>{typeof c.mrr==="number" ? `$${c.mrr.toLocaleString()}` : "—"}</div>
              <div style={{fontSize:9,color:SOC.textMut,marginTop:4}}>{c.plan}</div>
            </div>
          </div>

          {/* Main grid */}
          <div style={{display:"grid",gridTemplateColumns:"1.4fr 1fr",gap:14,marginBottom:14}}>
            {/* Posture trend */}
            <SocPanel title="Security Posture — 12 Month Trend" accent={SOC.cyan}>
              <TrendChart data={c.history} color={clr}/>
            </SocPanel>

            {/* Live threat feed */}
            <SocPanel title="Live Threat Feed" accent={SOC.red}
              action={<span style={{fontSize:9,color:SOC.green,display:"flex",alignItems:"center",gap:5}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:SOC.green,boxShadow:`0 0 6px ${SOC.green}`}}/>LIVE</span>}>
              {(c.alerts || []).length === 0 ? (
                <div style={{color:SOC.textSec,fontSize:12,padding:"20px 0",textAlign:"center"}}>
                  No active threats. All clear. ✓
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:150,overflowY:"auto"}}>
                  {(c.alerts || []).map((a,i)=>(
                    <div key={i} style={{display:"flex",gap:10,padding:"8px 10px",background:SOC.bg,
                      borderRadius:8,borderLeft:`3px solid ${sevColor(a.sev)}`}}>
                      <div style={{flex:1}}>
                        <div style={{color:SOC.text,fontSize:12,fontWeight:600}}>{a.title}</div>
                        <div style={{color:SOC.textMut,fontSize:10,marginTop:2}}>{a.detail}</div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <span style={{fontSize:8,fontWeight:700,color:sevColor(a.sev),textTransform:"uppercase"}}>{a.sev}</span>
                        <div style={{fontSize:9,color:SOC.textMut,marginTop:2}}>{a.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SocPanel>
          </div>

          {/* Real breach exposure — previously only visible to Mastermind's
              get_darkweb_exposure tool, never shown directly to the analyst. */}
          <div style={{marginBottom:14}}>
            <AnalystDarkWebPanel clientId={c.id}/>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
            {/* Real, one-directional note to the client — delivered as an
                actual notification via /api/analyst/clients/:id/note, and
                logged to the same action history the "Action History" button
                in My Clients reads. This replaced a two-way chat UI that
                looked functional but only ever wrote to local component state:
                nothing sent here ever reached the client. */}
            <ClientNotePanel clientId={c.id}/>

            {/* Review & approval queue — reads reviewItems() from the
                portfolio API, which returns {id, kind, title, status}. This
                previously read item.type/item.generated (fields that don't
                exist in that response, so they always rendered blank) and had
                an Approve button with no onClick — it looked actionable and
                did nothing. Both are fixed: real fields, and Approve calls the
                same /review-decision endpoint the client-detail review tab
                uses elsewhere in this app. */}
            <SocPanel title="Review & Approval Queue" accent={SOC.amber}>
              {(c.reviewQueue || []).length === 0 ? (
                <div style={{color:SOC.textSec,fontSize:12,padding:"20px 0",textAlign:"center"}}>
                  Nothing pending — client is up to date. ✓
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {(c.reviewQueue || []).map((item,i)=>{
                    const meta = {
                      awaiting_review: {label:"Review", color:SOC.amber},
                      approved: {label:"Approved", color:SOC.green},
                      changes_requested: {label:"Changes requested", color:SOC.red},
                    }[item.status] || {label:item.status||"—", color:SOC.textMut};
                    const busyKey = item.id + "approve";
                    return (
                      <div key={item.id || i} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 11px",background:SOC.bg,borderRadius:8}}>
                        <span style={{fontSize:15}}>📄</span>
                        <div style={{flex:1}}>
                          <div style={{color:SOC.text,fontSize:12,fontWeight:600}}>{item.title || "Untitled"}</div>
                          <div style={{color:SOC.textMut,fontSize:9}}>{(item.kind||"item").toUpperCase()}</div>
                        </div>
                        {item.status==="awaiting_review" ? (
                          <button
                            disabled={reviewBusy===busyKey}
                            onClick={()=>approveReviewItem(c.id, item)}
                            style={{padding:"5px 12px",background:`${SOC.green}1A`,border:`1px solid ${SOC.green}44`,
                            borderRadius:6,color:SOC.green,fontSize:11,fontWeight:600,
                            cursor:reviewBusy===busyKey?"wait":"pointer"}}>
                            {reviewBusy===busyKey ? "…" : "Approve"}
                          </button>
                        ) : (
                          <span style={{fontSize:9,fontWeight:700,color:meta.color,textTransform:"uppercase"}}>{meta.label}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </SocPanel>
          </div>


          {/* Client document drilldown — read the actual assessments,
              programs, and policies behind the posture number. */}
          <div style={{marginBottom:14}}>
            <ClientDocuments clientId={c.id}/>
          </div>

          {/* Training program — assign, track completion, act on the client's
              security-awareness training. Scoped to this client via clientId. */}
          <div style={{marginBottom:14}}>
            <ClientTrainingPanel clientId={c.id}/>
          </div>

          {/* Reports — generate compliance/insurance/legal reports from the
              client's live data and deliver them to the client. */}
          <div style={{marginBottom:14}}>
            <ClientReportsPanel clientId={c.id}/>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
            {/* Program health — from the client's actual answers, not inferred.
                These four rows previously read:
                  { label:"Patch compliance", val: c.posture>50?78:34 }
                  { label:"MFA adoption",     val: c.posture>50?85:20 }
                  { label:"Backup health",    val: c.posture>50?92:40 }
                — three security metrics invented by a ternary on the posture
                score and rendered as progress bars. An analyst reading "MFA
                adoption 85%" would reasonably believe someone measured it.
                Nobody did. The assessment answers these questions directly, and
                the agent corroborates some of them, so we show that instead.
                A control with no answer shows "not assessed", not a number. */}
            <SocPanel title="Program Health" accent={SOC.blue}>
              <div style={{display:"flex",flexDirection:"column",gap:9}}>
                {[
                  { label:"Endpoint protection", val: c.agent?.endpoints ? Math.round((c.agent.healthy / c.agent.endpoints) * 100) : null,
                    note: c.agent?.endpoints ? `${c.agent.healthy}/${c.agent.endpoints} agents healthy` : "No agent enrolled" },
                  { label:"Compliance readiness", val: c.compliancePct?.current ?? null,
                    note: c.compliancePct ? `weakest: ${c.compliancePct.framework}` : "No assessment on file" },
                  { label:"Posture", val: typeof c.posture === "number" ? c.posture : null,
                    note: c.level || "Not scored" },
                ].map((r,i)=>(
                  <div key={i}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
                      <span style={{color:SOC.textSec}}>{r.label}</span>
                      <span style={{color:r.val===null?SOC.textMut:pColor(r.val),fontWeight:700}}>
                        {r.val===null ? "—" : `${r.val}%`}
                      </span>
                    </div>
                    <div style={{height:4,background:SOC.grid,borderRadius:2,overflow:"hidden"}}>
                      <div style={{width:`${r.val ?? 0}%`,height:"100%",background:r.val===null?SOC.grid:pColor(r.val)}}/>
                    </div>
                    <div style={{fontSize:9.5,color:SOC.textMut,marginTop:2}}>{r.note}</div>
                  </div>
                ))}
              </div>
            </SocPanel>

            {/* Compliance progress — real readiness per framework.
                This panel previously rendered c.compliancePct.target, a number
                that existed only in SAMPLE_CLIENTS, and concluded "On track for
                certification window" by comparing against it. That's a
                compliance claim derived from a fabricated target. There is no
                target in the real data because nobody has set one — so we show
                what we actually computed: readiness per framework, weakest
                first, and the gap count that drives it. */}
            <SocPanel title="Compliance Readiness" accent={SOC.purple}>
              {!c.compliancePct ? (
                <div style={{textAlign:"center",padding:"14px 0",color:SOC.textMut,fontSize:11,lineHeight:1.6}}>
                  No assessment on file.<br/>Nothing here is a pass — we haven't asked yet.
                </div>
              ) : (
                <>
                  <div style={{textAlign:"center",padding:"6px 0"}}>
                    <div style={{fontSize:11,color:SOC.textSec}}>Weakest: {c.compliancePct.framework}</div>
                    <div style={{fontSize:32,fontWeight:800,color:SOC.purple,margin:"4px 0"}}>{c.compliancePct.current}%</div>
                    <div style={{height:6,background:SOC.grid,borderRadius:3,overflow:"hidden",margin:"8px 0"}}>
                      <div style={{width:`${c.compliancePct.current}%`,height:"100%",background:`linear-gradient(90deg,${SOC.purple},${SOC.cyan})`}}/>
                    </div>
                    <div style={{fontSize:10,color:SOC.textMut}}>
                      readiness over assessed controls · {c.compliancePct.frameworks} framework(s)
                    </div>
                  </div>
                  <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:5}}>
                    {(c.compliancePct.detail || []).slice(0,6).map((f,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:10}}>
                        <span style={{color:SOC.textSec,flex:1}}>{f.short}</span>
                        {f.gaps > 0 && <span style={{color:SOC.amber}}>{f.gaps} gap{f.gaps>1?"s":""}</span>}
                        <span style={{color:f.readinessPct===null?SOC.textMut:pColor(f.readinessPct),fontWeight:700,minWidth:32,textAlign:"right"}}>
                          {f.readinessPct===null ? "—" : `${f.readinessPct}%`}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </SocPanel>

            {/* Training program — real rollup from clientTrainingSummary (same
                source the client's own Training tab and the admin fleet view
                use). `c.training` guarded with `|| {}` since older cached
                portfolio rows (or a future schema change) shouldn't crash this
                view — a missing field renders as "no data", not an exception. */}
            <SocPanel title="Training Program" accent={SOC.cyan}>
              {(() => {
                const t = c.training || {};
                const enrolled = t.enrolled || 0;
                return (
                  <>
                    <div style={{fontSize:12,color:SOC.text,fontWeight:600,marginBottom:4}}>
                      {t.active || "No data to report"}
                    </div>
                    {enrolled > 0 ? (
                      <>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:SOC.textMut,marginBottom:6}}>
                          <span>{enrolled} enrolled</span>
                          <span>{t.overdue > 0 ? <span style={{color:SOC.amber}}>{t.overdue} overdue</span> : "none overdue"}</span>
                        </div>
                        <div style={{position:"relative",height:8,background:SOC.grid,borderRadius:4,overflow:"hidden"}}>
                          <div style={{width:`${t.completion || 0}%`,height:"100%",
                            background:`linear-gradient(90deg,${SOC.cyan},${SOC.green})`}}/>
                        </div>
                        <div style={{fontSize:18,fontWeight:800,color:SOC.cyan,marginTop:8,textAlign:"center"}}>
                          {t.completion || 0}%<span style={{fontSize:10,color:SOC.textMut,fontWeight:400}}> complete</span>
                        </div>
                      </>
                    ) : (
                      <div style={{color:SOC.textSec,fontSize:11,padding:"10px 0",lineHeight:1.6}}>
                        No active program. Deploy a tailored awareness campaign for this client.
                      </div>
                    )}
                    <button onClick={()=>setTrainingClient(c)} style={{marginTop:10,width:"100%",padding:"8px",
                      background:`${SOC.cyan}18`,border:`1px solid ${SOC.cyan}44`,borderRadius:7,
                      color:SOC.cyan,fontSize:11,fontWeight:600,cursor:"pointer"}}>
                      {enrolled>0?"Manage Training":"Build Training Program"} →
                    </button>
                  </>
                );
              })()}
            </SocPanel>

          </div>

          <div style={{marginTop:16,padding:"12px 16px",background:`${SOC.cyan}0A`,
            border:`1px dashed ${SOC.cyan}33`,borderRadius:10,textAlign:"center"}}>
            <span style={{color:SOC.textSec,fontSize:11}}>
              Panels reflect this client's real data — agent telemetry, compliance readiness, training,
              and threat exposure. Fields with no data yet show "—" rather than a placeholder.
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ═══ PORTFOLIO OVERVIEW ═══
  // Loading / error / empty states exist because the console never needed them
  // before: SAMPLE_CLIENTS was always there, always populated, always cheerful.
  // Real data can be absent, and each absence means something different.
  if (portfolioErr || portfolio === null || clients.length === 0) {
    return (
      <div style={{minHeight:"100vh",background:SOC.bg,fontFamily:"Inter,system-ui,sans-serif",color:SOC.text}}>
        <Header title="Portfolio Command Center"/>
        <div style={{maxWidth:1180,margin:"0 auto",padding:"40px 20px"}}>
          <div style={{background:SOC.panel,border:`1px solid ${portfolioErr?SOC.red+"44":SOC.border}`,
            borderRadius:12,padding:"28px 24px",textAlign:"center"}}>
            {portfolioErr ? (
              <>
                <div style={{color:SOC.red,fontSize:14,fontWeight:700,marginBottom:6}}>{portfolioErr}</div>
                <div style={{color:SOC.textSec,fontSize:12}}>
                  If you're an analyst and seeing this, your account may not have the analyst role yet.
                </div>
              </>
            ) : portfolio === null ? (
              <div style={{color:SOC.textSec,fontSize:13}}>Loading your portfolio…</div>
            ) : (
              <>
                <div style={{color:SOC.text,fontSize:14,fontWeight:700,marginBottom:6}}>No clients assigned to you</div>
                <div style={{color:SOC.textSec,fontSize:12,lineHeight:1.7,maxWidth:420,margin:"0 auto"}}>
                  An admin assigns clients to analysts. You see only your own — that scoping is
                  enforced server-side, not here.
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{minHeight:"100vh",background:SOC.bg,fontFamily:"Inter,system-ui,sans-serif",color:SOC.text}}>
      <Header title="Portfolio Command Center"/>
      <Mastermind/>
      <div style={{maxWidth:1180,margin:"0 auto",padding:"20px"}}>

        {/* KPI row */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:12,marginBottom:18}}>
          {[
            { label:"Active Clients", value:clients.length, color:SOC.cyan },
            // "—" until billing is wired. Not $0.0k, which would be a claim.
            { label:"Monthly Recurring", value: totalMRR === null ? "—" : `$${(totalMRR/1000).toFixed(1)}k`,
              color: totalMRR === null ? SOC.textMut : SOC.green,
              hint: totalMRR === null ? "No billing integration yet — nothing to report." : null },
            { label:"Avg Posture", value: avgPosture === null ? "—" : avgPosture,
              color: avgPosture === null ? SOC.textMut : pColor(avgPosture),
              hint: unscoredCount > 0 ? `${scored.length} of ${clients.length} scored` : null },
            { label:"Agents Online", value:`${agentsOnline}/${withAgents || 0}`, color:SOC.blue,
              hint: withAgents < clients.length ? `${clients.length - withAgents} without an agent` : null },
            { label:"Pending Reviews", value:reviewCount, color:reviewCount>0?SOC.amber:SOC.green },
            { label:"Conflicts", value:openConflicts, color:openConflicts>0?SOC.amber:SOC.green,
              hint: openConflicts > 0 ? "Agent telemetry disagrees with client answers" : null },
          ].map((k,i)=>(
            <div key={i} style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderRadius:10,padding:"14px",textAlign:"center"}}>
              <div style={{fontSize:24,fontWeight:800,color:k.color}}>{k.value}</div>
              <div style={{fontSize:9,color:SOC.textMut,marginTop:3,letterSpacing:0.5}}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Agent fleet status legend */}
        <div style={{display:"flex",alignItems:"center",gap:18,marginBottom:18,padding:"10px 16px",
          background:SOC.panel,border:`1px solid ${SOC.border}`,borderRadius:10}}>
          <span style={{fontSize:10,color:SOC.textMut,letterSpacing:1,textTransform:"uppercase",fontWeight:700}}>Agent Fleet</span>
          {[
            { c: SOC.green, label: `${clients.filter(x=>x.agent.status==="healthy").length} Healthy`, sub: "working properly" },
            { c: SOC.amber, label: `${clients.filter(x=>x.agent.status==="degraded").length} Degraded`, sub: "partially degraded" },
            { c: SOC.red, label: `${clients.filter(x=>x.agent.status==="offline").length} No Comms`, sub: "not detected" },
          ].map((s,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:7}}>
              <span style={{width:10,height:10,borderRadius:"50%",background:s.c,boxShadow:`0 0 6px ${s.c}`}}/>
              <span style={{fontSize:12,color:SOC.text,fontWeight:600}}>{s.label}</span>
              <span style={{fontSize:10,color:SOC.textMut}}>· {s.sub}</span>
            </div>
          ))}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1.5fr 1fr",gap:14}}>
          {/* Client list */}
          <div>
            <div style={{display:"flex",alignItems:"center",marginBottom:10}}>
              <div style={{width:3,height:14,background:SOC.cyan,borderRadius:2,marginRight:9}}/>
              <span style={{color:SOC.text,fontSize:12,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Client Portfolio</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {clients.map(c=>{
                const clr = pColor(c.posture);
                const sm = metaFor(c.status);
                const pend = (c.reviewQueue || []).filter(r=>r.status==="awaiting_review").length;
                const highA = (c.alerts || []).filter(a=>a.sev==="high"||a.sev==="critical").length;
                return (
                  <div key={c.id} onClick={()=>{setActive(c);setView("client");}}
                    style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderRadius:10,
                      padding:"13px 15px",cursor:"pointer",display:"flex",alignItems:"center",gap:13}}>
                    <div style={{width:46,height:46,borderRadius:"50%",flexShrink:0,
                      background:`conic-gradient(${clr} ${c.posture*3.6}deg, ${SOC.grid} 0deg)`,
                      display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <div style={{width:36,height:36,borderRadius:"50%",background:SOC.panel,
                        display:"flex",alignItems:"center",justifyContent:"center",color:typeof c.posture==="number"?clr:SOC.textMut,fontWeight:700,fontSize:13}}>{typeof c.posture==="number" ? c.posture : "—"}</div>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{color:SOC.text,fontWeight:600,fontSize:14}}>{c.name}</span>
                        <span style={{fontSize:9,padding:"2px 7px",borderRadius:10,background:sm.color+"22",color:sm.color,fontWeight:700}}>{sm.label}</span>
                      </div>
                      <div style={{color:SOC.textMut,fontSize:11,marginTop:3}}>{c.industry} · {c.employees} employees</div>
                      <div style={{display:"flex",gap:5,marginTop:6,flexWrap:"wrap"}}>
                        {(() => { const am = agentMeta(c.agent.status); return (
                          <span style={{fontSize:9,color:am.color,display:"flex",alignItems:"center",gap:3}}>
                            <span style={{width:5,height:5,borderRadius:"50%",background:am.dot,
                              boxShadow:am.glow?`0 0 4px ${am.dot}`:"none"}}/>
                            Agent {am.short.toLowerCase()}
                          </span>
                        ); })()}
                        {highA>0 && <span style={{fontSize:9,color:SOC.red}}>● {highA} high alert{highA>1?"s":""}</span>}
                        {pend>0 && <span style={{fontSize:9,color:SOC.amber}}>{pend} to review</span>}
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{color:SOC.green,fontWeight:700,fontSize:14}}>${c.mrr.toLocaleString()}</div>
                      <div style={{color:SOC.textMut,fontSize:9,marginTop:2}}>per month</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Attention feed */}
          <div>
            <div style={{display:"flex",alignItems:"center",marginBottom:10}}>
              <div style={{width:3,height:14,background:SOC.red,borderRadius:2,marginRight:9}}/>
              <span style={{color:SOC.text,fontSize:12,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Needs Your Attention</span>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {clients.flatMap(c => c.alerts.filter(a=>a.sev==="high").map(a=>({c,a})))
                .map(({c,a},i)=>(
                <div key={"al"+i} onClick={()=>{setActive(c);setView("client");}}
                  style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderLeft:`3px solid ${SOC.red}`,
                    borderRadius:8,padding:"10px 12px",cursor:"pointer"}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontSize:9,fontWeight:700,color:SOC.red,textTransform:"uppercase"}}>High Alert</span>
                    <span style={{fontSize:9,color:SOC.textMut}}>{a.time}</span>
                  </div>
                  <div style={{color:SOC.text,fontSize:12,fontWeight:600,marginTop:3}}>{a.title}</div>
                  <div style={{color:SOC.textMut,fontSize:10,marginTop:2}}>{c.name}</div>
                </div>
              ))}
              {clients.flatMap(c => c.reviewQueue.filter(r=>r.status==="awaiting_review").map(r=>({c,r})))
                .map(({c,r},i)=>(
                <div key={"rv"+i} onClick={()=>{setActive(c);setView("client");}}
                  style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderLeft:`3px solid ${SOC.amber}`,
                    borderRadius:8,padding:"10px 12px",cursor:"pointer"}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontSize:9,fontWeight:700,color:SOC.amber,textTransform:"uppercase"}}>Awaiting Review</span>
                    <span style={{fontSize:9,color:SOC.textMut}}>{r.generated}</span>
                  </div>
                  <div style={{color:SOC.text,fontSize:12,fontWeight:600,marginTop:3}}>{r.type}</div>
                  <div style={{color:SOC.textMut,fontSize:10,marginTop:2}}>{c.name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Portfolio Training Overview */}
        <div style={{marginTop:24}}>
          <div style={{display:"flex",alignItems:"center",marginBottom:12}}>
            <div style={{width:3,height:14,background:SOC.cyan,borderRadius:2,marginRight:9}}/>
            <span style={{color:SOC.text,fontSize:12,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>Training Across Portfolio</span>
            <span style={{marginLeft:10,fontSize:10,color:SOC.textMut}}>Awareness program status for every client</span>
          </div>
          <div style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderRadius:12,overflow:"hidden"}}>
            {clients.map((c,i)=>{
              const tr = c.training || {};
              const deployed = (tr.enrolled||0) > 0;
              const comp = tr.completion || 0;
              const compColor = comp>=90?SOC.green:comp>=60?SOC.cyan:comp>0?SOC.amber:SOC.textMut;
              const activeCampaign = (tr.campaigns||[]).find(x=>x.status==="active");
              return (
                <div key={c.id} onClick={()=>{setActive(c);setView("client");setTrainingClient(c);}}
                  style={{display:"flex",alignItems:"center",gap:14,padding:"12px 16px",cursor:"pointer",
                    borderTop:i>0?`1px solid ${SOC.border}`:"none"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{color:SOC.text,fontSize:13,fontWeight:600}}>{c.name}</div>
                    <div style={{color:SOC.textMut,fontSize:11,marginTop:2}}>
                      {deployed ? tr.active : "No program deployed"}
                    </div>
                  </div>
                  {activeCampaign && (
                    <span style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:10,
                      background:`${SOC.purple}22`,color:SOC.purple}}>CAMPAIGN ACTIVE</span>
                  )}
                  {deployed ? (
                    <>
                      <div style={{width:140}}>
                        <div style={{height:6,background:SOC.grid,borderRadius:3,overflow:"hidden"}}>
                          <div style={{width:`${comp}%`,height:"100%",background:compColor}}/>
                        </div>
                      </div>
                      <div style={{width:42,textAlign:"right",color:compColor,fontWeight:700,fontSize:13}}>{comp}%</div>
                    </>
                  ) : (
                    <span style={{fontSize:11,color:SOC.amber}}>Build program →</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{marginTop:16,padding:"12px 16px",background:`${SOC.cyan}0A`,
          border:`1px dashed ${SOC.cyan}33`,borderRadius:10,textAlign:"center"}}>
          <span style={{color:SOC.textSec,fontSize:11}}>
            Live portfolio data for your assigned clients. Click any client to open their full command center.
          </span>
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
//  MONITORING AGENT — endpoint fleet UI (client + analyst)
// ─────────────────────────────────────────────────────────────

// Posture → display metadata
const POSTURE_META = {
  healthy:         { label: "Healthy",         color: C.green, dot: C.green },
  needs_attention: { label: "Needs attention", color: C.amber, dot: C.amber },
  at_risk:         { label: "At risk",         color: C.red,   dot: C.red   },
};
const SEV_META = {
  critical: { label: "Critical", color: "#FF4D6A" },
  high:     { label: "High",     color: "#FF4D6A" },
  medium:   { label: "Medium",   color: "#FFB800" },
  low:      { label: "Low",      color: "#7ED957" },
  info:     { label: "Info",     color: C.textSec },
};
const CHECK_STATUS_META = {
  pass:    { label: "Pass",    color: C.green },
  warn:    { label: "Warn",    color: C.amber },
  fail:    { label: "Fail",    color: C.red },
  unknown: { label: "Unknown", color: C.textMut },
};

function timeAgo(iso) {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

function PostureDot({ posture }) {
  const m = POSTURE_META[posture] || POSTURE_META.needs_attention;
  return <span style={{display:"inline-block",width:9,height:9,borderRadius:"50%",
    background:m.dot,marginRight:7,verticalAlign:"middle"}}/>;
}

// Online if seen within ~3 collection intervals (assume 60m default → 3h grace)
function isOnline(lastSeen) {
  if (!lastSeen) return false;
  return (Date.now() - new Date(lastSeen)) < 3 * 60 * 60 * 1000;
}

// ── Add Endpoint modal: generates a one-time enrollment token ──
function AddEndpointModal({ onClose }) {
  const [token, setToken] = useState(null);
  const [expires, setExpires] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/endpoints/enroll-token`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create token.");
      setToken(data.enrollmentToken);
      setExpires(data.expiresInMinutes);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }

  const installCmd = token
    ? `powershell -ExecutionPolicy Bypass -File .\\install.ps1 \`\n  -ServerUrl "${API_BASE}" \`\n  -EnrollmentToken "${token}" \`\n  -IntervalMinutes 60`
    : "";

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:50,
      display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.border}`,
        borderRadius:14,maxWidth:640,width:"100%",padding:"24px 26px",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <h2 style={{color:C.text,fontSize:19,margin:0}}>Add an Endpoint</h2>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.textSec,
            fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
        </div>
        <p style={{color:C.textSec,fontSize:13,lineHeight:1.6,margin:"0 0 18px"}}>
          The ShieldAI agent is <strong>read-only</strong> — it collects security posture and
          uploads it for analysis. It never changes anything on the machine. Generate a one-time
          enrollment token, then run the installer on the target server or workstation.
        </p>

        {!token ? (
          <button onClick={generate} disabled={loading}
            style={{padding:"11px 20px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
              color:C.bg,border:"none",borderRadius:9,fontSize:14,fontWeight:700,
              cursor:loading?"wait":"pointer"}}>
            {loading ? "Generating…" : "Generate Enrollment Token"}
          </button>
        ) : (
          <div>
            <div style={{marginBottom:14,padding:"12px 14px",background:`${C.amber}12`,
              border:`1px solid ${C.amber}40`,borderRadius:9,color:C.amber,fontSize:12.5,lineHeight:1.5}}>
              This token is shown once and is valid for {expires} minutes. It can enroll a single endpoint.
            </div>

            <div style={{marginBottom:6,color:C.textSec,fontSize:12,fontWeight:600}}>Enrollment token</div>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              <code style={{flex:1,padding:"10px 12px",background:C.surface,border:`1px solid ${C.border}`,
                borderRadius:8,color:C.text,fontSize:12,wordBreak:"break-all"}}>{token}</code>
              <button onClick={()=>{navigator.clipboard.writeText(token);setCopied(true);setTimeout(()=>setCopied(false),1500);}}
                style={{padding:"8px 14px",background:C.surface,border:`1px solid ${C.border}`,
                  borderRadius:8,color:copied?C.green:C.textSec,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>

            <div style={{marginBottom:6,color:C.textSec,fontSize:12,fontWeight:600}}>
              Windows install (run as Administrator)
            </div>
            <pre style={{margin:0,padding:"12px 14px",background:C.surface,border:`1px solid ${C.border}`,
              borderRadius:8,color:C.text,fontSize:11.5,overflowX:"auto",whiteSpace:"pre-wrap",lineHeight:1.5}}>{installCmd}</pre>
            <p style={{color:C.textMut,fontSize:11.5,lineHeight:1.5,margin:"12px 0 0"}}>
              Linux & macOS installers use the same token. The endpoint enrolls and sends its first
              report within ~1 minute, then reports on a schedule.
            </p>
          </div>
        )}
        {error && <div style={{marginTop:14,color:C.red,fontSize:13}}>{error}</div>}
      </div>
    </div>
  );
}

// ── Endpoint detail drawer ────────────────────────────────────
function EndpointDetail({ endpointId, onBack, isAnalystView }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await authFetch(`${API_BASE}/api/admin/endpoints/${endpointId}`);
        if (!res.ok) throw new Error("Could not load endpoint.");
        setData(await res.json());
      } catch (e) { setError(e.message); } finally { setLoading(false); }
    })();
  }, [endpointId]);

  if (loading) return <div style={{padding:40,display:"flex",justifyContent:"center"}}><Spinner/></div>;
  if (error) return <div style={{padding:24,color:C.red}}>{error}</div>;

  const a = data.agent;
  const report = data.latestReport;
  const checks = report?.checks || [];
  const inv = report?.inventory || {};
  const events = data.events || [];
  const m = POSTURE_META[a.summary?.posture] || POSTURE_META.needs_attention;

  return (
    <div>
      <button onClick={onBack} style={{marginBottom:16,padding:"6px 14px",background:"none",
        border:`1px solid ${C.border}`,borderRadius:6,color:C.textSec,fontSize:12,cursor:"pointer"}}>
        ← Back to fleet
      </button>

      <Card style={{marginBottom:16}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:14,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <span style={{fontSize:18}}>{a.os==="windows"?"🪟":a.os==="macos"?"🍎":"🐧"}</span>
              <span style={{color:C.text,fontWeight:700,fontSize:18}}>{a.hostname}</span>
              <Badge label={isOnline(a.lastSeen)?"Online":"Offline"} color={isOnline(a.lastSeen)?C.green:C.textMut}/>
            </div>
            <div style={{color:C.textSec,fontSize:13}}>
              {report?.host?.osVersion || a.os} · last report {timeAgo(a.lastReportAt)}
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,color:m.color,fontWeight:700,fontSize:15}}>
              <PostureDot posture={a.summary?.posture}/>{m.label}
            </div>
            {a.summary && (
              <div style={{color:C.textSec,fontSize:12,marginTop:4}}>
                {a.summary.failCount} fail · {a.summary.warnCount} warn · {a.summary.checkCount} checks
              </div>
            )}
          </div>
        </div>
      </Card>

      {events.length > 0 && (
        <>
          <SectionLabel text={`Security Events (${events.length})`}/>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:18}}>
            {events.slice(0,12).map(e=>{
              const sm = SEV_META[e.severity] || SEV_META.info;
              return (
                <Card key={e.id} style={{padding:"12px 14px"}}>
                  <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                    <Badge label={sm.label} color={sm.color}/>
                    <div style={{flex:1}}>
                      <div style={{color:C.text,fontSize:13,fontWeight:600}}>{e.message}</div>
                      <div style={{color:C.textMut,fontSize:11,marginTop:3}}>
                        {e.source} · {e.type} · {timeAgo(e.ts)}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <SectionLabel text="Posture Checks"/>
      <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:18}}>
        {checks.map((c,i)=>{
          const cm = CHECK_STATUS_META[c.status] || CHECK_STATUS_META.unknown;
          return (
            <div key={i} style={{display:"flex",gap:12,padding:"11px 14px",background:C.surface,
              borderRadius:8,alignItems:"flex-start"}}>
              <Badge label={cm.label} color={cm.color}/>
              <div style={{flex:1}}>
                <div style={{color:C.text,fontSize:13,fontWeight:600}}>
                  {c.title} {c.cisControl && <span style={{color:C.textMut,fontWeight:400,fontSize:11}}>· CIS {c.cisControl}</span>}
                </div>
                <div style={{color:C.textSec,fontSize:12,marginTop:3}}>{c.detail}</div>
                {c.observed && <div style={{color:C.textMut,fontSize:11,marginTop:2}}>Observed: {c.observed}</div>}
              </div>
            </div>
          );
        })}
        {checks.length===0 && <div style={{color:C.textMut,fontSize:13}}>No report received yet.</div>}
      </div>

      {(inv.localAdmins?.length || inv.installedSecurityTools?.length || inv.diskEncryption) && (
        <>
          <SectionLabel text="Inventory"/>
          <Card style={{padding:"14px 16px"}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12,fontSize:12.5}}>
              {inv.diskEncryption && <div><span style={{color:C.textMut}}>Disk encryption:</span> <span style={{color:C.text}}>{inv.diskEncryption}</span></div>}
              {inv.firewall && <div><span style={{color:C.textMut}}>Firewall:</span> <span style={{color:C.text}}>{inv.firewall}</span></div>}
              {typeof inv.pendingPatches==="number" && <div><span style={{color:C.textMut}}>Pending patches:</span> <span style={{color:C.text}}>{inv.pendingPatches}</span></div>}
              {inv.installedSecurityTools?.length>0 && <div><span style={{color:C.textMut}}>Security tools:</span> <span style={{color:C.text}}>{inv.installedSecurityTools.join(", ")}</span></div>}
              {inv.localAdmins?.length>0 && <div><span style={{color:C.textMut}}>Local admins:</span> <span style={{color:C.text}}>{inv.localAdmins.length}</span></div>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Client fleet screen ───────────────────────────────────────
function EndpointsScreen({ onBack }) {
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState(null);
  const [recs, setRecs] = useState([]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [eRes, rRes] = await Promise.all([
        authFetch(`${API_BASE}/api/admin/endpoints`),
        authFetch(`${API_BASE}/api/admin/recommendations`),
      ]);
      if (!eRes.ok) throw new Error("Could not load endpoints.");
      setEndpoints(await eRes.json());
      if (rRes.ok) setRecs(await rRes.json());
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function decide(recId, decision) {
    try {
      const res = await authFetch(`${API_BASE}/api/admin/recommendations/${recId}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (res.ok) load();
    } catch { /* surfaced on reload */ }
  }
  async function markDone(recId) {
    try {
      const res = await authFetch(`${API_BASE}/api/recommendations/${recId}/complete`, { method: "POST" });
      if (res.ok) load();
    } catch { /* ignore */ }
  }

  if (selected) {
    return (
      <div style={{maxWidth:900,margin:"0 auto",padding:"24px 20px"}}>
        <EndpointDetail endpointId={selected} onBack={()=>{ setSelected(null); load(); }}/>
      </div>
    );
  }

  const openRecs = recs.filter(r => ["suggested","proposed"].includes(r.status));
  const activeRecs = recs.filter(r => ["permitted","client_performing"].includes(r.status));

  return (
    <div style={{maxWidth:900,margin:"0 auto",padding:"24px 20px"}}>
      {showAdd && <AddEndpointModal onClose={()=>{ setShowAdd(false); load(); }}/>}

      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:6,flexWrap:"wrap"}}>
        <h1 style={{color:C.text,fontSize:24,margin:0}}>Endpoints</h1>
        <button onClick={()=>setShowAdd(true)}
          style={{marginLeft:"auto",padding:"9px 18px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
            color:C.bg,border:"none",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer"}}>
          + Add Endpoint
        </button>
      </div>
      <p style={{color:C.textSec,fontSize:13.5,lineHeight:1.6,margin:"0 0 22px"}}>
        Continuous, read-only security monitoring across your servers and workstations.
        The agent reports posture and any security events from the tools already on each machine.
      </p>

      {error && <div style={{marginBottom:16,color:C.red,fontSize:13}}>{error}</div>}

      {/* Recommendations needing a decision */}
      {openRecs.length > 0 && (
        <>
          <SectionLabel text={`Recommendations Awaiting Your Decision (${openRecs.length})`}/>
          <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:22}}>
            {openRecs.map(r=>{
              const sm = SEV_META[r.severity] || SEV_META.medium;
              return (
                <Card key={r.id} style={{padding:"14px 16px"}}>
                  <div style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:10}}>
                    <Badge label={sm.label} color={sm.color}/>
                    <div style={{flex:1}}>
                      <div style={{color:C.text,fontSize:14,fontWeight:600}}>{r.title}</div>
                      {r.detail && <div style={{color:C.textSec,fontSize:12.5,marginTop:4,lineHeight:1.5}}>{r.detail}</div>}
                      {r.origin==="ai" && <div style={{color:C.textMut,fontSize:11,marginTop:4}}>Drafted by Mastermind AI · reviewed by your analyst</div>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button onClick={()=>decide(r.id,"self")}
                      style={{padding:"7px 14px",background:`${C.accent}18`,border:`1px solid ${C.accent}55`,
                        borderRadius:7,color:C.accent,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                      I'll handle it
                    </button>
                    <button onClick={()=>decide(r.id,"permit")}
                      style={{padding:"7px 14px",background:`${C.green}18`,border:`1px solid ${C.green}55`,
                        borderRadius:7,color:C.green,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                      Permit analyst to perform
                    </button>
                    <button onClick={()=>decide(r.id,"decline")}
                      style={{padding:"7px 14px",background:"none",border:`1px solid ${C.border}`,
                        borderRadius:7,color:C.textSec,fontSize:12,cursor:"pointer"}}>
                      Decline
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* In-progress recommendations */}
      {activeRecs.length > 0 && (
        <>
          <SectionLabel text="In Progress"/>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:22}}>
            {activeRecs.map(r=>(
              <Card key={r.id} style={{padding:"12px 16px"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <Badge label={r.status==="permitted"?"Analyst performing":"You're handling"}
                    color={r.status==="permitted"?C.green:C.accent}/>
                  <span style={{flex:1,color:C.text,fontSize:13.5,fontWeight:600}}>{r.title}</span>
                  {r.status==="client_performing" && (
                    <button onClick={()=>markDone(r.id)}
                      style={{padding:"6px 12px",background:`${C.green}18`,border:`1px solid ${C.green}55`,
                        borderRadius:6,color:C.green,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                      Mark done
                    </button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <SectionLabel text={`Monitored Endpoints (${endpoints.length})`}/>
      {loading ? <Spinner/> : endpoints.length === 0 ? (
        <Card style={{textAlign:"center",padding:"44px 24px"}}>
          <div style={{fontSize:32,marginBottom:10}}>🖥️</div>
          <div style={{color:C.text,fontWeight:600,fontSize:16,marginBottom:6}}>No endpoints yet</div>
          <p style={{color:C.textSec,fontSize:13,margin:"0 auto 18px",maxWidth:420,lineHeight:1.6}}>
            Add your first server or workstation to begin continuous security monitoring.
          </p>
          <button onClick={()=>setShowAdd(true)}
            style={{padding:"10px 20px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
              color:C.bg,border:"none",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            + Add Endpoint
          </button>
        </Card>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {endpoints.map(e=>{
            const m = POSTURE_META[e.summary?.posture] || POSTURE_META.needs_attention;
            return (
              <Card key={e.id} style={{padding:"15px 18px",cursor:"pointer"}} onClick={()=>setSelected(e.id)}>
                <div style={{display:"flex",alignItems:"center",gap:14}}>
                  <span style={{fontSize:20}}>{e.os==="windows"?"🪟":e.os==="macos"?"🍎":"🐧"}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{color:C.text,fontWeight:600,fontSize:14}}>{e.hostname}</span>
                      <Badge label={isOnline(e.lastSeen)?"Online":"Offline"} color={isOnline(e.lastSeen)?C.green:C.textMut}/>
                    </div>
                    <div style={{color:C.textMut,fontSize:12,marginTop:3}}>
                      last report {timeAgo(e.lastReportAt)}
                      {e.summary && ` · ${e.summary.failCount} fail · ${e.summary.warnCount} warn`}
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6,color:m.color,fontWeight:600,fontSize:13}}>
                    <PostureDot posture={e.summary?.posture}/>{m.label}
                  </div>
                  <span style={{color:C.accent,fontSize:12,fontWeight:600}}>View →</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
//  MASTERMIND CONSOLE (admin) — chat, oversight, on-demand analyze
// ─────────────────────────────────────────────────────────────
function MastermindConsole({ onClose }) {
  const [tab, setTab] = useState("chat");        // chat | oversight | analyze
  const [error, setError] = useState(null);

  // chat
  const [msgs, setMsgs] = useState([
    { role: "assistant", content: "I'm Mastermind. I can see your whole portfolio's posture and recommendations. Ask me what to prioritize, which clients are at risk, or how to handle a finding. I advise only — your team and clients take the actions." },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);

  // oversight
  const [recs, setRecs] = useState([]);
  const [recsLoaded, setRecsLoaded] = useState(false);

  // analyze
  const [accounts, setAccounts] = useState([]);
  const [analyzeTarget, setAnalyzeTarget] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [promoted, setPromoted] = useState({});

  // upgrades
  const [upgrades, setUpgrades] = useState(null);
  const [upgradesLoaded, setUpgradesLoaded] = useState(false);
  const [upgradeInfo, setUpgradeInfo] = useState(null); // { hostname, command, ... }
  const [upgradeBusy, setUpgradeBusy] = useState(false);

  useEffect(() => {
    if (tab === "upgrades" && !upgradesLoaded) {
      authFetch(`${API_BASE}/api/endpoints/upgrades`)
        .then(r=>r.ok?r.json():{outdated:[]}).then(d=>{setUpgrades(d);setUpgradesLoaded(true);}).catch(()=>{});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function getUpgradeInstructions(id) {
    setUpgradeBusy(true); setError(null); setUpgradeInfo(null);
    try {
      const res = await authFetch(`${API_BASE}/api/endpoints/${id}/upgrade-instructions`, { method:"POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not get instructions.");
      setUpgradeInfo(data);
    } catch (e) { setError(e.message); } finally { setUpgradeBusy(false); }
  }

  useEffect(() => {
    authFetch(`${API_BASE}/api/admin/accounts`).then(r=>r.ok&&r.json()).then(d=>d&&setAccounts(d)).catch(()=>{});
  }, []);
  useEffect(() => {
    if (tab === "oversight" && !recsLoaded) {
      authFetch(`${API_BASE}/api/admin/mastermind/recommendations`)
        .then(r=>r.ok?r.json():[]).then(d=>{setRecs(Array.isArray(d)?d:[]);setRecsLoaded(true);}).catch(()=>{});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function send() {
    const text = input.trim();
    if (!text || thinking) return;
    const next = [...msgs, { role:"user", content:text }];
    setMsgs(next); setInput(""); setThinking(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/admin/mastermind/chat`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ messages: next.filter(m=>m.role!=="system") }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Mastermind error.");
      setMsgs(m => [...m, { role:"assistant", content: data.reply }]);
    } catch (e) {
      setError(e.message);
      setMsgs(m => [...m, { role:"assistant", content: "(I couldn't respond — "+e.message+")" }]);
    } finally { setThinking(false); }
  }

  async function runAnalysis() {
    if (!analyzeTarget) return;
    setAnalyzing(true); setAnalysis(null); setError(null); setPromoted({});
    try {
      const res = await authFetch(`${API_BASE}/api/admin/mastermind/analyze`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ userId: analyzeTarget }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed.");
      setAnalysis(data);
    } catch (e) { setError(e.message); } finally { setAnalyzing(false); }
  }

  async function promote(rec, idx) {
    if (!analysis?.ownerUserId) return;
    try {
      const res = await authFetch(`${API_BASE}/api/admin/mastermind/promote`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ ownerUserId: analysis.ownerUserId, title: rec.title, detail: rec.detail, severity: rec.severity }),
      });
      if (res.ok) setPromoted(p => ({ ...p, [idx]: true }));
    } catch { /* ignore */ }
  }

  const sevColor = (s) => s==="critical"||s==="high"?C.red:s==="medium"?C.amber:s==="low"?C.green:C.textSec;

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"Inter,system-ui,sans-serif",color:C.text}}>
      <div style={{padding:"12px 20px",background:`linear-gradient(135deg,${C.purple}22,${C.accent}11)`,
        borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:18}}>🧠</span>
        <span style={{fontWeight:800,fontSize:16}}>Mastermind <span style={{color:C.purple}}>Console</span></span>
        <span style={{fontSize:11,color:C.textMut,padding:"2px 8px",border:`1px solid ${C.border}`,borderRadius:20}}>Advisory only</span>
        <button onClick={onClose} style={{marginLeft:"auto",padding:"6px 14px",background:C.surface,
          border:`1px solid ${C.border}`,borderRadius:6,color:C.textSec,fontSize:12,cursor:"pointer"}}>← Back</button>
      </div>

      <div style={{display:"flex",gap:8,padding:"12px 20px 0",borderBottom:`1px solid ${C.border}`}}>
        {[{id:"chat",label:"💬 Chat"},{id:"oversight",label:"📋 Oversight"},{id:"analyze",label:"🔎 Analyze"},{id:"upgrades",label:"⬆️ Agent Upgrades"}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{padding:"9px 16px",background:"none",border:"none",cursor:"pointer",
              borderBottom:`2px solid ${tab===t.id?C.purple:"transparent"}`,marginBottom:-1,
              color:tab===t.id?C.text:C.textSec,fontSize:13,fontWeight:tab===t.id?700:500,
              fontFamily:"Inter,system-ui,sans-serif"}}>{t.label}</button>
        ))}
      </div>

      <div style={{maxWidth:900,margin:"0 auto",padding:"20px"}}>
        {error && <div style={{marginBottom:14,color:C.red,fontSize:13}}>{error}</div>}

        {/* CHAT */}
        {tab==="chat" && (
          <div>
            <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
              {msgs.map((m,i)=>(
                <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
                  <div style={{maxWidth:"80%",padding:"11px 15px",borderRadius:12,fontSize:13.5,lineHeight:1.55,
                    background:m.role==="user"?`${C.accent}1F`:C.card,
                    border:`1px solid ${m.role==="user"?C.accent+"44":C.border}`,
                    color:C.text}}>
                    {m.role==="user" ? m.content : <ChatMarkdown text={m.content} color={C.text} mutedColor={C.textSec}/>}
                  </div>
                </div>
              ))}
              {thinking && <div style={{color:C.textMut,fontSize:13}}>Mastermind is thinking…</div>}
            </div>
            <div style={{display:"flex",gap:8,position:"sticky",bottom:16}}>
              <input value={input} onChange={e=>setInput(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter")send();}}
                placeholder="Ask Mastermind about your portfolio…"
                style={{flex:1,padding:"12px 14px",background:C.surface,border:`1px solid ${C.border}`,
                  borderRadius:10,color:C.text,fontSize:13.5,fontFamily:"Inter,system-ui,sans-serif"}}/>
              <button onClick={send} disabled={thinking||!input.trim()}
                style={{padding:"12px 22px",background:input.trim()?`linear-gradient(135deg,${C.purple},${C.accent})`:C.border,
                  color:input.trim()?"#fff":C.textMut,border:"none",borderRadius:10,fontSize:13,fontWeight:700,
                  cursor:input.trim()?"pointer":"default"}}>Send</button>
            </div>
          </div>
        )}

        {/* OVERSIGHT */}
        {tab==="oversight" && (
          <div>
            <SectionLabel text={`Recommendations Across All Clients (${recs.length})`}/>
            {!recsLoaded ? <Spinner/> : recs.length===0 ? (
              <Card style={{textAlign:"center",padding:"36px"}}>
                <div style={{color:C.textSec,fontSize:13}}>No recommendations yet.</div>
              </Card>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {recs.map(r=>(
                  <Card key={r.id} style={{padding:"13px 16px"}}>
                    <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                      <Badge label={r.severity} color={sevColor(r.severity)}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{color:C.text,fontSize:13.5,fontWeight:600}}>{r.title}</div>
                        {r.detail && <div style={{color:C.textSec,fontSize:12.5,marginTop:3,lineHeight:1.5}}>{r.detail}</div>}
                        <div style={{color:C.textMut,fontSize:11,marginTop:5}}>
                          {r.client} · {r.aiAuthored?"AI-drafted":r.origin} · {new Date(r.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <Badge label={r.status} color={r.status==="completed"?C.green:r.status==="declined"?C.textMut:r.status==="suggested"?C.purple:C.accent}/>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ANALYZE */}
        {tab==="analyze" && (
          <div>
            <SectionLabel text="On-Demand Analysis"/>
            <p style={{color:C.textSec,fontSize:13,lineHeight:1.6,margin:"0 0 14px"}}>
              Run Mastermind against a client's current endpoint posture to get a prioritized read and
              suggested recommendations you can promote into the analyst pipeline.
            </p>
            <div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}>
              <select value={analyzeTarget} onChange={e=>setAnalyzeTarget(e.target.value)}
                style={{flex:"1 1 240px",padding:"11px 13px",background:C.surface,border:`1px solid ${C.border}`,
                  borderRadius:9,color:C.text,fontSize:13,fontFamily:"Inter,system-ui,sans-serif"}}>
                <option value="">Select a client…</option>
                {accounts.filter(a=>!a.isAdmin).map(a=>(
                  <option key={a.id} value={a.id}>{a.companyName||a.email} ({a.counts?.endpoints||0} endpoints)</option>
                ))}
              </select>
              <button onClick={runAnalysis} disabled={!analyzeTarget||analyzing}
                style={{padding:"11px 22px",background:analyzeTarget?`linear-gradient(135deg,${C.purple},${C.accent})`:C.border,
                  color:analyzeTarget?"#fff":C.textMut,border:"none",borderRadius:9,fontSize:13,fontWeight:700,
                  cursor:analyzeTarget?"pointer":"default"}}>
                {analyzing?"Analyzing…":"Run Analysis"}
              </button>
            </div>

            {analysis && (
              <div>
                <Card style={{marginBottom:16}}>
                  <div style={{color:C.purple,fontSize:11,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>
                    Summary · {analysis.client}
                  </div>
                  <div style={{color:C.text,fontSize:13.5,lineHeight:1.6}}>{analysis.summary || "No summary."}</div>
                </Card>

                {analysis.findings?.length>0 && (
                  <>
                    <SectionLabel text="Findings"/>
                    <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
                      {analysis.findings.map((fd,i)=>(
                        <div key={i} style={{display:"flex",gap:10,padding:"10px 14px",background:C.surface,
                          borderRadius:8,alignItems:"flex-start"}}>
                          <Badge label={fd.severity} color={sevColor(fd.severity)}/>
                          <div style={{flex:1}}>
                            <div style={{color:C.text,fontSize:13,fontWeight:600}}>{fd.area}</div>
                            <div style={{color:C.textSec,fontSize:12.5,marginTop:2}}>{fd.observation}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {analysis.recommendations?.length>0 && (
                  <>
                    <SectionLabel text="Suggested Recommendations"/>
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {analysis.recommendations.map((rc,i)=>(
                        <Card key={i} style={{padding:"13px 16px"}}>
                          <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                            <Badge label={rc.severity} color={sevColor(rc.severity)}/>
                            <div style={{flex:1}}>
                              <div style={{color:C.text,fontSize:13.5,fontWeight:600}}>{rc.title}</div>
                              <div style={{color:C.textSec,fontSize:12.5,marginTop:3,lineHeight:1.5}}>{rc.detail}</div>
                            </div>
                            <button onClick={()=>promote(rc,i)} disabled={promoted[i]}
                              style={{padding:"6px 12px",borderRadius:6,fontSize:11.5,fontWeight:600,whiteSpace:"nowrap",
                                cursor:promoted[i]?"default":"pointer",
                                background:promoted[i]?`${C.green}18`:`${C.accent}18`,
                                border:`1px solid ${promoted[i]?C.green:C.accent}55`,
                                color:promoted[i]?C.green:C.accent}}>
                              {promoted[i]?"✓ Promoted":"Promote →"}
                            </button>
                          </div>
                        </Card>
                      ))}
                    </div>
                    <p style={{color:C.textMut,fontSize:11.5,marginTop:10,lineHeight:1.5}}>
                      "Promote" sends a suggestion into the analyst pipeline (status: suggested). An analyst
                      reviews and forwards it; the client decides who acts. Mastermind never acts directly.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* UPGRADES */}
        {tab==="upgrades" && (
          <div>
            <SectionLabel text="Agent Upgrades"/>
            <p style={{color:C.textSec,fontSize:13,lineHeight:1.6,margin:"0 0 14px"}}>
              Endpoints running an outdated agent. ShieldAI never pushes code — click an endpoint to
              get the exact re-install command a human runs (or sends to the client) to upgrade it.
            </p>
            {!upgradesLoaded ? <Spinner/> : (
              <>
                <div style={{color:C.textMut,fontSize:12,marginBottom:12}}>
                  Latest version: <span style={{color:C.text,fontWeight:600}}>{upgrades?.latestVersion}</span>
                  {" · "}{upgrades?.outdated?.length||0} outdated endpoint(s)
                </div>
                {(upgrades?.outdated||[]).length===0 ? (
                  <Card style={{textAlign:"center",padding:"36px"}}>
                    <div style={{color:C.green,fontSize:14,fontWeight:600}}>✓ All agents are up to date.</div>
                  </Card>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {upgrades.outdated.map(e=>(
                      <Card key={e.id} style={{padding:"13px 16px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:12}}>
                          <span style={{fontSize:18}}>{e.os==="windows"?"🪟":e.os==="macos"?"🍎":"🐧"}</span>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{color:C.text,fontSize:13.5,fontWeight:600}}>{e.hostname}</div>
                            <div style={{color:C.textMut,fontSize:11,marginTop:2}}>
                              {e.owner?.name} · v{e.agentVersion} → v{e.latestVersion}
                            </div>
                          </div>
                          <button onClick={()=>getUpgradeInstructions(e.id)} disabled={upgradeBusy}
                            style={{padding:"7px 14px",background:`${C.accent}18`,border:`1px solid ${C.accent}55`,
                              borderRadius:7,color:C.accent,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                            Get Upgrade Command
                          </button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}

                {upgradeInfo && (
                  <Card style={{marginTop:16,padding:"16px 18px",border:`1px solid ${C.accent}33`}}>
                    <div style={{color:C.accent,fontSize:12,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>
                      Upgrade {upgradeInfo.hostname} · v{upgradeInfo.fromVersion} → v{upgradeInfo.toVersion}
                    </div>
                    <ol style={{color:C.textSec,fontSize:12.5,lineHeight:1.7,margin:"0 0 12px",paddingLeft:18}}>
                      {upgradeInfo.steps.map((s,i)=><li key={i}>{s}</li>)}
                    </ol>
                    <pre style={{margin:0,padding:"12px 14px",background:C.surface,border:`1px solid ${C.border}`,
                      borderRadius:8,color:C.text,fontSize:11.5,overflowX:"auto",whiteSpace:"pre-wrap",lineHeight:1.5}}>{upgradeInfo.command}</pre>
                    <div style={{display:"flex",gap:8,marginTop:10,alignItems:"center"}}>
                      <button onClick={()=>{navigator.clipboard.writeText(upgradeInfo.command);}}
                        style={{padding:"6px 13px",background:C.surface,border:`1px solid ${C.border}`,
                          borderRadius:7,color:C.textSec,fontSize:12,cursor:"pointer"}}>Copy command</button>
                      <span style={{color:C.amber,fontSize:11.5}}>
                        Token valid {upgradeInfo.expiresInMinutes} min · re-installs &amp; re-enrolls this endpoint.
                      </span>
                    </div>
                  </Card>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
//  FORCE PASSWORD CHANGE (first login for admin-created accounts)
// ─────────────────────────────────────────────────────────────
function ForcePasswordChange({ user, onDone, onSignOut }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setError(null);
    if (newPassword.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (newPassword !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    try {
      const res = await authFetch(`${API_BASE}/api/auth/change-password`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not change password.");
      onDone(data.user);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",
      padding:20,fontFamily:"Inter,system-ui,sans-serif"}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,maxWidth:440,width:"100%",padding:"28px 30px"}}>
        <h2 style={{color:C.text,fontSize:20,margin:"0 0 6px"}}>Set a new password</h2>
        <p style={{color:C.textSec,fontSize:13.5,lineHeight:1.6,margin:"0 0 20px"}}>
          Your account was created with a temporary password. Choose a new one to continue.
        </p>

        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <input type="password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)}
            placeholder="Current (temporary) password"
            style={{padding:"11px 13px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,
              color:C.text,fontSize:13.5,fontFamily:"Inter,system-ui,sans-serif"}}/>
          <input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)}
            placeholder="New password (min 8 characters)"
            style={{padding:"11px 13px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,
              color:C.text,fontSize:13.5,fontFamily:"Inter,system-ui,sans-serif"}}/>
          <input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")submit();}}
            placeholder="Confirm new password"
            style={{padding:"11px 13px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,
              color:C.text,fontSize:13.5,fontFamily:"Inter,system-ui,sans-serif"}}/>
        </div>

        {error && <div style={{color:C.red,fontSize:13,marginTop:12}}>{error}</div>}

        <button onClick={submit} disabled={busy}
          style={{marginTop:18,width:"100%",padding:"12px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
            color:C.bg,border:"none",borderRadius:9,fontSize:14,fontWeight:700,cursor:busy?"wait":"pointer"}}>
          {busy ? "Saving…" : "Set Password & Continue"}
        </button>
        <button onClick={onSignOut}
          style={{marginTop:10,width:"100%",padding:"9px",background:"none",border:`1px solid ${C.border}`,
            borderRadius:9,color:C.textSec,fontSize:12.5,cursor:"pointer"}}>
          Sign out
        </button>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
//  UPGRADE PROMPT (shown when a tier gate blocks an action)
// ─────────────────────────────────────────────────────────────
function UpgradeModal({ info, onClose }) {
  const [addonBusy, setAddonBusy] = useState(false);
  const [addonMsg, setAddonMsg] = useState(null);
  if (!info) return null;
  const isLimit = info.code === "LIMIT_REACHED";
  const isTrainingAddon = info.addon === "training_delivery";

  async function buyTrainingAddon() {
    setAddonBusy(true); setAddonMsg(null);
    try {
      const res = await authFetch(`${API_BASE}/api/billing/checkout-addon`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addon: "training_delivery" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) { window.location.href = data.url; return; }
      // Billing not yet live (Stripe price unset) or add-on unavailable — explain gracefully.
      setAddonMsg(data.error || "Training add-on checkout isn't available yet. Contact your ShieldAI admin to enable it.");
    } catch {
      setAddonMsg("Couldn't start checkout. Contact your ShieldAI admin to add training delivery.");
    } finally { setAddonBusy(false); }
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:80,
      display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.accent}55`,
        borderRadius:14,maxWidth:440,width:"100%",padding:"26px 28px",textAlign:"center"}}>
        <div style={{fontSize:30,marginBottom:10}}>{isTrainingAddon ? "🎓" : isLimit ? "📦" : "🔒"}</div>
        <h2 style={{color:C.text,fontSize:19,margin:"0 0 8px"}}>
          {isTrainingAddon ? "Add employee training delivery" : isLimit ? "Plan limit reached" : "Upgrade to unlock"}
        </h2>
        <p style={{color:C.textSec,fontSize:13.5,lineHeight:1.6,margin:"0 0 18px"}}>
          {info.error || "This feature isn't included in your current plan."}
          {info.currentTier && <><br/><span style={{color:C.textMut,fontSize:12}}>Current plan: {info.currentTier}</span></>}
        </p>

        {isTrainingAddon && (
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,
            padding:"14px 16px",marginBottom:16,textAlign:"left"}}>
            <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:6}}>
              <span style={{color:C.text,fontWeight:700,fontSize:14}}>Training Delivery add-on</span>
              <span style={{color:C.green,fontWeight:800,fontSize:15}}>$40<span style={{fontSize:11,color:C.textMut}}>/mo</span></span>
            </div>
            <div style={{color:C.textMut,fontSize:12,lineHeight:1.5}}>
              Tokenized learner links, assignments, quarterly scheduling, completion tracking, and reports.
              Bundled free on Growth and higher.
            </div>
          </div>
        )}
        {addonMsg && <div style={{color:C.amber,fontSize:12,marginBottom:12,lineHeight:1.5}}>{addonMsg}</div>}

        <div style={{display:"flex",gap:8,justifyContent:"center"}}>
          <button onClick={onClose}
            style={{padding:"9px 18px",background:C.surface,border:`1px solid ${C.border}`,
              borderRadius:8,color:C.textSec,fontSize:13,cursor:"pointer"}}>Maybe later</button>
          {isTrainingAddon ? (
            <button onClick={buyTrainingAddon} disabled={addonBusy}
              style={{padding:"9px 20px",background:`linear-gradient(135deg,${C.green},${C.accent})`,
                color:C.bg,border:"none",borderRadius:8,fontSize:13,fontWeight:700,
                cursor:addonBusy?"default":"pointer",opacity:addonBusy?0.7:1}}>
              {addonBusy ? "Starting…" : "Add for $40/mo"}
            </button>
          ) : (
            <button onClick={onClose}
              style={{padding:"9px 20px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
                color:C.bg,border:"none",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer"}}>
              View plans
            </button>
          )}
        </div>
        <div style={{color:C.textMut,fontSize:11,marginTop:14,lineHeight:1.5}}>
          {isTrainingAddon
            ? "Or upgrade to Growth or higher, where training delivery is included."
            : "Contact your ShieldAI admin to change your subscription tier."}
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
//  CLIENT MASTERMIND (Enterprise) — scoped to the client's own data
// ─────────────────────────────────────────────────────────────
function ClientMastermind({ onClose }) {
  const [msgs, setMsgs] = useState([
    { role:"assistant", content:"Hi — I'm your ShieldAI Mastermind assistant. I can see your own endpoints, security posture, and recommendations, and help you understand and improve them. What would you like to know?" },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState(null);

  async function send() {
    const text = input.trim();
    if (!text || thinking) return;
    const next = [...msgs, { role:"user", content:text }];
    setMsgs(next); setInput(""); setThinking(true); setError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/client/mastermind/chat`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Mastermind error.");
      setMsgs(m => [...m, { role:"assistant", content: data.reply }]);
    } catch (e) {
      setError(e.message);
      setMsgs(m => [...m, { role:"assistant", content: "(I couldn't respond — "+e.message+")" }]);
    } finally { setThinking(false); }
  }

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"Inter,system-ui,sans-serif",color:C.text}}>
      <div style={{padding:"12px 20px",background:`linear-gradient(135deg,${C.purple}22,${C.accent}11)`,
        borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:18}}>🧠</span>
        <span style={{fontWeight:800,fontSize:16}}>Mastermind <span style={{color:C.purple}}>Assistant</span></span>
        <span style={{fontSize:11,color:C.textMut,padding:"2px 8px",border:`1px solid ${C.border}`,borderRadius:20}}>Your data only · advisory</span>
        <button onClick={onClose} style={{marginLeft:"auto",padding:"6px 14px",background:C.surface,
          border:`1px solid ${C.border}`,borderRadius:6,color:C.textSec,fontSize:12,cursor:"pointer"}}>← Back</button>
      </div>
      <div style={{maxWidth:820,margin:"0 auto",padding:"20px"}}>
        {error && <div style={{marginBottom:12,color:C.red,fontSize:13}}>{error}</div>}
        <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
          {msgs.map((m,i)=>(
            <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
              <div style={{maxWidth:"80%",padding:"11px 15px",borderRadius:12,fontSize:13.5,lineHeight:1.55,
                background:m.role==="user"?`${C.accent}1F`:C.card,
                border:`1px solid ${m.role==="user"?C.accent+"44":C.border}`,color:C.text}}>
                {m.role==="user" ? m.content : <ChatMarkdown text={m.content} color={C.text} mutedColor={C.textSec}/>}
              </div>
            </div>
          ))}
          {thinking && <div style={{color:C.textMut,fontSize:13}}>Mastermind is thinking…</div>}
        </div>
        <div style={{display:"flex",gap:8,position:"sticky",bottom:16}}>
          <input value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")send();}}
            placeholder="Ask about your security posture…"
            style={{flex:1,padding:"12px 14px",background:C.surface,border:`1px solid ${C.border}`,
              borderRadius:10,color:C.text,fontSize:13.5,fontFamily:"Inter,system-ui,sans-serif"}}/>
          <button onClick={send} disabled={thinking||!input.trim()}
            style={{padding:"12px 22px",background:input.trim()?`linear-gradient(135deg,${C.purple},${C.accent})`:C.border,
              color:input.trim()?"#fff":C.textMut,border:"none",borderRadius:10,fontSize:13,fontWeight:700,
              cursor:input.trim()?"pointer":"default"}}>Send</button>
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
//  ROOT
// ─────────────────────────────────────────────────────────────
export default function ShieldAI() {
  const [user, setUser] = useState(null);           // null = logged out
  const [phase, setPhase] = useState("home");        // home | landing | intake | checklist | analysis | dashboard
  const [assessment, setAssessment] = useState(null);
  const [results, setResults] = useState(null);
  const [consoleTarget, setConsoleTarget] = useState(null); // {assessmentId, programId}
  const [publicView, setPublicView] = useState("marketing"); // marketing | investor | auth (when logged out)
  const [pendingCodeEntry, setPendingCodeEntry] = useState(false); // open the code modal on marketing mount
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAnalyst, setShowAnalyst] = useState(false);
  const [showEndpoints, setShowEndpoints] = useState(false);
  const [showMastermind, setShowMastermind] = useState(false);
  const [showClientMastermind, setShowClientMastermind] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [regenAssessmentId, setRegenAssessmentId] = useState(null);

  // Frontend analyst detection for the mockup (matches the analyst email).
  // Later this becomes a real role flag from the backend.
  // Analyst-console access. For a demo session, this is governed strictly by the
  // access-code type: only an "investor" code unlocks the analyst console. A
  // "client" code never does — those visitors see a "Your vCISO" panel instead.
  const isAnalyst = user && (
    user.isDemo
      ? user.accessType === "investor"
      : (user.isAnalyst || user.email === ANALYST_EMAIL)
  );

  // Tier-gate upgrade prompt (fired by authFetch on any HTTP 402).
  const [upgradePrompt, setUpgradePrompt] = useState(null);
  useEffect(() => {
    setUpgradeHandler((data) => setUpgradePrompt(data || { error: "Upgrade required." }));
    return () => setUpgradeHandler(null);
  }, []);

  // Resolve the white-label brand for the logged-in user (their MSP's brand,
  // platform default, or ShieldAI). Re-runs on login/logout and role change.
  useEffect(() => { refreshBrandForUser(user); }, [user?.id]);

  // Capability helper for gating UI (mirrors backend; backend remains the real gate).
  const can = (cap) => {
    if (!user) return false;
    if (user.isAdmin || user.isAnalyst) return true;       // staff exempt
    return !!(user.capabilities && user.capabilities[cap]);
  };

  function handleAuthenticated(userObj) {
    setUser(userObj);
    setPhase("home");
    if (userObj && userObj.mustChangePassword) {
      // Force a password change before granting access to anything else.
      return;
    }
    // Real analysts land directly in their console. An investor-code demo
    // session is different: it should start in the CLIENT experience (that's
    // what a prospect sees) with the analyst console one click away, so the
    // investor sees both sides. So we skip the auto-jump for demo sessions.
    if (userObj && !userObj.isDemo && (userObj.isAnalyst || userObj.email === ANALYST_EMAIL)) {
      setShowAnalyst(true);
    }
  }

  // Enter the read-only sandbox. Reuses the normal authenticated flow — the
  // demo token simply binds every request to the demo store on the backend.
  async function handleStartDemo(persona) {
    const demoUser = await startDemoSession(persona);
    handleAuthenticated(demoUser);
  }

  // Redeem an access code → scoped demo session. accessType ("investor" |
  // "client") rides on the user object and gates which consoles are reachable.
  async function handleRedeemCode(code) {
    const demoUser = await redeemAccessCode(code);
    handleAuthenticated(demoUser);
  }

  function signOut() {
    setAuthToken(null);
    setUser(null);
    setPublicView("marketing");
    setAssessment(null);
    setResults(null);
    setShowAnalyst(false);
    setShowAdmin(false);
    setShowEndpoints(false);
    setShowMastermind(false);
    setShowClientMastermind(false);
    setPhase("home");
  }

  function reset() {
    setPhase("home");
    setAssessment(null);
    setResults(null);
  }

  // Open a saved program from the home screen
  async function openProgram(assessmentId, programId) {
    // Fetch the assessment data and the program sections in parallel
    const [aRes, pRes] = await Promise.all([
      authFetch(`${API_BASE}/api/assessments/${assessmentId}`),
      authFetch(`${API_BASE}/api/programs/${programId}`),
    ]);
    if (!aRes.ok) throw new Error("Could not load assessment");
    if (!pRes.ok) throw new Error("Could not load program");
    const aData = await aRes.json();
    const pData = await pRes.json();
    setAssessment(aData.data);
    setResults(pData.sections);
    setPhase("dashboard");
  }

  function openConsole(assessmentId, programId) {
    setConsoleTarget({ assessmentId, programId });
    setPhase("console");
  }

  // Called by EditAssessmentScreen when user chooses Save & Regenerate
  async function handleRegenerate(assessmentId, replaceOld) {
    setRegenAssessmentId({ assessmentId, replaceOld });
    setEditingId(null);
    setPhase("analysis");
  }

  // Standalone learner training page — token in the URL, no login. This is the
  // public face of the Training product; it renders on its own with no app
  // chrome and never requires an account.
  const trainMatch = typeof window !== "undefined" && window.location.pathname.match(/^\/train\/([^/?#]+)/);
  if (trainMatch) {
    return <LearnerPage token={decodeURIComponent(trainMatch[1])}/>;
  }

  // Not logged in → marketing front page, investor page, or auth
  if (!user) {
    if (publicView === "auth") {
      return <AuthScreen onAuthenticated={handleAuthenticated} onBack={() => setPublicView("marketing")}/>;
    }
    if (publicView === "investor") {
      return <InvestorPage
        onBack={() => setPublicView("marketing")}
        onOpenCode={() => { setPublicView("marketing"); setTimeout(() => setPendingCodeEntry(true), 0); }}/>;
    }
    return <MarketingPage
      onEnterApp={() => setPublicView("auth")}
      onLogin={() => setPublicView("auth")}
      onStartDemo={handleStartDemo}
      onRedeemCode={handleRedeemCode}
      onOpenInvestor={() => setPublicView("investor")}
      openCodeEntry={pendingCodeEntry}
      onCodeEntryOpened={() => setPendingCodeEntry(false)}/>;
  }

  // Forced first-login password change — blocks everything until done.
  if (user.mustChangePassword) {
    return <ForcePasswordChange user={user}
      onDone={(updated) => {
        setUser(updated);
        if (updated && (updated.isAnalyst || updated.email === ANALYST_EMAIL)) setShowAnalyst(true);
      }}
      onSignOut={signOut}/>;
  }

  // Admin panel (admins only)
  if (showAdmin && user.isAdmin) {
    return <AdminPanel onClose={() => setShowAdmin(false)}/>;
  }

  // Mastermind console (admin only)
  if (showMastermind && user.isAdmin) {
    return <MastermindConsole onClose={() => setShowMastermind(false)}/>;
  }

  // Sandbox marker rides above every authenticated view, including the analyst
  // console and Mastermind — there is no screen where a visitor can forget
  // they're in the demo.
  async function exitDemo() {
    await endDemoSession();
    signOut();
  }
  const demoBanner = user.isDemo ? <DemoBanner onExit={exitDemo}/> : null;

  // Client-facing Mastermind (Enterprise clients only; staff use admin console)
  if (showClientMastermind && !user.isAdmin && !user.isAnalyst) {
    return <>{demoBanner}<ClientMastermind onClose={() => setShowClientMastermind(false)}/></>;
  }

  // Analyst console (analyst accounts only)
  if (showAnalyst && isAnalyst) {
    return <>{demoBanner}<AnalystConsole user={user} onExit={() => setShowAnalyst(false)}/></>;
  }

  // Top bar showing the logged-in company + sign out
  const TopBar = () => (
    <>
    {demoBanner}
    <UpgradeModal info={upgradePrompt} onClose={() => setUpgradePrompt(null)}/>
    <div style={{padding:"10px 20px",background:C.surface,borderBottom:`1px solid ${C.border}`,
      display:"flex",alignItems:"center",gap:10}}>
      <span onClick={() => setPhase("home")} style={{cursor:"pointer",display:"inline-flex"}}>
        <ShieldLockup logoSize={22} textSize={15} ink={C.text}/>
      </span>
      <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:14}}>
        <span style={{fontSize:12,color:C.textSec}}>
          {user.companyName || user.email}
        </span>
        <button onClick={() => setShowEndpoints(true)}
          style={{padding:"5px 12px",background:`${C.accent}18`,
            border:`1px solid ${C.accent}55`,borderRadius:6,
            color:C.accent,fontSize:11,cursor:"pointer",fontWeight:600}}>
          🖥️ Endpoints
        </button>
        {!user.isAdmin && !user.isAnalyst && (
          <button onClick={() => can("mastermindChat")
              ? setShowClientMastermind(true)
              : setUpgradePrompt({ error:"Mastermind is available on the Starter plan and above. Upgrade to Starter ($159/mo) to chat with your virtual-CISO assistant.", code:"UPGRADE_REQUIRED", capability:"mastermindChat", currentTier:user.tier, requiresTier:"starter" })}
            title={can("mastermindChat") ? "" : "Starter plan feature"}
            style={{padding:"5px 12px",
              background: can("mastermindChat") ? `${C.purple}22` : C.surface,
              border:`1px solid ${can("mastermindChat") ? C.purple+"55" : C.border}`,borderRadius:6,
              color: can("mastermindChat") ? C.purple : C.textMut,fontSize:11,cursor:"pointer",fontWeight:600}}>
            {can("mastermindChat") ? "🧠 Mastermind" : "🔒 Mastermind"}
          </button>
        )}
        {user.isAdmin && (
          <button onClick={() => setShowMastermind(true)}
            style={{padding:"5px 12px",background:`${C.purple}22`,
              border:`1px solid ${C.purple}55`,borderRadius:6,
              color:C.purple,fontSize:11,cursor:"pointer",fontWeight:600}}>
            🧠 Mastermind
          </button>
        )}
        {user.isAdmin && (
          <button onClick={() => setShowAdmin(true)}
            style={{padding:"5px 12px",background:`${C.purple}22`,
              border:`1px solid ${C.purple}55`,borderRadius:6,
              color:C.purple,fontSize:11,cursor:"pointer",fontWeight:600}}>
            ⚙ Admin
          </button>
        )}
        {isAnalyst && (
          <button onClick={() => setShowAnalyst(true)}
            style={{padding:"5px 12px",background:`#00C8FF22`,
              border:`1px solid #00C8FF55`,borderRadius:6,
              color:"#00C8FF",fontSize:11,cursor:"pointer",fontWeight:600}}>
            🛰️ Analyst Console
          </button>
        )}
        <button onClick={signOut}
          style={{padding:"5px 12px",background:"none",border:`1px solid ${C.border}`,
            borderRadius:6,color:C.textSec,fontSize:11,cursor:"pointer"}}>
          Sign Out
        </button>
      </div>
    </div>
    </>
  );

  if (showEndpoints) {
    return (
      <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",background:C.bg}}>
        <TopBar/>
        <div style={{flex:1}}>
          <div style={{maxWidth:900,margin:"0 auto",padding:"16px 20px 0"}}>
            <button onClick={() => setShowEndpoints(false)}
              style={{padding:"6px 14px",background:"none",border:`1px solid ${C.border}`,
                borderRadius:6,color:C.textSec,fontSize:12,cursor:"pointer"}}>
              ← Back
            </button>
          </div>
          <EndpointsScreen onBack={() => setShowEndpoints(false)}/>
        </div>
      </div>
    );
  }

  if (phase === "home") {
    return (
      <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",background:C.bg}}>
        <TopBar/>
        <HomeScreen
          user={user}
          onNewAssessment={() => setPhase("intake")}
          onOpenProgram={openProgram}
          onEditAssessment={(id) => { setEditingId(id); setPhase("edit"); }}
          onOpenConsole={openConsole}
        />
      </div>
    );
  }

  if (phase === "console" && consoleTarget) {
    return (
      <CapabilityContext.Provider value={{ can, tier: user.tier, capabilities: user.capabilities || {} }}>
      <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",background:C.bg}}>
        <TopBar/>
        <CompanyConsole
          assessmentId={consoleTarget.assessmentId}
          programId={consoleTarget.programId}
          user={user}
          onClose={() => { setConsoleTarget(null); setPhase("home"); }}
          onOpenProgram={openProgram}
        />
      </div>
      </CapabilityContext.Provider>
    );
  }

  if (phase === "landing") {
    return (
      <div>
        <TopBar/>
        <Landing onStart={() => setPhase("intake")}/>
      </div>
    );
  }

  if (phase === "intake") {
    return (
      <div style={{height:"100vh",display:"flex",flexDirection:"column",
        background:C.bg,fontFamily:"Inter,system-ui,sans-serif"}}>
        <TopBar/>
        <div style={{padding:"12px 20px",background:C.surface,borderBottom:`1px solid ${C.border}`,
          display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontWeight:600,color:C.text}}>Security Assessment</span>
          <span style={{fontSize:11,color:C.textSec,marginLeft:8}}>Step 1 of 3 — Intake Interview</span>
          <button onClick={reset} style={{marginLeft:"auto",padding:"5px 12px",background:"none",
            border:`1px solid ${C.border}`,borderRadius:6,color:C.textSec,fontSize:11,cursor:"pointer"}}>
            ← Back
          </button>
        </div>
        <div style={{flex:1,overflow:"hidden"}}>
          <IntakeChat onComplete={data => { setAssessment(data); setPhase("framework"); }}/>
        </div>
      </div>
    );
  }

  if (phase === "framework") {
    return (
      <div style={{height:"100vh",display:"flex",flexDirection:"column"}}>
        <TopBar/>
        <div style={{padding:"12px 20px",background:C.surface,borderBottom:`1px solid ${C.border}`,
          display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontWeight:600,color:C.text}}>Security Assessment</span>
          <span style={{fontSize:11,color:C.textSec,marginLeft:8}}>Step 2 of 4 — Framework Foundation</span>
        </div>
        <FrameworkFoundationScreen
          initial={assessment?.frameworkLens || "nist"}
          onComplete={(frameworkLens) => {
            // The lens rides on the assessment; riskEngine reads it when scoring,
            // so every downstream consumer gets the chosen framing for free.
            setAssessment(prev => ({ ...prev, frameworkLens }));
            setPhase("checklist");
          }}
          onBack={() => setPhase("intake")}
        />
      </div>
    );
  }

  if (phase === "checklist") {
    return (
      <div style={{height:"100vh",display:"flex",flexDirection:"column"}}>
        <TopBar/>
        <div style={{padding:"12px 20px",background:C.surface,borderBottom:`1px solid ${C.border}`,
          display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontWeight:600,color:C.text}}>Security Assessment</span>
          <span style={{fontSize:11,color:C.textSec,marginLeft:8}}>Step 3 of 4 — Security Checklist</span>
        </div>
        <ChecklistScreen
          frameworkLens={assessment?.frameworkLens || "nist"}
          onComplete={(checklist, selectedFrameworks) => {
            setAssessment(prev => ({ ...prev, checklist, selectedFrameworks }));
            setPhase("analysis");
          }}
          onBack={() => setPhase("framework")}
        />
      </div>
    );
  }

  if (phase === "edit") {
    return (
      <EditAssessmentScreen
        assessmentId={editingId}
        onCancel={() => { setEditingId(null); setPhase("home"); }}
        onSaved={() => { setEditingId(null); setPhase("home"); }}
        onRegenerate={handleRegenerate}
      />
    );
  }

  if (phase === "analysis") {
    return (
      <AnalysisScreen
        assessment={assessment}
        regenerate={regenAssessmentId}
        onComplete={async (r) => {
          // If we regenerated an existing assessment, also load its company data
          if (regenAssessmentId) {
            try {
              const aRes = await authFetch(`${API_BASE}/api/assessments/${regenAssessmentId.assessmentId}`);
              if (aRes.ok) { const aData = await aRes.json(); setAssessment(aData.data); }
            } catch { /* ignore */ }
            setRegenAssessmentId(null);
          }
          setResults(r);
          setPhase("dashboard");
        }}/>
    );
  }

  if (phase === "dashboard") {
    return (
      <CapabilityContext.Provider value={{ can, tier: user.tier, capabilities: user.capabilities || {} }}>
      <div style={{height:"100vh",display:"flex",flexDirection:"column"}}>
        <TopBar/>
        <div style={{flex:1,overflow:"hidden"}}>
          <Dashboard assessment={assessment} results={results} onReset={reset}/>
        </div>
      </div>
      </CapabilityContext.Provider>
    );
  }

  return null;
}