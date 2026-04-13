import { useState, useEffect, useRef, useCallback } from "react";
import { useUser, useAuth, SignIn, UserButton, Show, SignInButton } from "@clerk/react";

const R2_WORKER_URL = "https://nextframe-flow-r2.donniepai.workers.dev";

/* ═══════════════════════════════════════════
   NEXTFRAME FLOW — AI Film Pipeline v1.0
   ═══════════════════════════════════════════ */

// ─── API Key (from Vercel env) ───
const API_KEY = typeof import.meta !== "undefined" && import.meta.env?.VITE_ANTHROPIC_API_KEY || "";
const API_HEADERS = {
  "Content-Type": "application/json",
  ...(API_KEY ? {
    "x-api-key": API_KEY,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  } : {}),
};

// ─── Storage helpers (localStorage) ───
const S = {
  async get(k) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }
    catch { return null; }
  },
  async set(k, v) {
    try {
      const json = JSON.stringify(v);
      localStorage.setItem(k, json);
      return true;
    } catch (e) {
      console.error("Storage save failed:", k, e);
      return false;
    }
  },
  async del(k) {
    try { localStorage.removeItem(k); return true; }
    catch { return false; }
  },
  async list(prefix) {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      return keys;
    } catch { return []; }
  },
};

// ─── Theme (Light) ───
const T = {
  bg: "#f5f5f0", bg1: "#ffffff", bg2: "#fafaf7", bg3: "#eeeee8",
  card: "#ffffff", cardHover: "#f8f8f4",
  border: "rgba(0,0,0,0.07)", borderL: "rgba(0,0,0,0.12)",
  text: "#3d3d3a", dim: "#8a8a82", muted: "#c5c5bc",
  hi: "#1a1a18",
  red: "#d9453a", redG: "rgba(217,69,58,0.08)",
  grn: "#1a9a6e", grnG: "rgba(26,154,110,0.08)",
  blu: "#3b7dd8", bluG: "rgba(59,125,216,0.08)",
  pur: "#7c5cbf", purG: "rgba(124,92,191,0.08)",
  amb: "#c8850a", ambG: "rgba(200,133,10,0.08)",
  cyn: "#0e8e9e", cynG: "rgba(14,142,158,0.08)",
};

const PHASES = [
  { key: "script", label: "腳本", en: "Script", icon: "✎", color: T.blu, glow: T.bluG },
  { key: "storyboard", label: "分鏡表", en: "Storyboard & Shots", icon: "▦", color: T.pur, glow: T.purG },
  { key: "assets", label: "素材", en: "Assets", icon: "◈", color: T.amb, glow: T.ambG },
  { key: "prompt", label: "Prompt", en: "Prompt", icon: "⚡", color: T.red, glow: T.redG },
];

// ─── AI System Prompt: Script → Storyboard ───
const STORYBOARD_STYLE_PRESETS = {
  anime: {
    label: "🎌 日式動漫",
    desc: "Japanese Anime",
    prompt: `【風格：日式動漫 Japanese Anime】
你必須以日本動畫的鏡頭語言來拆分鏡表。遵循以下原則：
- 景別偏好：善用「大遠景人物渺小」建立世界觀、「極端特寫眼睛/嘴唇」表達情緒
- 運鏡偏好：多用 Match Cut（場景轉換）、靜止長鏡（留白凝望 3-5 秒）、快速閃回蒙太奇
- 光線偏好：丁達爾光束、散景光暈、黃昏逆光剪影、窗邊灑落的光線粒子
- 角度偏好：仰角居多（表達敬畏）、鳥瞰城市全景、45度斜角表達動態
- 動畫特有表現：速度線、背景虛化為色塊、人物靜止背景流動、誇張表情特寫
- 節奏：日式動漫慣用「靜→靜→突然爆發」的節奏，不要全程高速
- 音效描述要包含：環境音層次（蟬鳴/電車/風鈴）、BGM 情緒（鋼琴/弦樂/電子）`,
  },
  liveaction: {
    label: "🎬 真人電影",
    desc: "Live Action Film",
    prompt: `【風格：真人電影 Live Action Film】
你必須以好萊塢/專業電影的鏡頭語言來拆分鏡表。遵循以下原則：
- 景別偏好：遵循「建立鏡頭→中景→近景→反應鏡頭」的經典剪輯邏輯
- 運鏡偏好：Dolly 推軌、Steadicam 跟拍、搖臂升降、手持（緊張場景）
- 光線偏好：自然光 / 三點打光 / 倫勃朗光 / 逆光剪影、根據場景情緒選擇冷暖色溫
- 角度偏好：180度軸線法則、正反打對話、Over-the-shoulder、低角度英雄構圖
- 真人特有表現：景深控制（淺景深虛化背景）、鏡頭焦距變化（廣角 vs 長焦壓縮）
- 節奏：遵循三幕劇結構的節奏，對話場景用中景正反打，動作場景加快剪輯
- 音效描述要包含：同期聲（腳步/環境）、Foley 音效、配樂風格、對白語氣`,
  },
};

const buildStoryboardPrompt = (styleKey) => {
  const styleBlock = STORYBOARD_STYLE_PRESETS[styleKey]?.prompt || STORYBOARD_STYLE_PRESETS.liveaction.prompt;
  return `你是專業的電影分鏡師，擅長將劇本文字拆解成結構化的分鏡表。

${styleBlock}

【任務】將使用者提供的腳本拆解為一格一格的分鏡，並按每 15 秒一組分配 Segment。

【輸出要求】
你必須只輸出一個 JSON 陣列，不要輸出任何其他文字、markdown 或解釋。
每個元素代表一格分鏡，格式如下：

[
  {
    "segment": 1,
    "segmentName": "段落名稱（例：開場環境建立）",
    "desc": "畫面描述：詳細描述這一格看到什麼（角色動作、表情、環境細節、光線氛圍）",
    "shotSize": "景別（例：大遠景/遠景/全景/中景/中近景/近景/特寫/大特寫）",
    "angle": "角度（例：平角/俯角/仰角/鳥瞰/荷蘭角/主觀視角）",
    "movement": "運鏡（例：固定/推/拉/搖/移/跟/升降/手持/環繞/Dolly Zoom）",
    "duration": "預估秒數（例：3s/5s/8s）",
    "audio": "音效或對白（例：環境音-風聲/角色A：台詞內容/BGM漸入）"
  }
]

【規則】
- 每個 Segment 總秒數約 15 秒，同 segment 的分鏡 segment 欄位填相同數字
- segment 從 1 開始遞增，segmentName 描述該段落的核心內容
- 根據劇情節奏合理拆分，一般每 Segment 有 2-5 格分鏡
- 每格 desc 要夠具體，讓人閉眼就能想像畫面
- 景別要有變化（遠→近→特寫），不要全部都是中景
- 注意節奏：開場宜慢（遠景建立環境），高潮宜快（快速剪輯特寫）
- 只輸出 JSON，不要輸出其他任何文字`;
};

// ─── AI System Prompt: Storyboard → Seedance 2.0 Prompts ───
const STORYBOARD_TO_PROMPT_PROMPT = `你是頂級的 Seedance 2.0 AI 視頻提示詞專家。

【任務】根據分鏡表（含 Segment 分組、景別、角度、運鏡、畫面描述、音效）生成每個 Segment 的 Seedance 2.0 提示詞。

【Seedance 2.0 提示詞公式】
主體(Subject) + 動作(Action) + 鏡頭語言(Camera Language) + @參考素材 + 風格美學 + 音頻音效 + 限制條件(Negative Prompts)

【時間結構格式】（每段恰好15秒）
[風格/美學定義]
0-Xs：[景別][角度][運動] [主體] [動作] [光效細節] [音效]
Xs-Ys：...
Ys-15s：...
@參考素材：@圖片1=角色參考 ｜@圖片2=場景環境
限制條件：[不要出現的元素]

【@素材參考系統】
- @圖片1 / @Image1 — 角色外觀、首幀參考
- @圖片2 / @Image2 — 場景環境參考
- @視頻1 / @Video1 — 動作參考、鏡頭運動
- @音頻1 / @Audio1 — BGM、節奏同步

【輸出要求】
你必須只輸出一個 JSON 陣列，不要輸出任何其他文字。
每個元素代表一個 Segment 的提示詞：

[
  {
    "segment": 1,
    "title": "第1段｜0-15秒｜段落名稱",
    "zh": "完整中文 Seedance 2.0 提示詞（含時間碼結構、@參考素材、限制條件）",
    "en": "Complete English Seedance 2.0 prompt (with timecodes, @references, negative prompts)",
    "upload": "素材上傳指引：說明 @圖片1 應上傳什麼、@圖片2 應上傳什麼",
    "bridge": "銜接建議：與下一段如何銜接"
  }
]

【規則】
- 每個 Segment 的 zh 和 en 都是完整可直接貼入 Seedance 2.0 的提示詞
- 時間碼精確到秒，總和恰好 15 秒
- 根據分鏡表中的景別、角度、運鏡直接對應到提示詞的鏡頭語言
- 音效/對白整合到時間碼中
- 限制條件要具體（避免閃爍、避免畫面跳切等）
- 只輸出 JSON，不要輸出其他任何文字`;

// ─── AI System Prompt: Script → Assets extraction ───
const SCRIPT_TO_ASSETS_PROMPT = `你是專業的電影製作資產分析師，擅長從腳本中提取所有需要製作的視覺素材。

【任務】從使用者提供的腳本中，提取所有出現的角色、場景、道具，並為每個素材生成簡潔的視覺描述。

【輸出要求】
你必須只輸出一個 JSON 物件，不要輸出任何其他文字、markdown 或解釋。
格式如下：

{
  "characters": [
    { "name": "角色名稱", "desc": "角色外觀的詳細視覺描述：年齡、性別、髮型髮色、膚色、體型、服裝風格、標誌性特徵、常見表情/氣質" }
  ],
  "scenes": [
    { "name": "場景名稱", "desc": "場景環境的詳細視覺描述：地點類型、時間（日/夜）、天氣、光線氛圍、建築風格、色調、關鍵視覺元素" }
  ],
  "props": [
    { "name": "道具名稱", "desc": "道具的詳細視覺描述：材質、尺寸、顏色、設計風格、功能特徵、使用場景" }
  ]
}

【規則】
- 角色：提取所有有名字或有描述的角色，包含主角和配角
- 場景：提取所有不同的場景地點，同一地點不同時間算不同場景（如「城市街道-白天」vs「城市街道-夜晚」）
- 道具：提取劇情中重要的道具、武器、載具、裝備，不要提取太瑣碎的物品
- 每個 desc 要足夠詳細，讓 AI 圖像生成工具能根據描述產出一致的視覺素材
- 如果腳本中沒有明確描述外觀，根據劇情合理推測並補充視覺細節
- 只輸出 JSON，不要輸出其他任何文字`;

const newProject = (name) => ({
  id: "p_" + Date.now(),
  name,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  script: "",
  storyboard: [],   // [{id, segment, segmentName, image (base64), desc, shotSize, angle, movement, duration, audio}]
  assets: { characters: [], scenes: [], props: [] },
  // characters/scenes/props: [{id, name, desc, image (base64)}]
  prompts: [],       // [{id, title, zh, en, upload, bridge}]
  status: { script: "empty", storyboard: "empty", assets: "empty", prompt: "empty" },
});

const STATUS_LABELS = { empty: "未開始", wip: "進行中", done: "已完成" };
const STATUS_COLORS = { empty: T.muted, wip: T.amb, done: T.grn };

// ─── Reusable Components ───
const Btn = ({ children, onClick, color = T.red, disabled, small, outline, ghost, style }) => (
  <button onClick={onClick} disabled={disabled} style={{
    padding: small ? "5px 12px" : "9px 20px",
    background: ghost ? "transparent" : outline ? "transparent" : disabled ? T.bg2 : color,
    color: ghost ? color : outline ? color : disabled ? T.dim : "#fff",
    border: outline ? `1px solid ${color}44` : ghost ? "none" : "1px solid transparent",
    borderRadius: 7, fontSize: small ? 11 : 13, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1,
    transition: "all 0.2s", fontFamily: "inherit", letterSpacing: 0.3, ...style,
  }}>{children}</button>
);

const Input = ({ value, onChange, placeholder, style }) => (
  <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
    style={{
      width: "100%", boxSizing: "border-box", background: T.bg1, border: `1px solid ${T.border}`,
      borderRadius: 8, padding: "10px 14px", color: T.hi, fontSize: 14, outline: "none",
      fontFamily: "inherit", transition: "border 0.2s", ...style,
    }}
    onFocus={e => e.target.style.borderColor = T.borderL}
    onBlur={e => e.target.style.borderColor = T.border}
  />
);

const TArea = ({ value, onChange, placeholder, rows = 8, readOnly, style }) => (
  <textarea value={value} onChange={e => onChange?.(e.target.value)} placeholder={placeholder}
    readOnly={readOnly} rows={rows}
    style={{
      width: "100%", boxSizing: "border-box", background: T.bg1, border: `1px solid ${T.border}`,
      borderRadius: 8, padding: 14, color: T.text, fontSize: 13, lineHeight: 1.75,
      resize: "vertical", fontFamily: "'Noto Sans TC', monospace", outline: "none", ...style,
    }}
  />
);

const Badge = ({ children, color = T.dim }) => (
  <span style={{
    display: "inline-block", fontSize: 10, fontWeight: 600, padding: "2px 8px",
    borderRadius: 4, background: color + "18", color, letterSpacing: 0.5,
  }}>{children}</span>
);

const copyText = (text) => {
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => fbCopy(text));
    } else fbCopy(text);
  } catch { fbCopy(text); }
};
const fbCopy = (text) => {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.cssText = "position:fixed;opacity:0;";
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand("copy"); } catch {}
  document.body.removeChild(ta);
};

// ─── Image handler ───
const toBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(file);
});

// Upload image to R2 via API route, returns URL
const uploadToR2 = async (projectId, file) => {
  const filename = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const key = `${projectId}/${filename}`;
  const res = await fetch(`/api/r2?action=upload&key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) throw new Error(`R2 upload failed: ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`R2 upload error: ${data.error || "unknown"}`);
  return data.url;
};

// ════════════════════════════════════════
//         LOGIN SCREEN
// ════════════════════════════════════════
function LoginScreen() {
  return (
    <div style={{
      minHeight: "100vh", background: "#f5f5f0", display: "flex",
      alignItems: "center", justifyContent: "center", flexDirection: "column",
      fontFamily: "'Noto Sans TC', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;600;700&family=Instrument+Sans:wght@400;700&display=swap" rel="stylesheet"/>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14,
          background: "linear-gradient(135deg, #d9453a, #c8850a)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 26, color: "#fff", margin: "0 auto 20px",
          boxShadow: "0 8px 24px rgba(217,69,58,0.25)",
        }}>▶</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: "#1a1a18", fontFamily: "'Instrument Sans', sans-serif", letterSpacing: 1 }}>
          NEXTFRAME FLOW
        </div>
        <div style={{ fontSize: 11, color: "#8a8a82", letterSpacing: 3, marginTop: 6 }}>
          AI 電影流程管理
        </div>
      </div>

      <div style={{
        background: "#fff", borderRadius: 16, padding: "40px 48px",
        boxShadow: "0 8px 48px rgba(0,0,0,0.08)", border: "1px solid rgba(0,0,0,0.06)",
        textAlign: "center", minWidth: 320,
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a18", marginBottom: 8 }}>歡迎登入</div>
        <div style={{ fontSize: 12, color: "#8a8a82", marginBottom: 28, lineHeight: 1.6 }}>
          登入後即可查看分享的<br/>AI 電影專案管理內容
        </div>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <button style={{
              width: "100%", padding: "12px 24px", borderRadius: 10,
              background: "linear-gradient(135deg, #d9453a, #c8850a)",
              color: "#fff", fontSize: 14, fontWeight: 700, border: "none",
              cursor: "pointer", letterSpacing: 0.5, fontFamily: "inherit",
              boxShadow: "0 4px 16px rgba(217,69,58,0.3)",
            }}>
              登入 / 註冊
            </button>
          </SignInButton>
        </Show>
      </div>

      <div style={{ fontSize: 11, color: "#c5c5bc", marginTop: 24 }}>
        由 Clerk 提供安全驗證
      </div>
    </div>
  );
}

// ════════════════════════════════════════
//              MAIN APP
// ════════════════════════════════════════
export default function FilmPipelineManager() {
  const { user, isLoaded: userLoaded } = useUser();
  const { getToken } = useAuth();
  const OWNER_ID = import.meta.env.VITE_OWNER_USER_ID;
  const isOwner = !!user && (user.id === OWNER_ID || !OWNER_ID);
  const readOnly = !!user && !!OWNER_ID && user.id !== OWNER_ID;

  const [projects, setProjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const projectsRef = useRef([]);
  const activeIdRef = useRef(null);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  const [activePhase, setActivePhase] = useState("script");
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const fileRef = useRef(null);
  const sbFileRef = useRef(null);

  const proj = projects.find(p => p.id === activeId);

  // ─── Segment grouping for storyboard ───
  const getSegmentGroups = () => {
    const panels = proj?.storyboard || [];
    const segMap = {};
    panels.forEach(p => {
      const s = p.segment || 1;
      if (!segMap[s]) segMap[s] = { name: p.segmentName || "", panels: [] };
      if (p.segmentName && !segMap[s].name) segMap[s].name = p.segmentName;
      segMap[s].panels.push(p);
    });
    const segKeys = Object.keys(segMap).map(Number).sort((a, b) => a - b);
    return { panels, segMap, segKeys };
  };

  // ─── Toast ───
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2000); };

  // ─── Export / Import projects ───
  const importFileRef = useRef(null);
  const [exportData, setExportData] = useState(null); // show export modal

  const exportAllProjects = () => {
    if (projects.length === 0) { showToast("沒有專案可匯出"); return; }
    const data = JSON.stringify(projects);
    setExportData(data);
  };

  const importProjects = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : [data];
      let imported = 0;
      for (const p of arr) {
        if (!p.id || !p.name) continue;
        const exists = projects.find(x => x.id === p.id);
        if (exists) continue;
        await S.set("proj:" + p.id, p);
        imported++;
      }
      if (imported > 0) {
        const keys = await S.list("proj:");
        const loaded = [];
        for (const k of keys) {
          const proj = await S.get(k);
          if (proj) loaded.push(proj);
        }
        loaded.sort((a, b) => b.updatedAt - a.updatedAt);
        setProjects(loaded);
        showToast(`✓ 已匯入 ${imported} 個專案`);
      } else {
        showToast("沒有新專案可匯入（可能已存在）");
      }
    } catch (e) {
      showToast("匯入失敗：" + (e.message || "JSON 格式錯誤"));
    }
  };

  const importFromText = (text) => {
    try {
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : [data];
      let imported = 0;
      const updatedProjects = [...projects];
      arr.forEach(p => {
        if (!p.id || !p.name) return;
        if (updatedProjects.find(x => x.id === p.id)) return;
        S.set("proj:" + p.id, p);
        updatedProjects.push(p);
        imported++;
      });
      if (imported > 0) {
        updatedProjects.sort((a, b) => b.updatedAt - a.updatedAt);
        setProjects(updatedProjects);
        showToast(`✓ 已匯入 ${imported} 個專案`);
      } else {
        showToast("沒有新專案可匯入");
      }
    } catch (e) {
      showToast("匯入失敗：JSON 格式錯誤");
    }
  };

  // ─── Script file import ───
  const [importing, setImporting] = useState(false);
  const scriptFileRef = useRef(null);

  const handleScriptFileImport = async (file) => {
    if (!file || !proj) return;
    setImporting(true);
    const ext = file.name.split(".").pop().toLowerCase();
    try {
      let text = "";

      if (ext === "txt" || ext === "md" || ext === "csv") {
        text = await file.text();

      } else if (ext === "docx") {
        const arrayBuf = await file.arrayBuffer();
        const mam = await loadScript(
          "mammoth",
          "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
          () => window.mammoth
        );
        const result = await mam.extractRawText({ arrayBuffer: arrayBuf });
        text = result.value;

      } else if (ext === "xlsx" || ext === "xls") {
        const XLSX = await loadScript(
          "XLSX",
          "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
          () => window.XLSX
        );
        const arrayBuf = await file.arrayBuffer();
        const wb = XLSX.read(arrayBuf, { type: "array" });
        const lines = [];
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          const csv = XLSX.utils.sheet_to_csv(ws);
          if (wb.SheetNames.length > 1) lines.push(`【${sheetName}】`);
          lines.push(csv);
          lines.push("");
        }
        text = lines.join("\n").trim();

      } else if (ext === "pdf") {
        const arrayBuf = await file.arrayBuffer();
        const pdfjsLib = await loadScript(
          "pdfjsLib",
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
          () => {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
              "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
            return window.pdfjsLib;
          }
        );
        const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map(item => item.str).join(" ");
          pages.push(pageText);
        }
        text = pages.join("\n\n");

      } else {
        showToast("不支援此檔案格式，請使用 DOCX / XLSX / PDF / TXT");
        setImporting(false);
        return;
      }

      if (text.trim()) {
        const prev = proj.script || "";
        const merged = prev ? prev + "\n\n───── 匯入：" + file.name + " ─────\n\n" + text : text;
        updateProj("script", merged);
        showToast(`✓ 已匯入 ${file.name}`);
      } else {
        showToast("檔案內容為空");
      }
    } catch (e) {
      console.error("Import error:", e);
      showToast("匯入失敗：" + (e.message || "未知錯誤"));
    }
    setImporting(false);
  };

  // ─── CDN Script loader (cached) ───
  const _scriptCache = useRef({});
  const loadScript = (name, url, getLib) => new Promise((resolve, reject) => {
    if (_scriptCache.current[name]) { resolve(_scriptCache.current[name]); return; }
    const el = document.createElement("script");
    el.src = url;
    el.onload = () => {
      try {
        const lib = getLib();
        _scriptCache.current[name] = lib;
        resolve(lib);
      } catch (e) { reject(e); }
    };
    el.onerror = () => reject(new Error(`${name} 載入失敗`));
    document.head.appendChild(el);
  });

  // ─── AI: Script → Storyboard ───
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [filmStyle, setFilmStyle] = useState("anime");

  const generateStoryboard = async () => {
    // Read latest project from state
    const latestProj = projects.find(p => p.id === activeId);
    if (!latestProj?.script?.trim()) { showToast("請先輸入腳本"); return; }
    setAnalyzing(true); setAnalyzeProgress(10);
    try {
      setAnalyzeProgress(30);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: API_HEADERS,
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          system: buildStoryboardPrompt(filmStyle),
          messages: [{ role: "user", content: latestProj.script }],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      setAnalyzeProgress(70);

      const raw = (data.content || []).map(c => c.text || "").join("");
      // Extract JSON array from response
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("AI 回傳格式異常，無法解析分鏡");
      const panels = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(panels) || panels.length === 0) throw new Error("未產生任何分鏡格");

      setAnalyzeProgress(90);
      const newPanels = panels.map((p, i) => ({
        id: "sb_" + Date.now() + "_" + i,
        image: null,
        segment: p.segment || 1,
        segmentName: p.segmentName || "",
        desc: p.desc || "",
        shotSize: p.shotSize || "",
        angle: p.angle || "",
        movement: p.movement || "",
        duration: p.duration || "",
        audio: p.audio || "",
      }));

      // Atomic update: storyboard + both statuses at once
      const existing = latestProj.storyboard || [];
      const merged = [...existing, ...newPanels];
      updateMultiFields({
        storyboard: merged,
        status: {
          ...(latestProj.status || {}),
          script: "done",
          storyboard: "wip",
        },
      });
      setAnalyzeProgress(100);
      showToast(`✓ 已生成 ${newPanels.length} 格分鏡`);
      setTimeout(() => { setActivePhase("storyboard"); }, 600);
    } catch (e) {
      console.error("AI storyboard error:", e);
      showToast("分鏡生成失敗：" + (e.message || "未知錯誤"));
    }
    setAnalyzing(false); setAnalyzeProgress(0);
  };

  // ─── AI: Storyboard → Prompts ───
  const [genPromptLoading, setGenPromptLoading] = useState(false);
  const [genPromptProgress, setGenPromptProgress] = useState(0);

  const generatePrompts = async () => {
    const latestProj = projects.find(p => p.id === activeId);
    const panels = latestProj?.storyboard || [];
    if (panels.length === 0) { showToast("請先建立分鏡表"); return; }

    setGenPromptLoading(true); setGenPromptProgress(10);
    try {
      // Build structured storyboard text for AI
      const segMap = {};
      panels.forEach(p => {
        const s = p.segment || 1;
        if (!segMap[s]) segMap[s] = { name: p.segmentName || "", shots: [] };
        if (p.segmentName && !segMap[s].name) segMap[s].name = p.segmentName;
        segMap[s].shots.push(p);
      });

      let storyboardText = "";
      Object.keys(segMap).sort((a, b) => a - b).forEach(segNum => {
        const seg = segMap[segNum];
        const start = (segNum - 1) * 15;
        const end = segNum * 15;
        storyboardText += `【SEGMENT ${segNum}】${start}-${end}秒 | ${seg.name || "段落" + segNum}\n`;
        seg.shots.forEach((shot, i) => {
          storyboardText += `Shot ${i + 1} (${shot.duration || "?s"}): ${shot.shotSize || ""}，${shot.angle || ""}，${shot.movement || ""}，${shot.desc || ""}，${shot.audio || ""}\n`;
        });
        storyboardText += "\n";
      });

      setGenPromptProgress(30);

      // Auto-continue API call
      let messages = [{ role: "user", content: storyboardText }];
      let fullText = "";
      for (let i = 0; i < 3; i++) {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: API_HEADERS,
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 16000,
            system: STORYBOARD_TO_PROMPT_PROMPT,
            messages,
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        const chunk = (data.content || []).map(c => c.text || "").join("");
        fullText += chunk;
        if (data.stop_reason === "max_tokens") {
          messages = [...messages,
            { role: "assistant", content: fullText },
            { role: "user", content: "你的回答被截斷了，請從斷點處繼續完成剩餘的所有 Segment。不要重複已寫的內容。只輸出 JSON。" }
          ];
          setGenPromptProgress(50);
        } else break;
      }

      setGenPromptProgress(80);

      const jsonMatch = fullText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("AI 回傳格式異常，無法解析 Prompt");
      const promptData = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(promptData) || promptData.length === 0) throw new Error("未產生任何 Prompt");

      const newPrompts = promptData.map((p, i) => ({
        id: "pm_" + Date.now() + "_" + i,
        segment: p.segment || (i + 1),
        title: p.title || `第${i + 1}段`,
        zh: p.zh || "",
        en: p.en || "",
        upload: p.upload || "",
        bridge: p.bridge || "",
      }));

      setGenPromptProgress(95);
      updateMultiFields({
        prompts: newPrompts,
        status: {
          ...(latestProj.status || {}),
          storyboard: "done",
          prompt: "wip",
        },
      });
      setGenPromptProgress(100);
      showToast(`✓ 已生成 ${newPrompts.length} 段 Prompt`);
    } catch (e) {
      console.error("AI prompt error:", e);
      showToast("Prompt 生成失敗：" + (e.message || "未知錯誤"));
    }
    setGenPromptLoading(false); setGenPromptProgress(0);
  };

  // ─── AI: Script → Assets ───
  const [genAssetsLoading, setGenAssetsLoading] = useState(false);
  const [genAssetsProgress, setGenAssetsProgress] = useState(0);

  const generateAssets = async () => {
    const latestProj = projects.find(p => p.id === activeId);
    if (!latestProj?.script?.trim()) { showToast("請先輸入腳本"); return; }
    setGenAssetsLoading(true); setGenAssetsProgress(10);
    try {
      setGenAssetsProgress(30);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: API_HEADERS,
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          system: SCRIPT_TO_ASSETS_PROMPT,
          messages: [{ role: "user", content: latestProj.script }],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      setGenAssetsProgress(70);

      const raw = (data.content || []).map(c => c.text || "").join("");
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("AI 回傳格式異常");
      const parsed = JSON.parse(jsonMatch[0]);

      setGenAssetsProgress(90);
      const toAssets = (arr) => (arr || []).map((item, i) => ({
        id: "a_" + Date.now() + "_" + i + "_" + Math.random().toString(36).slice(2, 5),
        name: item.name || "",
        desc: item.desc || "",
        image: null,
      }));

      // Merge: append new ones, don't overwrite existing
      const existing = latestProj.assets || { characters: [], scenes: [], props: [] };
      const merged = {
        characters: [...(existing.characters || []), ...toAssets(parsed.characters)],
        scenes: [...(existing.scenes || []), ...toAssets(parsed.scenes)],
        props: [...(existing.props || []), ...toAssets(parsed.props)],
      };

      const totalNew = (parsed.characters?.length || 0) + (parsed.scenes?.length || 0) + (parsed.props?.length || 0);

      updateMultiFields({
        assets: merged,
        status: { ...(latestProj.status || {}), assets: "wip" },
      });
      setGenAssetsProgress(100);
      showToast(`✓ 已提取 ${totalNew} 個素材`);
    } catch (e) {
      console.error("AI assets error:", e);
      showToast("素材提取失敗：" + (e.message || "未知錯誤"));
    }
    setGenAssetsLoading(false); setGenAssetsProgress(0);
  };

  // ─── Export Storyboard as PDF ───
  const exportStoryboardPDF = () => {
    if (!proj) return;
    const { panels, segMap, segKeys } = getSegmentGroups();
    if (panels.length === 0) { showToast("分鏡表為空"); return; }

    const w = window.open("", "_blank");
    if (!w) { showToast("請允許彈出視窗"); return; }

    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${proj.name} — 分鏡表</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;600;700&family=Share+Tech+Mono&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Noto Sans TC', sans-serif; color: #1a1a18; background: #fff; padding: 32px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { font-size: 12px; color: #8a8a82; margin-bottom: 24px; }
  .seg-header { display: flex; align-items: center; gap: 10px; padding: 8px 14px; background: #f3f0ff; border-bottom: 2px solid #7c5cbf; margin-top: 20px; border-radius: 8px 8px 0 0; }
  .seg-badge { background: #7c5cbf; color: #fff; font-size: 11px; font-weight: 700; padding: 2px 10px; border-radius: 5px; font-family: 'Share Tech Mono', monospace; }
  .seg-time { font-size: 11px; color: #8a8a82; font-family: 'Share Tech Mono', monospace; }
  .seg-name { font-size: 14px; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 2px; background: #1a1a18; padding: 2px; border-radius: 0 0  8px 8px; }
  .panel { background: #fff; page-break-inside: avoid; }
  .panel-head { padding: 4px 10px; background: #fafaf7; display: flex; justify-content: space-between; font-size: 10px; font-weight: 700; color: #7c5cbf; font-family: 'Share Tech Mono', monospace; }
  .panel-img { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; }
  .panel-placeholder { width: 100%; aspect-ratio: 16/9; background: #f5f5f0; display: flex; align-items: center; justify-content: center; color: #c5c5bc; font-size: 12px; }
  .panel-info { padding: 8px 10px; }
  .panel-desc { font-size: 11px; line-height: 1.6; color: #3d3d3a; margin-bottom: 6px; }
  .panel-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px; }
  .tag { font-size: 9px; padding: 2px 6px; background: #f5f5f0; border: 1px solid rgba(0,0,0,0.07); border-radius: 3px; color: #3d3d3a; }
  .panel-audio { font-size: 9px; color: #8a8a82; }
  @media print {
    body { padding: 16px; }
    .seg-header { break-before: auto; }
    .panel { break-inside: avoid; }
    .no-print { display: none !important; }
  }
</style></head><body>
<div class="no-print" style="margin-bottom:20px;text-align:right">
  <button onclick="window.print()" style="padding:8px 20px;background:#7c5cbf;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-family:inherit">🖨 列印 / 存為 PDF</button>
</div>
<h1>${proj.name}</h1>
<div class="subtitle">NextFrame Flow — 分鏡表 ｜ ${new Date().toLocaleDateString("zh-TW")} ｜ ${panels.length} 格 ｜ ${segKeys.length} 段落</div>`;

    segKeys.forEach(segNum => {
      const seg = segMap[segNum];
      const startSec = (segNum - 1) * 15;
      const endSec = segNum * 15;
      html += `<div class="seg-header">
        <span class="seg-badge">SEG ${segNum}</span>
        <span class="seg-time">${startSec}–${endSec}s</span>
        <span class="seg-name">${seg.name || ""}</span>
      </div>
      <div class="grid">`;

      seg.panels.forEach((panel, idx) => {
        const imgHtml = panel.image
          ? `<img class="panel-img" src="${panel.image}" />`
          : `<div class="panel-placeholder">尚無圖片</div>`;
        const tags = [panel.shotSize, panel.angle, panel.movement, panel.duration]
          .filter(Boolean)
          .map(t => `<span class="tag">${t}</span>`)
          .join("");
        html += `<div class="panel">
          <div class="panel-head"><span>S${segNum}-${String(idx + 1).padStart(2, "0")}</span></div>
          ${imgHtml}
          <div class="panel-info">
            <div class="panel-desc">${(panel.desc || "").replace(/\n/g, "<br>")}</div>
            ${tags ? `<div class="panel-tags">${tags}</div>` : ""}
            ${panel.audio ? `<div class="panel-audio">🔊 ${panel.audio}</div>` : ""}
          </div>
        </div>`;
      });
      html += `</div>`;
    });

    html += `</body></html>`;
    w.document.write(html);
    w.document.close();
    showToast("分鏡表已在新視窗開啟，可列印為 PDF");
  };

  // ─── Load projects from storage (owner) or R2 shared (viewer) ───
  useEffect(() => {
    if (!userLoaded || !user) return;
    if (isOwner) {
      (async () => {
        const keys = await S.list("proj:");
        const loaded = [];
        for (const k of keys) {
          const p = await S.get(k);
          if (p) loaded.push(p);
        }
        loaded.sort((a, b) => b.updatedAt - a.updatedAt);
        setProjects(loaded);
        setLoading(false);
      })();
    } else {
      // Viewer: load shared projects from R2
      (async () => {
        try {
          const res = await fetch("/api/r2?action=list-shared");
          const data = await res.json();
          const shared = (data.projects || []).sort((a, b) => b.updatedAt - a.updatedAt);
          setProjects(shared);
        } catch (e) {
          console.error("Failed to load shared projects:", e);
        }
        setLoading(false);
      })();
    }
  }, [userLoaded, user, isOwner]);

  // ─── Flush save on page unload ───
  useEffect(() => {
    const handleUnload = () => {
      if (window._saveTimer) {
        clearTimeout(window._saveTimer);
        window._saveTimer = null;
        const id = window._saveTargetId;
        const p = projectsRef.current.find(x => x.id === id);
        if (p) {
          const updated = { ...p, updatedAt: Date.now() };
          try { localStorage.setItem("proj:" + p.id, JSON.stringify(updated)); } catch {}
        }
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  // ─── Save project ───
  const saveProject = useCallback(async (p) => {
    const updated = { ...p, updatedAt: Date.now() };
    setSaving(true);
    const ok = await S.set("proj:" + p.id, updated);
    setSaving(false);
    if (ok) {
      showToast("已儲存");
    } else {
      showToast("⚠ 儲存失敗：儲存空間不足，請清理舊專案");
    }
  }, []);

  // ─── Flush pending save immediately ───
  const flushSave = useCallback(() => {
    if (window._saveTimer) {
      clearTimeout(window._saveTimer);
      window._saveTimer = null;
      const id = window._saveTargetId || activeIdRef.current;
      const p = projectsRef.current.find(x => x.id === id);
      if (p) saveProject(p);
    }
  }, [saveProject]);

  // ─── Debounced save using latest ref ───
  const scheduleSave = useCallback(() => {
    clearTimeout(window._saveTimer);
    window._saveTargetId = activeIdRef.current;
    window._saveTimer = setTimeout(() => {
      window._saveTimer = null;
      const id = window._saveTargetId;
      const p = projectsRef.current.find(x => x.id === id);
      if (p) saveProject(p);
    }, 800);
  }, [saveProject]);

  // ─── Update active project field ───
  const updateProj = useCallback((field, value) => {
    setProjects(prev => {
      const id = activeId;
      if (!id) return prev;
      const p = prev.find(x => x.id === id);
      if (!p) return prev;
      const updated = { ...p, [field]: value, updatedAt: Date.now() };
      return prev.map(x => x.id === id ? updated : x);
    });
    scheduleSave();
  }, [activeId, scheduleSave]);

  const updateMultiFields = useCallback((fields) => {
    setProjects(prev => {
      const id = activeId;
      if (!id) return prev;
      const p = prev.find(x => x.id === id);
      if (!p) return prev;
      const updated = { ...p, ...fields, updatedAt: Date.now() };
      return prev.map(x => x.id === id ? updated : x);
    });
    scheduleSave();
  }, [activeId, scheduleSave]);

  const updateStatus = useCallback((phase, status) => {
    setProjects(prev => {
      const id = activeId;
      if (!id) return prev;
      const p = prev.find(x => x.id === id);
      if (!p) return prev;
      const newStatus = { ...p.status, [phase]: status };
      const updated = { ...p, status: newStatus, updatedAt: Date.now() };
      return prev.map(x => x.id === id ? updated : x);
    });
    scheduleSave();
  }, [activeId, scheduleSave]);

  // ─── Create project ───
  const createProject = async () => {
    if (!newName.trim()) return;
    const p = newProject(newName.trim());
    await S.set("proj:" + p.id, p);
    setProjects(prev => [p, ...prev]);
    setActiveId(p.id);
    setActivePhase("script");
    setNewName("");
    setShowNewDialog(false);
    showToast("專案已建立");
  };

  // ─── Delete project ───
  const deleteProject = async (id) => {
    if (!confirm("確定要刪除此專案？此操作無法復原。")) return;
    await S.del("proj:" + id);
    setProjects(prev => prev.filter(x => x.id !== id));
    if (activeId === id) setActiveId(null);
    showToast("已刪除");
  };

  // ─── Share / Unshare project ───
  const [sharingId, setSharingId] = useState(null);

  const toggleShare = async (projectId) => {
    const p = projectsRef.current.find(x => x.id === projectId);
    if (!p) return;
    setSharingId(projectId);
    try {
      const token = await getToken();
      if (!p.shared) {
        // Share: save to R2
        const res = await fetch("/api/r2?action=save-project", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ projectId, project: { ...p, shared: true } }),
        });
        const data = await res.json();
        if (data.ok) {
          const updated = { ...p, shared: true };
          setProjects(prev => prev.map(x => x.id === projectId ? updated : x));
          await S.set("proj:" + projectId, updated);
          showToast("✓ 已分享此專案，其他登入用戶可查看");
        } else {
          showToast("分享失敗：" + (data.error || "未知錯誤"));
        }
      } else {
        // Unshare: delete from R2 shared
        await fetch(`/api/r2?action=delete-shared&projectId=${projectId}`, {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${token}` },
        });
        const updated = { ...p, shared: false };
        setProjects(prev => prev.map(x => x.id === projectId ? updated : x));
        await S.set("proj:" + projectId, updated);
        showToast("已取消分享");
      }
    } catch (e) {
      showToast("操作失敗：" + e.message);
    }
    setSharingId(null);
  };

  // ─── Storyboard panel management ───
  const addStoryboardPanel = (seg) => {
    const panels = proj.storyboard || [];
    const maxSeg = panels.reduce((m, p) => Math.max(m, p.segment || 1), 0);
    const targetSeg = seg || maxSeg || 1;
    const newPanel = {
      id: "sb_" + Date.now(), image: null,
      segment: targetSeg, segmentName: "",
      desc: "", shotSize: "", angle: "", movement: "", duration: "", audio: "",
    };
    updateProj("storyboard", [...panels, newPanel]);
  };

  const addSegment = () => {
    const panels = proj.storyboard || [];
    const maxSeg = panels.reduce((m, p) => Math.max(m, p.segment || 1), 0);
    const newSeg = maxSeg + 1;
    const newPanel = {
      id: "sb_" + Date.now(), image: null,
      segment: newSeg, segmentName: "",
      desc: "", shotSize: "", angle: "", movement: "", duration: "", audio: "",
    };
    updateProj("storyboard", [...panels, newPanel]);
  };

  const updatePanel = (panelId, field, value) => {
    setProjects(prev => {
      const id = activeId;
      if (!id) return prev;
      const p = prev.find(x => x.id === id);
      if (!p) return prev;
      const panels = (p.storyboard || []).map(panel =>
        panel.id === panelId ? { ...panel, [field]: value } : panel
      );
      const updated = { ...p, storyboard: panels, updatedAt: Date.now() };
      return prev.map(x => x.id === id ? updated : x);
    });
    scheduleSave();
  };

  const removePanel = (panelId) => {
    const panels = (proj.storyboard || []).filter(p => p.id !== panelId);
    updateProj("storyboard", panels);
  };

  const movePanel = (panelId, direction) => {
    setProjects(prev => {
      const id = activeId;
      if (!id) return prev;
      const p = prev.find(x => x.id === id);
      if (!p) return prev;
      const panels = [...(p.storyboard || [])];
      const idx = panels.findIndex(pan => pan.id === panelId);
      if (idx < 0) return prev;
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= panels.length) return prev;
      [panels[idx], panels[targetIdx]] = [panels[targetIdx], panels[idx]];
      const updated = { ...p, storyboard: panels, updatedAt: Date.now() };
      return prev.map(x => x.id === id ? updated : x);
    });
    scheduleSave();
  };

  const handlePanelImage = async (panelId, file) => {
    if (!file || !proj) return;
    if (file.size > 4 * 1024 * 1024) {
      showToast("⚠ 圖片超過 4MB 上限，請壓縮後再上傳");
      return;
    }
    showToast("上傳中...");
    try {
      const url = await uploadToR2(proj.id, file);
      updatePanel(panelId, "image", url);
      showToast("✓ 圖片已上傳");
    } catch (e) {
      console.error("Panel image upload failed:", e);
      showToast("⚠ 上傳失敗：" + (e.message || "未知錯誤"));
    }
  };

  // ─── Asset management ───
  const addAsset = (type) => {
    const assets = { ...proj.assets };
    assets[type] = [...(assets[type] || []), { id: "a_" + Date.now(), name: "", desc: "", image: null }];
    updateProj("assets", assets);
  };

  const updateAsset = (type, assetId, field, value) => {
    setProjects(prev => {
      const id = activeId;
      if (!id) return prev;
      const p = prev.find(x => x.id === id);
      if (!p) return prev;
      const assets = { ...p.assets };
      assets[type] = (assets[type] || []).map(a => a.id === assetId ? { ...a, [field]: value } : a);
      const updated = { ...p, assets, updatedAt: Date.now() };
      return prev.map(x => x.id === id ? updated : x);
    });
    scheduleSave();
  };

  const removeAsset = (type, assetId) => {
    const assets = { ...proj.assets };
    assets[type] = (assets[type] || []).filter(a => a.id !== assetId);
    updateProj("assets", assets);
  };

  const handleAssetImage = async (type, assetId, file) => {
    if (!file || !proj) return;
    if (file.size > 4 * 1024 * 1024) {
      showToast("⚠ 圖片超過 4MB 上限，請壓縮後再上傳");
      return;
    }
    showToast("上傳中...");
    try {
      const url = await uploadToR2(proj.id, file);
      updateAsset(type, assetId, "image", url);
      showToast("✓ 圖片已上傳");
    } catch (e) {
      console.error("Asset image upload failed:", e);
      showToast("⚠ 上傳失敗：" + (e.message || "未知錯誤"));
    }
  };

  // ─── Prompt management ───
  const addPrompt = () => {
    const prompts = [...(proj.prompts || []), {
      id: "pm_" + Date.now(), title: "", zh: "", en: "", upload: "", bridge: "",
    }];
    updateProj("prompts", prompts);
  };

  const updatePrompt = (promptId, field, value) => {
    const prompts = (proj.prompts || []).map(p =>
      p.id === promptId ? { ...p, [field]: value } : p
    );
    updateProj("prompts", prompts);
  };

  const removePrompt = (promptId) => {
    const prompts = (proj.prompts || []).filter(p => p.id !== promptId);
    updateProj("prompts", prompts);
  };

  // ─── Render ───
  if (!userLoaded) return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: T.dim, fontSize: 14, fontFamily: "'Noto Sans TC', sans-serif" }}>載入中...</div>
    </div>
  );

  if (!user) return <LoginScreen />;

  if (loading) return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: T.dim, fontSize: 14, fontFamily: "'Noto Sans TC', sans-serif" }}>載入中...</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "'Noto Sans TC', sans-serif", display: "flex" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;600;700;900&family=Share+Tech+Mono&family=Instrument+Sans:wght@400;600;700&display=swap" rel="stylesheet"/>
      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideR { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
        @keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:${T.border};border-radius:2px}
        textarea::-webkit-scrollbar{width:3px}
      `}</style>

      {/* ════ SIDEBAR ════ */}
      <div style={{
        width: 260, minWidth: 260, borderRight: `1px solid ${T.border}`,
        background: T.bg1, display: "flex", flexDirection: "column", height: "100vh",
      }}>
        {/* Logo */}
        <div style={{ padding: "14px 18px 12px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg, ${T.red}, ${T.amb})`,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#fff",
              }}>▶</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.hi, fontFamily: "'Instrument Sans', sans-serif", letterSpacing: 1 }}>
                  NEXTFRAME FLOW
                </div>
                <div style={{ fontSize: 9, color: T.dim, letterSpacing: 2, fontFamily: "'Share Tech Mono', monospace" }}>
                  {readOnly ? "▶ 訪客模式" : "AI 電影流程管理"}
                </div>
              </div>
            </div>
            <UserButton />
          </div>
        </div>

        {/* New Project — owner only */}
        {isOwner && (
          <div style={{ padding: "12px 14px" }}>
            <Btn onClick={() => setShowNewDialog(true)} color={T.red} style={{ width: "100%", fontSize: 12 }}>
              ＋ 新建專案
            </Btn>
          </div>
        )}
        {readOnly && (
          <div style={{ padding: "10px 18px 8px", fontSize: 11, color: T.dim, borderBottom: `1px solid ${T.border}` }}>
            📋 共享的專案內容（唯讀）
          </div>
        )}

        {showNewDialog && (
          <div style={{ padding: "0 14px 12px", animation: "fadeIn 0.2s ease" }}>
            <Input value={newName} onChange={setNewName} placeholder="專案名稱..." style={{ marginBottom: 8, fontSize: 13 }} />
            <div style={{ display: "flex", gap: 6 }}>
              <Btn small onClick={createProject} color={T.grn} disabled={!newName.trim()}>建立</Btn>
              <Btn small ghost color={T.dim} onClick={() => { setShowNewDialog(false); setNewName(""); }}>取消</Btn>
            </div>
          </div>
        )}

        {/* Project List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {projects.length === 0 && (
            <div style={{ padding: "40px 20px", textAlign: "center", color: T.dim, fontSize: 12 }}>
              還沒有專案，點擊上方按鈕建立第一個
            </div>
          )}
          {projects.map(p => {
            const isActive = p.id === activeId;
            const doneCount = Object.values(p.status || {}).filter(s => s === "done").length;
            const isSharing = sharingId === p.id;
            return (
              <div key={p.id} onClick={() => { flushSave(); setActiveId(p.id); setActivePhase("script"); }}
                style={{
                  padding: "10px 14px 10px 18px", cursor: "pointer", transition: "all 0.15s",
                  background: isActive ? T.bg2 : "transparent",
                  borderLeft: isActive ? `2px solid ${T.red}` : "2px solid transparent",
                  borderBottom: `1px solid ${T.border}`,
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: isActive ? T.hi : T.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.shared ? <span title="已共享" style={{ color: T.grn, marginRight: 4 }}>●</span> : null}{p.name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginLeft: 6 }}>
                    {isOwner && (
                      <button
                        onClick={e => { e.stopPropagation(); toggleShare(p.id); }}
                        disabled={isSharing}
                        title={p.shared ? "取消分享" : "分享給登入用戶"}
                        style={{
                          padding: "2px 6px", fontSize: 9, fontWeight: 600, borderRadius: 4, cursor: "pointer",
                          border: `1px solid ${p.shared ? T.grn + "66" : T.muted}`,
                          background: p.shared ? T.grnG : "transparent",
                          color: p.shared ? T.grn : T.dim,
                          fontFamily: "inherit", opacity: isSharing ? 0.5 : 1,
                        }}>
                        {isSharing ? "..." : p.shared ? "● 共享中" : "📤"}
                      </button>
                    )}
                    <div style={{
                      fontSize: 9, color: T.dim, fontFamily: "'Share Tech Mono', monospace",
                      background: T.bg, padding: "2px 6px", borderRadius: 3,
                    }}>
                      {doneCount}/4
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 3, marginTop: 6 }}>
                  {PHASES.map(ph => (
                    <div key={ph.key} style={{
                      flex: 1, height: 3, borderRadius: 1,
                      background: (p.status?.[ph.key] === "done") ? ph.color :
                                  (p.status?.[ph.key] === "wip") ? T.amb + "55" : T.muted + "33",
                    }} />
                  ))}
                </div>
                <div style={{ fontSize: 10, color: T.dim, marginTop: 4 }}>
                  {new Date(p.updatedAt).toLocaleDateString("zh-TW")}
                </div>
              </div>
            );
          })}
        </div>

        {/* Export / Import + Sync */}
        <div style={{ borderTop: `1px solid ${T.border}`, padding: "10px 14px" }}>
          {isOwner && (
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <button onClick={exportAllProjects} style={{
                flex: 1, padding: "6px 0", background: T.bg2, border: `1px solid ${T.border}`,
                borderRadius: 6, color: T.text, fontSize: 10, cursor: "pointer", fontFamily: "inherit",
              }}>⬇ 匯出全部</button>
              <input ref={importFileRef} type="file" accept=".json" style={{ display: "none" }}
                onChange={e => { if (e.target.files[0]) importProjects(e.target.files[0]); e.target.value = ""; }}
              />
              <button onClick={() => importFileRef.current?.click()} style={{
                flex: 1, padding: "6px 0", background: T.bg2, border: `1px solid ${T.border}`,
                borderRadius: 6, color: T.text, fontSize: 10, cursor: "pointer", fontFamily: "inherit",
              }}>⬆ 匯入專案</button>
            </div>
          )}
          <div style={{ fontSize: 10, color: T.dim, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: saving ? T.amb : T.grn, display: "inline-block" }} />
            {saving ? "同步中..." : readOnly ? `以 ${user?.firstName || user?.emailAddresses?.[0]?.emailAddress || "訪客"} 登入` : "已同步"}
          </div>
        </div>
      </div>

      {/* ════ MAIN CONTENT ════ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>

        {!proj ? (
          /* ─── Empty State ─── */
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.15 }}>▶</div>
            <div style={{ fontSize: 16, color: T.dim, marginBottom: 8 }}>選擇或建立一個專案</div>
            <div style={{ fontSize: 12, color: T.muted }}>從左側面板開始</div>
          </div>
        ) : (
          <>
            {/* ─── Project Header ─── */}
            <div style={{
              padding: "14px 24px", borderBottom: `1px solid ${T.border}`,
              display: "flex", alignItems: "center", justifyContent: "space-between",
              background: T.bg1,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: T.hi }}>{proj.name}</h2>
                <Badge color={T.dim}>{new Date(proj.createdAt).toLocaleDateString("zh-TW")}</Badge>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {readOnly && (
                  <span style={{ fontSize: 10, color: T.grn, background: T.grnG, padding: "3px 10px", borderRadius: 5, fontWeight: 600 }}>
                    👁 唯讀
                  </span>
                )}
                {isOwner && <>
                  <Btn small ghost color={T.dim} onClick={() => {
                    const name = prompt("重新命名專案", proj.name);
                    if (name?.trim()) { updateProj("name", name.trim()); }
                  }}>重新命名</Btn>
                  <Btn small ghost color={T.red} onClick={() => deleteProject(proj.id)}>刪除</Btn>
                </>}
              </div>
            </div>

            {/* ─── Phase Tabs ─── */}
            <div style={{
              display: "flex", borderBottom: `1px solid ${T.border}`, background: T.bg1,
            }}>
              {PHASES.map(ph => {
                const isActive = activePhase === ph.key;
                const st = proj.status?.[ph.key] || "empty";
                return (
                  <div key={ph.key} onClick={() => { flushSave(); setActivePhase(ph.key); }}
                    style={{
                      flex: 1, padding: "12px 6px", textAlign: "center", cursor: "pointer",
                      borderBottom: isActive ? `2px solid ${ph.color}` : "2px solid transparent",
                      background: isActive ? ph.glow : "transparent", transition: "all 0.2s",
                    }}>
                    <div style={{ fontSize: 14, marginBottom: 1 }}>{ph.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: isActive ? 700 : 400, color: isActive ? ph.color : T.text }}>
                      {ph.label}
                    </div>
                    <div style={{
                      fontSize: 9, color: STATUS_COLORS[st],
                      fontFamily: "'Share Tech Mono', monospace", marginTop: 2,
                    }}>{STATUS_LABELS[st]}</div>
                  </div>
                );
              })}
            </div>

            {/* ─── Phase Content ─── */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 60px" }}>

              {/* ═══ SCRIPT ═══ */}
              {activePhase === "script" && (
                <div style={{ animation: "fadeIn 0.25s ease" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 15, color: T.hi }}>📝 腳本 / 劇本</h3>
                      <p style={{ margin: "3px 0 0", fontSize: 11, color: T.dim }}>貼上文字、或匯入 DOCX / Excel / PDF 檔案</p>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input ref={scriptFileRef} type="file"
                        accept=".docx,.xlsx,.xls,.pdf,.txt,.csv,.md"
                        style={{ display: "none" }}
                        onChange={e => {
                          if (e.target.files[0]) handleScriptFileImport(e.target.files[0]);
                          e.target.value = "";
                        }}
                      />
                      <Btn small outline color={T.blu} onClick={() => scriptFileRef.current?.click()}
                        disabled={importing}>
                        {importing ? "匯入中..." : "📎 匯入檔案"}
                      </Btn>
                      <select
                        value={proj.status?.script || "empty"}
                        onChange={e => updateStatus("script", e.target.value)}
                        style={{
                          background: T.bg2, color: STATUS_COLORS[proj.status?.script || "empty"],
                          border: `1px solid ${T.border}`, borderRadius: 6, padding: "4px 10px",
                          fontSize: 11, outline: "none", cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        <option value="empty">未開始</option>
                        <option value="wip">進行中</option>
                        <option value="done">已完成</option>
                      </select>
                    </div>
                  </div>

                  {/* Drop zone */}
                  <div
                    onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.blu; e.currentTarget.style.background = T.bluG; }}
                    onDragLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = "transparent"; }}
                    onDrop={e => {
                      e.preventDefault();
                      e.currentTarget.style.borderColor = T.border;
                      e.currentTarget.style.background = "transparent";
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleScriptFileImport(file);
                    }}
                    style={{
                      border: `2px dashed ${T.border}`, borderRadius: 10, padding: "14px 20px",
                      marginBottom: 12, textAlign: "center", transition: "all 0.2s",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 16,
                    }}
                  >
                    <div style={{ display: "flex", gap: 8 }}>
                      {[
                        { ext: "DOCX", color: T.blu },
                        { ext: "XLSX", color: T.grn },
                        { ext: "PDF", color: T.red },
                        { ext: "TXT", color: T.dim },
                      ].map(f => (
                        <span key={f.ext} style={{
                          fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                          background: f.color + "14", color: f.color, fontFamily: "'Share Tech Mono', monospace",
                        }}>{f.ext}</span>
                      ))}
                    </div>
                    <span style={{ fontSize: 11, color: T.dim }}>
                      拖曳檔案到此處，或點擊「匯入檔案」按鈕
                    </span>
                  </div>

                  <TArea value={proj.script || ""} onChange={v => updateProj("script", v)}
                    placeholder="在這裡貼上你的劇本、故事概念、角色描述..." rows={20} />

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    <div style={{ fontSize: 11, color: T.dim }}>
                      {(proj.script || "").length.toLocaleString()} 字
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {(proj.storyboard || []).length > 0 && (
                        <span style={{ fontSize: 11, color: T.grn }}>
                          已有 {proj.storyboard.length} 格分鏡
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Style selector + Generate */}
                  <div style={{
                    marginTop: 14, padding: "14px 16px",
                    background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10,
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: T.dim, whiteSpace: "nowrap" }}>影片風格</span>
                      <div style={{ display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", border: `1px solid ${T.border}` }}>
                        {Object.entries(STORYBOARD_STYLE_PRESETS).map(([key, preset]) => (
                          <button key={key} onClick={() => setFilmStyle(key)}
                            style={{
                              padding: "7px 16px", border: "none", cursor: "pointer",
                              fontSize: 12, fontWeight: filmStyle === key ? 700 : 400,
                              fontFamily: "inherit",
                              background: filmStyle === key ? (key === "anime" ? T.pur : T.blu) : T.bg1,
                              color: filmStyle === key ? "#fff" : T.text,
                              transition: "all 0.2s",
                            }}>
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Btn color={filmStyle === "anime" ? T.pur : T.blu} onClick={generateStoryboard}
                      disabled={analyzing || !(proj.script || "").trim()}>
                      {analyzing ? "⏳ AI 分析中..." : "🎬 AI 分析分鏡"}
                    </Btn>
                  </div>

                  {/* AI Progress */}
                  {analyzing && (
                    <div style={{ marginTop: 12, animation: "fadeIn 0.2s ease" }}>
                      <div style={{
                        width: "100%", height: 3, background: T.bg3, borderRadius: 2, overflow: "hidden",
                      }}>
                        <div style={{
                          width: `${analyzeProgress}%`, height: "100%",
                          background: `linear-gradient(90deg, ${T.pur}, ${T.blu})`,
                          transition: "width 0.5s ease", borderRadius: 2,
                        }} />
                      </div>
                      <div style={{
                        textAlign: "center", marginTop: 8, fontSize: 12, color: T.dim,
                      }}>
                        AI 正在拆解腳本為分鏡格...
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ═══ STORYBOARD ═══ */}
              {activePhase === "storyboard" && (() => {
                    const { panels, segMap, segKeys } = getSegmentGroups();
                    return (
                <div style={{ animation: "fadeIn 0.25s ease" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 15, color: T.hi }}>🎬 分鏡表</h3>
                      <p style={{ margin: "3px 0 0", fontSize: 11, color: T.dim }}>
                        按段落（每 15 秒）分組，每格可上傳分鏡圖
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Btn small outline color={T.red} onClick={exportStoryboardPDF}
                        disabled={panels.length === 0}>
                        📄 匯出 PDF
                      </Btn>
                      <Btn small outline color={T.blu} onClick={() => {
                        const inp = document.createElement("input");
                        inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
                        inp.onchange = async (e) => {
                          const files = Array.from(e.target.files || []);
                          if (!files.length) return;
                          showToast(`上傳 ${files.length} 張圖片中...`);
                          // Upload all files first, collect URLs
                          const projId = activeIdRef.current;
                          const urls = [];
                          for (const file of files) {
                            const url = await uploadToR2(projId, file);
                            urls.push(url);
                          }
                          // Then update state once using latest state
                          setProjects(prev => {
                            const id = activeIdRef.current;
                            const p = prev.find(x => x.id === id);
                            if (!p) return prev;
                            const allPanels = p.storyboard || [];
                            let emptyIdx = 0;
                            const emptyPanels = allPanels.filter(panel => !panel.image);
                            const updatedPanels = [...allPanels];
                            const newPanels = [];
                            for (const url of urls) {
                              const target = emptyPanels[emptyIdx];
                              if (target) {
                                const realIdx = updatedPanels.findIndex(panel => panel.id === target.id);
                                if (realIdx >= 0) updatedPanels[realIdx] = { ...updatedPanels[realIdx], image: url };
                                emptyIdx++;
                              } else {
                                const maxSeg = updatedPanels.reduce((m, panel) => Math.max(m, panel.segment || 1), 1);
                                newPanels.push({
                                  id: "sb_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
                                  image: url, segment: maxSeg, segmentName: "",
                                  desc: "", shotSize: "", angle: "", movement: "", duration: "", audio: "",
                                });
                              }
                            }
                            const updated = { ...p, storyboard: [...updatedPanels, ...newPanels], updatedAt: Date.now() };
                            return prev.map(x => x.id === id ? updated : x);
                          });
                          scheduleSave();
                          showToast(`✓ 已上傳 ${files.length} 張圖片`);
                        };
                        inp.click();
                      }}>
                        🖼 批量上傳
                      </Btn>
                      <select value={proj.status?.storyboard || "empty"}
                        onChange={e => updateStatus("storyboard", e.target.value)}
                        style={{
                          background: T.bg2, color: STATUS_COLORS[proj.status?.storyboard || "empty"],
                          border: `1px solid ${T.border}`, borderRadius: 6, padding: "4px 10px",
                          fontSize: 11, outline: "none", cursor: "pointer", fontFamily: "inherit",
                        }}>
                        <option value="empty">未開始</option>
                        <option value="wip">進行中</option>
                        <option value="done">已完成</option>
                      </select>
                      <Btn small color={T.pur} onClick={addSegment}>＋ 新增段落</Btn>
                    </div>
                  </div>

                  {/* Empty state */}
                  {panels.length === 0 && (
                    <div style={{
                      padding: 50, textAlign: "center", border: `2px dashed ${T.border}`, borderRadius: 12,
                    }}>
                      <div style={{ fontSize: 13, color: T.dim, marginBottom: 12 }}>尚無分鏡</div>
                      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                        <Btn small color={T.pur} onClick={() => {
                          if ((proj.script || "").trim()) { generateStoryboard(); }
                          else { setActivePhase("script"); showToast("請先輸入腳本"); }
                        }}>🎬 從腳本 AI 生成</Btn>
                        <Btn small outline color={T.pur} onClick={addSegment}>＋ 手動新增</Btn>
                      </div>
                    </div>
                  )}

                  {/* Segment groups */}
                  {segKeys.map(segNum => {
                    const seg = segMap[segNum];
                    const startSec = (segNum - 1) * 15;
                    const endSec = segNum * 15;
                    const totalDur = seg.panels.reduce((sum, p) => {
                      const n = parseFloat(p.duration) || 0;
                      return sum + n;
                    }, 0);

                    return (
                      <div key={segNum} style={{ marginBottom: 20 }}>
                        {/* Segment header */}
                        <div style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "8px 14px", background: T.purG, borderRadius: "10px 10px 0 0",
                          borderBottom: `2px solid ${T.pur}`,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{
                              background: T.pur, color: "#fff", fontSize: 11, fontWeight: 700,
                              padding: "2px 10px", borderRadius: 5, fontFamily: "'Share Tech Mono', monospace",
                            }}>SEG {segNum}</span>
                            <span style={{ fontSize: 11, color: T.dim, fontFamily: "'Share Tech Mono', monospace" }}>
                              {startSec}–{endSec}s
                            </span>
                            <input
                              value={seg.name}
                              onChange={e => {
                                const newName = e.target.value;
                                const updated = (proj.storyboard || []).map(p =>
                                  (p.segment || 1) === segNum ? { ...p, segmentName: newName } : p
                                );
                                updateProj("storyboard", updated);
                              }}
                              placeholder="段落名稱..."
                              style={{
                                background: "transparent", border: "none", borderBottom: `1px solid ${T.border}`,
                                color: T.hi, fontSize: 13, fontWeight: 600, outline: "none",
                                fontFamily: "inherit", width: 180, padding: "2px 4px",
                              }}
                            />
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 10, color: totalDur > 15 ? T.red : T.dim }}>
                              {totalDur > 0 ? `${totalDur}s / 15s` : ""}
                            </span>
                            <Btn small ghost color={T.pur} onClick={() => addStoryboardPanel(segNum)}
                              style={{ fontSize: 10 }}>＋ 加格</Btn>
                          </div>
                        </div>

                        {/* Comic panels grid */}
                        <div style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                          gap: 2, background: T.hi, padding: 2,
                          borderRadius: "0 0 10px 10px",
                        }}>
                          {seg.panels.map((panel, idx) => {
                            const globalIdx = panels.findIndex(p => p.id === panel.id);
                            return (
                            <div key={panel.id} style={{
                              background: T.bg, borderRadius: 1, overflow: "hidden",
                              display: "flex", flexDirection: "column",
                            }}>
                              {/* Panel header */}
                              <div style={{
                                padding: "3px 10px", background: T.bg2,
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                              }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, color: T.pur,
                                    fontFamily: "'Share Tech Mono', monospace",
                                  }}>
                                    S{segNum}-{String(idx + 1).padStart(2, "0")}
                                  </span>
                                  <Btn small ghost color={T.dim} onClick={() => movePanel(panel.id, -1)}
                                    style={{ padding: "1px 4px", fontSize: 9, lineHeight: 1 }}
                                    title="往前移">◀</Btn>
                                  <Btn small ghost color={T.dim} onClick={() => movePanel(panel.id, 1)}
                                    style={{ padding: "1px 4px", fontSize: 9, lineHeight: 1 }}
                                    title="往後移">▶</Btn>
                                </div>
                                <Btn small ghost color={T.dim} onClick={() => removePanel(panel.id)}
                                  style={{ padding: "1px 5px", fontSize: 9 }}>✕</Btn>
                              </div>

                              {/* Image */}
                              <div onClick={() => {
                                const inp = document.createElement("input");
                                inp.type = "file"; inp.accept = "image/*";
                                inp.onchange = e => handlePanelImage(panel.id, e.target.files[0]);
                                inp.click();
                              }} style={{
                                aspectRatio: "16/9", background: panel.image ? "none" : T.bg1,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                cursor: "pointer", overflow: "hidden", position: "relative",
                              }}>
                                {panel.image ? (
                                  <>
                                    <img src={panel.image} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    <div style={{
                                      position: "absolute", bottom: 3, right: 3,
                                      background: "rgba(0,0,0,0.55)", color: "#fff",
                                      fontSize: 8, padding: "2px 6px", borderRadius: 3, fontWeight: 600,
                                    }}>替換</div>
                                  </>
                                ) : (
                                  <div style={{ textAlign: "center", color: T.muted }}>
                                    <div style={{ fontSize: 20, marginBottom: 2 }}>🖼</div>
                                    <div style={{ fontSize: 9 }}>上傳圖片</div>
                                  </div>
                                )}
                              </div>

                              {/* Info */}
                              <div style={{ padding: "6px 8px" }}>
                                <textarea value={panel.desc}
                                  onChange={e => updatePanel(panel.id, "desc", e.target.value)}
                                  placeholder="畫面描述..." rows={2}
                                  style={{
                                    width: "100%", boxSizing: "border-box", background: "transparent",
                                    border: "none", color: T.text, fontSize: 11, lineHeight: 1.5,
                                    resize: "none", outline: "none", fontFamily: "inherit",
                                  }}
                                />
                                <div style={{ display: "flex", gap: 3, marginTop: 3, flexWrap: "wrap" }}>
                                  {[
                                    { field: "shotSize", ph: "景別" },
                                    { field: "angle", ph: "角度" },
                                    { field: "movement", ph: "運鏡" },
                                    { field: "duration", ph: "秒數" },
                                  ].map(({ field, ph }) => (
                                    <input key={field} value={panel[field] || ""}
                                      onChange={e => updatePanel(panel.id, field, e.target.value)}
                                      placeholder={ph}
                                      style={{
                                        flex: 1, minWidth: 46, background: T.bg1, border: `1px solid ${T.border}`,
                                        borderRadius: 3, padding: "2px 5px", color: T.text, fontSize: 9,
                                        outline: "none", fontFamily: "inherit",
                                      }}
                                    />
                                  ))}
                                </div>
                                <input value={panel.audio || ""}
                                  onChange={e => updatePanel(panel.id, "audio", e.target.value)}
                                  placeholder="🔊 對白 / 音效..."
                                  style={{
                                    width: "100%", boxSizing: "border-box", marginTop: 3,
                                    background: T.bg1, border: `1px solid ${T.border}`,
                                    borderRadius: 3, padding: "2px 5px", color: T.text, fontSize: 9,
                                    outline: "none", fontFamily: "inherit",
                                  }}
                                />
                              </div>
                            </div>
                          )})}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ); })()}

              {/* ═══ ASSETS ═══ */}
              {activePhase === "assets" && (
                <div style={{ animation: "fadeIn 0.25s ease" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 15, color: T.hi }}>◈ 素材管理</h3>
                      <p style={{ margin: "3px 0 0", fontSize: 11, color: T.dim }}>從腳本 AI 提取角色、場景、道具，或手動新增</p>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Btn small color={T.amb} onClick={generateAssets}
                        disabled={genAssetsLoading || !(proj.script || "").trim()}>
                        {genAssetsLoading ? "⏳ AI 提取中..." : "◈ 從腳本 AI 提取"}
                      </Btn>
                      <select value={proj.status?.assets || "empty"}
                        onChange={e => updateStatus("assets", e.target.value)}
                        style={{
                          background: T.bg2, color: STATUS_COLORS[proj.status?.assets || "empty"],
                          border: `1px solid ${T.border}`, borderRadius: 6, padding: "4px 10px",
                          fontSize: 11, outline: "none", cursor: "pointer", fontFamily: "inherit",
                        }}>
                        <option value="empty">未開始</option>
                        <option value="wip">進行中</option>
                        <option value="done">已完成</option>
                      </select>
                    </div>
                  </div>

                  {/* AI Progress */}
                  {genAssetsLoading && (
                    <div style={{ marginBottom: 16, animation: "fadeIn 0.2s ease" }}>
                      <div style={{ width: "100%", height: 3, background: T.bg3, borderRadius: 2, overflow: "hidden" }}>
                        <div style={{
                          width: `${genAssetsProgress}%`, height: "100%",
                          background: `linear-gradient(90deg, ${T.amb}, ${T.red})`,
                          transition: "width 0.5s ease", borderRadius: 2,
                        }} />
                      </div>
                      <div style={{ textAlign: "center", marginTop: 8, fontSize: 12, color: T.dim }}>
                        AI 正在分析腳本，提取角色、場景、道具...
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {!(proj.assets?.characters?.length || proj.assets?.scenes?.length || proj.assets?.props?.length) && !genAssetsLoading && (
                    <div style={{
                      padding: "40px 0", textAlign: "center", border: `2px dashed ${T.border}`, borderRadius: 10,
                      marginBottom: 16,
                    }}>
                      <div style={{ fontSize: 13, color: T.dim, marginBottom: 12 }}>尚無素材</div>
                      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                        <Btn small color={T.amb} onClick={() => {
                          if ((proj.script || "").trim()) { generateAssets(); }
                          else { setActivePhase("script"); showToast("請先輸入腳本"); }
                        }}>◈ 從腳本 AI 提取</Btn>
                        <Btn small outline color={T.amb} onClick={() => { addAsset("characters"); addAsset("scenes"); }}>
                          ＋ 手動新增
                        </Btn>
                      </div>
                    </div>
                  )}

                  {[
                    { type: "characters", label: "🎭 角色", color: T.pur },
                    { type: "scenes", label: "🌆 場景", color: T.cyn },
                    { type: "props", label: "⚙️ 道具", color: T.amb },
                  ].map(({ type, label, color }) => (
                    <div key={type} style={{ marginBottom: 24 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color }}>{label}</div>
                        <Btn small color={color} onClick={() => addAsset(type)}>＋ 新增</Btn>
                      </div>
                      <div style={{
                        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10,
                      }}>
                        {(proj.assets?.[type] || []).map(asset => (
                          <div key={asset.id} style={{
                            background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10,
                            overflow: "hidden",
                          }}>
                            {/* Asset image */}
                            <div
                              onClick={() => {
                                const inp = document.createElement("input");
                                inp.type = "file"; inp.accept = "image/*";
                                inp.onchange = e => handleAssetImage(type, asset.id, e.target.files[0]);
                                inp.click();
                              }}
                              style={{
                                aspectRatio: type === "characters" ? "2/3" : type === "scenes" ? "16/9" : "1/1",
                                background: asset.image ? "none" : T.bg, cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                overflow: "hidden",
                              }}>
                              {asset.image ? (
                                <img src={asset.image} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              ) : (
                                <div style={{ color: T.dim, fontSize: 11, textAlign: "center" }}>
                                  <div style={{ fontSize: 18, marginBottom: 4 }}>🖼</div>
                                  點擊上傳
                                </div>
                              )}
                            </div>
                            <div style={{ padding: "8px 10px" }}>
                              <input
                                value={asset.name} onChange={e => updateAsset(type, asset.id, "name", e.target.value)}
                                placeholder="名稱..." style={{
                                  width: "100%", boxSizing: "border-box", background: "transparent",
                                  border: "none", borderBottom: `1px solid ${T.border}`, color: T.hi,
                                  fontSize: 13, fontWeight: 600, padding: "4px 0", outline: "none",
                                  fontFamily: "inherit",
                                }}
                              />
                              <textarea
                                value={asset.desc} onChange={e => updateAsset(type, asset.id, "desc", e.target.value)}
                                placeholder="描述..." rows={2}
                                style={{
                                  width: "100%", boxSizing: "border-box", background: "transparent",
                                  border: "none", color: T.text, fontSize: 11, lineHeight: 1.6,
                                  resize: "none", outline: "none", marginTop: 4, fontFamily: "inherit",
                                }}
                              />
                              <div style={{ textAlign: "right", marginTop: 4 }}>
                                <Btn small ghost color={T.dim} onClick={() => removeAsset(type, asset.id)}
                                  style={{ fontSize: 10, padding: "2px 6px" }}>刪除</Btn>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {(proj.assets?.[type] || []).length === 0 && (
                        <div style={{
                          padding: "24px 0", textAlign: "center", color: T.dim, fontSize: 11,
                          border: `1px dashed ${T.border}`, borderRadius: 8,
                        }}>尚無{label.split(" ")[1]}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ═══ PROMPT ═══ */}
              {activePhase === "prompt" && (
                <div style={{ animation: "fadeIn 0.25s ease" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 15, color: T.hi }}>⚡ Seedance 2.0 Prompt</h3>
                      <p style={{ margin: "3px 0 0", fontSize: 11, color: T.dim }}>
                        從分鏡表 AI 生成，或手動編輯每段提示詞
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Btn small color={T.red} onClick={generatePrompts}
                        disabled={genPromptLoading || !(proj.storyboard || []).length}>
                        {genPromptLoading ? "⏳ AI 生成中..." : "⚡ 從分鏡表 AI 生成"}
                      </Btn>
                      <select value={proj.status?.prompt || "empty"}
                        onChange={e => updateStatus("prompt", e.target.value)}
                        style={{
                          background: T.bg2, color: STATUS_COLORS[proj.status?.prompt || "empty"],
                          border: `1px solid ${T.border}`, borderRadius: 6, padding: "4px 10px",
                          fontSize: 11, outline: "none", cursor: "pointer", fontFamily: "inherit",
                        }}>
                        <option value="empty">未開始</option>
                        <option value="wip">進行中</option>
                        <option value="done">已完成</option>
                      </select>
                      <Btn small outline color={T.pur} onClick={addPrompt}>＋ 手動新增</Btn>
                      {(proj.prompts || []).length > 0 && (
                        <Btn small outline color={T.dim} onClick={() => {
                          const all = (proj.prompts || []).map((p, i) =>
                            `--- #${String(i+1).padStart(2,"0")} ${p.title} ---\n[ZH]\n${p.zh}\n\n[EN]\n${p.en}`
                          ).join("\n\n");
                          copyText(all); showToast("已複製全部 Prompt");
                        }}>複製全部</Btn>
                      )}
                    </div>
                  </div>

                  {/* AI Progress */}
                  {genPromptLoading && (
                    <div style={{ marginBottom: 16, animation: "fadeIn 0.2s ease" }}>
                      <div style={{ width: "100%", height: 3, background: T.bg3, borderRadius: 2, overflow: "hidden" }}>
                        <div style={{
                          width: `${genPromptProgress}%`, height: "100%",
                          background: `linear-gradient(90deg, ${T.red}, ${T.amb})`,
                          transition: "width 0.5s ease", borderRadius: 2,
                        }} />
                      </div>
                      <div style={{ textAlign: "center", marginTop: 8, fontSize: 12, color: T.dim }}>
                        AI 正在分析分鏡表並生成 Seedance 2.0 提示詞...
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {(proj.prompts || []).length === 0 && !genPromptLoading && (
                    <div style={{
                      padding: "40px 0", textAlign: "center", border: `2px dashed ${T.border}`, borderRadius: 10,
                    }}>
                      <div style={{ fontSize: 13, color: T.dim, marginBottom: 12 }}>尚無 Prompt</div>
                      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                        <Btn small color={T.red} onClick={() => {
                          if ((proj.storyboard || []).length > 0) { generatePrompts(); }
                          else { setActivePhase("storyboard"); showToast("請先建立分鏡表"); }
                        }}>⚡ 從分鏡表 AI 生成</Btn>
                        <Btn small outline color={T.pur} onClick={addPrompt}>＋ 手動新增</Btn>
                      </div>
                    </div>
                  )}

                  {(proj.prompts || []).map((pm, idx) => (
                    <div key={pm.id} style={{
                      background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10,
                      marginBottom: 12, overflow: "hidden", animation: "fadeIn 0.2s ease",
                    }}>
                      {/* Header */}
                      <div style={{
                        padding: "10px 14px", background: T.card,
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        borderBottom: `1px solid ${T.border}`,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{
                            background: T.red, color: "#fff", fontSize: 10, fontWeight: 700,
                            padding: "2px 8px", borderRadius: 4, fontFamily: "'Share Tech Mono', monospace",
                          }}>#{String(idx + 1).padStart(2, "0")}</span>
                          <input value={pm.title} onChange={e => updatePrompt(pm.id, "title", e.target.value)}
                            placeholder="段落標題..."
                            style={{
                              background: "transparent", border: "none", color: T.hi,
                              fontSize: 13, fontWeight: 600, outline: "none", fontFamily: "inherit", width: 200,
                            }} />
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <Btn small ghost color={T.dim} onClick={() => {
                            copyText(`[ZH]\n${pm.zh}\n\n[EN]\n${pm.en}`);
                            showToast("已複製");
                          }}>複製</Btn>
                          <Btn small ghost color={T.red} onClick={() => removePrompt(pm.id)}
                            style={{ fontSize: 10 }}>✕</Btn>
                        </div>
                      </div>

                      <div style={{ padding: 14 }}>
                        {/* Upload guide */}
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 10, color: T.amb, fontWeight: 600, marginBottom: 4 }}>
                            素材上傳指引
                          </div>
                          <textarea value={pm.upload} onChange={e => updatePrompt(pm.id, "upload", e.target.value)}
                            placeholder="@圖片1：角色參考圖..." rows={2}
                            style={{
                              width: "100%", boxSizing: "border-box", background: T.bg,
                              border: `1px solid ${T.border}`, borderRadius: 6, padding: 8,
                              color: T.text, fontSize: 11, resize: "none", outline: "none",
                              fontFamily: "'Noto Sans TC', monospace", lineHeight: 1.6,
                            }} />
                        </div>

                        {/* ZH prompt */}
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 10, color: T.blu, fontWeight: 600, marginBottom: 4 }}>
                            [ZH] 中文提示詞
                          </div>
                          <textarea value={pm.zh} onChange={e => updatePrompt(pm.id, "zh", e.target.value)}
                            placeholder="中文 Seedance 2.0 提示詞..." rows={5}
                            style={{
                              width: "100%", boxSizing: "border-box", background: T.bg,
                              border: `1px solid ${T.border}`, borderRadius: 6, padding: 10,
                              color: T.text, fontSize: 12, resize: "vertical", outline: "none",
                              fontFamily: "'Share Tech Mono', 'Noto Sans TC', monospace", lineHeight: 1.8,
                            }} />
                        </div>

                        {/* EN prompt */}
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 10, color: T.grn, fontWeight: 600, marginBottom: 4 }}>
                            [EN] 英文提示詞
                          </div>
                          <textarea value={pm.en} onChange={e => updatePrompt(pm.id, "en", e.target.value)}
                            placeholder="英文 Seedance 2.0 提示詞..." rows={5}
                            style={{
                              width: "100%", boxSizing: "border-box", background: T.bg,
                              border: `1px solid ${T.border}`, borderRadius: 6, padding: 10,
                              color: T.text, fontSize: 12, resize: "vertical", outline: "none",
                              fontFamily: "'Share Tech Mono', monospace", lineHeight: 1.8,
                            }} />
                        </div>

                        {/* Bridge */}
                        <div>
                          <div style={{ fontSize: 10, color: T.amb, fontWeight: 600, marginBottom: 4 }}>
                            銜接建議
                          </div>
                          <input value={pm.bridge} onChange={e => updatePrompt(pm.id, "bridge", e.target.value)}
                            placeholder="下一段銜接方式..."
                            style={{
                              width: "100%", boxSizing: "border-box", background: T.bg,
                              border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px",
                              color: T.text, fontSize: 11, outline: "none", fontFamily: "inherit",
                            }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Export Modal */}
      {exportData && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        }} onClick={() => setExportData(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 14,
            padding: 24, width: "90%", maxWidth: 560, maxHeight: "80vh",
            display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.hi }}>匯出專案資料</div>
              <Btn small ghost color={T.dim} onClick={() => setExportData(null)}>✕</Btn>
            </div>
            <p style={{ fontSize: 11, color: T.dim, margin: "0 0 10px" }}>
              全選下方內容 → 複製 → 到部署版本的「匯入」貼上，或存成 .json 檔
            </p>
            <textarea
              readOnly
              value={exportData}
              onFocus={e => e.target.select()}
              style={{
                flex: 1, minHeight: 200, width: "100%", boxSizing: "border-box",
                background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8,
                padding: 12, color: T.text, fontSize: 11, lineHeight: 1.5,
                fontFamily: "'Share Tech Mono', monospace", resize: "none", outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <Btn small color={T.blu} onClick={() => {
                copyText(exportData);
                showToast("✓ 已複製到剪貼簿");
              }}>📋 複製全部</Btn>
              <Btn small outline color={T.dim} onClick={() => setExportData(null)}>關閉</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: T.bg3, border: `1px solid ${T.borderL}`, borderRadius: 8,
          padding: "8px 20px", color: T.hi, fontSize: 12, fontWeight: 500,
          animation: "fadeIn 0.2s ease", zIndex: 999, boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
        }}>{toast}</div>
      )}
    </div>
  );
}
