import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useFollowList, type SocialMiniProfile } from "../../hooks/useFollowList";

type Mode = "followers" | "following";

/* ------- small row ------- */
function PersonRow({ p }: { p: SocialMiniProfile }) {
  const href = `/u/${p.username || p.id}`;
  return (
    <Link
      to={href}
      className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 hover:bg-neutral-900"
    >
      <img
        src={p.avatar_url || "/images/taedal-logo.svg"}
        alt=""
        className="h-10 w-10 rounded-full object-cover"
        loading="lazy"
      />
      <div className="min-w-0">
        <div className="truncate font-medium">{p.display_name || p.username || "User"}</div>
        <div className="text-sm text-neutral-400 truncate">@{p.username || p.id}</div>
      </div>
    </Link>
  );
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-neutral-800">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="h-10 w-10 rounded-full bg-neutral-800 animate-pulse" />
          <div className="flex-1">
            <div className="h-4 w-40 bg-neutral-800 animate-pulse rounded" />
            <div className="h-3 w-28 bg-neutral-800 animate-pulse rounded mt-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FollowListPage() {
  const { handle } = useParams();
  const nav = useNavigate();
  const loc = useLocation();

  // /u/:handle/followers vs /u/:handle/following
  const mode: Mode = useMemo(
    () => (loc.pathname.endsWith("/following") ? "following" : "followers"),
    [loc.pathname]
  );

  // resolve :handle to profile id (username first, then assume id)
  const [profileId, setProfileId] = useState<string | null>(null);
  const [titleName, setTitleName] = useState("Profile");

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!handle) return;
      let { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, username")
        .eq("username", handle)
        .maybeSingle();

      if (!data) {
        const r = await supabase
          .from("profiles")
          .select("id, display_name, username")
          .eq("id", handle)
          .maybeSingle();
        data = r.data as any;
        error = r.error;
      }

      if (error || !data) {
        nav(`/u/${handle}`, { replace: true });
        return;
      }
      if (mounted) {
        setProfileId(data.id);
        setTitleName(data.display_name?.trim() || data.username || "Profile");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [handle, nav]);

  // HOOK — note: only TWO args and it returns { items, loading, error }
  const { items, loading, error } = useFollowList(profileId, mode);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">
            {titleName} — {mode === "followers" ? "Followers" : "Following"}
          </h1>
          <div className="text-neutral-400">
            <Link to={`/u/${handle}`} className="hover:underline">
              ← Back to profile
            </Link>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-3 text-amber-300 text-sm">
          {typeof error === "string" ? error : "Failed to load list."}
        </div>
      )}

      {!items.length && loading ? (
        <ListSkeleton />
      ) : items.length ? (
        <div className="rounded-xl border border-neutral-800 overflow-hidden bg-black/40">
          {items.map((row) => (
            <PersonRow key={row.id} p={row} />
          ))}
        </div>
      ) : (
        <div className="card text-neutral-400">No users to show.</div>
      )}
    </div>
  );
}
