// app/src/routes/inbox/Inbox.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from "../../lib/notifications";

function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const s = Math.max(1, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function InboxPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const unreadCount = useMemo(
    () => (rows ? rows.filter((r) => !r.read_at).length : 0),
    [rows]
  );

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchNotifications(60);
      setRows(data);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load notifications.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function openRow(r: NotificationRow) {
    try {
      if (!r.read_at) {
        await markNotificationRead(r.id);
        setRows((prev) =>
          (prev ?? []).map((x) =>
            x.id === r.id ? { ...x, read_at: new Date().toISOString() } : x
          )
        );
      }
    } catch {
      // ignore UI errors
    }

    if (r.href) nav(r.href);
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Inbox</h1>
          <p className="text-sm text-white/60 mt-1">
            Notifications like auction wins, contract updates, and system alerts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.10] text-sm"
            onClick={load}
            disabled={loading}
            title="Refresh"
          >
            Refresh
          </button>
          <button
            className="px-3 py-2 rounded-xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.10] text-sm"
            onClick={async () => {
              await markAllNotificationsRead();
              setRows((prev) =>
                (prev ?? []).map((x) =>
                  x.read_at ? x : { ...x, read_at: new Date().toISOString() }
                )
              );
            }}
            disabled={!rows?.length || unreadCount === 0}
            title="Mark all as read"
          >
            Mark all read
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
        {loading ? (
          <div className="p-6 text-white/70">Loading…</div>
        ) : err ? (
          <div className="p-6">
            <div className="text-amber-300 text-sm">{err}</div>
          </div>
        ) : !rows || rows.length === 0 ? (
          <div className="p-6 text-white/70">No notifications yet.</div>
        ) : (
          <ul>
            {rows.map((r) => (
              <li key={r.id} className="border-t border-white/10 first:border-t-0">
                <button
                  type="button"
                  onClick={() => openRow(r)}
                  className={[
                    "w-full text-left px-5 py-4 flex items-start gap-3 hover:bg-white/[0.05]",
                    !r.read_at ? "bg-white/[0.02]" : "",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "mt-1 h-2.5 w-2.5 rounded-full shrink-0",
                      !r.read_at ? "bg-sky-400" : "bg-white/15",
                    ].join(" ")}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium truncate">{r.title}</div>
                      <div className="text-xs text-white/50 shrink-0">
                        {timeAgo(r.created_at)}
                      </div>
                    </div>
                    {r.body && (
                      <div className="text-sm text-white/70 mt-1 line-clamp-2">
                        {r.body}
                      </div>
                    )}
                    {r.href && (
                      <div className="text-xs text-sky-300/90 mt-2">
                        Open →
                      </div>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {rows && rows.length > 0 && (
        <div className="mt-3 text-xs text-white/50">
          Unread: {unreadCount}
        </div>
      )}
    </div>
  );
}
