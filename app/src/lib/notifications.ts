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

export type UnreadCounts = {
  inboxUnread: number; // excludes message-type notifs
  messagesUnread: number; // message-type notifs only
};

export type CreateNotificationInput = {
  user_id: string; // recipient
  actor_id?: string | null; // sender/trigger (defaults to current user if omitted)
  type: string; // e.g. "auction_won", "purchase", "contract_update", "message"
  title: string;
  body?: string | null;
  href?: string | null;
  metadata?: any;
};

export async function createNotification(input: CreateNotificationInput) {
  // If caller didn't provide actor_id, try to use the current user
  let actor_id = input.actor_id ?? null;

  if (!actor_id) {
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) throw authErr;
    actor_id = auth.user?.id ?? null;
  }

  // If still null, this will fail RLS in frontend inserts (by design)
  if (!actor_id) {
    throw new Error(
      "createNotification(): actor_id is required for client-side inserts. If this is a system notification, create it from an Edge Function (service role)."
    );
  }

  const payload = {
    user_id: input.user_id,
    actor_id,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    href: input.href ?? null,
    metadata: input.metadata ?? {},
  };

  const { error } = await supabase.from("notifications").insert(payload);
  if (error) throw error;
}

export async function fetchNotificationsForUser(
  userId: string,
  limit = 200
): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id,user_id,actor_id,type,title,body,href,metadata,created_at,read_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}

export async function fetchInboxNotificationsForUser(
  userId: string,
  limit = 200
): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id,user_id,actor_id,type,title,body,href,metadata,created_at,read_at")
    .eq("user_id", userId)
    .neq("type", "message")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}

export async function getUnreadCounts(userId: string): Promise<UnreadCounts> {
  const inbox = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("type", "message")
    .is("read_at", null);

  if (inbox.error) throw inbox.error;

  const msgs = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "message")
    .is("read_at", null);

  if (msgs.error) throw msgs.error;

  return {
    inboxUnread: inbox.count ?? 0,
    messagesUnread: msgs.count ?? 0,
  };
}

export async function markManyRead(userId: string, ids: string[]) {
  if (!ids.length) return;
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: now })
    .eq("user_id", userId)
    .in("id", ids);

  if (error) throw error;
}
