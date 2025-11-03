import { supabase } from "./supabase";

export type NotificationRow = {
  id: string;
  profile_id: string;
  kind: "like" | "comment" | "follow" | "system";
  payload: any;
  created_at: string;
  read_at: string | null;
};

export async function fetchNotifications(limit = 30): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}

export async function markAllRead(): Promise<void> {
  const { error } = await supabase.rpc("mark_all_notifications_read");
  if (error) throw error;
}
