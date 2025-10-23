// src/assistant/AssistantDock.tsx
import { useEffect, useRef, useState } from "react";
import { classifyIntent } from "./intent";
import { runAction } from "./actions";

type Msg = { role: "user" | "assistant"; text: string };

export default function AssistantDock() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", text: "Hi! Ask me things like “switch to light theme” or “guide me to upload an avatar”." },
  ]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function onSend(e?: React.FormEvent) {
    e?.preventDefault();
    const q = input.trim();
    if (!q || busy) return;

    setMsgs((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);

    try {
      // 1) classify text -> action
      const action = classifyIntent(q);

      // 2) execute side-effect
      await runAction(action);

      // 3) acknowledge
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          text:
            action.type === "NONE"
              ? "I couldn’t match that to an action. Try: “switch to light theme”, “start a tour”, or “guide me to upload an avatar”."
              : "Done!",
        },
      ]);
    } catch (err: any) {
      setMsgs((m) => [
        ...m,
        { role: "assistant", text: `Oops: ${err?.message ?? "Something went wrong."}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* FAB toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed z-50 bottom-4 right-4 rounded-full h-12 w-12 grid place-items-center bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
        aria-label="Open assistant"
        title="Assistant"
      >
        ✨
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed z-50 bottom-20 right-4 w-[min(92vw,380px)] rounded-xl border border-neutral-700 bg-neutral-900 shadow-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-neutral-800 flex items-center justify-between">
            <div className="font-medium">Assistant</div>
            <button
              className="text-sm text-neutral-400 hover:text-neutral-200"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>

          <div className="max-h-[50vh] overflow-auto p-3 space-y-2 text-sm">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "text-right"
                    : ""
                }
              >
                <span
                  className={
                    "inline-block px-2 py-1 rounded " +
                    (m.role === "user"
                      ? "bg-neutral-700 text-neutral-50"
                      : "bg-neutral-800 text-neutral-200")
                  }
                >
                  {m.text}
                </span>
              </div>
            ))}
          </div>

          <form onSubmit={onSend} className="p-3 border-t border-neutral-800 flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Try: "switch to light theme"'
              className="input flex-1"
              disabled={busy}
            />
            <button className="btn" disabled={busy || !input.trim()}>
              {busy ? "…" : "Send"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
