// app/src/routes/profiles/PublicProfile.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";

/* ---------- types ---------- */
type Artwork = { id: string; title: string | null; image_url: string | null };
type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  instagram?: string | null;
  x_handle?: string | null;
  youtube?: string | null;
  telegram?: string | null;
};

export default function PublicProfile() {
  const { handle } = useParams();
  const [sp, setSp] = useSearchParams();
  const activeTab = (sp.get("tab") as "created" | "purchased" | "hidden") || "created";

  const [viewerId, setViewerId] = useState<string | null>(null);
  const [p, setP] = useState<Profile | null>(null);

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingGrid, setLoadingGrid] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [created, setCreated] = useState<Artwork[]>([]);
  const [purchased, setPurchased] = useState<Artwork[]>([]);
  const [hidden, setHidden] = useState<Artwork[]>([]);

  const ARTWORK_COLS = "id,title,image_url,creator_id,owner_id,created_at";

  /* session (viewer) */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setViewerId(data.session?.user?.id ?? null);
    })();
  }, []);

  /* load profile by handle or id */
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingProfile(true);
      setMsg(null);
      try {
        let { data, error } = await supabase
          .from("profiles")
          .select(
            "id,username,display_name,bio,avatar_url,cover_url,instagram,x_handle,youtube,telegram"
          )
          .eq("username", handle!)
          .maybeSingle();

        if (!data) {
          const r = await supabase
            .from("profiles")
            .select(
              "id,username,display_name,bio,avatar_url,cover_url,instagram,x_handle,youtube,telegram"
            )
            .eq("id", handle!)
            .maybeSingle();
          data = r.data as any;
          error = r.error;
        }
        if (error) throw error;
        if (!data) {
          setMsg("Profile not found.");
          setP(null);
          return;
        }
        if (alive) setP(data as Profile);
      } catch (e: any) {
        setMsg(e?.message || "Failed to load profile.");
      } finally {
        if (alive) setLoadingProfile(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [handle]);

  /* helpers */
  const mapArt = (rows: any[]): Artwork[] =>
    (rows || []).map((r) => ({
      id: r.id,
      title: r.title ?? null,
      image_url: r.image_url ?? null,
    }));

  /* loaders (Created excludes hidden when viewing your own profile) */
  async function loadCreated(profileId: string, isMe: boolean) {
    const { data, error } = await supabase
      .from("artworks")
      .select(ARTWORK_COLS)
      .eq("creator_id", profileId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const createdRows = (data ?? []) as any[];

    if (!isMe || createdRows.length === 0) {
      setCreated(mapArt(createdRows));
      return;
    }

    // You are viewing your own profile → exclude artworks you own & marked hidden.
    const ids = createdRows.map((r) => r.id);
    const { data: hiddenRows, error: hErr } = await supabase
      .from("ownerships")
      .select("artwork_id")
      .eq("owner_id", profileId)
      .eq("hidden", true)          // ← no quantity filter; some rows may have nulls
      .in("artwork_id", ids);
    if (hErr) throw hErr;

    const hiddenIds = new Set((hiddenRows ?? []).map((r: any) => r.artwork_id));
    setCreated(
      createdRows
        .filter((r) => !hiddenIds.has(r.id))
        .map((r) => ({ id: r.id, title: r.title, image_url: r.image_url }))
    );
  }

  async function loadPurchased(profileId: string) {
    const { data: own, error } = await supabase
      .from("ownerships")
      .select(
        `
        artwork_id,
        updated_at,
        artworks:artworks!ownerships_artwork_id_fkey ( id, title, image_url )
      `
      )
      .eq("owner_id", profileId)
      .eq("hidden", false)  // only visible
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    type Row = { artwork_id: string; artworks: any | any[] };
    const rows = (own ?? []) as Row[];
    const ids = rows.map((r) => r.artwork_id);
    const map = new Map(
      rows
        .map((r) => (Array.isArray(r.artworks) ? r.artworks[0] : r.artworks))
        .filter(Boolean)
        .map((a: any) => [a.id, a])
    );
    setPurchased(ids.map((id) => map.get(id)).filter(Boolean).map((a: any) => ({
      id: a.id, title: a.title, image_url: a.image_url
    })));
  }

  async function loadHidden(profileId: string) {
    const { data, error } = await supabase
      .from("ownerships")
      .select(
        `
        artwork_id,
        artworks:artworks!ownerships_artwork_id_fkey ( id, title, image_url )
      `
      )
      .eq("owner_id", profileId)
      .eq("hidden", true)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const rows = (data ?? []) as { artworks: any | any[] }[];
    setHidden(
      rows
        .map((r) => (Array.isArray(r.artworks) ? r.artworks[0] : r.artworks))
        .filter(Boolean)
        .map((a: any) => ({ id: a.id, title: a.title, image_url: a.image_url }))
    );
  }

  /* load for active tab */
  useEffect(() => {
    if (!p?.id) return;
    let alive = true;
    const isMe = Boolean(viewerId && viewerId === p.id);

    const load = async () => {
      setLoadingGrid(true);
      setMsg(null);
      try {
        if (activeTab === "created") {
          await loadCreated(p.id, isMe);
        } else if (activeTab === "purchased") {
          await loadPurchased(p.id);
        } else {
          // Hidden only makes sense for owner view (RLS will enforce anyway)
          await loadHidden(p.id);
        }
      } catch (e: any) {
        setMsg(e?.message || "Failed to load artworks.");
      } finally {
        if (alive) setLoadingGrid(false);
      }
    };

    load();
    return () => {
      alive = false;
    };
  }, [p?.id, viewerId, activeTab]);

  /* title */
  useEffect(() => {
    if (!p) return;
    document.title = `${p.display_name?.trim() || p.username || "Profile"} — taedal`;
  }, [p]);

  /* derived */
  const isMe = useMemo(() => Boolean(viewerId && p?.id && viewerId === p.id), [viewerId, p?.id]);
  const coverUrl = p?.cover_url || "";
  const avatarUrl = p?.avatar_url || "/images/taedal-logo.svg";
  const displayName = p?.display_name?.trim() || p?.username || "Profile";
  const usernameText = p?.username ? `@${p.username}` : null;

  const setTab = (t: "created" | "purchased" | "hidden") =>
    setSp((cur) => {
      const copy = new URLSearchParams(cur);
      copy.set("tab", t);
      return copy;
    }, { replace: true });

  if (loadingProfile) return <div className="p-6">loading…</div>;

  return (
    <div className="min-h-[100dvh]">
      {/* Cover */}
      <div className="relative border-b border-neutral-800 overflow-hidden" style={{ height: "clamp(12rem, 48vh, 52rem)" }}>
        {coverUrl ? (
          <img src={coverUrl} alt="cover" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-neutral-900" />
        )}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: "radial-gradient(120% 80% at 50% 40%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0.55) 80%)",
        }}/>
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-black/70 pointer-events-none" />
      </div>

      {/* Header */}
      <div className="max-w-6xl mx-auto px-4 -mt-12 md:-mt-14 relative z-10 pb-2">
        <div className="flex items-end justify-between">
          <div className="flex items-end gap-4">
            <img src={avatarUrl} alt="avatar" className="h-24 w-24 rounded-full object-cover ring-4 ring-black shadow-xl bg-neutral-900" />
            <div className="pb-1">
              <h1 className="text-2xl font-bold">{displayName}</h1>
              {usernameText && <p className="text-neutral-400">{usernameText}</p>}
              <div className="mt-1"><Socials p={p} /></div>
            </div>
          </div>
          <div className="pb-1">{isMe ? <Link to="/account" className="btn">Edit profile</Link> : null}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="sticky top-14 z-30 bg-black/75 backdrop-blur border-b border-neutral-800">
        <div className="max-w-6xl mx-auto px-4 h-12 flex items-end gap-6">
          <TabButton active={activeTab === "created"} onClick={() => setTab("created")}>Created</TabButton>
          <TabButton active={activeTab === "purchased"} onClick={() => setTab("purchased")}>Purchased</TabButton>
          {isMe && (
            <TabButton active={activeTab === "hidden"} onClick={() => setTab("hidden")}>Hidden</TabButton>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {msg && <div className="mb-4 text-amber-300 text-sm">{msg}</div>}
        {loadingGrid ? (
          <GridSkeleton />
        ) : activeTab === "created" ? (
          <ArtworkGrid items={created} emptyText="No artworks yet." />
        ) : activeTab === "purchased" ? (
          <ArtworkGrid items={purchased} emptyText="No purchased pieces yet." />
        ) : (
          <ArtworkGrid items={hidden} emptyText="No hidden pieces." />
        )}
      </div>
    </div>
  );
}

/* ---------- UI bits ---------- */
function TabButton({ active, onClick, children }: { active?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        "h-12 -mb-px px-1 border-b-2",
        active ? "border-white text-white" : "border-transparent text-neutral-400 hover:text-neutral-200",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function ArtworkGrid({ items, emptyText }: { items: Artwork[]; emptyText: string }) {
  if (!items?.length) return <div className="card text-sm text-neutral-400">{emptyText}</div>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
      {items.map((a) => (
        <Link
          key={a.id}
          to={`/art/${a.id}`}
          className="group rounded-xl overflow-hidden border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 transition"
        >
          <div className="aspect-square bg-neutral-800">
            {a.image_url ? (
              <img src={a.image_url} alt={a.title ?? "Artwork"} className="w-full h-full object-cover" loading="lazy" />
            ) : null}
          </div>
          <div className="p-3">
            <div className="truncate font-medium group-hover:text-white">{a.title || "Untitled"}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-xl overflow-hidden border border-neutral-800 bg-neutral-900 animate-pulse">
          <div className="aspect-square bg-neutral-800/70" />
          <div className="p-3 h-5 bg-neutral-800/70" />
        </div>
      ))}
    </div>
  );
}

function Socials({ p }: { p: Profile | null }) {
  if (!p) return null;
  const items: { label: string; href: string }[] = [];
  if (p.instagram) items.push({ label: "IG", href: `https://instagram.com/${p.instagram.replace(/^@/, "")}` });
  if (p.x_handle) items.push({ label: "X", href: `https://x.com/${p.x_handle.replace(/^@/, "")}` });
  if (p.youtube) items.push({ label: "YT", href: p.youtube.startsWith("http") ? p.youtube : `https://youtube.com/${p.youtube}` });
  if (p.telegram) items.push({ label: "TG", href: `https://t.me/${p.telegram.replace(/^@/, "")}` });
  if (!items.length) return null;
  return (
    <div className="flex items-center gap-2">
      {items.map((it) => (
        <a key={it.label} href={it.href} target="_blank" rel="noreferrer" className="text-xs px-2 py-0.5 rounded-md bg-neutral-800 hover:bg-neutral-700">
          {it.label}
        </a>
      ))}
    </div>
  );
}
