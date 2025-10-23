// src/assistant/AssistantDock.tsx
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { runAction, type AssistantAction } from "./actions";

function DockUI() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = inputRef.current?.value?.trim() ?? "";
    if (!text) return;

    let action: AssistantAction = { type: "NONE" };
    const m = text.toLowerCase();

    if (m.includes("light theme")) action = { type: "TOGGLE_THEME", mode: "light" };
    else if (m.includes("dark theme")) action = { type: "TOGGLE_THEME", mode: "dark" };
    else if (m.includes("system theme")) action = { type: "TOGGLE_THEME", mode: "system" };
    else if (m.includes("upload") && m.includes("avatar")) action = { type: "GUIDE_UPLOAD_AVATAR" };
    else if (m.includes("tour")) action = { type: "START_TOUR" };

    setBusy(true);
    try { await runAction(action); } finally { setBusy(false); }
    if (inputRef.current) inputRef.current.value = "";
  }

  // styles
  const wrap: React.CSSProperties = {
    position: "fixed",
    right: 20,
    bottom: 20,
    zIndex: 2147483647, // max it out
    pointerEvents: "none",
  };
  const panel: React.CSSProperties = {
    width: 360,
    maxWidth: "92vw",
    marginBottom: 12,
    borderRadius: 16,
    border: "1px solid rgba(120,120,120,0.4)",
    background: "rgba(18,18,18,0.95)",
    backdropFilter: "blur(6px)",
    color: "#eee",
    boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
    pointerEvents: "auto",
  };
  const header: React.CSSProperties = {
    padding: 12,
    borderBottom: "1px solid rgba(120,120,120,0.35)",
    display: "flex",
    alignItems: "center",
    gap: 8,
  };
  const videoDot: React.CSSProperties = {
    height: 32,
    width: 32,
    borderRadius: "999px",
    overflow: "hidden",
    background: "#222",
  };
  const closeBtn: React.CSSProperties = {
    marginLeft: "auto",
    padding: "6px 10px",
    fontSize: 12,
    borderRadius: 8,
    background: "#2a2a2a",
    color: "#eee",
    border: "1px solid rgba(120,120,120,0.35)",
    cursor: "pointer",
  };
  const body: React.CSSProperties = { padding: 12, fontSize: 14, color: "#ddd" };
  const row: React.CSSProperties = { display: "flex", gap: 8, marginTop: 8 };
  const input: React.CSSProperties = {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(120,120,120,0.35)",
    background: "#141414",
    color: "#eee",
    outline: "none",
  };
  const sendBtn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    background: "#3a3a3a",
    color: "#fff",
    border: "1px solid rgba(120,120,120,0.35)",
    cursor: "pointer",
  };
  const fab: React.CSSProperties = {
    height: 64,
    width: 64,
    borderRadius: 999,
    border: "1px solid rgba(120,120,120,0.4)",
    background: "rgba(22,22,22,0.9)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    pointerEvents: "auto",
  };
  const fabVidWrap: React.CSSProperties = {
    height: 48,
    width: 48,
    borderRadius: 999,
    overflow: "hidden",
    background: "#222",
  };

  return (
    <div style={wrap} aria-live="polite">
      {open && (
        <div style={panel} role="dialog" aria-label="Assistant">
          <div style={header}>
            <div style={videoDot}>
              <video
                src="/images/chatbot.mp4"
                autoPlay
                loop
                muted
                playsInline
                style={{ height: "100%", width: "100%", objectFit: "cover" }}
              />
            </div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Taedal Assistant</div>
            <button style={closeBtn} onClick={() => setOpen(false)} aria-label="Close assistant">
              Close
            </button>
          </div>
          <div style={body}>
            Try: “switch to light theme”, “guide me to upload an avatar”, or “start tour”.
            <form onSubmit={handleSubmit} style={row}>
              <input ref={inputRef} style={input} placeholder="Ask me anything…" disabled={busy} />
              <button style={sendBtn} disabled={busy} type="submit">{busy ? "…" : "Send"}</button>
            </form>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={fab}
        aria-label="Open assistant"
      >
        <div style={fabVidWrap}>
          <video
            src="/images/chatbot.mp4"
            autoPlay
            loop
            muted
            playsInline
            style={{ height: "100%", width: "100%", objectFit: "cover" }}
          />
        </div>
      </button>
    </div>
  );
}

export default function AssistantDock() {
  // Render into <body> to avoid any parent stacking/overflow issues
  if (typeof document === "undefined") return null;
  return createPortal(<DockUI />, document.body);
}
