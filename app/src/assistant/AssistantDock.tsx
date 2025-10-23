// src/assistant/AssistantDock.tsx
import { useState, useEffect } from "react";

export default function AssistantDock() {
  const [open, setOpen] = useState(false);

  // Defensive: ensure it can’t hide behind your layout
  useEffect(() => {
    // tiny heartbeat to confirm it's mounted
    // console.log("[assistant] dock mounted");
  }, []);

  const Z = 2147483647; // max-ish

  const bubbleStyle: React.CSSProperties = {
    position: "fixed",
    right: 16,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: 9999,
    border: "1px solid rgba(255,255,255,.2)",
    background: "rgba(17,17,17,.92)",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    boxShadow: "0 8px 28px rgba(0,0,0,.45)",
    zIndex: Z,
  };

  const panelStyle: React.CSSProperties = {
    position: "fixed",
    right: 16,
    bottom: 84, // sits above the bubble
    width: 360,
    maxWidth: "calc(100vw - 32px)",
    background: "rgba(12,12,12,.96)",
    color: "#fff",
    border: "1px solid rgba(255,255,255,.14)",
    borderRadius: 12,
    padding: 12,
    boxShadow: "0 20px 50px rgba(0,0,0,.6)",
    backdropFilter: "blur(8px)",
    zIndex: Z,
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  };

  const hintStyle: React.CSSProperties = {
    fontSize: 12,
    color: "#bbb",
    margin: "4px 0 10px",
  };

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  };

  const btnStyle: React.CSSProperties = {
    fontSize: 12,
    borderRadius: 10,
    padding: "9px 10px",
    textAlign: "center" as const,
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(24,24,24,.95)",
    color: "#fff",
    cursor: "pointer",
  };

  return (
    <>
      {/* Bubble */}
      <button
        aria-label="Open taedal assistant"
        style={bubbleStyle}
        onClick={() => setOpen((v) => !v)}
        title="Taedal Assistant"
      >
        🦊
      </button>

      {/* Panel */}
      {open && (
        <div style={panelStyle} role="dialog" aria-label="Taedal assistant">
          <div style={headerStyle}>
            <strong>Taedal Assistant</strong>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: "transparent",
                border: 0,
                color: "#aaa",
                fontSize: 18,
                cursor: "pointer",
              }}
              title="Close"
              aria-label="Close assistant"
            >
              ✕
            </button>
          </div>

          <p style={hintStyle}>
            Try: “change to light theme” or “go to account”. This is a minimal
            dock to prove visibility.
          </p>

          <div style={gridStyle}>
            <button
              style={btnStyle}
              onClick={() => {
                document.documentElement.setAttribute("data-theme", "light");
              }}
            >
              Light theme
            </button>
            <button
              style={btnStyle}
              onClick={() => {
                document.documentElement.setAttribute("data-theme", "dark");
              }}
            >
              Dark theme
            </button>

            <button
              style={btnStyle}
              onClick={() => {
                if (window.location.pathname !== "/account") {
                  window.history.pushState({}, "", "/account");
                  window.dispatchEvent(new PopStateEvent("popstate"));
                }
              }}
            >
              Go to Account
            </button>
            <button
              style={btnStyle}
              onClick={() => {
                alert("Tour would start here (placeholder).");
              }}
            >
              Start tour
            </button>
          </div>
        </div>
      )}
    </>
  );
}
