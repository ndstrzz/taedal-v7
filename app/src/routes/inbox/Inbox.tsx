// app/src/routes/inbox/Inbox.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  fetchNotifications,
  markManyRead,
  createNotification,
  type NotificationRow,
} from "../../lib/notifications";

type TabKey =
  | "all"
  | "auctions"
  | "purchases"
  | "contracts"
  | "messages"
  | "system";

function categoryOf(n: NotificationRow): TabKey {
  const t = (n.type || "").toLowerCase();

  if (t === "message" || t.startsWith("message_")) return "messages";
  if (t.startsWith("auction") || t.startsWith("bid")) return "auctions";
  if (t.startsWith("purchase") || t.startsWith("order") || t.startsWith("checkout"))
    return "purchases";
  if (t.startsWith("contract") || t.startsWith("license")) return "contracts";

  return "system";
}

function fmt(ts: string) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export default function Inbox() {
  const nav = useNavigate();
  const loc = useLocation();

  const [userId, setUserId] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>("all");
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const showDevTools =
    import.meta.env.DEV || new URLSearchParams(loc.search).has("dev");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (!uid) {
        setItems([]);
        return;
      }
      const rows = await fetchNotifications(250);
      setItems(rows);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load inbox.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const tabs = useMemo(
    () =>
      [
        ["all", "All"],
        ["auctions", "Auctions"],
        ["purchases", "Purchase history"],
        ["contracts", "Contracts"],
        ["messages", "Messages"],
        ["system", "System"],
      ] as const,
    []
  );

  const filtered = useMemo(() => {
    if (tab === "all") return items;
    return items.filter((n) => categoryOf(n) === tab);
  }, [items, tab]);

  const unreadIds = useMemo(
    () => filtered.filter((n) => !n.read_at).map((n) => n.id),
    [filtered]
  );

  async function markAllVisibleRead() {
    if (!userId) return;
    try {
      await markManyRead(userId, unreadIds);
      const now = new Date().toISOString();
      setItems((prev) =>
        prev.map((n) => (unreadIds.includes(n.id) ? { ...n, read_at: now } : n))
      );
    } catch (e: any) {
      setErr(e?.message ?? "Failed to mark as read.");
    }
  }

  async function openNotif(n: NotificationRow) {
    if (userId && !n.read_at) {
      try {
        await markManyRead(userId, [n.id]);
        const now = new Date().toISOString();
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: now } : x)));
      } catch {
        // don't block navigation
      }
    }
    if (n.href) nav(n.href);
  }

  async function sendTestNotif() {
    if (!userId) {
      setErr("Not signed in.");
      return;
    }
    setErr(null);
    try {
      // actor_id must match auth.uid() due to your insert policy
      await createNotification({
        user_id: userId,
        actor_id: userId,
        type: "system",
        title: "Test notification",
        body: "Inbox insert + RLS is working ✅",
        href: "/home",
        metadata: { source: "dev_button" },
      });

      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create test notification.");
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-8 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Inbox</h1>
          <p className="text-white/60 mt-1">
            Notifications like auction wins, contract updates, and system alerts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {showDevTools && (
            <button
              onClick={sendTestNotif}
              className="px-3 py-2 rounded-xl border border-white/10 hover:bg-white/5 text-sm"
              title="Dev-only: inserts a notification to your own inbox"
            >
              Send test
            </button>
          )}

          <button
            onClick={load}
            className="px-3 py-2 rounded-xl border border-white/10 hover:bg-white/5 text-sm"
          >
            Refresh
          </button>
          <button
            onClick={markAllVisibleRead}
            className="px-3 py-2 rounded-xl border border-white/10 hover:bg-white/5 text-sm"
            disabled={!unreadIds.length}
            title={!unreadIds.length ? "No unread in this tab" : "Mark all as read"}
          >
            Mark all read
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex flex-wrap gap-2">
        {tabs.map(([k, label]) => {
          const active = tab === k;
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={[
                "px-3 py-1.5 rounded-xl text-sm border",
                active
                  ? "bg-white text-black border-white"
                  : "border-white/10 text-white/80 hover:bg-white/5",
              ].join(" ")}
            >
              {label}
            </button>
          );
        })}
      </div>

      {err && (
        <div className="mt-4 text-sm text-amber-300 border border-amber-500/20 bg-amber-500/10 rounded-xl px-3 py-2">
          {err}
        </div>
      )}

      {/* List */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
        {loading ? (
          <div className="p-6 text-white/60">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-white/60">No notifications yet.</div>
        ) : (
          <ul>
            {filtered.map((n) => (
              <li key={n.id} className="border-t border-white/10 first:border-t-0">
                <button
                  onClick={() => openNotif(n)}
                  className="w-full text-left px-6 py-4 hover:bg-white/5 flex items-start gap-3"
                >
                  <div className="pt-1">
                    {!n.read_at ? (
                      <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                    ) : (
                      <div className="h-2.5 w-2.5 rounded-full bg-white/10" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium truncate">{n.title}</div>
                      <div className="text-xs text-white/45 shrink-0">
                        {fmt(n.created_at)}
                      </div>
                    </div>

                    {n.body && (
                      <div className="text-sm text-white/65 mt-1 line-clamp-2">
                        {n.body}
                      </div>
                    )}

                    <div className="text-xs text-white/40 mt-2">
                      {categoryOf(n).toUpperCase()}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showDevTools && (
        <div className="mt-4 text-xs text-white/40">
          Dev tools enabled (add <code className="text-white/60">?dev=1</code> to URL in prod).
        </div>
      )}
    </div>
  );
}
