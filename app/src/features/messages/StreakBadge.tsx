import React from "react";

export default function StreakBadge({ count, visible }: { count: number; visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80">
      <span className="text-base">🔥</span>
      <span className="font-medium">{count}-day streak</span>
    </div>
  );
}
