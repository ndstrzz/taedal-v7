import React, { useEffect, useRef, useState } from "react";
import { runAction, type AssistantAction } from "./actions";

/**
 * Floating assistant dock — always on top, bottom-right, draggable.
 * Uses an MP4 (public/images/chatbot.mp4) as the floating “bot”.
 */
export default function AssistantDock() {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Helpful visibility confirmation in DevTools
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("%c[assistant] dock mounted", "color:#8b5cf6");
  }, []);

  // Ensure we never hide under other UI
  useEffect(() => {
    const el = btnRef.current?.parentElement;
    if (el) {
      el.style.zIndex = "99999";
      el.id = "assistant-dock-root";
    }
  }, []);

  // Simple drag (pointer events)
  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging || !startRef.current) return;
      e.preventDefault();
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      const next = {
        x: Math.max(8, Math.min(window.innerWidth - 72, (pos?.x ?? window.innerWidth - 88) + dx)),
        y: Math.max(8, Math.min(window.innerHeight - 72, (pos?.y ?? window.innerHeight - 88) + dy)),
      };
      setPos(next);
      startRef.current = { x: e.clientX, y: e.clientY };
    }
    function onUp() {
      setDragging(false);
      startRef.current = null;
    }
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, pos]);

  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" }
    : { right: 16, bottom: 16 };

  const quickActions: { label: string; action: AssistantAction }[] = [
    { label: "Start tour", action: { type: "START_TOUR" } },
    { label: "Light theme", action: { type: "TOGGLE_THEME", mode: "light" } },
    { label: "Dark theme", action: { type: "TOGGLE_THEME", mode: "dark" } },
    { label: "Guide: upload avatar", action: { type: "GUIDE_UPLOAD_AVATAR" } },
  ];

  return (
    <div
      className="assistant-fixed"
      style={style}
      aria-live="polite"
      aria-label="Assistant dock"
    >
      {/* Floating bot button (draggable) */}
      <button
        ref={btnRef}
        className="assistant-bot"
        onClick={() => setOpen((v) => !v)}
        onPointerDown={(e) => {
          // drag only when you hold Alt (so normal click still opens panel)
          if (e.altKey) {
            setDragging(true);
            startRef.current = { x: e.clientX, y: e.clientY };
          }
        }}
        title="Assistant (Alt+drag to move)"
      >
        {/* Prefer MP4 if available; fallback to logo/emoji */}
        <video
          className="assistant-bot-video"
          src="/images/chatbot.mp4"
          autoPlay
          loop
          muted
          playsInline
          onError={(ev) => {
            // eslint-disable-next-line no-console
            console.warn("[assistant] chatbot.mp4 not found or failed to load", ev);
          }}
        />
        <span className="assistant-bot-fallback" aria-hidden>🤖</span>
      </button>

      {/* Panel */}
      {open && (
        <div className="assistant-panel">
          <div className="assistant-panel-header">
            <div className="assistant-panel-title">taedal assistant</div>
            <button className="assistant-close" onClick={() => setOpen(false)} aria-label="Close assistant">
              ✕
            </button>
          </div>

          <div className="assistant-panel-body">
            <p className="assistant-hint">
              Try: <code>“Switch to light theme”</code> or <code>“Guide me to upload an avatar”</code>
            </p>

            <div className="assistant-actions">
              {quickActions.map((qa) => (
                <button
                  key={qa.label}
                  className="assistant-action"
                  onClick={() => runAction(qa.action)}
                >
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
