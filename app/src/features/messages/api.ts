// C:\Users\User\Downloads\taedal-v7\app\src\features\messages\api.ts

import type { DMKind, DMMessageRow, DMThreadRow, DMFriendRow } from "./types";
import { supabase } from "../../lib/supabase";

/* ---------------- threads ---------------- */

export async function dmListThreads(box: "inbox" | "requests"): Promise<DMThreadRow[]> {
  const { data, error } = await supabase.rpc("dm_list_threads", { box });
  if (error) throw error;
  return (data ?? []) as DMThreadRow[];
}

export async function dmAcceptThread(threadId: string): Promise<void> {
  const { error } = await supabase.rpc("dm_accept_thread", { thread_id: threadId });
  if (error) throw error;
}

export async function dmGetOrCreateThread(otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc("dm_get_or_create_thread", {
    other_user: otherUserId,
  });
  if (error) throw error;
  return String(data);
}

export async function dmListFriends(): Promise<DMFriendRow[]> {
  const { data, error } = await supabase.rpc("dm_list_friends");
  if (error) throw error;
  return (data ?? []) as DMFriendRow[];
}

/**
 * IMPORTANT:
 * If you ever have a synthetic id like friend:<uuid>, you MUST convert it to a real thread first
 * using dmGetOrCreateThread(other_user_id) before calling dmFetchMessages/dmSend...
 */
export function dmIsSyntheticFriendThreadId(threadId: string) {
  return threadId.startsWith("friend:");
}

/* ---------------- messages ---------------- */

export async function dmFetchMessages(threadId: string, limit = 120): Promise<DMMessageRow[]> {
  const { data, error } = await supabase
    .from("dm_messages")
    .select("id,thread_id,sender_id,kind,body,shared_post_id,shared_artwork_id,created_at,meta")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as DMMessageRow[];
}

/* ---------------- storage (image/voice) ---------------- */

/** Upload media into Storage bucket `dm-media` (bucket must exist). */
export async function dmUploadMedia(
  threadId: string,
  file: File
): Promise<{ url: string; path: string }> {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const safeExt = ext.replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${threadId}/${crypto.randomUUID()}.${safeExt}`;

  const { error: upErr } = await supabase.storage.from("dm-media").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (upErr) throw upErr;

  const { data } = supabase.storage.from("dm-media").getPublicUrl(path);
  const url = data.publicUrl;
  if (!url) throw new Error("Failed to get public URL");

  return { url, path };
}

/* ---------------- send (V2) ---------------- */

/**
 * V2 sender.
 * Requires postgres function:
 *   dm_send_message_v2(thread_id uuid, kind text, body text, shared_post_id uuid, shared_artwork_id uuid, meta jsonb)
 *
 * IMPORTANT:
 * - ALWAYS pass shared_artwork_id (null if not artwork_share), otherwise PostgREST can't match signature.
 * - DO NOT pass undefined; use null explicitly.
 */
export async function dmSendMessageV2(args: {
  threadId: string;
  kind: DMKind;

  body?: string | null;
  shared_post_id?: string | null;
  shared_artwork_id?: string | null;

  meta?: Record<string, any>;
}): Promise<DMMessageRow> {
  // Guard: threadId must be a real uuid, not friend:<uuid>
  if (dmIsSyntheticFriendThreadId(args.threadId)) {
    throw new Error("Cannot send to friend:<id>. Create/get a real thread_id first.");
  }

  const payload = {
    thread_id: args.threadId,
    kind: args.kind,
    body: args.body ?? null,
    shared_post_id: args.shared_post_id ?? null,

    // ✅ CRITICAL: keep this key present (null if unused)
    shared_artwork_id: args.shared_artwork_id ?? null,

    meta: args.meta ?? {},
  };

  const { data, error } = await supabase.rpc("dm_send_message_v2", payload);
  if (error) throw error;

  return data as DMMessageRow;
}

/* ---------------- convenience helpers ---------------- */

export async function dmSendText(threadId: string, text: string) {
  return dmSendMessageV2({
    threadId,
    kind: "text",
    body: text,
    shared_post_id: null,
    shared_artwork_id: null,
    meta: {},
  });
}

export async function dmSendPostShare(
  threadId: string,
  postId: string,
  meta: Record<string, any> = {}
) {
  return dmSendMessageV2({
    threadId,
    kind: "post_share",
    body: null,
    shared_post_id: postId,
    shared_artwork_id: null,
    meta,
  });
}

export async function dmSendArtworkShare(
  threadId: string,
  artworkId: string,
  meta: Record<string, any> = {}
) {
  return dmSendMessageV2({
    threadId,
    kind: "artwork_share",
    body: null,
    shared_post_id: null,
    shared_artwork_id: artworkId,
    meta,
  });
}

export async function dmSendImage(threadId: string, file: File) {
  const { url, path } = await dmUploadMedia(threadId, file);
  return dmSendMessageV2({
    threadId,
    kind: "image",
    body: null,
    shared_post_id: null,
    shared_artwork_id: null,
    meta: {
      url,
      path,
      mime: file.type || null,
      name: file.name || null,
      size: file.size || null,
    },
  });
}

export async function dmSendVoice(threadId: string, file: File, extras: Record<string, any> = {}) {
  const { url, path } = await dmUploadMedia(threadId, file);
  return dmSendMessageV2({
    threadId,
    kind: "voice",
    body: null,
    shared_post_id: null,
    shared_artwork_id: null,
    meta: {
      url,
      path,
      mime: file.type || null,
      name: file.name || null,
      size: file.size || null,
      ...extras,
    },
  });
}
