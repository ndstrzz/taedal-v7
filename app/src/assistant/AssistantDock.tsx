// src/assistant/AssistantDock.tsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { classifyIntent } from "./intent";
import { runAction } from "./actions";

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
    console.log("[assistant] created portal root");
  }
  return el;
}

type Pos = { x: number; y: number };

export default function AssistantDock() {
  console.log("[assistant] AssistantDock() invoked");
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    setRoot(ensurePortalRoot());
    const mo = new MutationObserver(() => {
      if (!document.getElementById(ROOT_ID)) {
        console.warn("[assistant] root missing, re-creating");
        setRoot(ensurePortalRoot());
      }
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

  useEffect(() => { localStorage.setItem(OPEN_KEY, JSON.stringify(open)); (window as any).__taeAssistantOpen = open; }, [open]);
  useEffect(() => { localStorage.setItem(POS_KEY, JSON.stringify(pos)); }, [pos]);

  // Dragging
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
      x: Math.min(Math.max(drag.current.origin.x - dx, 8), vw - 64),
      y: Math.min(Math.max(drag.current.origin.y - dy, 8), vh - 64),
    });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    try {(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);} catch {}
    drag.current = null;
  };

  const bubbleBox: React.CSSProperties = useMemo(
    () => ({ position: "fixed", right: pos.x, bottom: pos.y, zIndex: 2147483647, pointerEvents: "auto" }),
    [pos]
  );

  // Input -> intent -> action
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  async function handleRun(text: string) {
    const action = classifyIntent(text);
    if (action.type === "NONE") { setStatus('Try: "light theme", "go to account", "tour".'); return; }
    if (action.type === "NAVIGATE" && !confirm(`Go to ${action.to}?`)) return;
    setStatus("Running…");
    await runAction(action);
    setStatus("Done.");
    setTimeout(() => setStatus(""), 800);
  }

  useEffect(() => {
    console.log("[assistant] mounted", { hasRoot: !!root, open, pos, path: window.location.pathname });
  }, [root]);

  if (!root) return null;

  const panelStyle: React.CSSProperties = {
    position: "fixed",
    right: (bubbleBox.right as number) + 68,
    bottom: bubbleBox.bottom,
    zIndex: 2147483647,
    pointerEvents: "auto",
    background: "rgba(12,12,12,0.94)",
    border: "1px solid rgba(255,255,255,0.14)",
    backdropFilter: "blur(10px)",
    borderRadius: 16,
    boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
    color: "#fff",
    padding: 12,
    width: Math.min(360, window.innerWidth - 24),
  };

  return createPortal(
    <>
      {/* Bubble with video */}
      <button
        aria-label="Open taedal assistant"
        title="Taedal Assistant"
        onClick={() => setOpen((v) => !v)}
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
          <source src="/images/chatbot.webm" type="video/webm" />
          <source src="/images/chatbot.mp4" type="video/mp4" />
        </video>
        <span className="assistant-bot-fallback" role="img" aria-label="assistant" style={{ pointerEvents: "none" }}>🦊</span>
      </button>

      {/* Panel */}
      {open && (
        <div role="dialog" aria-label="Taedal assistant" style={panelStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <strong>Taedal Assistant</strong>
            <button onClick={() => setOpen(false)} style={{ background: "transparent", border: 0, color: "#aaa", fontSize: 18 }} aria-label="Close assistant" title="Close">✕</button>
          </div>

          <p style={{ fontSize: 12, color: "#bbb", margin: "6px 0 10px" }}>
            Try: “light theme”, “dark theme”, “go to account”, “tour”.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <button className="assistant-action" onClick={() => handleRun("light theme")}>Light theme</button>
            <button className="assistant-action" onClick={() => handleRun("dark theme")}>Dark theme</button>
            <button className="assistant-action" onClick={() => handleRun("go to account")}>Go to Account</button>
            <button className="assistant-action" onClick={() => handleRun("tour")}>Start tour</button>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) handleRun(query); }} style={{ display: "flex", gap: 6 }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Type a command… e.g. "upload avatar"' aria-label="Assistant command"
              style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,.12)", background: "rgba(24,24,24,.9)", color: "#fff", fontSize: 13 }} />
            <button className="assistant-action" type="submit" style={{ padding: "10px 14px" }}>Run</button>
          </form>

          {status && <div style={{ fontSize: 12, color: "#bbb", marginTop: 6 }} aria-live="polite">{status}</div>}
        </div>
      )}
    </>,
    root
  );
}
