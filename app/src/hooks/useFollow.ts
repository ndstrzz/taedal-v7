import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export type MiniProfile = {
  other_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
};

export function useFollowList(
  profileId: string | null | undefined,
  kind: "followers" | "following",
  limit = 24
) {
  const [items, setItems] = useState<MiniProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!profileId) return;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const from = kind === "followers" ? "v_followers" : "v_following";
        const { data, error } = await supabase
          .from(from)
          .select("other_id, username, display_name, avatar_url, created_at")
          .eq("profile_id", profileId)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (error) throw error;
        if (!alive) return;
        setItems((data ?? []) as MiniProfile[]);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to load list.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [profileId, kind, limit]);

  return { items, loading, error };
}
