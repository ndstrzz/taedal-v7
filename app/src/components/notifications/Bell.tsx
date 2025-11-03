import { useRef, useState, useEffect } from "react";
import { useNotifications } from "../../hooks/useNotifications";

function lineFor(n: any) {
  const k = n.kind;
  const p = n.payload || {};
  if (k === "like") return `Someone liked your post`;
  if (k === "comment") return `New comment on your post`;
  if (k === "follow") return `You have a new follower`;
  return p.message || "Notification";
}

export default function Bell() {
  const { items, unread, loading, error, markAll, refresh } = useNotifications(25);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex items-center justify-center h-9 w-9 rounded-lg bg-neutral-900 border border-neutral-800 hover:bg-neutral-800"
        title="Notifications"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 text-[10px] leading-none px-1.5 py-0.5 rounded-full bg-rose-500 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-auto rounded-xl border border-neutral-800 bg-neutral-900 shadow-xl z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
            <div className="font-semibold">Notifications</div>
            <div className="flex items-center gap-2">
              <button className="text-xs text-neutral-300 hover:underline" onClick={refresh}>
                Refresh
              </button>
              <button className="text-xs text-neutral-300 hover:underline" onClick={markAll}>
                Mark all read
              </button>
            </div>
          </div>

          {loading && <div className="p-3 text-sm text-neutral-400">Loading…</div>}
          {error && <div className="p-3 text-amber-300 text-sm">{error}</div>}
          {!loading && items.length === 0 && (
            <div className="p-3 text-sm text-neutral-400">You’re all caught up.</div>
          )}

          <ul className="divide-y divide-neutral-800">
            {items.map((n) => (
              <li key={n.id} className={`p-3 ${!n.read_at ? "bg-neutral-850/50" : ""}`}>
                <div className="text-sm">{lineFor(n)}</div>
                <div className="text-xs text-neutral-400 mt-0.5">
                  {new Date(n.created_at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
