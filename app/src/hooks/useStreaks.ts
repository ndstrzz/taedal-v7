import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export type StreakRow = {
  profile_id: string;
  current: number;
  longest: number;
  updated_on: string | null; // date
};

export function useStreaks() {
  const [data, setData] = useState<StreakRow | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const uid = s?.session?.user?.id;
      if (!uid) return setData(null);
      const { data: row, error } = await supabase
        .from("streaks")
        .select("*")
        .eq("profile_id", uid)
        .maybeSingle();
      if (error) throw error;
      setData((row ?? null) as StreakRow | null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return { data, loading, refresh };
}
