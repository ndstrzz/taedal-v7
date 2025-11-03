import { supabase } from "./supabase";

export type Media = { url: string; kind: "image" | "video" };
export type Post = {
  id: string;
  author_id: string;
  text: string | null;
  created_at: string;
  media?: Media[];
  author?: {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
  };
  like_count?: number;
  comment_count?: number;
  did_like?: boolean;
};

export type Page<T> = { items: T[]; next?: { lt_created_at: string } };

export async function getSessionUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/** Keyset-paginated feed via view v_feed (from migration) */
export async function fetchFeedPage(params: { limit?: number; lt_created_at?: string } = {}): Promise<Page<Post>> {
  const uid = await getSessionUserId();
  if (!uid) throw new Error("Not signed in");

  const limit = Math.max(1, Math.min(params.limit ?? 20, 50));
  let q = supabase
    .from("v_feed")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (params.lt_created_at) q = q.lt("created_at", params.lt_created_at);

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as any[];
  const hasMore = rows.length > limit;
  const slice = rows.slice(0, limit);

  const items: Post[] = slice.map((r) => ({
    id: r.post_id,
    author_id: r.author_id,
    text: r.text,
    created_at: r.created_at,
    media: (r.media || []) as Media[],
    author: {
      id: r.author_id,
      username: r.username,
      display_name: r.display_name,
      avatar_url: r.avatar_url,
    },
    like_count: r.like_count ?? 0,
    comment_count: r.comment_count ?? 0,
    did_like: r.did_like ?? false,
  }));

  const next = hasMore ? { lt_created_at: items[items.length - 1].created_at } : undefined;
  return { items, next };
}

export async function createPost(input: { text?: string; media?: Media[] }) {
  const uid = await getSessionUserId();
  if (!uid) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("posts")
    .insert({ author_id: uid, text: input.text ?? null, media: input.media ?? [] })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function likePost(postId: string) {
  const uid = await getSessionUserId();
  if (!uid) throw new Error("Not signed in");
  const { error } = await supabase.from("post_likes").insert({ post_id: postId, profile_id: uid }).single();
  if (error && (error as any).code !== "23505") throw error; // ignore duplicate like
}

export async function unlikePost(postId: string) {
  const uid = await getSessionUserId();
  if (!uid) throw new Error("Not signed in");
  const { error } = await supabase.from("post_likes").delete().match({ post_id: postId, profile_id: uid });
  if (error) throw error;
}

export async function addComment(postId: string, text: string) {
  const uid = await getSessionUserId();
  if (!uid) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("post_comments")
    .insert({ post_id: postId, author_id: uid, text })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
