// app/src/lib/notifications.ts
import { supabase } from "./supabase";

export type NotificationRow = {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  metadata: any;
  created_at: string;
  read_at: string | null;
};

export async function fetchNotifications(limit = 50): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;
}

export async function markAllNotificationsRead() {
  // Only mark unread ones to reduce writes
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);

  if (error) throw error;
}

export async function createNotification(params: {
  user_id: string; // recipient
  actor_id?: string | null; // who triggered it (owner)
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  metadata?: any;
}) {
  const payload = {
    user_id: params.user_id,
    actor_id: params.actor_id ?? null,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    href: params.href ?? null,
    metadata: params.metadata ?? {},
  };

  const { error } = await supabase.from("notifications").insert(payload);
  if (error) throw error;
}
