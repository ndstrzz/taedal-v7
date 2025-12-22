import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

type PgEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

export type RealtimeOptions = {
  tables?: string[];
  events?: PgEvent[];
  throttleMs?: number;
  pauseWhenHidden?: boolean;
  channelName?: string;
};

function stableKey(arr: string[]) {
  return arr.slice().sort().join("|");
}

export function useRealtimeSocial(onChange?: () => void, opts?: RealtimeOptions) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  const throttleRef = useRef<number | null>(null);
  const visibleRef = useRef<boolean>(true);

  const {
    tables = ["posts", "post_media", "post_likes", "post_comments", "follows"],
    events = ["*"],
    throttleMs = 150,
    pauseWhenHidden = true,
    channelName = "realtime:social",
  } = opts || {};

  const tablesKey = stableKey(tables);
  const eventsKey = stableKey(events);

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

    const channel = supabase.channel(channelName);

    for (const table of tables) {
      for (const ev of events) {
        (channel as any).on(
          "postgres_changes" as any,
          { event: ev, schema: "public", table } as any,
          schedule
        );
      }
    }

    channel.subscribe();

    const onVis = () => {
      visibleRef.current = document.visibilityState !== "hidden";
      if (visibleRef.current) schedule();
    };

    if (pauseWhenHidden) document.addEventListener("visibilitychange", onVis);

    return () => {
      if (pauseWhenHidden) document.removeEventListener("visibilitychange", onVis);
      if (throttleRef.current != null) {
        clearTimeout(throttleRef.current);
        throttleRef.current = null;
      }
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [throttleMs, pauseWhenHidden, channelName, tablesKey, eventsKey]);
}
