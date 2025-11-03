import { useStreaks } from "../../hooks/useStreaks";

export default function StreakHUD() {
  const { data } = useStreaks();
  if (!data || (data.current ?? 0) <= 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/90 backdrop-blur px-3 py-2 shadow-xl">
        <div className="text-xs text-neutral-400">Streak</div>
        <div className="text-lg font-semibold">
          🔥 Day {data.current} <span className="text-xs text-neutral-400">best {data.longest}</span>
        </div>
      </div>
    </div>
  );
}
