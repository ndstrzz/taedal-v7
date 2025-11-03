import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export type FollowListRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  // relationship flags (from the viewer’s perspective)
  i_follow: boolean;   // viewer → this user
  follows_me: boolean; // this user → viewer
  mutual: boolean;     // both directions
};

/** Back-compat alias if another file expects this name */
export type SocialMiniProfile = FollowListRow;

type Kind = "followers" | "following";

/**
 * Followers / Following list with pagination + relationship flags.
 * Returns: { items, loading, error, hasMore, loadMore }
 */
export function useFollowList(
  profileId?: string | null,
  kind: Kind = "followers",
  pageSize = 32
) {
  const [items, setItems] = useState<FollowListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // Reset when inputs change
  useEffect(() => {
    setItems([]);
    setPage(0);
    setHasMore(true);
  }, [profileId, kind, pageSize]);

  useEffect(() => {
    let alive = true;
    if (!profileId) {
      setItems([]);
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // Who is the viewer?
        const { data: auth } = await supabase.auth.getUser();
        const viewer = auth.user?.id ?? null;

        const from = page * pageSize;
        const to = from + pageSize - 1;

        if (kind === "followers") {
          // Preferred path: materialized view with precomputed flags
          const { data, error } = await supabase
            .from("follows_with_profiles")
            .select(
              "follower_id, follower_username, follower_display_name, follower_avatar_url, i_follow, follows_me"
            )
            .eq("followee_id", profileId)
            .order("follower_username", { ascending: true })
            .range(from, to);

          if (!error && data) {
            const mapped = (data as any[]).map((r) => ({
              id: r.follower_id,
              username: r.follower_username,
              display_name: r.follower_display_name,
              avatar_url: r.follower_avatar_url,
              i_follow: !!r.i_follow,
              follows_me: !!r.follows_me,
              mutual: !!r.i_follow && !!r.follows_me,
            })) as FollowListRow[];

            if (alive) {
              setItems((prev) => (page === 0 ? mapped : [...prev, ...mapped]));
              setHasMore(mapped.length === pageSize);
            }
          } else {
            // Fallback: manual join + compute flags
            const { data: rows, error: e1 } = await supabase
              .from("follows")
              .select(
                "follower_id, profiles:follower_id ( id, username, display_name, avatar_url )"
              )
              .eq("followee_id", profileId)
              .order("created_at", { ascending: false })
              .range(from, to);
            if (e1) throw e1;

            const followerIds = (rows ?? []).map((r: any) => r.follower_id);
            let iFollowSet = new Set<string>();
            let followsMeSet = new Set<string>();

            if (viewer && followerIds.length) {
              const [{ data: iRows }, { data: meRows }] = await Promise.all([
                supabase
                  .from("follows")
                  .select("followee_id")
                  .eq("follower_id", viewer)
                  .in("followee_id", followerIds),
                supabase
                  .from("follows")
                  .select("follower_id")
                  .eq("followee_id", viewer)
                  .in("follower_id", followerIds),
              ]);
              iFollowSet = new Set((iRows ?? []).map((r: any) => r.followee_id));
              followsMeSet = new Set((meRows ?? []).map((r: any) => r.follower_id));
            }

            const mapped = (rows ?? []).map((r: any) => {
              const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
              const id = prof?.id || r.follower_id;
              const i_follow = viewer ? iFollowSet.has(id) : false;
              const follows_me = viewer ? followsMeSet.has(id) : false;
              return {
                id,
                username: prof?.username ?? null,
                display_name: prof?.display_name ?? null,
                avatar_url: prof?.avatar_url ?? null,
                i_follow,
                follows_me,
                mutual: i_follow && follows_me,
              } as FollowListRow;
            });

            if (alive) {
              setItems((prev) => (page === 0 ? mapped : [...prev, ...mapped]));
              setHasMore(mapped.length === pageSize);
            }
          }
        } else {
          // kind === "following"
          const { data, error } = await supabase
            .from("follows_with_profiles")
            .select(
              "followee_id, followee_username, followee_display_name, followee_avatar_url, i_follow, follows_me"
            )
            .eq("follower_id", profileId)
            .order("followee_username", { ascending: true })
            .range(from, to);

          if (!error && data) {
            const mapped = (data as any[]).map((r) => ({
              id: r.followee_id,
              username: r.followee_username,
              display_name: r.followee_display_name,
              avatar_url: r.followee_avatar_url,
              i_follow: !!r.i_follow,
              follows_me: !!r.follows_me,
              mutual: !!r.i_follow && !!r.follows_me,
            })) as FollowListRow[];

            if (alive) {
              setItems((prev) => (page === 0 ? mapped : [...prev, ...mapped]));
              setHasMore(mapped.length === pageSize);
            }
          } else {
            // Fallback manual join
            const { data: rows, error: e1 } = await supabase
              .from("follows")
              .select(
                "followee_id, profiles:followee_id ( id, username, display_name, avatar_url )"
              )
              .eq("follower_id", profileId)
              .order("created_at", { ascending: false })
              .range(from, to);
            if (e1) throw e1;

            const followeeIds = (rows ?? []).map((r: any) => r.followee_id);
            let iFollowSet = new Set<string>();
            let followsMeSet = new Set<string>();

            if (viewer && followeeIds.length) {
              const [{ data: iRows }, { data: meRows }] = await Promise.all([
                supabase
                  .from("follows")
                  .select("followee_id")
                  .eq("follower_id", viewer)
                  .in("followee_id", followeeIds),
                supabase
                  .from("follows")
                  .select("follower_id")
                  .eq("followee_id", viewer)
                  .in("follower_id", followeeIds),
              ]);
              iFollowSet = new Set((iRows ?? []).map((r: any) => r.followee_id));
              followsMeSet = new Set((meRows ?? []).map((r: any) => r.follower_id));
            }

            const mapped = (rows ?? []).map((r: any) => {
              const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
              const id = prof?.id || r.followee_id;
              const i_follow = viewer ? iFollowSet.has(id) : false;
              const follows_me = viewer ? followsMeSet.has(id) : false;
              return {
                id,
                username: prof?.username ?? null,
                display_name: prof?.display_name ?? null,
                avatar_url: prof?.avatar_url ?? null,
                i_follow,
                follows_me,
                mutual: i_follow && follows_me,
              } as FollowListRow;
            });

            if (alive) {
              setItems((prev) => (page === 0 ? mapped : [...prev, ...mapped]));
              setHasMore(mapped.length === pageSize);
            }
          }
        }
      } catch (e: any) {
        if (alive) setErr(e?.message || "Failed to load follows.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [profileId, kind, page, pageSize]);

  const loadMore = () => {
    if (!loading && hasMore) setPage((p) => p + 1);
  };

  return { items, loading, error: errorToText(error), hasMore, loadMore };
}

function errorToText(e: unknown): string | null {
  if (!e) return null;
  if (typeof e === "string") return e;
  if ((e as any)?.message) return (e as any).message;
  return "Something went wrong.";
}

export default useFollowList;
