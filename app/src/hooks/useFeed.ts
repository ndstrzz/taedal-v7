import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export type Post = {
  id: string;
  author_id: string;
  caption: string | null;
  created_at: string;
  listing_id: string | null;
  visibility: "public" | "followers";
  like_count: number;
  comment_count: number;
  did_like?: boolean;
};

export type PostMedia = {
  id: string;
  post_id: string;
  url: string;
  kind: "image" | "video";
  width?: number | null;
  height?: number | null;
  duration_s?: number | null;
};

export type MiniProfile = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

async function getUid(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

export function useFeed(pageSize = 20) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [posts, setPosts] = useState<Post[]>([]);
  const [mediaByPost, setMediaByPost] = useState<Record<string, PostMedia[]>>({});
  const [profiles, setProfiles] = useState<Record<string, MiniProfile>>({});

  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<{ created_at: string; id: string } | null>(null);
  const loadingMoreRef = useRef(false);

  const fetchPage = useCallback(
    async (cursor?: { created_at: string; id: string }) => {
      let q = supabase
        .from("v_feed_secure")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(pageSize);

      if (cursor) {
        q = q.or(
          `and(created_at.lt.${cursor.created_at}),and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`
        );
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Post[];
    },
    [pageSize]
  );

  const hydrateMediaAndAuthors = useCallback(async (batch: Post[]) => {
    const ids = batch.map((p) => p.id);

    if (ids.length) {
      const { data: mediaRows, error: mErr } = await supabase
        .from("post_media")
        .select("*")
        .in("post_id", ids);
      if (mErr) throw mErr;

      setMediaByPost((prev) => {
        const next = { ...prev };
        (mediaRows ?? []).forEach((m: any) => {
          (next[m.post_id] ||= []).push(m as PostMedia);
        });
        return next;
      });
    }

    const authorIds = Array.from(new Set(batch.map((p) => p.author_id)));
    if (authorIds.length) {
      const { data: profs, error: pErr } = await supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url")
        .in("id", authorIds);
      if (pErr) throw pErr;

      setProfiles((prev) => {
        const next = { ...prev };
        (profs ?? []).forEach((r: any) => (next[r.id] = r as MiniProfile));
        return next;
      });
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const first = await fetchPage();
        if (!alive) return;

        setPosts(first);
        setHasMore(first.length === pageSize);
        cursorRef.current =
          first.length > 0
            ? { created_at: first[first.length - 1].created_at, id: first[first.length - 1].id }
            : null;

        await hydrateMediaAndAuthors(first);
      } catch (e: any) {
        if (alive) setError(e?.message || "Failed to load feed.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [pageSize, fetchPage, hydrateMediaAndAuthors]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    try {
      const cur = cursorRef.current ?? undefined;
      const next = await fetchPage(cur);

      setPosts((prev) => [...prev, ...next]);
      setHasMore(next.length === pageSize);

      cursorRef.current =
        next.length > 0
          ? { created_at: next[next.length - 1].created_at, id: next[next.length - 1].id }
          : cursorRef.current;

      if (next.length) await hydrateMediaAndAuthors(next);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [fetchPage, hasMore, pageSize, hydrateMediaAndAuthors]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const first = await fetchPage();

      setPosts(first);
      setHasMore(first.length === pageSize);
      cursorRef.current =
        first.length > 0
          ? { created_at: first[first.length - 1].created_at, id: first[first.length - 1].id }
          : null;

      setMediaByPost({});
      setProfiles({});
      await hydrateMediaAndAuthors(first);
    } catch (e: any) {
      setError(e?.message || "Failed to refresh feed.");
    } finally {
      setLoading(false);
    }
  }, [fetchPage, pageSize, hydrateMediaAndAuthors]);

  const items = useMemo(
    () =>
      posts.map((p) => ({
        post: p,
        media: mediaByPost[p.id] || [],
        author: profiles[p.author_id] || null,
      })),
    [posts, mediaByPost, profiles]
  );

  async function toggleLike(postId: string, wantLike: boolean) {
    const uid = await getUid();
    if (!uid) {
      alert("Please sign in to like posts.");
      return;
    }

    const snapshot = posts;

    setPosts((prev) =>
      prev.map((p) =>
        p.id !== postId
          ? p
          : {
              ...p,
              like_count: Math.max(0, (p.like_count ?? 0) + (wantLike ? 1 : -1)),
              did_like: wantLike,
            }
      )
    );

    try {
      if (wantLike) {
        const { error } = await supabase.from("post_likes").insert({ post_id: postId, profile_id: uid });
        if (error && (error as any).code !== "23505") throw error;
      } else {
        const { error } = await supabase
          .from("post_likes")
          .delete()
          .match({ post_id: postId, profile_id: uid });
        if (error) throw error;
      }
    } catch (e: any) {
      console.error("[toggleLike] failed:", e);
      alert(e?.message || "Like failed.");
      setPosts(snapshot);
      await refresh();
    }
  }

  async function addComment(postId: string, text: string) {
    const uid = await getUid();
    if (!uid) {
      alert("Please sign in to comment.");
      return;
    }

    try {
      const { error } = await supabase.from("post_comments").insert({ post_id: postId, author_id: uid, text });
      if (error) throw error;

      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, comment_count: (p.comment_count || 0) + 1 } : p))
      );
    } catch (e: any) {
      console.error("[addComment] failed:", e);
      alert(e?.message || "Comment failed.");
      await refresh();
    }
  }

  return { loading, error, items, hasMore, loadMore, toggleLike, addComment, refresh };
}
