// app/src/components/social/FollowList.tsx
import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { toggleFollow } from "../../lib/follow";
import type { FollowListRow } from "../../hooks/useFollowList";

type Props = {
  title: string;
  open: boolean;
  onClose(): void;
  rows: FollowListRow[];
  loading: boolean;
  error: string | null;
};

export default function FollowList({ title, open, onClose, rows, loading, error }: Props) {
  const [filter, setFilter] = useState<"all" | "mutuals">("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.mutual === true)),
    [rows, filter]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-neutral-800 bg-neutral-950 shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button className="h-8 w-8 grid place-items-center rounded hover:bg-white/10" onClick={onClose}>×</button>
        </div>

        {/* Filter chips */}
        <div className="px-4 py-2 border-b border-neutral-800 flex items-center gap-2">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>All</Chip>
          <Chip active={filter === "mutuals"} onClick={() => setFilter("mutuals")}>Mutuals</Chip>
        </div>

        <div className="max-h-[70vh] overflow-auto">
          {loading && <div className="p-4 text-neutral-400">Loading…</div>}
          {error && <div className="p-4 text-amber-300 text-sm">{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div className="p-4 text-neutral-400">No users to show.</div>
          )}

          <ul className="divide-y divide-neutral-900">
            {filtered.map((r) => (
              <li key={r.id} className="px-4 py-3 flex items-center gap-3">
                <img
                  src={r.avatar_url || "/images/taedal-logo.svg"}
                  alt=""
                  className="h-10 w-10 rounded-full object-cover"
                  loading="lazy"
                />
                <div className="min-w-0 flex-1">
                  <Link to={`/u/${r.username || r.id}`} className="block truncate font-medium hover:underline">
                    {r.display_name?.trim() || r.username || "User"}
                  </Link>
                  <div className="text-xs text-neutral-400">
                    @{r.username || r.id}
                    {r.mutual && <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] bg-white/10">Mutual</span>}
                  </div>
                </div>
                {/* Follow / Unfollow inline */}
                <button
                  disabled={busyId === r.id}
                  onClick={async () => {
                    setBusyId(r.id);
                    try {
                      const next = await toggleFollow(r.id);
                      // Local flip for UX (don’t refetch the whole list)
                      r.i_follow = next;
                      r.mutual = next && r.follows_me ? true : (!next && r.follows_me ? false : r.mutual);
                    } finally {
                      setBusyId(null);
                    }
                  }}
                  className={[
                    "px-3 py-1 rounded text-sm",
                    r.i_follow ? "bg-neutral-800 hover:bg-neutral-700" : "bg-white text-black hover:bg-white/90",
                    busyId === r.id ? "opacity-70 cursor-wait" : ""
                  ].join(" ")}
                >
                  {r.i_follow ? "Following" : "Follow"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-2.5 py-1 rounded-full text-xs border",
        active ? "bg-white text-black border-white" : "bg-transparent text-white/80 border-white/20 hover:border-white/40"
      ].join(" ")}
    >
      {children}
    </button>
  );
}
