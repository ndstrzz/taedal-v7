// src/assistant/AssistantDock.tsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

  useEffect(() => {
    localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  }, [open]);
  useEffect(() => {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  }, [pos]);

  // Drag bubble
  const drag = useRef<{ startX: number; startY: number; origin: Pos } | null>(
    null
  );
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
      x: Math.min(Math.max(drag.current.origin.x - dx, 8), vw - 64),
      y: Math.min(Math.max(drag.current.origin.y - dy, 8), vh - 64),
    });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    drag.current = null;
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

  // Intent plumbing
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

// ...

async function handleRun(text: string) {
  const action = classifyIntent(text);

  // record the attempt
  track("assistant_command", {
    text,
    action: (action as any)?.type ?? "NONE",
    route: location.pathname,
    ok: action.type !== "NONE",
  });

  if (action.type === "NONE") {
    setStatus('Try: "light theme", "go to account", "tour".');
    return;
  }
  if (action.type === "NAVIGATE" && !confirm(`Go to ${action.to}?`)) return;

  setStatus("Running…");
  await runAction(action);
  setStatus("Done.");
  setTimeout(() => setStatus(""), 900);
}

  // Videos
  const bubbleVideoSrc = [
    { src: "/images/chatbot.webm", type: "video/webm" },
    { src: "/images/chatbot.mp4", type: "video/mp4" },
  ];
  const heroRef = useRef<HTMLVideoElement | null>(null);
  const titleAvatarRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    // replay hero + avatar when opening; pause when closing (saves CPU)
    const vids = [heroRef.current, titleAvatarRef.current].filter(
      Boolean
    ) as HTMLVideoElement[];
    if (open) {
      vids.forEach((v) => {
        try {
          v.currentTime = 0;
          v.play().catch(() => {});
        } catch {}
      });
    } else {
      vids.forEach((v) => {
        try {
          v.pause();
        } catch {}
      });
    }
  }, [open]);

  if (!root) return null;

  // Panel style
  const panelStyle: React.CSSProperties = {
    position: "fixed",
    right: (bubbleBox.right as number) + 68,
    bottom: bubbleBox.bottom,
    zIndex: 2147483647,
    pointerEvents: "auto",
    background: "var(--assistant-panel-bg, rgba(12,12,12,0.94))",
    border: "1px solid var(--assistant-panel-border, rgba(255,255,255,0.14))",
    borderRadius: 24,
    boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
    color: "var(--assistant-panel-fg, #fff)",
    width: Math.min(440, window.innerWidth - 24),
    overflow: "hidden",
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
          boxShadow:
            "0 10px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06) inset",
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
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            pointerEvents: "none",
          }}
        >
          {bubbleVideoSrc.map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
        </video>
        <span
          className="assistant-bot-fallback"
          role="img"
          aria-label="assistant"
          style={{ pointerEvents: "none" }}
        >
          🦊
        </span>
      </button>

      {/* Panel */}
      {open && (
        <div role="dialog" aria-label="Taedal assistant" style={panelStyle}>
          {/* HERO */}
          <div style={{ position: "relative", background: "#0a0a0a" }}>
            <video
              ref={heroRef}
              className="key-black"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              style={{
                width: "100%",
                height: 460,
                objectFit: "cover",
                display: "block",
              }}
            >
              {bubbleVideoSrc.map((s) => (
                <source key={s.src} src={s.src} type={s.type} />
              ))}
            </video>

            {/* pinned top-left logo */}
            <img
              src="/images/taedal-static.svg"
              alt="taedal"
              style={{
                position: "absolute",
                top: 8,
                left: 8,
                height: 22,
                width: 22,
                zIndex: 2,
                filter: "drop-shadow(0 1px 2px rgba(0,0,0,.5))",
                pointerEvents: "auto",
                userSelect: "none",
              }}
            />

            {/* pinned top-right close */}
            <button
              onClick={() => setOpen(false)}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                zIndex: 2,
                background: "rgba(0,0,0,0.55)",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "#fff",
                width: 28,
                height: 28,
                borderRadius: 9999,
                display: "grid",
                placeItems: "center",
                pointerEvents: "auto",
                lineHeight: 1,
              }}
              aria-label="Close assistant"
              title="Close"
            >
              ✕
            </button>
          </div>

          {/* BODY */}
          <div style={{ padding: 24 }}>
            {/* Title Row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 6,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  height: 36,
                  width: 36,
                  borderRadius: 9999,
                  overflow: "hidden",
                  border:
                    "1px solid var(--assistant-avatar-border, rgba(255,255,255,0.2))",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <video
                  ref={titleAvatarRef}
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
                  }}
                >
                  {bubbleVideoSrc.map((s) => (
                    <source key={s.src} src={s.src} type={s.type} />
                  ))}
                </video>
              </div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>쿠로</div>
            </div>

            <p
              style={{
                fontSize: 12,
                color: "var(--assistant-hint, #bbb)",
                margin: "0 0 10px",
              }}
            >
              Try: “light theme”, “dark theme”, “go to account”, “tour”.
            </p>

            {/* Quick actions */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <button
                className="assistant-action"
                onClick={() =>
                  runAction({ type: "TOGGLE_THEME", mode: "light" })
                }
              >
                Light theme
              </button>
              <button
                className="assistant-action"
                onClick={() =>
                  runAction({ type: "TOGGLE_THEME", mode: "dark" })
                }
              >
                Dark theme
              </button>
              <button
                className="assistant-action"
                onClick={() => handleRun("go to account")}
              >
                Go to Account
              </button>
              <button
                className="assistant-action"
                onClick={() => handleRun("tour")}
              >
                Start tour
              </button>
            </div>

            {/* Command input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (query.trim()) handleRun(query);
              }}
              style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Type a command… e.g. "upload avatar"'
                aria-label="Assistant command"
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  border:
                    "1px solid var(--assistant-input-border, rgba(255,255,255,.12))",
                  background: "var(--assistant-input-bg, rgba(24,24,24,.9))",
                  color: "var(--assistant-input-fg, #fff)",
                  fontSize: 14,
                }}
              />
              <button
                className="assistant-action"
                type="submit"
                style={{ padding: "12px 18px", borderRadius: 12 }}
              >
                Run
              </button>
            </form>

            {status && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--assistant-hint, #777)",
                  marginTop: 8,
                }}
                aria-live="polite"
              >
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
