import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { classifyIntent } from "./intent";
import { runAction } from "./actions";
import { track } from "./metrics";

const ROOT_ID = "assistant-dock-root";
const POS_KEY = "taedal:assistant:pos";
const OPEN_KEY = "taedal:assistant:open";

function ensurePortalRoot(): HTMLElement {
  let el = document.getElementById(ROOT_ID) as HTMLElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = ROOT_ID;
    Object.assign(el.style, {
      position: "fixed",
      zIndex: "2147483647",
      inset: "auto 0 0 auto",
      pointerEvents: "none",
    } as CSSStyleDeclaration);
    document.body.appendChild(el);
  }
  return el;
}

type Pos = { x: number; y: number };

// -------------------- helpers --------------------
function clamp(n: number, a: number, b: number) { return Math.min(Math.max(n, a), b); }
const uniq = <T,>(arr: T[]) => Array.from(new Set(arr));

// Expand a prompt into multiple keyword combos to improve hit rate for any text
function expandKeywords(prompt: string): string[] {
  const base = prompt.toLowerCase().trim();
  if (!base) return ["art texture"];

  // split to words, drop tiny connectors
  const words = base
    .replace(/[^\w\s-]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 1 && !["a","an","the","and","or","of","in","on","at","to","for","with","by"].includes(w));

  // synonyms / normalizations
  const map: Record<string,string[]> = {
    batman: ["batman", "dark knight", "gotham"],
    sunny: ["sunny", "sunlight", "bright"],
    sea: ["sea", "ocean", "coast", "shore", "waves"],
    beach: ["beach", "sand", "coast"],
    city: ["city", "urban", "downtown", "street"],
    night: ["night", "nocturne", "neon"],
    cyberpunk: ["cyberpunk", "neon", "futuristic", "rainy city"],
    pastel: ["pastel", "soft colors", "muted"],
    moody: ["moody", "dramatic", "low key"],
    fantasy: ["fantasy", "mythic", "epic"],
    portrait: ["portrait", "face", "headshot"],
    landscape: ["landscape", "scenery", "vista"],
    character: ["character", "figure", "hero"],
  };

  // make buckets of alternatives (first item keeps original word)
  const buckets = words.map(w => map[w] ? [w, ...map[w]] : [w]);

  // build a small set of combinations (up to 4 terms each)
  const combos: string[] = [];
  for (let i = 0; i < buckets.length; i++) {
    for (let j = i + 1; j <= Math.min(i + 3, buckets.length - 1); j++) {
      const a = buckets[i][0];
      const b = buckets[j][0];
      combos.push(`${a} ${b}`);
      // mix with synonyms
      if (buckets[i].length > 1) combos.push(`${buckets[i][1]} ${b}`);
      if (buckets[j].length > 1) combos.push(`${a} ${buckets[j][1]}`);
    }
  }

  // always include original, and a few generic art terms for safety
  const safety = [
    `${base} art`,
    `${base} photography`,
    `${base} texture`,
    `${base} illustration`,
  ];

  return uniq([base, ...combos, ...safety]).slice(0, 12);
}

// Build a list of Unsplash Source URLs that will almost always return relevant images
function moodboardSources(prompt: string, n = 10): string[] {
  const variants = expandKeywords(prompt);
  // rotate through variants; add a seed to ensure different images
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const q = variants[i % variants.length];
    const safe = encodeURIComponent(q);
    out.push(`https://source.unsplash.com/featured/720x480?${safe}&sig=${i + 7}`);
  }
  return out;
}

// Palette suggestions (fallback; optional)
const PALETTES: Record<string, string[]> = {
  cyberpunk: ["#0ff", "#f0f", "#ff0066", "#1a1a1a", "#111111"],
  moody: ["#0b0d0f", "#2b2f36", "#44546a", "#8a99a6", "#d9d9d9"],
  nature: ["#1b4332", "#2d6a4f", "#95d5b2", "#e9f5db", "#1c1c1c"],
  pastel: ["#fde2e4", "#fad2e1", "#e2ece9", "#bee1e6", "#cddafd"],
  neon: ["#2dfcc2", "#00e5ff", "#ff4dff", "#12051e", "#0b0f1a"],
};
function pickPalette(prompt: string) {
  const p = prompt.toLowerCase();
  const k = Object.keys(PALETTES).find(k => p.includes(k));
  return k ? PALETTES[k] : ["#111", "#333", "#777", "#aaa", "#ddd"];
}

// Price coach (simple demo heuristics)
function priceCoach(params: { sizeIn: "S"|"M"|"L"; baseMinutes: number; followers: number; pastAvg?: number; scarcity: "1/1"|"editions"; }) {
  const sizeFactor = params.sizeIn === "L" ? 1.6 : params.sizeIn === "M" ? 1.25 : 1.0;
  const timeFactor = 0.6 + Math.min(1.4, params.baseMinutes / 240);
  const socialFactor = 0.9 + Math.min(1.6, Math.log10(Math.max(10, params.followers)) / 2);
  const anchor = params.pastAvg && params.pastAvg > 0 ? params.pastAvg : 120;
  const one = params.scarcity === "1/1";
  let suggested = anchor * sizeFactor * timeFactor * socialFactor * (one ? 1.35 : 0.95);
  suggested = Math.round(suggested / 5) * 5;
  const editions = one ? 1 : (params.sizeIn === "L" ? 20 : params.sizeIn === "M" ? 35 : 50);
  const editionPrice = one ? suggested : Math.max(15, Math.round((suggested * 0.35) / 5) * 5);
  const reserve = one ? Math.max(50, Math.round((suggested * 0.6) / 5) * 5) : undefined;
  return {
    suggested, editions, editionPrice, reserve,
    notes: [
      one ? "1/1 premium applied (+35%)." : "Edition pricing at ~35% of 1/1 anchor.",
      `Time factor considers ~${params.baseMinutes} min of work.`,
      `Size factor: ${params.sizeIn} (${sizeFactor}x), Social factor: ~${socialFactor.toFixed(2)}x.`,
      params.pastAvg ? `Anchored to past avg sale: ${params.pastAvg}.` : "No past avg sale; used category baseline.",
    ]
  };
}

function critiqueChecklist(goal: string, style: string) {
  return [
    `**Composition:** Clear focal hierarchy. Try trimming negative space by 6–10% if focus is weak.`,
    `**Values:** Boost midtone contrast 8–12% to separate planes. Squint test: does silhouette read?`,
    `**Edges:** In ${style}, keep edge variety—soften 30–40% of non-focal edges.`,
    `**Color:** Limit to ~3 dominant hues. ${goal.includes("print") ? "Preview CMYK-safe" : "Check sRGB"} before export.`,
    `**Texture:** Add unifying grain at 8–12% opacity to tie layers.`,
    `**Typography:** If present, increase tracking +4–8 and align to an 8px baseline grid.`,
    `**Export:** Sharpen radius 0.3–0.5px. Web @2x; print at 300DPI.`,
  ];
}

// -------------------------------------------------

export default function AssistantDock() {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setRoot(ensurePortalRoot());
    const mo = new MutationObserver(() => {
      if (!document.getElementById(ROOT_ID)) setRoot(ensurePortalRoot());
    });
    mo.observe(document.body, { childList: true });
    return () => mo.disconnect();
  }, []);

  const [open, setOpen] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem(OPEN_KEY) || "false"); } catch { return false; }
  });
  const [pos, setPos] = useState<Pos>(() => {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || '{"x":16,"y":16}'); } catch { return { x:16, y:16 }; }
  });
  useEffect(() => { localStorage.setItem(OPEN_KEY, JSON.stringify(open)); }, [open]);
  useEffect(() => { localStorage.setItem(POS_KEY, JSON.stringify(pos)); }, [pos]);

  // drag bubble
  const drag = useRef<{ startX:number; startY:number; origin:Pos }|null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    try {(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);} catch {}
    drag.current = { startX: e.clientX, startY: e.clientY, origin: { ...pos } };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    const vw = window.innerWidth, vh = window.innerHeight;
    setPos({
      x: clamp(drag.current.origin.x - dx, 8, vw - 64),
      y: clamp(drag.current.origin.y - dy, 8, vh - 64),
    });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    try {(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);} catch {}
    drag.current = null;
    setPos(p => ({
      x: p.x < window.innerWidth / 2 ? 16 : window.innerWidth - 64,
      y: clamp(p.y, 16, window.innerHeight - 64),
    }));
  };

  const bubbleBox: React.CSSProperties = useMemo(
    () => ({ position: "fixed", right: pos.x, bottom: pos.y, zIndex: 2147483647, pointerEvents: "auto" }),
    [pos]
  );

  // intent
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  // tools
  type ToolTab = "none" | "mood" | "critique" | "pricing";
  const [tool, setTool] = useState<ToolTab>("none");

  // moodboard state
  const [moodPrompt, setMoodPrompt] = useState("batman sunny sea");
  const [moodImgs, setMoodImgs] = useState<string[]>([]);
  const moodPalette = useMemo(() => pickPalette(moodPrompt), [moodPrompt]);

  // critique state
  const [critGoal, setCritGoal] = useState("print drop");
  const [critStyle, setCritStyle] = useState("digital painting");
  const [critNotes, setCritNotes] = useState<string[]>([]);

  // pricing state
  const [sizeIn, setSizeIn] = useState<"S"|"M"|"L">("M");
  const [minutes, setMinutes] = useState<number>(120);
  const [followers, setFollowers] = useState<number>(2500);
  const [pastAvg, setPastAvg] = useState<number | undefined>(undefined);
  const [scarcity, setScarcity] = useState<"1/1"|"editions">("1/1");
  const [pricing, setPricing] = useState<ReturnType<typeof priceCoach> | null>(null);

  async function handleRun(text: string) {
    const lower = (text || "").toLowerCase();

    if (/(moodboard|mood board|palette|references?)/.test(lower)) { setTool("mood"); setStatus(""); return; }
    if (/(critique|review|checklist|feedback)/.test(lower)) { setTool("critique"); setStatus(""); return; }
    if (/(price|pricing|coach|how much)/.test(lower)) { setTool("pricing"); setStatus(""); return; }

    const action = classifyIntent(text);
    track("assistant_command", { text, action: (action as any)?.type ?? "NONE", route: location.pathname, ok: action.type !== "NONE" });

    if (action.type === "NONE") { setStatus('Try: “price coach”, “moodboard”, “critique”, or “light theme”.'); return; }
    if (action.type === "NAVIGATE" && !confirm(`Go to ${action.to}?`)) return;

    setStatus("Running…");
    await runAction(action);
    setStatus("Done.");
    setTimeout(() => setStatus(""), 900);
  }

  // videos
  const bubbleVideoSrc = [
    { src: "/images/chatbot.webm", type: "video/webm" },
    { src: "/images/chatbot.mp4",  type: "video/mp4"  },
  ];
  const heroRef = useRef<HTMLVideoElement | null>(null);
  const titleAvatarRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const vids = [heroRef.current, titleAvatarRef.current].filter(Boolean) as HTMLVideoElement[];
    if (open) {
      vids.forEach(v => { try { v.currentTime = 0; v.play().catch(() => {}); } catch {} });
    } else {
      vids.forEach(v => { try { v.pause(); } catch {} });
    }
  }, [open]);

  if (!root) return null;

  // styles
  const panelStyle: React.CSSProperties = {
    position: "fixed",
    right: (bubbleBox.right as number) + 68,
    bottom: bubbleBox.bottom,
    zIndex: 2147483647,
    pointerEvents: "auto",
    background: "var(--assistant-panel-bg, rgba(12,12,12,0.94))",
    border: "1px solid var(--assistant-panel-border, rgba(255,255,255,0.14))",
    borderRadius: 24,
    boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
    color: "var(--assistant-panel-fg, #fff)",
    width: Math.min(440, window.innerWidth - 24),
    overflow: "hidden",
  };

  // scrollable body (header video fixed)
  const bodyStyle: React.CSSProperties = {
    padding: 16,
    maxHeight: "min(70vh, 560px)",
    overflowY: "auto",
  };

  return createPortal(
    <>
      {/* Bubble */}
      <button
        aria-label="Open taedal assistant"
        title="Taedal Assistant"
        onClick={() => setOpen(v => !v)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          ...bubbleBox,
          height: 56, width: 56, borderRadius: 9999,
          border: "1px solid rgba(255,255,255,0.18)",
          background: "rgba(17,17,17,0.5)",
          boxShadow: "0 10px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06) inset",
          display: "grid", placeItems: "center", overflow: "hidden", outline: 0,
        }}
      >
        <video className="assistant-bot-video key-black mask-soft" autoPlay loop muted playsInline preload="metadata"
          style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}>
          {bubbleVideoSrc.map(s => <source key={s.src} src={s.src} type={s.type} />)}
        </video>
        <span className="assistant-bot-fallback" role="img" aria-label="assistant" style={{ pointerEvents: "none" }}>🦊</span>
      </button>

      {/* Panel */}
      {open && (
        <div role="dialog" aria-label="Taedal assistant" style={panelStyle}>
          {/* HERO */}
          <div style={{ position: "relative", background: "#0a0a0a" }}>
            <video ref={heroRef} className="key-black" autoPlay loop muted playsInline preload="metadata"
              style={{ width: "100%", height: 380, objectFit: "cover", display: "block" }}>
              {bubbleVideoSrc.map(s => <source key={s.src} src={s.src} type={s.type} />)}
            </video>

            {/* pinned logo */}
            <img src="/images/taedal-static.svg" alt="taedal"
              style={{ position: "absolute", top: 8, left: 8, height: 22, width: 22, zIndex: 2,
                filter: "drop-shadow(0 1px 2px rgba(0,0,0,.5))", pointerEvents: "auto", userSelect: "none" }} />

            {/* close */}
            <button onClick={() => setOpen(false)}
              style={{ position: "absolute", top: 8, right: 8, zIndex: 2, background: "rgba(0,0,0,0.55)",
                border: "1px solid rgba(255,255,255,0.2)", color: "#fff", width: 28, height: 28,
                borderRadius: 9999, display: "grid", placeItems: "center", pointerEvents: "auto", lineHeight: 1 }}
              aria-label="Close assistant" title="Close">✕</button>
          </div>

          {/* BODY (scrollable) */}
          <div style={bodyStyle}>
            {/* Title Row */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, marginBottom: 8 }}>
              <div style={{ height: 36, width: 36, borderRadius: 9999, overflow: "hidden",
                border: "1px solid var(--assistant-avatar-border, rgba(255,255,255,0.2))", background: "rgba(255,255,255,0.02)" }}>
                <video ref={titleAvatarRef} className="key-black" autoPlay loop muted playsInline preload="metadata"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}>
                  {[
                    { src: "/images/chatbot.webm", type: "video/webm" as const },
                    { src: "/images/chatbot.mp4", type: "video/mp4" as const },
                  ].map(s => <source key={s.src} src={s.src} type={s.type} />)}
                </video>
              </div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>쿠로</div>
            </div>

            <p style={{ fontSize: 12, color: "var(--assistant-hint, #bbb)", margin: "0 0 10px" }}>
              Try: “price coach”, “moodboard”, “critique”, “light theme”, “go to account”, “tour”.
            </p>

            {/* Quick actions */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <button className="assistant-action" onClick={() => runAction({ type: "TOGGLE_THEME", mode: "light" })}>Light theme</button>
              <button className="assistant-action" onClick={() => runAction({ type: "TOGGLE_THEME", mode: "dark" })}>Dark theme</button>
              <button className="assistant-action" onClick={() => handleRun("go to account")}>Go to Account</button>
              <button className="assistant-action" onClick={() => handleRun("tour")}>Start tour</button>
            </div>

            {/* TOOL TABS */}
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {[
                ["none", "Shortcuts"],
                ["mood", "Moodboard"],
                ["critique", "Critique"],
                ["pricing", "Price coach"],
              ].map(([key, label]) => (
                <button key={key}
                  onClick={() => setTool(key as any)}
                  style={{
                    padding: "6px 10px", borderRadius: 999,
                    border: "1px solid rgba(255,255,255,.16)",
                    background: tool === key ? "rgba(255,255,255,.12)" : "transparent",
                    color: "#fff", fontSize: 12
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {/* TOOLS */}
            {tool === "mood" && (
              <div className="card" style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Moodboard from prompt</div>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const list = moodboardSources(moodPrompt, 10);
                  setMoodImgs(list);
                  track("assistant_command", { tool: "moodboard", prompt: moodPrompt, variants: expandKeywords(moodPrompt) });
                }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                    <input
                      value={moodPrompt}
                      onChange={(e)=>setMoodPrompt(e.target.value)}
                      placeholder='e.g. "batman sunny sea", "pastel cafe at dawn"'
                      style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,.12)", background: "rgba(24,24,24,.9)", color:"#fff" }}
                    />
                    <button className="assistant-action" type="submit">Make</button>
                  </div>
                </form>

                {moodImgs.length > 0 && (
                  <>
                    <div style={{ marginTop: 10, marginBottom: 6, fontSize: 12, color:"#bbb" }}>Palette suggestion</div>
                    <div style={{ display:"flex", gap:6, marginBottom: 10 }}>
                      {moodPalette.map((c,i)=>(
                        <div key={i} style={{ width: 28, height: 18, borderRadius: 6, background: c, border:"1px solid rgba(0,0,0,.3)"}} title={c}/>
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {moodImgs.map((src,i)=>(
                        <div key={i} style={{ borderRadius: 10, overflow:"hidden", border:"1px solid rgba(255,255,255,.12)" }}>
                          <img src={src} alt={`mood ${i}`} loading="lazy" style={{ width:"100%", height: 140, objectFit:"cover", display:"block" }}/>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {tool === "critique" && (
              <div className="card" style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Portfolio critique checklist</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize:12, color:"#bbb", marginBottom:4 }}>Goal</div>
                    <select value={critGoal} onChange={(e)=>setCritGoal(e.target.value)} style={{ width:"100%", padding:"10px 12px", borderRadius:10, background:"rgba(24,24,24,.9)", border:"1px solid rgba(255,255,255,.12)"}}>
                      <option>print drop</option>
                      <option>web release</option>
                      <option>gallery submission</option>
                      <option>commission pitch</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize:12, color:"#bbb", marginBottom:4 }}>Style</div>
                    <select value={critStyle} onChange={(e)=>setCritStyle(e.target.value)} style={{ width:"100%", padding:"10px 12px", borderRadius:10, background:"rgba(24,24,24,.9)", border:"1px solid rgba(255,255,255,.12)"}}>
                      <option>digital painting</option>
                      <option>line art</option>
                      <option>photobash</option>
                      <option>3D render</option>
                    </select>
                  </div>
                </div>
                <button className="assistant-action" onClick={()=>{
                  const notes = critiqueChecklist(critGoal, critStyle);
                  setCritNotes(notes);
                  track("assistant_command", { tool: "critique", goal: critGoal, style: critStyle });
                }}>Make checklist</button>

                {critNotes.length>0 && (
                  <ul style={{ marginTop: 10, paddingLeft: 18, display:"grid", gap:8 }}>
                    {critNotes.map((n,i)=> <li key={i} style={{ lineHeight:1.35 }}>{n}</li>)}
                  </ul>
                )}
              </div>
            )}

            {tool === "pricing" && (
              <div className="card" style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Price coach</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap: 8 }}>
                  <div>
                    <div style={{ fontSize:12, color:"#bbb", marginBottom:4 }}>Size</div>
                    <select value={sizeIn} onChange={(e)=>setSizeIn(e.target.value as "S"|"M"|"L")}
                      style={{ width:"100%", padding:"10px 12px", borderRadius:10, background:"rgba(24,24,24,.9)", border:"1px solid rgba(255,255,255,.12)"}}>
                      <option value="S">Small</option>
                      <option value="M">Medium</option>
                      <option value="L">Large</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize:12, color:"#bbb", marginBottom:4 }}>Time spent (min)</div>
                    <input type="number" value={minutes} min={10} onChange={(e)=>setMinutes(parseInt(e.target.value||"0"))}
                      style={{ width:"100%", padding:"10px 12px", borderRadius:10, background:"rgba(24,24,24,.9)", border:"1px solid rgba(255,255,255,.12)", color:"#fff" }}/>
                  </div>
                  <div>
                    <div style={{ fontSize:12, color:"#bbb", marginBottom:4 }}>Followers</div>
                    <input type="number" value={followers} min={0} onChange={(e)=>setFollowers(parseInt(e.target.value||"0"))}
                      style={{ width:"100%", padding:"10px 12px", borderRadius:10, background:"rgba(24,24,24,.9)", border:"1px solid rgba(255,255,255,.12)", color:"#fff" }}/>
                  </div>
                  <div>
                    <div style={{ fontSize:12, color:"#bbb", marginBottom:4 }}>Past average sale (optional)</div>
                    <input type="number" value={pastAvg ?? ""} onChange={(e)=>setPastAvg(e.target.value? parseFloat(e.target.value): undefined)}
                      style={{ width:"100%", padding:"10px 12px", borderRadius:10, background:"rgba(24,24,24,.9)", border:"1px solid rgba(255,255,255,.12)", color:"#fff" }}/>
                  </div>
                  <div>
                    <div style={{ fontSize:12, color:"#bbb", marginBottom:4 }}>Scarcity</div>
                    <select value={scarcity} onChange={(e)=>setScarcity(e.target.value as "1/1"|"editions")}
                      style={{ width:"100%", padding:"10px 12px", borderRadius:10, background:"rgba(24,24,24,.9)", border:"1px solid rgba(255,255,255,.12)"}}>
                      <option value="1/1">1/1</option>
                      <option value="editions">Editions</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <button className="assistant-action" onClick={()=>{
                    const result = priceCoach({ sizeIn, baseMinutes: minutes, followers, pastAvg, scarcity });
                    setPricing(result);
                    track("assistant_command", { tool: "price_coach", ...result, sizeIn, followers, pastAvg, scarcity });
                  }}>Suggest pricing</button>
                </div>

                {pricing && (
                  <div style={{ marginTop: 12, display:"grid", gap: 6 }}>
                    <div style={{ fontWeight:600 }}>Recommendation</div>
                    <div>Suggested 1/1 anchor: <strong>{pricing.suggested}</strong></div>
                    {scarcity === "editions" ? (
                      <>
                        <div>Edition size: <strong>{pricing.editions}</strong></div>
                        <div>Per-edition price: <strong>{pricing.editionPrice}</strong></div>
                      </>
                    ) : (
                      <div>Reserve (auction): <strong>{pricing.reserve}</strong></div>
                    )}
                    <div style={{ fontSize:12, color:"#bbb", marginTop: 6 }}>Why</div>
                    <ul style={{ paddingLeft: 18, display:"grid", gap: 4 }}>
                      {pricing.notes.map((n,i)=><li key={i}>{n}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Command input */}
            <form
              onSubmit={(e) => { e.preventDefault(); if (query.trim()) handleRun(query); }}
              style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 12 }}
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Type a command… e.g. "moodboard batman sunny sea"'
                aria-label="Assistant command"
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid var(--assistant-input-border, rgba(255,255,255,.12))",
                  background: "var(--assistant-input-bg, rgba(24,24,24,.9))",
                  color: "var(--assistant-input-fg, #fff)",
                  fontSize: 14,
                }}
              />
              <button className="assistant-action" type="submit" style={{ padding: "12px 18px", borderRadius: 12 }}>
                Run
              </button>
            </form>

            {status && <div style={{ fontSize: 12, color: "var(--assistant-hint, #777)", marginTop: 8 }} aria-live="polite">{status}</div>}
          </div>
        </div>
      )}
    </>,
    root
  );
}
