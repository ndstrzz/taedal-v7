// src/assistant/AssistantDock.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { classifyIntent } from "./intent";
import { runAction } from "./actions";

function usePortalRoot(id = "assistant-dock-root") {
  const elRef = useRef<HTMLElement | null>(null);
  if (!elRef.current && typeof document !== "undefined") {
    const existing = document.getElementById(id) as HTMLElement | null;
    if (existing) {
      elRef.current = existing;
    } else {
      const div = document.createElement("div");
      div.id = id;
      div.style.position = "fixed";
      div.style.zIndex = String(2147483647);
      div.style.inset = "auto 0 0 auto";
      document.body.appendChild(div);
      elRef.current = div;
    }
  }
  return elRef.current;
}

type Pos = { x: number; y: number };
const POS_KEY = "taedal:assistant:pos";
const OPEN_KEY = "taedal:assistant:open";

export default function AssistantDock() {
  const root = usePortalRoot();
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(OPEN_KEY);
      return saved ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  });

  const [pos, setPos] = useState<Pos>(() => {
    try {
      const saved = localStorage.getItem(POS_KEY);
      return saved ? JSON.parse(saved) : { x: 16, y: 16 };
    } catch {
      return { x: 16, y: 16 };
    }
  });

  useEffect(() => {
    localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  }, [open]);

  useEffect(() => {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  }, [pos]);

  // Drag (pointer events)
  const dragData = useRef<{ startX: number; startY: number; origin: Pos } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragData.current = { startX: e.clientX, startY: e.clientY, origin: { ...pos } };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragData.current) return;
    const dx = e.clientX - dragData.current.startX;
    const dy = e.clientY - dragData.current.startY;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nextX = Math.min(Math.max(dragData.current.origin.x - dx, 8), vw - 64);
    const nextY = Math.min(Math.max(dragData.current.origin.y - dy, 8), vh - 64);
    setPos({ x: nextX, y: nextY });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    dragData.current = null;
  };

  const bubbleStyle: React.CSSProperties = useMemo(
    () => ({
      position: "fixed",
      right: pos.x,
      bottom: pos.y,
      zIndex: 2147483647,
    }),
    [pos]
  );

  // Simple input -> intent -> action
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>(""); // tiny feedback line

  async function handleRun(text: string) {
    const action = classifyIntent(text);
    if (action.type === "NONE") {
      setStatus("Didn’t catch that. Try: “light theme”, “go to account”, “tour”.");
      return;
    }
    // Soft confirmation: for NAVIGATE or anything that might change state
    if (action.type === "NAVIGATE") {
      const ok = confirm(`Go to ${action.to}?`);
      if (!ok) return;
    }
    if (action.type === "TOGGLE_THEME") {
      // No confirm; harmless
    }
    setStatus("Running…");
    await runAction(action);
    setStatus("Done.");
    // Clear quickly so it doesn’t linger
    setTimeout(() => setStatus(""), 900);
  }

  if (!root) return null;

  return createPortal(
    <>
      {/* Bubble */}
      <button
        aria-label="Open taedal assistant"
        className="assistant-bot"
        style={bubbleStyle}
        onClick={() => setOpen((v) => !v)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="Taedal Assistant"
      >
        {/* If you add /public/media/assistant-bot.webm, uncomment: */}
        {/* <video className="assistant-bot-video" autoPlay loop muted playsInline src="/media/assistant-bot.webm" /> */}
        <span className="assistant-bot-fallback" role="img" aria-label="assistant">🦊</span>
      </button>

      {/* Panel */}
      {open && (
        <div
          className="assistant-panel assistant-fixed"
          style={{ right: (bubbleStyle.right as number) + 68, bottom: bubbleStyle.bottom }}
          role="dialog"
          aria-label="Taedal assistant"
        >
          <div className="assistant-panel-header">
            <strong className="assistant-panel-title">Taedal Assistant</strong>
            <button
              onClick={() => setOpen(false)}
              className="assistant-close"
              title="Close"
              aria-label="Close assistant"
            >
              ✕
            </button>
          </div>

          <div className="assistant-panel-body">
            <p className="assistant-hint">
              Try: “change to light theme”, “go to account”, “tour”, “upload avatar”.
            </p>

            {/* Quick actions */}
            <div className="assistant-actions" style={{ marginBottom: 8 }}>
              <button className="assistant-action" onClick={() => handleRun("light theme")}>
                Light theme
              </button>
              <button className="assistant-action" onClick={() => handleRun("dark theme")}>
                Dark theme
              </button>
              <button className="assistant-action" onClick={() => handleRun("go to account")}>
                Go to Account
              </button>
              <button className="assistant-action" onClick={() => handleRun("tour")}>
                Start tour
              </button>
            </div>

            {/* Free-text command */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (query.trim()) handleRun(query);
              }}
              style={{ display: "flex", gap: 6 }}
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Type a command… e.g. "upload avatar"'
                aria-label="Assistant command"
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,.12)",
                  background: "rgba(24,24,24,.9)",
                  color: "#fff",
                  fontSize: 13,
                }}
              />
              <button
                className="assistant-action"
                type="submit"
                style={{ padding: "10px 14px" }}
                aria-label="Run command"
              >
                Run
              </button>
            </form>

            {status && (
              <div style={{ fontSize: 12, color: "#bbb", marginTop: 6 }} aria-live="polite">
                {status}
              </div>
            )}
          </div>
        </div>
      )}
    </>,
    root
  );
}
