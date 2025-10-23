import React, { useEffect, useRef, useState } from "react";
import { actions } from "./actions";

export default function AssistantDock() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!panelRef.current) return;
      if (panelRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <>
      {/* Floating button */}
      <button
        aria-label="Assistant"
        onClick={() => setOpen((v) => !v)}
        className="fixed z-50 right-4 bottom-4 h-12 w-12 rounded-full bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 shadow-lg grid place-items-center"
      >
        💬
      </button>

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          className="fixed z-50 right-4 bottom-20 w-72 rounded-xl border border-neutral-700 bg-neutral-900 shadow-xl overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-neutral-800 font-semibold">Assistant</div>
          <div className="p-2 grid gap-1">
            {actions.map((a) => (
              <button
                key={a.key}
                onClick={async () => {
                  await Promise.resolve(a.run());
                  setOpen(false);
                }}
                className="text-left w-full px-3 py-2 rounded-md hover:bg-neutral-800"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
