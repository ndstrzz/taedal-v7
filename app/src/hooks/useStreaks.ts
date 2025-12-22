// app/src/hooks/useStreaks.ts
import { useCallback, useEffect, useState } from "react";

/**
 * IMPORTANT (for Taedal v7):
 * Your streak requirement is NOT profile-based.
 * It should only start when TWO users message each other consecutively for 3 days,
 * then continue day-by-day as long as both users keep messaging daily.
 *
 * That means streaks must be built on top of the messaging system:
 * - conversations
 * - conversation_members
 * - messages
 * - conversation_streaks (or derived view)
 *
 * So for now, we DISABLE the old streak DB read to prevent schema mismatch errors
 * (e.g. "column current of relation streaks does not exist") and avoid confusing UX.
 */

export type StreakRow = {
  current: number;   // day count (will be conversation-based later)
  longest: number;   // best streak for that conversation later
  updated_on?: string | null;
};

export function useStreaks() {
  const [data, setData] = useState<StreakRow | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * No-op refresh until messaging is implemented.
   * Keeps the API shape so StreakHUD and other callers don't break.
   */
  const refresh = useCallback(async () => {
    setLoading(false);
    setData(null);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, refresh };
}
