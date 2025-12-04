// app/src/lib/feed.ts
import { supabase } from "./supabase";

/** ---------- Types ---------- */
export type MiniProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export type MediaRow = {
  url: string;
  kind: "image" | "video";
  width?: number | null;
  height?: number | null;
  duration_s?: number | null;
};

export type PostRow = {
  id: string;
  author_id: string;
  caption: string | null;
  created_at: string;
  visibility: "public" | "followers";
  listing_id: string | null;
  like_count: number;
  comment_count: number;
  author: MiniProfile | null;   // comes as JSON from the view
  media: MediaRow[];            // comes as JSON[] from the view
  did_like?: boolean;
};

const PAGE = 12;

/**
 * Fetch paginated feed from the v_feed view (future-proof, no FK hints).
 */
export async function fetchFeed(opts?: { cursor?: string | null }) {
  const cursor = opts?.cursor ?? null;

  let q = supabase
    .from("v_feed")
    .select(
      "id, author_id, caption, created_at, visibility, listing_id, like_count, comment_count, author, media"
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE);

  if (cursor) q = q.lte("created_at", cursor);

  const { data, error } = await q;
  if (error) throw error;

  // Normalize shapes from the view (already JSON/arrays).
  const rows: PostRow[] = (data ?? []).map((r: any) => ({
    id: r.id,
    author_id: r.author_id,
    caption: r.caption ?? null,
    created_at: r.created_at,
    visibility: r.visibility,
    listing_id: r.listing_id ?? null,
    like_count: Number(r.like_count ?? 0),
    comment_count: Number(r.comment_count ?? 0),
    author: r.author
      ? {
          id: String(r.author.id),
          username: r.author.username ?? null,
          display_name: r.author.display_name ?? null,
          avatar_url: r.author.avatar_url ?? null,
        }
      : null,
    media: Array.isArray(r.media) ? r.media : [],
    did_like: false,
  }));

  // Optional: mark did_like for signed-in user
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (uid && rows.length) {
    const ids = rows.map((p) => p.id);
    const { data: likes } = await supabase
      .from("post_likes")
      .select("post_id")
      .eq("user_id", uid)
      .in("post_id", ids);

    const liked = new Set((likes ?? []).map((r) => r.post_id));
    for (const p of rows) p.did_like = liked.has(p.id);
  }

  return { items: rows, next: rows.length ? rows[rows.length - 1].created_at : null };
}
