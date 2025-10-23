// app/src/assistant/AssistantDock.tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../providers/ThemeProvider";
import { runAssistantAction } from "./actions";
import { inferActionFromText } from "./intent";
import { startTour } from "./tours";

type Msg = { role: "user" | "assistant"; text: string };

export default function AssistantDock() {
  const [open, setOpen] = useState(true);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", text: "Hi! Try “switch to light theme”, “go to account”, or “guide me to upload an avatar.”" },
  ]);
  const [input, setInput] = useState("");
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    const x = Number(localStorage.getItem("assistant.x") || 16);
    const y = Number(localStorage.getItem("assistant.y") || 16);
    return { x, y };
  });
  const anchor = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const { setTheme } = useTheme();

  // drag
  function onMouseDown(e: React.MouseEvent) {
    if (!anchor.current) return;
    const startX = e.clientX, startY = e.clientY;
    const { x, y } = pos;
    const move = (ev: MouseEvent) => setPos({ x: x + (ev.clientX - startX), y: y + (ev.clientY - startY) });
    const up = () => {
      localStorage.setItem("assistant.x", String(pos.x));
      localStorage.setItem("assistant.y", String(pos.y));
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  async function send() {
    const text = input.trim();
    if (!text) return;
    setMsgs((m) => [...m, { role: "user", text }]);
    setInput("");

    const { reply, action } = inferActionFromText(text);
    if (reply) setMsgs((m) => [...m, { role: "assistant", text: reply }]);
    if (action) {
      const res = await runAssistantAction(action, {
        navigate: (p) => nav(p),
        setTheme: (m) => setTheme(m),
        startTour: (k) => {
          // ensure we’re on /account before starting avatar tour (best UX)
          if (k === "uploadAvatar" && location.pathname !== "/account") {
            nav("/account");
            setTimeout(() => startTour(k), 400);
          } else {
            startTour(k);
          }
        },
      });
      if (res.message) setMsgs((m) => [...m, { role: "assistant", text: res.message }]);
    }
  }

  useEffect(() => {
    // Close with ESC
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[1000] rounded-full h-12 w-12 bg-neutral-800 border border-neutral-700 shadow-xl"
        title="Open assistant"
      >🤖</button>
    );
  }

  return (
    <div
      ref={anchor}
      className="fixed z-[1000] w-80 rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="cursor-move flex items-center justify-between px-3 py-2 bg-neutral-800 rounded-t-xl select-none" onMouseDown={onMouseDown}>
        <div className="font-medium">Assistant</div>
        <button onClick={() => setOpen(false)} className="text-sm opacity-80 hover:opacity-100">×</button>
      </div>

      <div className="h-64 overflow-y-auto p-3 space-y-2 text-sm">
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div className={`inline-block px-2 py-1 rounded ${m.role === "user" ? "bg-blue-600" : "bg-neutral-800"}`}>
              {m.text}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 p-2 border-t border-neutral-800">
        <input
          className="flex-1 input"
          placeholder="Ask me something…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="btn" onClick={send}>Send</button>
      </div>
    </div>
  );
}
