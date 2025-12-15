import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

function clamp(n: number, a: number, b: number) {
  return Math.min(Math.max(n, a), b);
}

const uniq = <T,>(arr: T[]) => Array.from(new Set(arr));

/* ---------------- env/url resolution ---------------- */
function getEnv(key: string): string | undefined {
  try {
    // Vite injects import.meta.env at build time for app bundles.
    // If this file is bundled outside Vite, import.meta.env may not exist.
    // @ts-ignore
    return (import.meta as any)?.env?.[key];
  } catch {
    return undefined;
  }
}

function getCfg(key: string): string | undefined {
  // supports window.__CONFIG__ pattern too
  const w = globalThis as any;
  const cfg = w?.window?.__CONFIG__ || w?.__CONFIG__;
  if (cfg && typeof cfg === "object") return cfg[key];
  return undefined;
}

function getSupabaseUrl(): string | undefined {
  return getCfg("SUPABASE_URL") || getEnv("VITE_SUPABASE_URL") || getEnv("SUPABASE_URL");
}
function getSupabaseAnonKey(): string | undefined {
  return getCfg("SUPABASE_ANON_KEY") || getEnv("VITE_SUPABASE_ANON_KEY") || getEnv("SUPABASE_ANON_KEY");
}

/* ---------------- Moodboard helpers ---------------- */

function expandKeywords(prompt: string): string[] {
  const base = prompt.toLowerCase().trim();
  if (!base) return ["art texture"];

  const words = base
    .replace(/[^\w\s-]/g, "")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 1 &&
        !["a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "with", "by"].includes(w)
    );

  const map: Record<string, string[]> = {
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

  const buckets = words.map((w) => (map[w] ? [w, ...map[w]] : [w]));

  const combos: string[] = [];
  for (let i = 0; i < buckets.length; i++) {
    for (let j = i + 1; j <= Math.min(i + 3, buckets.length - 1); j++) {
      const a = buckets[i][0];
      const b = buckets[j][0];
      combos.push(`${a} ${b}`);
      if (buckets[i].length > 1) combos.push(`${buckets[i][1]} ${b}`);
      if (buckets[j].length > 1) combos.push(`${a} ${buckets[j][1]}`);
    }
  }

  const safety = [`${base} art`, `${base} photography`, `${base} texture`, `${base} illustration`];
  return uniq([base, ...combos, ...safety]).slice(0, 12);
}

function moodboardSources(prompt: string, n = 10): string[] {
  const variants = expandKeywords(prompt);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const q = variants[i % variants.length];
    const safe = encodeURIComponent(q);
    out.push(`https://source.unsplash.com/featured/720x480?${safe}&sig=${i + 7}`);
  }
  return out;
}

const PALETTES: Record<string, string[]> = {
  cyberpunk: ["#0ff", "#f0f", "#ff0066", "#1a1a1a", "#111111"],
  moody: ["#0b0d0f", "#2b2f36", "#44546a", "#8a99a6", "#d9d9d9"],
  nature: ["#1b4332", "#2d6a4f", "#95d5b2", "#e9f5db", "#1c1c1c"],
  pastel: ["#fde2e4", "#fad2e1", "#e2ece9", "#bee1e6", "#cddafd"],
  neon: ["#2dfcc2", "#00e5ff", "#ff4dff", "#12051e", "#0b0f1a"],
};

function pickPalette(prompt: string) {
  const p = prompt.toLowerCase();
  const k = Object.keys(PALETTES).find((k) => p.includes(k));
  return k ? PALETTES[k] : ["#111", "#333", "#777", "#aaa", "#ddd"];
}

/* ---------------- Critique + Price demo logic ---------------- */

function critiqueChecklist(goal: string, style: string) {
  return [
    `**Composition:** Clear focal hierarchy. Trim negative space by 6–10% if focus is weak.`,
    `**Values:** Boost midtone contrast 8–12% to separate planes. Squint test: silhouette read?`,
    `**Edges:** In ${style}, keep edge variety—soften 30–40% of non-focal edges.`,
    `**Color:** Limit to ~3 dominant hues. ${goal.includes("print") ? "Preview CMYK-safe" : "Check sRGB"} before export.`,
    `**Texture:** Add unifying grain at 8–12% opacity to tie layers.`,
    `**Typography:** If present, increase tracking +4–8 and align to an 8px baseline grid.`,
    `**Export:** Sharpen radius 0.3–0.5px. Web @2x; print at 300DPI.`,
  ];
}

function priceCoach(params: {
  sizeIn: "S" | "M" | "L";
  baseMinutes: number;
  followers: number;
  pastAvg?: number;
  scarcity: "1/1" | "editions";
}) {
  const sizeFactor = params.sizeIn === "L" ? 1.6 : params.sizeIn === "M" ? 1.25 : 1.0;
  const timeFactor = 0.6 + Math.min(1.4, params.baseMinutes / 240);
  const socialFactor = 0.9 + Math.min(1.6, Math.log10(Math.max(10, params.followers)) / 2);
  const anchor = params.pastAvg && params.pastAvg > 0 ? params.pastAvg : 120;
  const one = params.scarcity === "1/1";
  let suggested = anchor * sizeFactor * timeFactor * socialFactor * (one ? 1.35 : 0.95);
  suggested = Math.round(suggested / 5) * 5;
  const editions = one ? 1 : params.sizeIn === "L" ? 20 : params.sizeIn === "M" ? 35 : 50;
  const editionPrice = one ? suggested : Math.max(15, Math.round((suggested * 0.35) / 5) * 5);
  const reserve = one ? Math.max(50, Math.round((suggested * 0.6) / 5) * 5) : undefined;
  return {
    suggested,
    editions,
    editionPrice,
    reserve,
    notes: [
      one ? "1/1 premium applied (+35%)." : "Edition pricing at ~35% of 1/1 anchor.",
      `Time factor considers ~${params.baseMinutes} min of work.`,
      `Size factor: ${params.sizeIn} (${sizeFactor}x), Social factor: ~${socialFactor.toFixed(2)}x.`,
      params.pastAvg ? `Anchored to past avg sale: ${params.pastAvg}.` : "No past avg sale; used category baseline.",
    ],
  };
}

/* ---------------- AI Chat types ---------------- */

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  imageUrl?: string; // local preview URL
  ts: number;
};

function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/* ---------------- Supabase client fallback ---------------- */
// If your app already exposes the supabase client on window.supabase,
// we should prefer using that (no env parsing needed here).
function getWindowSupabase(): any | null {
  const w = globalThis as any;
  return w?.window?.supabase || w?.supabase || null;
}

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
    try {
      return JSON.parse(localStorage.getItem(OPEN_KEY) || "false");
    } catch {
      return false;
    }
  });

  const [pos, setPos] = useState<Pos>(() => {
    try {
      return JSON.parse(localStorage.getItem(POS_KEY) || '{"x":16,"y":16}');
    } catch {
      return { x: 16, y: 16 };
    }
  });

  useEffect(() => localStorage.setItem(OPEN_KEY, JSON.stringify(open)), [open]);
  useEffect(() => localStorage.setItem(POS_KEY, JSON.stringify(pos)), [pos]);

  // lock page scroll when open (so scroll wheel scrolls chat, not page)
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // drag bubble
  const drag = useRef<{ startX: number; startY: number; origin: Pos } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    drag.current = { startX: e.clientX, startY: e.clientY, origin: { ...pos } };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    const vw = window.innerWidth,
      vh = window.innerHeight;
    setPos({
      x: clamp(drag.current.origin.x - dx, 8, vw - 64),
      y: clamp(drag.current.origin.y - dy, 8, vh - 64),
    });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    drag.current = null;
    setPos((p) => ({
      x: p.x < window.innerWidth / 2 ? 16 : window.innerWidth - 64,
      y: clamp(p.y, 16, window.innerHeight - 64),
    }));
  };

  const bubbleBox: React.CSSProperties = useMemo(
    () => ({
      position: "fixed",
      right: pos.x,
      bottom: pos.y,
      zIndex: 2147483647,
      pointerEvents: "auto",
    }),
    [pos]
  );

  // tools
  type ToolTab = "shortcuts" | "ai" | "mood" | "critique" | "pricing";
  const [tool, setTool] = useState<ToolTab>("ai");

  // command input (shortcuts)
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  async function handleRun(text: string) {
    const lower = (text || "").toLowerCase();

    if (/(ai\s*chat|image chat|chatgpt|assistant)/.test(lower)) {
      setTool("ai");
      setStatus("");
      return;
    }
    if (/(moodboard|mood board|palette|references?)/.test(lower)) {
      setTool("mood");
      setStatus("");
      return;
    }
    if (/(critique|review|checklist|feedback)/.test(lower)) {
      setTool("critique");
      setStatus("");
      return;
    }
    if (/(price|pricing|coach|how much)/.test(lower)) {
      setTool("pricing");
      setStatus("");
      return;
    }

    const action = classifyIntent(text);
    track("assistant_command", {
      text,
      action: (action as any)?.type ?? "NONE",
      route: location.pathname,
      ok: action.type !== "NONE",
    });

    if (action.type === "NONE") {
      setStatus('Try: “AI chat”, “price coach”, “moodboard”, “critique”, “light theme”, “go to account”, “tour”.');
      return;
    }
    if (action.type === "NAVIGATE" && !confirm(`Go to ${action.to}?`)) return;

    setStatus("Running…");
    await runAction(action);
    setStatus("Done.");
    setTimeout(() => setStatus(""), 900);
  }

  // moodboard state
  const [moodPrompt, setMoodPrompt] = useState("batman sunny sea");
  const [moodImgs, setMoodImgs] = useState<string[]>([]);
  const moodPalette = useMemo(() => pickPalette(moodPrompt), [moodPrompt]);

  // critique state
  const [critGoal, setCritGoal] = useState("print drop");
  const [critStyle, setCritStyle] = useState("digital painting");
  const [critNotes, setCritNotes] = useState<string[]>([]);

  // pricing state
  const [sizeIn, setSizeIn] = useState<"S" | "M" | "L">("M");
  const [minutes, setMinutes] = useState<number>(120);
  const [followers, setFollowers] = useState<number>(2500);
  const [pastAvg, setPastAvg] = useState<number | undefined>(undefined);
  const [scarcity, setScarcity] = useState<"1/1" | "editions">("1/1");
  const [pricing, setPricing] = useState<ReturnType<typeof priceCoach> | null>(null);

  // AI chat state
  const [chat, setChat] = useState<ChatMsg[]>(() => [
    {
      id: uid(),
      role: "assistant",
      text:
        "Hey — I’m **쿠로**.\n\nUpload an image and ask:\n- *analyze this style*\n- *any issues?*\n- *how to improve?*\n- *how much is this worth?*",
      ts: Date.now(),
    },
  ]);
  const [chatText, setChatText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState<string>("");
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [pickedPreview, setPickedPreview] = useState<string>("");

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // auto-scroll to bottom on new messages
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat.length, tool, open]);

  useEffect(() => {
    return () => {
      if (pickedPreview) URL.revokeObjectURL(pickedPreview);
    };
  }, [pickedPreview]);

  function envDebugFlags() {
    const SUPABASE_URL = getSupabaseUrl();
    const SUPABASE_ANON = getSupabaseAnonKey();
    const wsb = getWindowSupabase();
    return {
      has_window_supabase: !!wsb,
      has_window_supabase_functions: !!wsb?.functions?.invoke,
      cfg_url: !!getCfg("SUPABASE_URL"),
      cfg_anon: !!getCfg("SUPABASE_ANON_KEY"),
      vite_url: !!getEnv("VITE_SUPABASE_URL"),
      vite_anon: !!getEnv("VITE_SUPABASE_ANON_KEY"),
      resolved_url: !!SUPABASE_URL,
      resolved_anon: !!SUPABASE_ANON,
    };
  }

  async function sendAiChat() {
    const text = chatText.trim();
    if (!text && !pickedFile) return;

    setChatErr("");
    const userMsg: ChatMsg = {
      id: uid(),
      role: "user",
      text: text || "(image)",
      imageUrl: pickedPreview || undefined,
      ts: Date.now(),
    };
    setChat((prev) => [...prev, userMsg]);
    setChatText("");
    setChatBusy(true);

    try {
      let image_b64: string | undefined;
      let image_mime: string | undefined;

      if (pickedFile) {
        image_b64 = await fileToBase64(pickedFile);
        image_mime = pickedFile.type || "image/jpeg";
      }

      const body = {
        message: text,
        image_b64,
        image_mime,
      };

      // ✅ Preferred path: use your app’s existing Supabase client on window.supabase
      const wsb = getWindowSupabase();
      if (wsb?.functions?.invoke) {
        const { data, error } = await wsb.functions.invoke("assistant-chat", { body });
        if (error) throw error;

        const replyText =
          (typeof data?.reply === "string" && data.reply) ||
          (typeof data?.text === "string" && data.text) ||
          (typeof data?.result === "string" && data.result) ||
          "I received your message, but I couldn't parse a reply format.";

        setChat((prev) => [...prev, { id: uid(), role: "assistant", text: replyText, ts: Date.now() }]);

        if (pickedPreview) URL.revokeObjectURL(pickedPreview);
        setPickedPreview("");
        setPickedFile(null);

        track("assistant_command", { tool: "ai_chat", has_image: !!image_b64, via: "window.supabase" });
        return;
      }

      // Fallback path: call Edge Function directly using anon key (never service role in browser)
      const SUPABASE_URL = getSupabaseUrl();
      const SUPABASE_ANON = getSupabaseAnonKey();
      if (!SUPABASE_URL || !SUPABASE_ANON) {
        const flags = envDebugFlags();
        throw new Error(
          `Missing Supabase URL/anon key. Expected in app/.env:\n- VITE_SUPABASE_URL\n- VITE_SUPABASE_ANON_KEY\n\nFound flags: ${JSON.stringify(flags)}\n\nIf you just edited .env, restart the dev server.`
        );
      }

      const endpoint = `${SUPABASE_URL}/functions/v1/assistant-chat`;

      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
        },
        body: JSON.stringify(body),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j?.error || j?.message || `Edge Function error (${r.status})`);
      }

      const replyText =
        (typeof j?.reply === "string" && j.reply) ||
        (typeof j?.text === "string" && j.text) ||
        (typeof j?.result === "string" && j.result) ||
        "I received your message, but I couldn't parse a reply format.";

      setChat((prev) => [...prev, { id: uid(), role: "assistant", text: replyText, ts: Date.now() }]);

      if (pickedPreview) URL.revokeObjectURL(pickedPreview);
      setPickedPreview("");
      setPickedFile(null);

      track("assistant_command", { tool: "ai_chat", has_image: !!image_b64, via: "direct_fetch" });
    } catch (e: any) {
      const msg = e?.message || "Failed to send a request to the Edge Function";
      setChatErr(msg);
      setChat((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text: "❌ Failed to send a request to the Edge Function.\n\nCheck your deployment + env keys, then try again.",
          ts: Date.now(),
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  }

  // videos
  const bubbleVideoSrc = [
    { src: "/images/chatbot.webm", type: "video/webm" },
    { src: "/images/chatbot.mp4", type: "video/mp4" },
  ];

  const leftVideoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const v = leftVideoRef.current;
    if (!v) return;
    try {
      v.currentTime = 0;
      v.play().catch(() => {});
    } catch {}
  }, [open]);

  if (!root) return null;

  // shared styles
  const pillBtn: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(255,255,255,.06)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  };

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,.14)",
    background: active ? "rgba(255,255,255,.12)" : "transparent",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  });

  const cardStyle: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,.12)",
    borderRadius: 16,
    background: "rgba(10,10,10,.35)",
    boxShadow: "0 12px 40px rgba(0,0,0,.35)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,.12)",
    background: "rgba(24,24,24,.9)",
    color: "#fff",
    outline: "none",
    fontSize: 14,
  };

  return createPortal(
    <>
      {/* Bubble */}
      <button
        aria-label="Open taedal assistant"
        title="Taedal Assistant"
        onClick={() => setOpen(true)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          ...bubbleBox,
          height: 56,
          width: 56,
          borderRadius: 9999,
          border: "1px solid rgba(255,255,255,0.18)",
          background: "rgba(17,17,17,0.5)",
          boxShadow: "0 10px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06) inset",
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
          outline: 0,
          pointerEvents: "auto",
        }}
      >
        <video
          className="assistant-bot-video key-black mask-soft"
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
        >
          {bubbleVideoSrc.map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
        </video>
        <span className="assistant-bot-fallback" role="img" aria-label="assistant" style={{ pointerEvents: "none" }}>
          🦊
        </span>
      </button>

      {/* Fullscreen overlay modal */}
      {open && (
        <div
          role="dialog"
          aria-label="Taedal assistant"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2147483647,
            pointerEvents: "auto",
            background: "rgba(0,0,0,.55)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            style={{
              width: "min(1200px, 96vw)",
              height: "min(760px, 90vh)",
              borderRadius: 22,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,.14)",
              background: "rgba(10,10,10,.92)",
              boxShadow: "0 30px 90px rgba(0,0,0,.65)",
              display: "grid",
              gridTemplateRows: "56px 1fr",
              minHeight: 0, // ✅ allow internal scroll
            }}
          >
            {/* Top bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 14px",
                borderBottom: "1px solid rgba(255,255,255,.10)",
                background: "linear-gradient(to bottom, rgba(255,255,255,.06), rgba(255,255,255,0))",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <img src="/images/taedal-static.svg" alt="taedal" style={{ height: 18, width: 18 }} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>쿠로</div>
                  <div style={{ color: "rgba(255,255,255,.7)", fontSize: 13 }}>Taedal Assistant</div>
                </div>
              </div>

              <button
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
                title="Close"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,.16)",
                  background: "rgba(0,0,0,.35)",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            {/* Main */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "42% 58%",
                minHeight: 0, // ✅ important
              }}
            >
              {/* LEFT: Kuro video */}
              <div
                style={{
                  position: "relative",
                  borderRight: "1px solid rgba(255,255,255,.10)",
                  minHeight: 0,
                }}
              >
                <video
                  ref={leftVideoRef}
                  className="key-black"
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="metadata"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                    filter: "contrast(1.02) saturate(0.9)",
                  }}
                >
                  {bubbleVideoSrc.map((s) => (
                    <source key={s.src} src={s.src} type={s.type} />
                  ))}
                </video>

                <div
                  style={{
                    position: "absolute",
                    left: 14,
                    bottom: 14,
                    right: 14,
                    padding: 14,
                    borderRadius: 16,
                    background: "rgba(0,0,0,.45)",
                    border: "1px solid rgba(255,255,255,.14)",
                    backdropFilter: "blur(6px)",
                  }}
                >
                  <div style={{ fontWeight: 900, fontSize: 18 }}>쿠로</div>
                  <div style={{ marginTop: 6, color: "rgba(255,255,255,.75)", fontSize: 13, lineHeight: 1.4 }}>
                    Image critique • style analysis • improvement tips
                  </div>
                </div>
              </div>

              {/* RIGHT: tabs + content */}
              <div
                style={{
                  display: "grid",
                  gridTemplateRows: "60px 1fr",
                  minHeight: 0, // ✅ important
                }}
              >
                {/* Tabs row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "0 14px",
                    borderBottom: "1px solid rgba(255,255,255,.10)",
                    minHeight: 0,
                  }}
                >
                  <button style={tabBtn(tool === "shortcuts")} onClick={() => setTool("shortcuts")}>
                    Shortcuts
                  </button>
                  <button style={tabBtn(tool === "ai")} onClick={() => setTool("ai")}>
                    AI Chat
                  </button>
                  <button style={tabBtn(tool === "mood")} onClick={() => setTool("mood")}>
                    Moodboard
                  </button>
                  <button style={tabBtn(tool === "critique")} onClick={() => setTool("critique")}>
                    Critique
                  </button>
                  <button style={tabBtn(tool === "pricing")} onClick={() => setTool("pricing")}>
                    Price
                  </button>
                </div>

                {/* Content area */}
                <div
                  style={{
                    padding: 14,
                    minHeight: 0, // ✅ important
                    overflow: "hidden", // keep scrolling inside tool panels
                  }}
                >
                  {/* SHORTCUTS */}
                  {tool === "shortcuts" && (
                    <div style={{ ...cardStyle, padding: 14, height: "100%", minHeight: 0, overflowY: "auto" }}>
                      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>Quick actions</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <button className="assistant-action" style={pillBtn} onClick={() => runAction({ type: "TOGGLE_THEME", mode: "light" })}>
                          Light theme
                        </button>
                        <button className="assistant-action" style={pillBtn} onClick={() => runAction({ type: "TOGGLE_THEME", mode: "dark" })}>
                          Dark theme
                        </button>
                        <button className="assistant-action" style={pillBtn} onClick={() => handleRun("go to account")}>
                          Go to Account
                        </button>
                        <button className="assistant-action" style={pillBtn} onClick={() => handleRun("tour")}>
                          Start tour
                        </button>
                      </div>

                      <div style={{ marginTop: 14, color: "rgba(255,255,255,.65)", fontSize: 12 }}>
                        Tip: You can type commands like <b>“AI chat”</b>, <b>“moodboard pastel cafe”</b>, <b>“critique”</b>, <b>“price coach”</b>.
                      </div>

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (query.trim()) handleRun(query);
                        }}
                        style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginTop: 14 }}
                      >
                        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Type a command… e.g. "light theme"' style={inputStyle} />
                        <button style={{ ...pillBtn, padding: "12px 16px" }} type="submit">
                          Run
                        </button>
                      </form>

                      {status && <div style={{ marginTop: 10, fontSize: 12, color: "rgba(255,255,255,.65)" }}>{status}</div>}
                    </div>
                  )}

                  {/* AI CHAT */}
                  {tool === "ai" && (
                    <div
                      style={{
                        height: "100%",
                        minHeight: 0, // ✅ important
                        display: "grid",
                        gridTemplateRows: "1fr auto",
                        gap: 10,
                      }}
                    >
                      {/* Message list (SCROLLS) */}
                      <div
                        ref={chatScrollRef}
                        style={{
                          ...cardStyle,
                          padding: 14,
                          minHeight: 0, // ✅ enables overflow scroll in grid
                          height: "100%",
                          overflowY: "auto",
                          overscrollBehavior: "contain",
                          WebkitOverflowScrolling: "touch",
                          scrollbarGutter: "stable",
                        }}
                      >
                        {chat.map((m) => (
                          <div
                            key={m.id}
                            style={{
                              display: "flex",
                              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                              marginBottom: 10,
                            }}
                          >
                            <div
                              style={{
                                maxWidth: "78%",
                                padding: 12,
                                borderRadius: 16,
                                border: "1px solid rgba(255,255,255,.12)",
                                background: m.role === "user" ? "rgba(120,120,255,.18)" : "rgba(255,255,255,.06)",
                                color: "#fff",
                                lineHeight: 1.4,
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {m.imageUrl && (
                                <div
                                  style={{
                                    borderRadius: 12,
                                    overflow: "hidden",
                                    border: "1px solid rgba(255,255,255,.14)",
                                    marginBottom: 10,
                                  }}
                                >
                                  <img src={m.imageUrl} alt="attachment" style={{ width: "100%", height: 220, objectFit: "cover", display: "block" }} />
                                </div>
                              )}
                              <div dangerouslySetInnerHTML={{ __html: m.text.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>") }} />
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Composer */}
                      <div style={{ ...cardStyle, padding: 12 }}>
                        {chatErr && <div style={{ color: "#ff8a8a", fontSize: 12, marginBottom: 8 }}>{chatErr}</div>}

                        {pickedPreview && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              marginBottom: 10,
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(255,255,255,.12)",
                              background: "rgba(255,255,255,.04)",
                            }}
                          >
                            <img src={pickedPreview} alt="picked" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 10 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "rgba(255,255,255,.75)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {pickedFile?.name || "image"}
                              </div>
                              <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)" }}>Attached — will be sent with your next message</div>
                            </div>
                            <button
                              onClick={() => {
                                if (pickedPreview) URL.revokeObjectURL(pickedPreview);
                                setPickedPreview("");
                                setPickedFile(null);
                              }}
                              style={{
                                borderRadius: 999,
                                border: "1px solid rgba(255,255,255,.18)",
                                background: "rgba(0,0,0,.25)",
                                color: "#fff",
                                padding: "8px 10px",
                                cursor: "pointer",
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        )}

                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10 }}>
                          <input
                            value={chatText}
                            onChange={(e) => setChatText(e.target.value)}
                            placeholder='Ask: "analyze style", "how to improve?", "composition?"'
                            style={inputStyle}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                if (!chatBusy) sendAiChat();
                              }
                            }}
                            disabled={chatBusy}
                          />

                          {/* attach */}
                          <label
                            style={{
                              width: 46,
                              height: 46,
                              borderRadius: 14,
                              border: "1px solid rgba(255,255,255,.12)",
                              background: "rgba(255,255,255,.06)",
                              display: "grid",
                              placeItems: "center",
                              cursor: "pointer",
                              userSelect: "none",
                            }}
                            title="Attach image"
                          >
                            📎
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: "none" }}
                              onChange={(e) => {
                                const f = e.target.files?.[0] || null;
                                if (!f) return;
                                if (pickedPreview) URL.revokeObjectURL(pickedPreview);
                                setPickedFile(f);
                                setPickedPreview(URL.createObjectURL(f));
                              }}
                            />
                          </label>

                          <button
                            onClick={() => sendAiChat()}
                            disabled={chatBusy}
                            style={{
                              ...pillBtn,
                              padding: "12px 18px",
                              opacity: chatBusy ? 0.6 : 1,
                            }}
                          >
                            {chatBusy ? "Sending…" : "Send"}
                          </button>
                        </div>

                        <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,.55)" }}>
                          Tip: upload → ask <b>“analyze the style”</b> / <b>“how to improve”</b>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* MOODBOARD */}
                  {tool === "mood" && (
                    <div style={{ ...cardStyle, padding: 14, height: "100%", minHeight: 0, overflowY: "auto" }}>
                      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>Moodboard from prompt</div>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const list = moodboardSources(moodPrompt, 10);
                          setMoodImgs(list);
                          track("assistant_command", {
                            tool: "moodboard",
                            prompt: moodPrompt,
                            variants: expandKeywords(moodPrompt),
                          });
                        }}
                      >
                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
                          <input
                            value={moodPrompt}
                            onChange={(e) => setMoodPrompt(e.target.value)}
                            placeholder='e.g. "pastel cafe at dawn", "cyberpunk rainy city"'
                            style={inputStyle}
                          />
                          <button style={{ ...pillBtn, padding: "12px 16px" }} type="submit">
                            Make
                          </button>
                        </div>
                      </form>

                      {moodImgs.length > 0 && (
                        <>
                          <div style={{ marginTop: 12, marginBottom: 8, fontSize: 12, color: "rgba(255,255,255,.65)" }}>Palette suggestion</div>
                          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                            {moodPalette.map((c, i) => (
                              <div
                                key={i}
                                style={{
                                  width: 30,
                                  height: 18,
                                  borderRadius: 8,
                                  background: c,
                                  border: "1px solid rgba(0,0,0,.3)",
                                }}
                                title={c}
                              />
                            ))}
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            {moodImgs.map((src, i) => (
                              <div key={i} style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,.12)" }}>
                                <img src={src} alt={`mood ${i}`} loading="lazy" style={{ width: "100%", height: 160, objectFit: "cover", display: "block" }} />
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* CRITIQUE */}
                  {tool === "critique" && (
                    <div style={{ ...cardStyle, padding: 14, height: "100%", minHeight: 0, overflowY: "auto" }}>
                      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>Portfolio critique checklist</div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                        <div>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,.65)", marginBottom: 6 }}>Goal</div>
                          <select value={critGoal} onChange={(e) => setCritGoal(e.target.value)} style={{ ...inputStyle, padding: "10px 12px" }}>
                            <option>print drop</option>
                            <option>web release</option>
                            <option>gallery submission</option>
                            <option>commission pitch</option>
                          </select>
                        </div>

                        <div>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,.65)", marginBottom: 6 }}>Style</div>
                          <select value={critStyle} onChange={(e) => setCritStyle(e.target.value)} style={{ ...inputStyle, padding: "10px 12px" }}>
                            <option>digital painting</option>
                            <option>line art</option>
                            <option>photobash</option>
                            <option>3D render</option>
                          </select>
                        </div>
                      </div>

                      <button
                        style={{ ...pillBtn, width: "fit-content" }}
                        onClick={() => {
                          const notes = critiqueChecklist(critGoal, critStyle);
                          setCritNotes(notes);
                          track("assistant_command", { tool: "critique", goal: critGoal, style: critStyle });
                        }}
                      >
                        Make checklist
                      </button>

                      {critNotes.length > 0 && (
                        <ul style={{ marginTop: 12, paddingLeft: 18, display: "grid", gap: 10 }}>
                          {critNotes.map((n, i) => (
                            <li key={i} style={{ lineHeight: 1.4 }}>
                              <span dangerouslySetInnerHTML={{ __html: n.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>") }} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* PRICING */}
                  {tool === "pricing" && (
                    <div style={{ ...cardStyle, padding: 14, height: "100%", minHeight: 0, overflowY: "auto" }}>
                      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>Price coach</div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,.65)", marginBottom: 6 }}>Size</div>
                          <select value={sizeIn} onChange={(e) => setSizeIn(e.target.value as "S" | "M" | "L")} style={{ ...inputStyle, padding: "10px 12px" }}>
                            <option value="S">Small</option>
                            <option value="M">Medium</option>
                            <option value="L">Large</option>
                          </select>
                        </div>

                        <div>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,.65)", marginBottom: 6 }}>Time spent (min)</div>
                          <input type="number" value={minutes} min={10} onChange={(e) => setMinutes(parseInt(e.target.value || "0"))} style={inputStyle} />
                        </div>

                        <div>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,.65)", marginBottom: 6 }}>Followers</div>
                          <input type="number" value={followers} min={0} onChange={(e) => setFollowers(parseInt(e.target.value || "0"))} style={inputStyle} />
                        </div>

                        <div>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,.65)", marginBottom: 6 }}>Past average sale (optional)</div>
                          <input type="number" value={pastAvg ?? ""} onChange={(e) => setPastAvg(e.target.value ? parseFloat(e.target.value) : undefined)} style={inputStyle} />
                        </div>

                        <div>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,.65)", marginBottom: 6 }}>Scarcity</div>
                          <select value={scarcity} onChange={(e) => setScarcity(e.target.value as "1/1" | "editions")} style={{ ...inputStyle, padding: "10px 12px" }}>
                            <option value="1/1">1/1</option>
                            <option value="editions">Editions</option>
                          </select>
                        </div>
                      </div>

                      <div style={{ marginTop: 12 }}>
                        <button
                          style={{ ...pillBtn }}
                          onClick={() => {
                            const result = priceCoach({ sizeIn, baseMinutes: minutes, followers, pastAvg, scarcity });
                            setPricing(result);
                            track("assistant_command", { tool: "price_coach", sizeIn, minutes, followers, pastAvg, scarcity });
                          }}
                        >
                          Suggest pricing
                        </button>
                      </div>

                      {pricing && (
                        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                          <div style={{ fontWeight: 800 }}>Recommendation</div>
                          <div>
                            Suggested 1/1 anchor: <b>{pricing.suggested}</b>
                          </div>
                          {scarcity === "editions" ? (
                            <>
                              <div>
                                Edition size: <b>{pricing.editions}</b>
                              </div>
                              <div>
                                Per-edition price: <b>{pricing.editionPrice}</b>
                              </div>
                            </>
                          ) : (
                            <div>
                              Reserve (auction): <b>{pricing.reserve}</b>
                            </div>
                          )}

                          <div style={{ fontSize: 12, color: "rgba(255,255,255,.65)", marginTop: 6 }}>Why</div>
                          <ul style={{ paddingLeft: 18, display: "grid", gap: 6 }}>
                            {pricing.notes.map((n, i) => (
                              <li key={i}>{n}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>,
    root
  );
}
