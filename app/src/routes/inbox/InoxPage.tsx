// app/src/routes/inbox/InboxPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  fetchInboxNotifications,
  markManyRead,
  type NotificationRow,
} from "../../lib/notifications";

type TabKey = "all" | "auctions" | "purchases" | "contracts" | "system";

function tabOf(n: NotificationRow): TabKey {
  const t = (n.type || "").toLowerCase();

  if (t.startsWith("auction") || t.includes("bid") || t.includes("outbid") || t.includes("won"))
    return "auctions";

  if (t.startsWith("purchase") || t.startsWith("order") || t.startsWith("payment"))
    return "purchases";

  if (t.startsWith("contract") || t.includes("license"))
    return "contracts";

  return "system";
}

export default function InboxPage() {
  const nav = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>("all");
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const u = data.session?.user ?? null;
      if (!alive) return;
      setUserId(u?.id ?? null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const refresh = async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchInboxNotifications(200);
      setRows(data);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load inbox.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (tab === "all") return rows;
    return rows.filter((r) => tabOf(r) === tab);
  }, [rows, tab]);

  const unreadIdsAll = useMemo(
    () => rows.filter((r) => !r.read_at).map((r) => r.id),
    [rows]
  );

  const tabs: { key: TabKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "auctions", label: "Auctions" },
    { key: "purchases", label: "Purchases" },
    { key: "contracts", label: "Contracts" },
    { key: "system", label: "System" },
  ];

  const onOpen = async (n: NotificationRow) => {
    try {
      if (userId && !n.read_at) {
        await markManyRead(userId, [n.id]);
        setRows((prev) =>
          prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
        );
      }
    } catch {
      // ignore
    }

    if (n.href) {
      if (n.href.startsWith("http")) window.location.href = n.href;
      else nav(n.href);
    }
  };

  if (!userId) {
    return (
      <div className="max-w-5xl mx-auto px-8 py-10">
        <h1 className="text-3xl font-semibold">Inbox</h1>
        <p className="text-white/70 mt-2">Sign in to view your notifications.</p>
        <button className="btn mt-6" onClick={() => nav("/signin")}>
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-8 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Inbox</h1>
          <p className="text-white/60 mt-1">
            Notifications like auction wins, contract updates, and system alerts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button className="btn" onClick={refresh} disabled={loading}>
            Refresh
          </button>
          <button
            className="btn"
            onClick={async () => {
              if (!userId) return;
              await markManyRead(userId, unreadIdsAll);
              setRows((prev) => prev.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })));
            }}
            disabled={!unreadIdsAll.length}
            title={!unreadIdsAll.length ? "No unread notifications" : "Mark all as read"}
          >
            Mark all read
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex flex-wrap gap-2">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={[
                "px-3 py-1.5 rounded-xl border text-sm transition",
                active
                  ? "border-white/25 bg-white/10 text-white"
                  : "border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06]",
              ].join(" ")}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
        {loading ? (
          <div className="p-5 text-white/60">Loading…</div>
        ) : err ? (
          <div className="p-5 text-amber-300">{err}</div>
        ) : filtered.length === 0 ? (
          <div className="p-5 text-white/60">No notifications yet.</div>
        ) : (
          <ul>
            {filtered.map((n) => {
              const unread = !n.read_at;
              return (
                <li
                  key={n.id}
                  className={[
                    "px-5 py-4 border-t border-white/10 first:border-t-0",
                    "hover:bg-white/[0.04] transition",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(n)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {unread && <span className="h-2 w-2 rounded-full bg-red-500 mt-1" />}
                          <div className={["font-medium truncate", unread ? "text-white" : "text-white/80"].join(" ")}>
                            {n.title}
                          </div>
                        </div>
                        {n.body && (
                          <div className="text-sm text-white/60 mt-1 line-clamp-2">
                            {n.body}
                          </div>
                        )}
                        <div className="text-xs text-white/40 mt-2">
                          {new Date(n.created_at).toLocaleString()}
                        </div>
                      </div>

                      {n.href && (
                        <div className="text-xs text-white/50 whitespace-nowrap">
                          Open →
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
