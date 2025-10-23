// src/assistant/AssistantDock.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { runAction, type AssistantAction } from "./actions";

function DockInner() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // visible signal in DevTools
    console.log("[AssistantDock] mounted");
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputRef.current?.value?.trim() || "";
    if (!text) return;

    let action: AssistantAction = { type: "NONE" };
    const m = text.toLowerCase();

    if (m.includes("light theme")) action = { type: "TOGGLE_THEME", mode: "light" };
    else if (m.includes("dark theme")) action = { type: "TOGGLE_THEME", mode: "dark" };
    else if (m.includes("system theme")) action = { type: "TOGGLE_THEME", mode: "system" };
    else if (m.includes("upload") && m.includes("avatar")) action = { type: "GUIDE_UPLOAD_AVATAR" };
    else if (m.includes("tour")) action = { type: "START_TOUR" };

    setBusy(true);
    try {
      await runAction(action);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  // styles isolated in Shadow DOM
  const css = `
:host, * { box-sizing: border-box; }
.assist-wrap { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; pointer-events: none; }
.assist-fab {
  height: 64px; width: 64px; border-radius: 999px; border: 1px solid rgba(120,120,120,.45);
  background: rgba(20,20,20,.95); box-shadow: 0 12px 40px rgba(0,0,0,.6);
  display: grid; place-items: center; cursor: pointer; pointer-events: auto;
}
.fab-vid { height: 48px; width: 48px; border-radius: 999px; overflow: hidden; background:#222; display:grid; place-items:center; color:#fff; font-weight:700; }
.panel {
  width: 360px; max-width: 92vw; margin-bottom: 12px; border-radius: 16px;
  border: 1px solid rgba(120,120,120,.45); background: rgba(18,18,18,.98); color:#eee;
  pointer-events: auto; backdrop-filter: blur(6px); box-shadow: 0 12px 40px rgba(0,0,0,.6);
}
.hdr { padding: 12px; border-bottom: 1px solid rgba(120,120,120,.35); display:flex; align-items:center; gap:8px; }
.dot { height: 32px; width: 32px; border-radius: 999px; overflow:hidden; background:#222; }
.close { margin-left:auto; padding:6px 10px; font-size:12px; border-radius:8px; background:#2a2a2a; color:#eee;
  border: 1px solid rgba(120,120,120,.35); cursor:pointer; }
.body { padding: 12px; font-size: 14px; color: #ddd; }
.row { display:flex; gap:8px; margin-top:8px; }
.inp { flex:1; padding:10px 12px; border-radius:10px; border:1px solid rgba(120,120,120,.35); background:#141414; color:#eee; outline:none; }
.btn { padding:10px 12px; border-radius:10px; background:#3a3a3a; color:#fff; border:1px solid rgba(120,120,120,.35); cursor:pointer; }
  `;

  const [videoOk, setVideoOk] = useState(true);

  return (
    <>
      <style>{css}</style>

      <div className="assist-wrap" aria-live="polite">
        {open && (
          <div className="panel" role="dialog" aria-label="Assistant">
            <div className="hdr">
              <div className="dot">
                {videoOk ? (
                  <video
                    src="/images/chatbot.mp4"
                    autoPlay
                    loop
                    muted
                    playsInline
                    onError={() => setVideoOk(false)}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>?</div>
                )}
              </div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Taedal Assistant</div>
              <button className="close" onClick={() => setOpen(false)} aria-label="Close assistant">
                Close
              </button>
            </div>

            <div className="body">
              Try: “switch to light theme”, “guide me to upload an avatar”, or “start tour”.
              <form className="row" onSubmit={submit}>
                <input className="inp" ref={inputRef} placeholder="Ask me anything…" disabled={busy} />
                <button className="btn" type="submit" disabled={busy}>{busy ? "…" : "Send"}</button>
              </form>
            </div>
          </div>
        )}

        <button className="assist-fab" type="button" onClick={() => setOpen(v => !v)} aria-label="Open assistant">
          <div className="fab-vid">
            {videoOk ? (
              <video
                src="/images/chatbot.mp4"
                autoPlay
                loop
                muted
                playsInline
                onError={() => setVideoOk(false)}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              "?"
            )}
          </div>
        </button>
      </div>
    </>
  );
}

export default function AssistantDock() {
  // Create a shadow host mounted on body to escape app z-index/overflow traps
  const host = useMemo(() => {
    if (typeof document === "undefined") return null;
    let el = document.getElementById("assistant-root") as (HTMLElement | null);
    if (!el) {
      el = document.createElement("div");
      el.id = "assistant-root";
      document.body.appendChild(el);
    }
    return el;
  }, []);

  const shadowRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    if (!host || shadowRef.current) return;
    shadowRef.current = host.attachShadow ? host.attachShadow({ mode: "open" }) : null;
  }, [host]);

  if (!host) return null;

  // If Shadow DOM is supported (most modern browsers), render inside it.
  if (shadowRef.current) {
    return createPortal(<DockInner />, shadowRef.current as unknown as Element);
  }
  // Fallback: render as a normal portal to body.
  return createPortal(<DockInner />, host);
}
