// app/src/routes/collection/CollectionPage.tsx
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";

type Collection = {
  id: string;
  name: string | null;
  slug: string | null;
  description: string | null;
  owner_id: string | null;
};

type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type ArtworkCard = {
  id: string;
  title: string | null;
  image_url: string | null;
};

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/10 border border-white/10">
      {children}
    </span>
  );
}

export default function CollectionPage() {
  const { slug: slugOrId } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [col, setCol] = useState<Collection | null>(null);
  const [owner, setOwner] = useState<Profile | null>(null);
  const [arts, setArts] = useState<ArtworkCard[]>([]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr(null);
      try {
        if (!slugOrId) throw new Error("Missing slug");

        // 1) Try by slug
        let c: Collection | null = null;
        {
          const { data, error } = await supabase
            .from("collections")
            .select("id,name,slug,description,owner_id")
            .eq("slug", slugOrId)
            .maybeSingle();
          if (error) throw error;
          c = (data as Collection) ?? null;
        }

        // 2) Fallback: if it *looks* like a UUID and slug lookup failed, try by id
        if (!c && isUuid(slugOrId)) {
          const { data, error } = await supabase
            .from("collections")
            .select("id,name,slug,description,owner_id")
            .eq("id", slugOrId)
            .maybeSingle();
          if (error) throw error;
          c = (data as Collection) ?? null;
        }

        if (!c) throw new Error("Collection not found");
        if (!alive) return;
        setCol(c);

        // 3) Load owner profile (optional)
        if (c.owner_id) {
          const { data: p } = await supabase
            .from("profiles")
            .select("id,username,display_name,avatar_url")
            .eq("id", c.owner_id)
            .maybeSingle();
          if (alive) setOwner((p as Profile) ?? null);
        }

        // 4) Artworks in this collection
        const { data: a, error: ae } = await supabase
          .from("artworks")
          .select("id,title,image_url")
          .eq("collection_id", c.id)
          .order("created_at", { ascending: false })
          .limit(60);
        if (ae) throw ae;

        if (!alive) return;
        setArts(((a ?? []) as any[]).map((r) => ({
          id: r.id,
          title: r.title ?? null,
          image_url: r.image_url ?? null,
        })));
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load collection.");
        setCol(null);
        setArts([]);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => { alive = false; };
  }, [slugOrId]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="h-7 w-64 bg-white/10 rounded animate-pulse mb-3" />
        <div className="h-4 w-80 bg-white/10 rounded animate-pulse" />
        <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden">
              <div className="aspect-square bg-white/10 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (err || !col) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-2">Collection</h1>
        {err && <p className="text-amber-300">{err}</p>}
        <Link to="/" className="btn mt-4 inline-block">Back home</Link>
      </div>
    );
  }

  const ownerHandle = owner
    ? owner.username ? `/u/${owner.username}` : `/u/${owner.id}`
    : null;

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-semibold truncate">{col.name || col.slug || "Collection"}</h1>
          <Pill>Collection</Pill>
        </div>
        <div className="text-sm text-white/80">
          by{" "}
          {owner ? (
            <Link to={ownerHandle!} className="underline">
              {owner.display_name || owner.username || "creator"}
            </Link>
          ) : (
            "—"
          )}
        </div>
        {col.description && (
          <p className="text-sm text-white/70 whitespace-pre-wrap">{col.description}</p>
        )}
      </header>

      <section>
        {arts.length === 0 ? (
          <div className="text-white/70">No artworks in this collection yet.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {arts.map((a) => (
              <Link
                key={a.id}
                to={`/art/${a.id}`}
                className="group rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden hover:border-white/30 transition"
              >
                <div className="aspect-square bg-neutral-950">
                  {a.image_url ? (
                    <img src={a.image_url} alt={a.title ?? "Artwork"} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-white/40">No image</div>
                  )}
                </div>
                <div className="p-3">
                  <div className="truncate font-medium">{a.title || "Untitled"}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div>
        <Link to="/" className="btn">Back home</Link>
      </div>
    </div>
  );
}
