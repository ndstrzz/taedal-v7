import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { fetchNotifications, markAllRead } from "../lib/notifications";

export type NotificationRow = {
  id: string;
  profile_id: string;
  kind: "like" | "comment" | "follow" | "system";
  payload: any;
  created_at: string;
  read_at: string | null;
};

export function useNotifications(limit = 30) {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setLoading(true);
      setError(null);
      const rows = await fetchNotifications(limit);
      setItems(rows);
    } catch (e: any) {
      setError(e?.message || "Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  }

  async function markAll() {
    await markAllRead();
    await refresh();
  }

  useEffect(() => {
    refresh();
  }, [limit]);

  // ✅ Wrap the async refresh so the callback is typed as void
  useEffect(() => {
    const ch = supabase
      .channel("notif-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        () => { void refresh(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const unread = items.filter((n) => !n.read_at).length;

  return { items, unread, loading, error, refresh, markAll };
}
