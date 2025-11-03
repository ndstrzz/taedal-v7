import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

/**
 * Realtime listener for social tables.
 * Debounces bursts so we don't spam refresh().
 */
export function useRealtimeSocial(onChange?: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const trigger = () => {
      if (!onChange) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => onChange(), 150);
    };

    const channel = supabase
      .channel("rt-social")
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, trigger)
      .on("postgres_changes", { event: "*", schema: "public", table: "post_media" }, trigger)
      .on("postgres_changes", { event: "*", schema: "public", table: "post_likes" }, trigger)
      .on("postgres_changes", { event: "*", schema: "public", table: "post_comments" }, trigger)
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [onChange]);
}

export default useRealtimeSocial;
