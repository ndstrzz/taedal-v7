import { useEffect, useRef, useState } from "react";
import { runAction, type AssistantAction } from "./actions";

// Simple, visible, bottom-right floating chatbot with a video avatar.
export default function AssistantDock() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on Esc
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Naive intent parser — wire to your intents later
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = inputRef.current?.value?.trim() ?? "";
    if (!text) return;

    // Very simple demo routing
    let action: AssistantAction = { type: "NONE" };
    const msg = text.toLowerCase();

    if (msg.includes("light theme")) {
      action = { type: "TOGGLE_THEME", mode: "light" };
    } else if (msg.includes("dark theme")) {
      action = { type: "TOGGLE_THEME", mode: "dark" };
    } else if (msg.includes("system theme")) {
      action = { type: "TOGGLE_THEME", mode: "system" };
    } else if (msg.includes("upload") && msg.includes("avatar")) {
      action = { type: "GUIDE_UPLOAD_AVATAR" };
    } else if (msg.includes("tour")) {
      action = { type: "START_TOUR" };
    }

    setBusy(true);
    try {
      await runAction(action);
    } finally {
      setBusy(false);
    }

    // Keep panel open so the user sees the effect; clear the input
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div
      className="fixed right-5 bottom-5 z-[99999] pointer-events-none"
      aria-live="polite"
    >
      {/* Panel */}
      {open && (
        <div
          className="mb-3 w-[min(92vw,360px)] rounded-2xl border border-neutral-700 bg-neutral-900/95 backdrop-blur shadow-2xl pointer-events-auto"
          role="dialog"
          aria-label="Assistant"
        >
          <div className="p-3 border-b border-neutral-800">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full overflow-hidden bg-neutral-800">
                <video
                  src="/images/chatbot.mp4"
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="text-sm font-medium">Taedal Assistant</div>
              <button
                className="ml-auto px-2 py-1 text-xs rounded bg-neutral-800 hover:bg-neutral-700"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
              >
                Close
              </button>
            </div>
          </div>

          <div className="p-3 text-sm text-neutral-300 space-y-2">
            <p>Try: “switch to light theme”, “guide me to upload an avatar”, or “start tour”.</p>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                ref={inputRef}
                className="flex-1 input"
                placeholder="Ask me anything…"
                disabled={busy}
              />
              <button className="btn" disabled={busy} type="submit">
                {busy ? "…" : "Send"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto h-14 w-14 rounded-full border border-neutral-700 bg-neutral-900/90 shadow-xl hover:bg-neutral-800 grid place-items-center"
        aria-label="Open assistant"
      >
        <div className="h-10 w-10 rounded-full overflow-hidden">
          <video
            src="/images/chatbot.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="h-full w-full object-cover"
          />
        </div>
      </button>
    </div>
  );
}
