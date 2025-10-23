// src/assistant/AssistantDock.tsx
import { useEffect, useRef, useState } from "react";
import { classifyIntent } from "./intent";
import { runAction } from "./actions";

export default function AssistantDock() {
  const [open, setOpen] = useState<boolean>(() => {
    // recover last state; default closed
    const v = localStorage.getItem("assistant:open");
    return v === "1";
  });
  const [msg, setMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem("assistant:open", open ? "1" : "0");
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = msg.trim();
    if (!q) return;
    setMsg("");
    const action = classifyIntent(q);
    await runAction(action);
  }

  return (
    <>
      {/* Floating button */}
      <button
        aria-label="Assistant"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 999999, // ⬅️ above everything
          height: 56,
          width: 56,
          borderRadius: 999,
          background: "#3b82f6",
          color: "white",
          border: "1px solid rgba(255,255,255,0.2)",
          boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
        }}
      >
        💬
      </button>

      {/* Panel */}
      {open && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 84,
            zIndex: 999999,
            width: 320,
            maxWidth: "calc(100vw - 32px)",
            background: "rgba(17,17,17,0.95)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
            backdropFilter: "blur(8px)",
            boxShadow: "0 20px 48px rgba(0,0,0,0.45)",
          }}
        >
          <div style={{ padding: 12, fontSize: 14, color: "#e5e7eb" }}>
            <div style={{ marginBottom: 8, opacity: 0.8 }}>
              Ask me things like:
              <div>• “switch to light theme”</div>
              <div>• “start a tour”</div>
              <div>• “guide me to upload an avatar”</div>
            </div>
            <form onSubmit={onSubmit} style={{ display: "flex", gap: 8 }}>
              <input
                ref={inputRef}
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                placeholder="Type a request…"
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(24,24,27,0.9)",
                  color: "white",
                  outline: "none",
                }}
              />
              <button
                type="submit"
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "#22c55e",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                Run
              </button>
            </form>
            <button
              onClick={() => setOpen(false)}
              style={{
                marginTop: 8,
                fontSize: 12,
                opacity: 0.7,
                textDecoration: "underline",
                background: "transparent",
                border: 0,
                color: "#9ca3af",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
