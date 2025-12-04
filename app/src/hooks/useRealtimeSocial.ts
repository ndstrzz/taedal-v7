// app/src/hooks/useRealtimeSocial.ts
import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

type PgEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

export type RealtimeOptions = {
  tables?: string[];          // defaults below
  events?: PgEvent[];         // defaults to ["*"]
  throttleMs?: number;        // default 150ms
  pauseWhenHidden?: boolean;  // default true
};

/**
 * Realtime listener for social tables (posts, media, likes, comments).
 * Uses Supabase channel API (v2) with small type assertions to satisfy TS
 * across versions that type the .on() overloads differently.
 */
export function useRealtimeSocial(onChange?: () => void, opts?: RealtimeOptions) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  const throttleRef = useRef<number | null>(null);
  const visibleRef = useRef<boolean>(true);

  const {
    tables = ["posts", "post_media", "post_likes", "post_comments"],
    events = ["*"],
    throttleMs = 150,
    pauseWhenHidden = true,
  } = opts || {};

  useEffect(() => {
    const schedule = () => {
      if (!cbRef.current) return;
      if (pauseWhenHidden && !visibleRef.current) return;
      if (throttleRef.current != null) return;
      throttleRef.current = window.setTimeout(() => {
        throttleRef.current = null;
        cbRef.current?.();
      }, throttleMs);
    };

    // Create one channel and attach multiple postgres_changes handlers
    const channel = supabase.channel("realtime:social");

    for (const table of tables) {
      for (const ev of events) {
        // TS shim: some @supabase/supabase-js versions narrow the overload
        // to "system". We cast the event+filter to any to keep it version-agnostic.
        (channel as any).on(
          "postgres_changes" as any,
          { event: ev, schema: "public", table } as any,
          schedule
        );
      }
    }

    const subscription = channel.subscribe();

    const onVis = () => {
      visibleRef.current = document.visibilityState !== "hidden";
      if (visibleRef.current) schedule();
    };
    if (pauseWhenHidden) {
      document.addEventListener("visibilitychange", onVis);
    }

    return () => {
      if (pauseWhenHidden) document.removeEventListener("visibilitychange", onVis);
      if (throttleRef.current != null) {
        clearTimeout(throttleRef.current);
        throttleRef.current = null;
      }
      try {
        supabase.removeChannel(channel);
        (subscription as any)?.unsubscribe?.();
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [throttleMs, pauseWhenHidden, JSON.stringify(tables), JSON.stringify(events)]);
}
