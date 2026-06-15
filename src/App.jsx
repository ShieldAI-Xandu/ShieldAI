import { useState, useRef, useEffect, useCallback } from "react";

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
//  AI ROUTER  – routes tasks to the right model
//  In production: Claude = Anthropic API,
//                 Gemini / GPT = their respective APIs
//  Here we proxy everything through Claude with role prompting
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

  // Prepend model persona to system prompt
  const enrichedSystem = `You are operating as the ${modelInfo.label} engine within ShieldAI, a virtual CISO platform.
Your specialty: ${modelInfo.specialty}

${systemPrompt}`;

  const res = await authFetch("http://localhost:3001/api/claude", {
    method: "POST",
    headers: { 
       "Content-Type": "application/json",
    },
    body: JSON.stringify({
       model: "claude-sonnet-4-6",
       max_tokens: 16384,
       system: enrichedSystem,
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
          if (onChunk) onChunk(full, model);
        }
      } catch {}
    }
  }
  return { text: full, model };
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

  riskAnalysis: `You are a senior CISO performing risk analysis. Return ONLY valid JSON, no markdown fences, no prose:
{
  "riskScore": 0-100,
  "riskLevel": "Low|Medium|High|Critical",
  "executiveSummary": "3-4 sentences",
  "topThreats": [{"threat":"","likelihood":"High|Medium|Low","impact":"High|Medium|Low","description":""}],
  "priorities": [{"id":"","rank":1,"title":"","description":"","effort":"Quick Win|30 Days|90 Days|Long Term","impact":"High|Medium|Low","category":"Identity|Network|Data|Endpoint|Compliance|Awareness|AppSec|Physical","owner":"IT|Leadership|All Staff","estimatedCost":"$0|<$500|$500-2k|$2k-10k|$10k+"}],
  "quickWins": [{"action":"","benefit":"","howTo":""}]
}`,

  policyDraft: `You are a CISO drafting security policies. Return ONLY valid JSON:
{"policies":[{"id":"","name":"","purpose":"","scope":"","policyText":"4-6 sentences of actual policy language","procedures":["step 1","step 2","step 3"],"reviewCycle":"Annual|Semi-Annual|Quarterly","owner":""}]}`,

  complianceMap: `You are a compliance expert. Return ONLY valid JSON:
{"frameworks":[{"name":"","applicability":"Required|Recommended|Optional","gaps":[{"control":"","status":"Missing|Partial|Compliant","remediation":"","priority":"High|Medium|Low"}],"overallScore":0-100,"certificationPath":""}]}`,

  workflows: `You are a CISO building incident response and security workflows. Return ONLY valid JSON:
{"workflows":[{"id":"","name":"","category":"Incident Response|Access Management|Change Management|Vendor Risk|Awareness|Monitoring","trigger":"","severity":"Critical|High|Medium|Low","steps":[{"step":1,"action":"","responsible":"","timeframe":"","tools":""}],"escalationPath":[],"successCriteria":"","reviewFrequency":""}]}`,

  threatIntel: `You are a threat intelligence analyst (Gemini). Return ONLY valid JSON:
{"threatLandscape":{"industryThreats":[{"name":"","description":"","prevalence":"High|Medium|Low","mitigations":[]}],"recentCVEs":[{"id":"","description":"","severity":"Critical|High|Medium","affected":"","patch":""}],"attackVectors":[],"darkWebMentions":"No intel|Low risk|Elevated|High alert"},"recommendations":[]}`,

  toolRecommendations: `You are a security architect recommending tools. Return ONLY valid JSON:
{"toolStack":[{"category":"","subcategory":"","recommended":"","alternative":"","rationale":"","cost":"Free|<$50/mo|$50-200/mo|$200+/mo","implementation":"Easy|Moderate|Complex","integrations":[],"link":""}]}`,

  awarenessTraining: `You are a security awareness trainer (GPT-4o style). Return ONLY valid JSON:
{"trainingProgram":{"modules":[{"id":"","title":"","audience":"All Staff|IT|Leadership|Finance","duration":"15 min|30 min|1 hour","topics":[],"keyTakeaways":[],"quiz":[{"question":"","options":["a","b","c","d"],"correct":0}]}],"phishingSimulation":{"frequency":"","scenarios":[]},"metricsToTrack":[]}}`,

  execSummary: `You are writing an executive summary for a CISO report (GPT-4o style). Return ONLY valid JSON:
{"executiveReport":{"headline":"","securityPosture":"","keyFindings":[],"businessRisk":"","investmentRequired":"","roi":"","topRecommendations":[],"nextSteps":[{"action":"","owner":"","dueDate":"","priority":""}]}}`,
};

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
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🛡️</div>
            )}
            <div style={{maxWidth:"75%"}}>
              <div style={{padding:"12px 16px",borderRadius:m.role==="user"?"16px 16px 4px 16px":"4px 16px 16px 16px",
                background:m.role==="user"?`${C.accent}18`:C.card,
                border:`1px solid ${m.role==="user"?C.accent+"33":C.border}`,
                color:C.text,fontSize:14,lineHeight:1.7,whiteSpace:"pre-wrap"}}>
                {m.content}
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
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🛡️</div>
            <div style={{maxWidth:"75%",padding:"12px 16px",borderRadius:"4px 16px 16px 16px",
              background:C.card,border:`1px solid ${C.border}`,color:C.text,fontSize:14,lineHeight:1.7}}>
              {streaming || <Spinner/>}
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
const API_BASE = "http://localhost:3001";

// ─────────────────────────────────────────────────────────────
//  AUTH HELPERS
// ─────────────────────────────────────────────────────────────
let AUTH_TOKEN = null;

function setAuthToken(token) {
  AUTH_TOKEN = token;
  // For persistence across refreshes in your local Vite app, uncomment:
  // if (token) localStorage.setItem("shieldai_token", token);
  // else localStorage.removeItem("shieldai_token");
}

function getAuthToken() {
  // For persistence across refreshes, uncomment:
  // if (!AUTH_TOKEN) AUTH_TOKEN = localStorage.getItem("shieldai_token");
  return AUTH_TOKEN;
}

// Drop-in replacement for fetch() that attaches the auth token.
async function authFetch(url, options = {}) {
  const token = getAuthToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
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
function AuthScreen({ onAuthenticated }) {
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
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:40,marginBottom:8}}>🛡️</div>
          <div style={{fontWeight:800,fontSize:24,color:C.text}}>ShieldAI</div>
          <div style={{fontSize:11,color:C.textMut,letterSpacing:2,marginTop:4}}>
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

      {/* NIST CSF breakdown */}
      {breakdown?.functions && (
        <Card style={{marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
            <SectionLabel text="NIST CSF Posture Breakdown"/>
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

function ComplianceSection({ results }) {
  const frames = results?.compliance?.frameworks || [];
  return (
    <div>
      <SectionLabel text="Compliance Framework Analysis"/>
      {frames.map((f,i)=>(
        <Card key={i} style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div>
              <div style={{color:C.text,fontWeight:700,fontSize:16}}>{f.name}</div>
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
      ))}
    </div>
  );
}

function ThreatIntelSection({ results }) {
  const tl = results?.threatIntel?.threatLandscape;
  if (!tl) return <div style={{color:C.textSec,padding:20}}>Threat intelligence not loaded.</div>;

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <SectionLabel text="Threat Intelligence"/>
        <div style={{marginLeft:"auto"}}><AIChip model="gemini"/></div>
      </div>
      {tl.darkWebMentions && tl.darkWebMentions !== "No intel" && (
        <div style={{padding:"12px 16px",background:`${C.red}15`,border:`1px solid ${C.red}33`,
          borderRadius:8,marginBottom:14,color:C.red,fontSize:13}}>
          ⚠️ Dark web monitoring: {tl.darkWebMentions}
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
        <Card>
          <SectionLabel text="Industry Threats"/>
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
        <Card>
          <SectionLabel text="Recent CVEs & Vulnerabilities"/>
          {(tl.recentCVEs||[]).map((c,i)=>(
            <div key={i} style={{marginBottom:10,padding:"8px 12px",
              background:C.surface,borderRadius:6}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <span style={{color:C.accent,fontSize:12,fontWeight:700}}>{c.id}</span>
                <Badge label={c.severity}/>
              </div>
              <div style={{color:C.textSec,fontSize:12,marginBottom:3}}>{c.description}</div>
              <div style={{color:C.textMut,fontSize:11}}>Affected: {c.affected}</div>
              {c.patch && <div style={{color:C.green,fontSize:11}}>Patch: {c.patch}</div>}
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

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <SectionLabel text="Recommended Security Tool Stack"/>
        <div style={{marginLeft:"auto"}}><AIChip model="gemini"/></div>
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

function TrainingSection({ results }) {
  const [activeModule, setActiveModule] = useState(0);
  const prog = results?.training?.trainingProgram;
  if (!prog) return <div style={{color:C.textSec,padding:20}}>Training program not loaded.</div>;
  const mod = prog.modules?.[activeModule];

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <SectionLabel text="Security Awareness Training Program"/>
        <div style={{marginLeft:"auto"}}><AIChip model="gpt4"/></div>
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
          {prog.phishingSimulation && (
            <div style={{marginTop:10,padding:"10px 14px",background:`${C.amber}11`,
              border:`1px solid ${C.amber}33`,borderRadius:8}}>
              <div style={{color:C.amber,fontSize:12,fontWeight:600,marginBottom:4}}>
                🎣 Phishing Simulation
              </div>
              <div style={{color:C.textSec,fontSize:11}}>
                Frequency: {prog.phishingSimulation.frequency}
              </div>
            </div>
          )}
        </div>
        {mod && (
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{color:C.text,fontWeight:700,fontSize:16}}>{mod.title}</div>
              <div style={{display:"flex",gap:6}}>
                <Badge label={mod.duration} color={C.accent}/>
                <Badge label={mod.audience} color={C.purple}/>
              </div>
            </div>
            <SectionLabel text="Topics Covered"/>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
              {(mod.topics||[]).map((t,i)=>(
                <span key={i} style={{padding:"4px 12px",background:C.surface,
                  border:`1px solid ${C.border}`,borderRadius:20,
                  color:C.textSec,fontSize:12}}>{t}</span>
              ))}
            </div>
            <SectionLabel text="Key Takeaways"/>
            {(mod.keyTakeaways||[]).map((t,i)=>(
              <div key={i} style={{display:"flex",gap:10,marginBottom:8}}>
                <span style={{color:C.green,fontSize:14}}>✓</span>
                <span style={{color:C.textSec,fontSize:13}}>{t}</span>
              </div>
            ))}
            {mod.quiz?.length > 0 && (
              <div style={{marginTop:14}}>
                <SectionLabel text="Sample Quiz Question"/>
                <div style={{padding:"14px",background:C.surface,borderRadius:8}}>
                  <div style={{color:C.text,fontSize:13,fontWeight:600,marginBottom:10}}>
                    {mod.quiz[0].question}
                  </div>
                  {mod.quiz[0].options.map((opt,j)=>(
                    <div key={j} style={{padding:"7px 12px",marginBottom:5,borderRadius:6,
                      background:j===mod.quiz[0].correct?`${C.green}22`:C.card,
                      border:`1px solid ${j===mod.quiz[0].correct?C.green:C.border}`,
                      color:j===mod.quiz[0].correct?C.green:C.textSec,fontSize:12}}>
                      {String.fromCharCode(65+j)}. {opt}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function ExecReportSection({ assessment, results }) {
  const rep = results?.execReport?.executiveReport;
  const risk = results?.riskOverview;
  if (!rep) return <div style={{color:C.textSec,padding:20}}>Report not generated.</div>;

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <SectionLabel text="Executive CISO Report"/>
        <div style={{marginLeft:"auto"}}><AIChip model="gpt4"/></div>
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
//  POLICY LIBRARY
// ─────────────────────────────────────────────────────────────

function PolicyLibrarySection({ assessment }) {
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
          html += '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">';
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
    const full = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${generated.policyName}</title>
<style>
  body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1a1a1a;line-height:1.5;}
  h1{font-size:20pt;color:#0b3d91;margin:0 0 6pt;}
  h2{font-size:14pt;color:#0b3d91;border-bottom:1px solid #ccc;padding-bottom:3pt;margin:16pt 0 6pt;}
  h3{font-size:12pt;margin:10pt 0 4pt;}
  table{margin:8pt 0;} th{background:#f0f3f8;}
  hr{border:none;border-top:1px solid #ccc;}
</style></head><body>${body}</body></html>`;
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
                <button onClick={downloadAsWord}
                  style={{padding:"6px 14px",background:`${C.accent}15`,border:`1px solid ${C.accent}33`,
                    borderRadius:6,color:C.accent,fontSize:12,cursor:"pointer"}}>
                  ⬇ Download Word
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

  const nav = [
    { id:"overview",    icon:"🎯", label:"Overview",          badge:null },
    { id:"priorities",  icon:"📊", label:"Priorities",        badge:results?.priorities?.priorities?.length },
    { id:"policies",    icon:"📄", label:"Policies",          badge:policyCount || null },
    { id:"workflows",   icon:"🔄", label:"Workflows",         badge:results?.workflows?.workflows?.length },
    { id:"compliance",  icon:"✅", label:"Compliance",        badge:results?.compliance?.frameworks?.length },
    { id:"threats",     icon:"🔍", label:"Threat Intel",      badge:null },
    { id:"tools",       icon:"🔧", label:"Tool Stack",        badge:results?.tools?.toolStack?.length },
    { id:"training",    icon:"🎓", label:"Training",          badge:results?.training?.trainingProgram?.modules?.length },
    { id:"report",      icon:"📋", label:"Exec Report",       badge:null },
    { id:"library",     icon:"📚", label:"Policy Library",    badge:null },
  ];

  const sectionMap = {
    overview:   <OverviewSection assessment={assessment} results={results}/>,
    priorities: <PrioritiesSection results={results}/>,
    policies:   <PoliciesSection results={results}/>,
    workflows:  <WorkflowsSection results={results}/>,
    compliance: <ComplianceSection results={results}/>,
    threats:    <ThreatIntelSection results={results}/>,
    tools:      <ToolsSection results={results}/>,
    training:   <TrainingSection results={results}/>,
    report:     <ExecReportSection assessment={assessment} results={results}/>,
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
            <span style={{fontSize:20}}>🛡️</span>
            <span style={{fontWeight:700,fontSize:15,color:C.text}}>ShieldAI</span>
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
      <div style={{flex:1,overflowY:"auto",padding:"24px"}}>
        {sectionMap[section]}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  LANDING PAGE
// ─────────────────────────────────────────────────────────────
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
        <span style={{fontSize:22}}>🛡️</span>
        <span style={{fontWeight:700,fontSize:16}}>ShieldAI</span>
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
const SECURITY_CHECKLIST = [
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

function ChecklistScreen({ onComplete, onBack }) {
  const [answers, setAnswers] = useState({});
  const total = SECURITY_CHECKLIST.length;
  const answered = Object.keys(answers).length;
  const allAnswered = answered === total;

  function selectAnswer(qId, option) {
    setAnswers(prev => ({ ...prev, [qId]: option }));
  }

  const grouped = SECURITY_CHECKLIST.reduce((acc, q) => {
    (acc[q.nistFunction] = acc[q.nistFunction] || []).push(q);
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

        <div style={{position:"sticky",top:0,zIndex:5,background:C.bg,
          padding:"10px 0 14px",marginBottom:6}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{color:C.textSec,fontSize:12}}>{answered} of {total} answered</span>
            <span style={{color:C.accent,fontSize:12,fontWeight:700}}>
              {Math.round((answered/total)*100)}%
            </span>
          </div>
          <ProgressBar value={(answered/total)*100} color={C.accent}/>
        </div>

        {Object.entries(grouped).map(([fn, questions]) => (
          <div key={fn} style={{marginBottom:24}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:NIST_COLORS[fn]}}/>
              <span style={{color:NIST_COLORS[fn],fontSize:12,fontWeight:700,
                letterSpacing:1.5,textTransform:"uppercase"}}>{fn}</span>
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
        ))}

        <div style={{position:"sticky",bottom:0,background:C.bg,padding:"16px 0",
          borderTop:`1px solid ${C.border}`,marginTop:8}}>
          <button onClick={() => onComplete(answers)} disabled={!allAnswered}
            style={{width:"100%",padding:"14px",borderRadius:10,border:"none",
              background: allAnswered ? `linear-gradient(135deg,${C.accent},${C.accentDm})` : C.border,
              color: allAnswered ? C.bg : C.textMut,
              fontSize:15,fontWeight:700,
              cursor: allAnswered ? "pointer" : "not-allowed"}}>
            {allAnswered ? "Generate Security Program →" : `Answer all questions (${total-answered} remaining)`}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminPanel({ onClose }) {
  const [view, setView] = useState("list");   // list | user | program
  const [users, setUsers] = useState([]);
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
                    </div>
                    <div style={{color:C.textSec,fontSize:13}}>{u.email}</div>
                    <div style={{color:C.textMut,fontSize:11,marginTop:4}}>
                      Joined {new Date(u.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  {!u.isAdmin && (
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
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

        <SectionLabel text="All Accounts — Click to Inspect"/>
        {loading ? <Spinner/> : (
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
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  HOME SCREEN — returning user's dashboard of saved assessments
// ─────────────────────────────────────────────────────────────
function HomeScreen({ user, onNewAssessment, onOpenProgram, onEditAssessment }) {
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
            <div style={{fontSize:40,marginBottom:14}}>🛡️</div>
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
                        <button onClick={() => openLatestProgram(a.id)} disabled={opening===a.id}
                          style={{padding:"10px 20px",background:`linear-gradient(135deg,${C.accent},${C.accentDm})`,
                            color:C.bg,border:"none",borderRadius:8,fontSize:13,fontWeight:700,
                            cursor:opening===a.id?"wait":"pointer",whiteSpace:"nowrap"}}>
                          {opening===a.id ? "Opening…" : "Open Program →"}
                        </button>
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [company, setCompany] = useState({ name: "", industry: "", employees: "" });
  const [answers, setAnswers] = useState({});
  const [hasProgram, setHasProgram] = useState(false);
  const [showRegenChoice, setShowRegenChoice] = useState(false);

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

  const grouped = SECURITY_CHECKLIST.reduce((acc, q) => {
    (acc[q.nistFunction] = acc[q.nistFunction] || []).push(q);
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
const SAMPLE_CLIENTS = [
  {
    id: "c1", name: "Meridian Dental Group", industry: "Healthcare", employees: "45",
    posture: 53, level: "Developing", plan: "Managed vCISO", mrr: 1800,
    status: "needs_review", lastActivity: "2h ago", compliance: ["HIPAA"],
    weakest: ["Identify", "Respond"], openItems: 3,
    history: [31, 34, 38, 38, 41, 44, 44, 47, 49, 49, 51, 53],
    agent: { status: "healthy", endpoints: 38, lastSeen: "3 min ago", coverage: 84 },
    compliancePct: { current: 62, target: 90, framework: "HIPAA" },
    alerts: [
      { sev: "high", title: "Phishing email reported by 2 staff", time: "18 min ago", detail: "Spoofed invoice from 'billing@meridian-dental.co' — quarantined." },
      { sev: "medium", title: "Outdated OS on 3 endpoints", time: "2h ago", detail: "Workstations running unsupported Windows build." },
      { sev: "low", title: "New device joined network", time: "5h ago", detail: "Unmanaged tablet on guest VLAN." },
    ],
    reviewQueue: [
      { type: "Incident Response Policy", status: "awaiting_review", generated: "2h ago" },
      { type: "Q2 Risk Reassessment", status: "awaiting_review", generated: "2h ago" },
    ],
    chat: [
      { from: "client", who: "Dr. Patel", text: "We had a staff member click something suspicious — should we be worried?", time: "20 min ago" },
      { from: "analyst", who: "You", text: "Saw the alert come through — it was quarantined before any payload ran. I'm resetting that account's credentials as a precaution and will send a short refresher to the team.", time: "12 min ago" },
      { from: "client", who: "Dr. Patel", text: "Thank you, that's a relief.", time: "8 min ago" },
    ],
    training: { active: "Phishing Awareness Q2", completion: 71, enrolled: 45, nextDue: "Jun 30" },
  },
  {
    id: "c2", name: "Lakeside Financial Advisors", industry: "Finance", employees: "28",
    posture: 91, level: "Strong", plan: "Managed vCISO", mrr: 2400,
    status: "on_track", lastActivity: "1d ago", compliance: ["SEC", "SOC 2"],
    weakest: ["Respond"], openItems: 1,
    history: [68, 70, 72, 74, 77, 79, 81, 83, 85, 87, 89, 91],
    agent: { status: "healthy", endpoints: 26, lastSeen: "1 min ago", coverage: 96 },
    compliancePct: { current: 88, target: 95, framework: "SOC 2" },
    alerts: [
      { sev: "low", title: "Impossible-travel login flagged & cleared", time: "6h ago", detail: "VP logged in from two cities; confirmed VPN, no action needed." },
    ],
    reviewQueue: [
      { type: "Backup & Recovery Policy", status: "approved", generated: "1d ago" },
    ],
    chat: [
      { from: "analyst", who: "You", text: "Your SOC 2 evidence package is 88% complete — we're on track for the audit window.", time: "1d ago" },
      { from: "client", who: "Sandra Kim", text: "Excellent. The board will be pleased.", time: "1d ago" },
    ],
    training: { active: "Annual Security Refresher", completion: 96, enrolled: 28, nextDue: "Complete" },
  },
  {
    id: "c3", name: "Apex Manufacturing", industry: "Manufacturing", employees: "120",
    posture: 24, level: "At Risk", plan: "Assessment + Roadmap", mrr: 950,
    status: "attention", lastActivity: "4h ago", compliance: ["CMMC"],
    weakest: ["Protect", "Identify"], openItems: 7,
    history: [18, 18, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24],
    agent: { status: "offline", endpoints: 0, lastSeen: "never", coverage: 0 },
    compliancePct: { current: 19, target: 80, framework: "CMMC L2" },
    alerts: [
      { sev: "high", title: "No MFA on email — active brute-force attempts", time: "1h ago", detail: "47 failed logins on shared mailbox in past hour." },
      { sev: "high", title: "Unpatched VPN appliance (critical CVE)", time: "3h ago", detail: "Internet-facing device vulnerable to known exploit." },
      { sev: "medium", title: "Local admin rights on all workstations", time: "4h ago", detail: "Standard users can install software / disable controls." },
    ],
    reviewQueue: [
      { type: "Initial Security Program", status: "awaiting_review", generated: "4h ago" },
      { type: "Access Control Policy", status: "awaiting_review", generated: "4h ago" },
      { type: "Data Classification Policy", status: "draft", generated: "5h ago" },
    ],
    chat: [
      { from: "analyst", who: "You", text: "We've finished your initial assessment — there are a few urgent items I'd like to walk you through. Do you have 15 minutes tomorrow?", time: "3h ago" },
      { from: "client", who: "Mike Torres", text: "Yeah, mornings are best. How bad is it?", time: "2h ago" },
      { from: "analyst", who: "You", text: "Fixable, but we should move quickly on MFA and the VPN patch. I'll prep a prioritized list.", time: "2h ago" },
    ],
    training: { active: "Not yet deployed", completion: 0, enrolled: 0, nextDue: "—" },
  },
  {
    id: "c4", name: "BrightPath Marketing", industry: "Professional Services", employees: "16",
    posture: 84, level: "Strong", plan: "Self-Serve + Quarterly Review", mrr: 450,
    status: "on_track", lastActivity: "3d ago", compliance: ["GDPR"],
    weakest: ["Detect"], openItems: 0,
    history: [70, 72, 73, 75, 76, 78, 79, 80, 81, 82, 83, 84],
    agent: { status: "degraded", endpoints: 14, lastSeen: "8 min ago", coverage: 64 },
    compliancePct: { current: 80, target: 90, framework: "GDPR" },
    alerts: [],
    reviewQueue: [],
    chat: [
      { from: "client", who: "Jordan Lee", text: "Quick one — is it safe to use that new AI tool with client data?", time: "3d ago" },
      { from: "analyst", who: "You", text: "Let me review their data-handling terms and get back to you with a recommendation.", time: "3d ago" },
    ],
    training: { active: "Data Privacy Essentials", completion: 88, enrolled: 16, nextDue: "Jul 15" },
  },
  {
    id: "c5", name: "Coastal Property Mgmt", industry: "Real Estate", employees: "33",
    posture: 61, level: "Moderate", plan: "Managed vCISO", mrr: 1600,
    status: "needs_review", lastActivity: "6h ago", compliance: ["State Privacy"],
    weakest: ["Respond"], openItems: 2,
    history: [44, 46, 47, 49, 51, 52, 54, 55, 57, 58, 60, 61],
    agent: { status: "healthy", endpoints: 29, lastSeen: "12 min ago", coverage: 79 },
    compliancePct: { current: 64, target: 85, framework: "State Privacy" },
    alerts: [
      { sev: "medium", title: "Shared password detected in cloud drive", time: "6h ago", detail: "Plaintext credentials file found in shared folder." },
    ],
    reviewQueue: [
      { type: "Vendor Risk Policy", status: "awaiting_review", generated: "6h ago" },
    ],
    chat: [
      { from: "client", who: "Rosa Mendes", text: "Got the vendor policy draft — looks good. One question on the cloud storage section.", time: "5h ago" },
    ],
    training: { active: "Phishing Awareness Q2", completion: 58, enrolled: 33, nextDue: "Jun 30" },
  },
];

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

// ── ShieldAI Mastermind — scripted diagnostic-AI responses ──
// Context-aware canned exchanges for the demo. Each quick-action returns
// an expert-sounding, structured response. Some are tailored per client.
const MASTERMIND_QUICK = [
  { id: "triage",     icon: "🚨", label: "Triage active alerts", category: "Threat Response" },
  { id: "compliance", icon: "✅", label: "Compliance gap analysis", category: "Compliance" },
  { id: "troubleshoot", icon: "🔧", label: "Diagnose agent / coverage issue", category: "Troubleshooting" },
  { id: "nextsteps",  icon: "🎯", label: "What should I prioritize?", category: "Advisory" },
];

function mastermindReply(quickId, client) {
  const name = client?.name || "this client";
  const fw = client?.compliancePct?.framework || "the applicable framework";
  switch (quickId) {
    case "triage": {
      const high = (client?.alerts || []).filter(a => a.sev === "high");
      if (high.length === 0) {
        return `No high-severity alerts are active for ${name} right now. The feed shows only low/medium items, which I'd handle on the normal weekly cycle. I'd keep an eye on endpoint coverage — anything under ~85% leaves blind spots where alerts simply won't fire.`;
      }
      return `I see ${high.length} high-severity alert${high.length>1?"s":""} for ${name}. Recommended response order:\n\n1. **${high[0].title}** — this is your priority. Isolate the affected account/host immediately, then preserve logs before remediating. Likely root cause: ${high[0].detail}\n\n2. Confirm whether any sensitive data was reachable from the affected scope. If ${fw} applies, start your breach-assessment clock now — don't wait for confirmation.\n\n3. Once contained, I can draft the incident timeline and a client-facing summary for your review. Want me to prepare that?`;
    }
    case "compliance": {
      const cur = client?.compliancePct?.current ?? 0;
      const tgt = client?.compliancePct?.target ?? 90;
      return `Here's where ${name} stands on ${fw}: currently **${cur}%** against a ${tgt}% target.\n\nThe gaps holding the score down, in priority order:\n\n• **Access control & least privilege** — highest-weighted control family; partial implementation is capping the score.\n• **Audit logging & monitoring** — needs centralized collection with documented review cadence.\n• **Incident response** — plan exists but requires a documented test/tabletop to count as "implemented."\n\nFastest path to the ${tgt}% target: close access-control first (biggest score movement), then formalize logging. I estimate ~6–8 weeks at current pace. I can generate the remediation plan with owner assignments if you'd like.`;
    }
    case "troubleshoot": {
      const a = client?.agent;
      if (a?.status === "offline") {
        return `${name}'s agent is showing **No Comms** — here's my diagnostic path:\n\n1. **Connectivity** — confirm the endpoint can reach the ShieldAI cloud on 443 outbound. A new firewall rule or proxy is the most common cause of a sudden offline state.\n2. **Service health** — check whether the agent service is running locally; if it crashed, the watchdog should restart it, so a persistent stop suggests a permissions or AV-conflict issue.\n3. **Deployment** — if endpoints show 0, the agent likely was never fully rolled out here. I'd push the deployment package to a pilot group of 5 first, confirm telemetry, then expand.\n\nUntil comms are restored you have **no detection coverage** on this client, so I'd treat it as urgent. Want a step-by-step rollout checklist?`;
      }
      if (a?.status === "degraded") {
        return `${name}'s agent is **Degraded** at ${a.coverage}% coverage — partial telemetry. Most likely causes:\n\n1. **Uncovered endpoints** — new devices joined without the agent installed. ${a.coverage}% coverage means roughly ${Math.round((1-a.coverage/100)*a.endpoints/(a.coverage/100))||"a few"} machines are dark.\n2. **Intermittent check-ins** — sleeping/roaming laptops reporting irregularly; usually benign but worth confirming.\n\nI'd run a discovery scan to find unmanaged devices, then push the agent to them. Getting above ~90% coverage will clear the degraded state. Want the discovery + deployment steps?`;
      }
      return `${name}'s agent is healthy at ${a?.coverage}% coverage — no action needed. If you're troubleshooting a specific error, paste the message or code and I'll diagnose it. Common ones I can walk you through: failed log forwarding, MFA enrollment errors, or backup-job failures.`;
    }
    case "nextsteps": {
      const weak = (client?.weakest || []).join(" and ") || "the weakest NIST areas";
      return `For ${name}, here's how I'd prioritize this week:\n\n1. **Address ${weak}** — these are the lowest-scoring NIST functions and where you'll get the most posture improvement per hour invested.\n2. **Clear the review queue** — there ${ (client?.reviewQueue||[]).filter(r=>r.status==="awaiting_review").length>0 ? "are items awaiting your sign-off; approving them keeps the client moving" : "is nothing pending, so you're current"}.\n3. **${fw} progress** — keep chipping at the compliance gaps; you're trending the right direction.\n\nIf you want, I can turn this into a dated action plan with owners and drop it in the client's program. Just say the word.`;
    }
    default:
      return "I'm ShieldAI Mastermind — your diagnostic co-pilot. Ask me about active threats, compliance gaps, agent issues, training design, or what to prioritize for this client.";
  }
}


function AnalystConsole({ user, onExit }) {
  const [view, setView] = useState("portfolio");
  const [active, setActive] = useState(null);
  const [chatDraft, setChatDraft] = useState("");
  const [localChats, setLocalChats] = useState({});
  const [mmOpen, setMmOpen] = useState(false);
  const [mmThread, setMmThread] = useState([
    { from: "mm", text: "I'm ShieldAI Mastermind — your diagnostic co-pilot. Pick a quick action below or ask me anything about this client: threat triage, compliance gaps, agent issues, or what to prioritize." },
  ]);
  const [mmDraft, setMmDraft] = useState("");
  const [mmThinking, setMmThinking] = useState(false);

  function mmSend(quickId, freeText) {
    const userMsg = freeText
      ? { from: "analyst", text: freeText }
      : { from: "analyst", text: MASTERMIND_QUICK.find(q => q.id === quickId)?.label || "…" };
    setMmThread(t => [...t, userMsg]);
    setMmDraft("");
    setMmThinking(true);
    // Simulate the assistant thinking, then reply (scripted)
    setTimeout(() => {
      const reply = quickId
        ? mastermindReply(quickId, active)
        : "Here's my read: based on this client's current posture and open items, I'd focus on the highest-severity alert first, then close the largest compliance gap. Use a quick action below for a detailed breakdown, or ask me about a specific error or control. (In the live product, I analyze this client's real telemetry and program data to answer.)";
      setMmThread(t => [...t, { from: "mm", text: reply }]);
      setMmThinking(false);
    }, 650);
  }

  const clients = SAMPLE_CLIENTS;
  const totalMRR = clients.reduce((s, c) => s + c.mrr, 0);
  const avgPosture = Math.round(clients.reduce((s, c) => s + c.posture, 0) / clients.length);
  const reviewCount = clients.reduce((s, c) => s + c.reviewQueue.filter(r => r.status === "awaiting_review").length, 0);
  const highAlerts = clients.reduce((s, c) => s + c.alerts.filter(a => a.sev === "high").length, 0);
  const agentsOnline = clients.filter(c => c.agent.status === "healthy").length;

  const statusMeta = {
    on_track: { label: "On Track", color: SOC.green },
    needs_review: { label: "Needs Review", color: SOC.amber },
    attention: { label: "Attention", color: SOC.red },
  };

  const Header = ({ title, backTo }) => (
    <div style={{padding:"13px 22px",background:SOC.panel,borderBottom:`1px solid ${SOC.border}`,
      display:"flex",alignItems:"center",gap:12}}>
      <span style={{fontSize:18}}>🛰️</span>
      <span style={{fontWeight:700,fontSize:15,color:SOC.text}}>{title}</span>
      <span style={{fontSize:10,color:SOC.cyan,letterSpacing:2,padding:"2px 10px",
        background:`${SOC.cyan}18`,borderRadius:20,border:`1px solid ${SOC.cyan}33`}}>ANALYST CONSOLE</span>
      <span style={{fontSize:9,color:SOC.textMut,padding:"2px 8px",background:SOC.bg,
        border:`1px solid ${SOC.border}`,borderRadius:4}}>VISION MOCKUP</span>
      <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
        <span style={{fontSize:11,color:SOC.textSec}}>{user.email}</span>
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
                <div style={{padding:"10px 12px",borderRadius:10,fontSize:12,lineHeight:1.6,whiteSpace:"pre-wrap",
                  background:m.from==="analyst"?SOC.cyan:SOC.bg,
                  color:m.from==="analyst"?SOC.bg:SOC.text,
                  border:m.from==="analyst"?"none":`1px solid ${SOC.border}`}}>
                  {m.text}
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
  if (view === "client" && active) {
    const c = active;
    const clr = pColor(c.posture);
    const chatLog = [...(c.chat || []), ...((localChats[c.id]) || [])];
    const trend = c.history[c.history.length-1] - c.history[0];

    function sendChat() {
      if (!chatDraft.trim()) return;
      setLocalChats(prev => ({ ...prev, [c.id]: [...(prev[c.id]||[]), { from:"analyst", who:"You", text:chatDraft, time:"just now" }] }));
      setChatDraft("");
    }

    return (
      <div style={{minHeight:"100vh",background:SOC.bg,fontFamily:"Inter,system-ui,sans-serif",color:SOC.text}}>
        <Header title={c.name} backTo={{ label:"Portfolio", fn:()=>{setView("portfolio");setActive(null);} }}/>
        <Mastermind/>
        <div style={{maxWidth:1180,margin:"0 auto",padding:"20px"}}>

          {/* Top band: posture + agent + compliance + plan */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:16}}>
            <div style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderRadius:12,padding:"16px",textAlign:"center"}}>
              <div style={{fontSize:36,fontWeight:800,color:clr,lineHeight:1}}>{c.posture}</div>
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
                  <div style={{fontSize:9,color:SOC.textMut}}>endpoints · {c.agent.coverage}% coverage</div>
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
              <div style={{fontSize:9,color:SOC.textMut,letterSpacing:1}}>{c.compliancePct.framework} READINESS</div>
              <div style={{fontSize:28,fontWeight:800,color:SOC.cyan,marginTop:4}}>{c.compliancePct.current}%</div>
              <div style={{height:5,background:SOC.grid,borderRadius:3,marginTop:8,overflow:"hidden"}}>
                <div style={{width:`${c.compliancePct.current}%`,height:"100%",background:SOC.cyan}}/>
              </div>
              <div style={{fontSize:9,color:SOC.textMut,marginTop:4}}>target {c.compliancePct.target}%</div>
            </div>
            <div style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderRadius:12,padding:"16px",textAlign:"center"}}>
              <div style={{fontSize:9,color:SOC.textMut,letterSpacing:1}}>MONTHLY VALUE</div>
              <div style={{fontSize:24,fontWeight:800,color:SOC.green,marginTop:6}}>${c.mrr.toLocaleString()}</div>
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
              {c.alerts.length === 0 ? (
                <div style={{color:SOC.textSec,fontSize:12,padding:"20px 0",textAlign:"center"}}>
                  No active threats. All clear. ✓
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:150,overflowY:"auto"}}>
                  {c.alerts.map((a,i)=>(
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

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
            {/* Direct client chat */}
            <SocPanel title="Direct Client Channel" accent={SOC.green}>
              <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:200,overflowY:"auto",marginBottom:10}}>
                {chatLog.map((m,i)=>(
                  <div key={i} style={{alignSelf:m.from==="analyst"?"flex-end":"flex-start",maxWidth:"80%"}}>
                    <div style={{padding:"8px 11px",borderRadius:10,fontSize:12,lineHeight:1.5,
                      background:m.from==="analyst"?SOC.cyan:SOC.panelHi,
                      color:m.from==="analyst"?SOC.bg:SOC.text,
                      border:m.from==="analyst"?"none":`1px solid ${SOC.border}`}}>
                      {m.text}
                    </div>
                    <div style={{fontSize:9,color:SOC.textMut,marginTop:2,textAlign:m.from==="analyst"?"right":"left"}}>
                      {m.who} · {m.time}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:8}}>
                <input value={chatDraft} onChange={e=>setChatDraft(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&sendChat()}
                  placeholder="Message the client…"
                  style={{flex:1,padding:"9px 12px",background:SOC.bg,border:`1px solid ${SOC.border}`,
                    borderRadius:8,color:SOC.text,fontSize:12,fontFamily:"Inter,system-ui,sans-serif"}}/>
                <button onClick={sendChat} style={{padding:"9px 16px",background:SOC.green,color:SOC.bg,
                  border:"none",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>Send</button>
              </div>
            </SocPanel>

            {/* Review & approval queue */}
            <SocPanel title="Review & Approval Queue" accent={SOC.amber}>
              {c.reviewQueue.length === 0 ? (
                <div style={{color:SOC.textSec,fontSize:12,padding:"20px 0",textAlign:"center"}}>
                  Nothing pending — client is up to date. ✓
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {c.reviewQueue.map((item,i)=>{
                    const meta = { awaiting_review:{label:"Review",color:SOC.amber}, approved:{label:"Approved",color:SOC.green}, draft:{label:"Draft",color:SOC.textMut} }[item.status];
                    return (
                      <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 11px",background:SOC.bg,borderRadius:8}}>
                        <span style={{fontSize:15}}>📄</span>
                        <div style={{flex:1}}>
                          <div style={{color:SOC.text,fontSize:12,fontWeight:600}}>{item.type}</div>
                          <div style={{color:SOC.textMut,fontSize:9}}>AI-generated · {item.generated}</div>
                        </div>
                        {item.status==="awaiting_review" ? (
                          <button style={{padding:"5px 12px",background:`${SOC.green}1A`,border:`1px solid ${SOC.green}44`,
                            borderRadius:6,color:SOC.green,fontSize:11,fontWeight:600,cursor:"pointer"}}>Approve</button>
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

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
            {/* Weekly program status */}
            <SocPanel title="Weekly Program Health" accent={SOC.blue}>
              <div style={{display:"flex",flexDirection:"column",gap:9}}>
                {[
                  { label:"Endpoint protection", val: c.agent.coverage, },
                  { label:"Patch compliance", val: c.posture>50?78:34 },
                  { label:"MFA adoption", val: c.posture>50?85:20 },
                  { label:"Backup health", val: c.posture>50?92:40 },
                ].map((r,i)=>(
                  <div key={i}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
                      <span style={{color:SOC.textSec}}>{r.label}</span>
                      <span style={{color:pColor(r.val),fontWeight:700}}>{r.val}%</span>
                    </div>
                    <div style={{height:4,background:SOC.grid,borderRadius:2,overflow:"hidden"}}>
                      <div style={{width:`${r.val}%`,height:"100%",background:pColor(r.val)}}/>
                    </div>
                  </div>
                ))}
              </div>
              <button style={{marginTop:12,width:"100%",padding:"8px",background:SOC.panelHi,
                border:`1px solid ${SOC.border}`,borderRadius:7,color:SOC.textSec,fontSize:11,cursor:"pointer"}}>
                Generate Weekly Report →
              </button>
            </SocPanel>

            {/* Compliance progress */}
            <SocPanel title="Compliance Progress" accent={SOC.purple}>
              <div style={{textAlign:"center",padding:"6px 0"}}>
                <div style={{fontSize:11,color:SOC.textSec}}>{c.compliancePct.framework}</div>
                <div style={{fontSize:32,fontWeight:800,color:SOC.purple,margin:"4px 0"}}>{c.compliancePct.current}%</div>
                <div style={{height:6,background:SOC.grid,borderRadius:3,overflow:"hidden",margin:"8px 0"}}>
                  <div style={{width:`${c.compliancePct.current}%`,height:"100%",background:`linear-gradient(90deg,${SOC.purple},${SOC.cyan})`}}/>
                </div>
                <div style={{fontSize:10,color:SOC.textMut}}>
                  {c.compliancePct.target - c.compliancePct.current}% to target ({c.compliancePct.target}%)
                </div>
              </div>
              <div style={{marginTop:8,fontSize:10,color:SOC.textSec,lineHeight:1.6}}>
                {c.compliancePct.current >= c.compliancePct.target - 10
                  ? "On track for certification window."
                  : "Remediation roadmap in progress."}
              </div>
            </SocPanel>

            {/* Training program */}
            <SocPanel title="Training Program" accent={SOC.cyan}>
              <div style={{fontSize:12,color:SOC.text,fontWeight:600,marginBottom:4}}>{c.training.active}</div>
              {c.training.enrolled > 0 ? (
                <>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:SOC.textMut,marginBottom:6}}>
                    <span>{c.training.enrolled} enrolled</span><span>Due {c.training.nextDue}</span>
                  </div>
                  <div style={{position:"relative",height:8,background:SOC.grid,borderRadius:4,overflow:"hidden"}}>
                    <div style={{width:`${c.training.completion}%`,height:"100%",
                      background:`linear-gradient(90deg,${SOC.cyan},${SOC.green})`}}/>
                  </div>
                  <div style={{fontSize:18,fontWeight:800,color:SOC.cyan,marginTop:8,textAlign:"center"}}>
                    {c.training.completion}%<span style={{fontSize:10,color:SOC.textMut,fontWeight:400}}> complete</span>
                  </div>
                </>
              ) : (
                <div style={{color:SOC.textSec,fontSize:11,padding:"10px 0",lineHeight:1.6}}>
                  No active program. Deploy a tailored awareness campaign for this client.
                </div>
              )}
              <button style={{marginTop:10,width:"100%",padding:"8px",
                background:`${SOC.cyan}18`,border:`1px solid ${SOC.cyan}44`,borderRadius:7,
                color:SOC.cyan,fontSize:11,fontWeight:600,cursor:"pointer"}}>
                {c.training.enrolled>0?"Manage Program":"Build Training Program"} →
              </button>
            </SocPanel>
          </div>

          <div style={{marginTop:16,padding:"12px 16px",background:`${SOC.cyan}0A`,
            border:`1px dashed ${SOC.cyan}33`,borderRadius:10,textAlign:"center"}}>
            <span style={{color:SOC.textSec,fontSize:11}}>
              Vision mockup — panels show the platform's intended capabilities (live agent telemetry,
              threat detection, client messaging, automated reporting) with representative data.
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ═══ PORTFOLIO OVERVIEW ═══
  return (
    <div style={{minHeight:"100vh",background:SOC.bg,fontFamily:"Inter,system-ui,sans-serif",color:SOC.text}}>
      <Header title="Portfolio Command Center"/>
      <Mastermind/>
      <div style={{maxWidth:1180,margin:"0 auto",padding:"20px"}}>

        {/* KPI row */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:12,marginBottom:18}}>
          {[
            { label:"Active Clients", value:clients.length, color:SOC.cyan },
            { label:"Monthly Recurring", value:`$${(totalMRR/1000).toFixed(1)}k`, color:SOC.green },
            { label:"Avg Posture", value:avgPosture, color:pColor(avgPosture) },
            { label:"Agents Online", value:`${agentsOnline}/${clients.length}`, color:SOC.blue },
            { label:"Pending Reviews", value:reviewCount, color:reviewCount>0?SOC.amber:SOC.green },
            { label:"High Alerts", value:highAlerts, color:highAlerts>0?SOC.red:SOC.green },
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
                const sm = statusMeta[c.status];
                const pend = c.reviewQueue.filter(r=>r.status==="awaiting_review").length;
                const highA = c.alerts.filter(a=>a.sev==="high").length;
                return (
                  <div key={c.id} onClick={()=>{setActive(c);setView("client");}}
                    style={{background:SOC.panel,border:`1px solid ${SOC.border}`,borderRadius:10,
                      padding:"13px 15px",cursor:"pointer",display:"flex",alignItems:"center",gap:13}}>
                    <div style={{width:46,height:46,borderRadius:"50%",flexShrink:0,
                      background:`conic-gradient(${clr} ${c.posture*3.6}deg, ${SOC.grid} 0deg)`,
                      display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <div style={{width:36,height:36,borderRadius:"50%",background:SOC.panel,
                        display:"flex",alignItems:"center",justifyContent:"center",color:clr,fontWeight:700,fontSize:13}}>{c.posture}</div>
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

        <div style={{marginTop:16,padding:"12px 16px",background:`${SOC.cyan}0A`,
          border:`1px dashed ${SOC.cyan}33`,borderRadius:10,textAlign:"center"}}>
          <span style={{color:SOC.textSec,fontSize:11}}>
            Vision mockup with representative data. Click any client to open their full command center.
          </span>
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
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAnalyst, setShowAnalyst] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [regenAssessmentId, setRegenAssessmentId] = useState(null);

  // Frontend analyst detection for the mockup (matches the analyst email).
  // Later this becomes a real role flag from the backend.
  const isAnalyst = user && (user.isAnalyst || user.email === ANALYST_EMAIL);

  function handleAuthenticated(userObj) {
    setUser(userObj);
    setPhase("home");
    // Analysts land directly in their console
    if (userObj && (userObj.isAnalyst || userObj.email === ANALYST_EMAIL)) {
      setShowAnalyst(true);
    }
  }

  function signOut() {
    setAuthToken(null);
    setUser(null);
    setAssessment(null);
    setResults(null);
    setShowAnalyst(false);
    setShowAdmin(false);
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

  // Called by EditAssessmentScreen when user chooses Save & Regenerate
  async function handleRegenerate(assessmentId, replaceOld) {
    setRegenAssessmentId({ assessmentId, replaceOld });
    setEditingId(null);
    setPhase("analysis");
  }

  // Not logged in → show auth screen
  if (!user) {
    return <AuthScreen onAuthenticated={handleAuthenticated}/>;
  }

  // Admin panel (admins only)
  if (showAdmin && user.isAdmin) {
    return <AdminPanel onClose={() => setShowAdmin(false)}/>;
  }

  // Analyst console (analyst accounts only)
  if (showAnalyst && isAnalyst) {
    return <AnalystConsole user={user} onExit={() => setShowAnalyst(false)}/>;
  }

  // Top bar showing the logged-in company + sign out
  const TopBar = () => (
    <div style={{padding:"10px 20px",background:C.surface,borderBottom:`1px solid ${C.border}`,
      display:"flex",alignItems:"center",gap:10}}>
      <span onClick={() => setPhase("home")}
        style={{fontSize:18,cursor:"pointer"}}>🛡️</span>
      <span onClick={() => setPhase("home")}
        style={{fontWeight:700,color:C.text,fontSize:14,cursor:"pointer"}}>ShieldAI</span>
      <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:14}}>
        <span style={{fontSize:12,color:C.textSec}}>
          {user.companyName || user.email}
        </span>
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
  );

  if (phase === "home") {
    return (
      <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",background:C.bg}}>
        <TopBar/>
        <HomeScreen
          user={user}
          onNewAssessment={() => setPhase("intake")}
          onOpenProgram={openProgram}
          onEditAssessment={(id) => { setEditingId(id); setPhase("edit"); }}
        />
      </div>
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
          <IntakeChat onComplete={data => { setAssessment(data); setPhase("checklist"); }}/>
        </div>
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
          <span style={{fontSize:11,color:C.textSec,marginLeft:8}}>Step 2 of 3 — Security Checklist</span>
        </div>
        <ChecklistScreen
          onComplete={checklist => {
            setAssessment(prev => ({ ...prev, checklist }));
            setPhase("analysis");
          }}
          onBack={() => setPhase("intake")}
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
      <div style={{height:"100vh",display:"flex",flexDirection:"column"}}>
        <TopBar/>
        <div style={{flex:1,overflow:"hidden"}}>
          <Dashboard assessment={assessment} results={results} onReset={reset}/>
        </div>
      </div>
    );
  }

  return null;
}