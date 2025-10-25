import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";

type Collection = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
};

type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type Artwork = {
  id: string;
  title: string | null;
  image_url: string | null;
  status: string | null;
};

const isUUID = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );

export default function CollectionPage() {
  const { slug = "" } = useParams();
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [owner, setOwner] = useState<Profile | null>(null);
  const [artworks, setArtworks] = useState<Artwork[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setMsg(null);
      try {
        // 1) Load collection by slug OR id
        let coll: Collection | null = null;

        if (isUUID(slug)) {
          const { data, error } = await supabase
            .from("collections")
            .select("id,owner_id,name,slug,description,logo_url,banner_url")
            .eq("id", slug)
            .maybeSingle();
          if (error) throw error;
          coll = (data as any) ?? null;

          // Normalize URL to slug if we have it
          if (coll?.slug && coll.slug !== slug) {
            nav(`/collection/${coll.slug}`, { replace: true });
            // do not return early; we can still render after redirect
          }
        } else {
          const { data, error } = await supabase
            .from("collections")
            .select("id,owner_id,name,slug,description,logo_url,banner_url")
            .eq("slug", slug)
            .maybeSingle();
          if (error) throw error;
          coll = (data as any) ?? null;
        }

        if (!alive) return;
        if (!coll) {
          setCollection(null);
          setMsg("Collection not found.");
          return;
        }
        setCollection(coll);

        // 2) Load owner profile
        const { data: prof } = await supabase
          .from("profiles")
          .select("id,username,display_name,avatar_url")
          .eq("id", coll.owner_id)
          .maybeSingle();
        if (!alive) return;
        setOwner((prof as any) ?? null);

        // 3) Load artworks in this collection
        const { data: arts } = await supabase
          .from("artworks")
          .select("id,title,image_url,status")
          .eq("collection_id", coll.id)
          .eq("status", "active")
          .order("created_at", { ascending: false });
        if (!alive) return;
        setArtworks(((arts as any[]) ?? []).filter(Boolean));
      } catch (e: any) {
        if (!alive) return;
        setMsg(e?.message ?? "Failed to load collection.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [slug, nav]);

  const ownerHandle = useMemo(() => {
    if (!owner) return null;
    return owner.username ? `/u/${owner.username}` : `/u/${owner.id}`;
  }, [owner]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="h-8 w-64 bg-white/10 rounded animate-pulse mb-3" />
        <div className="h-4 w-80 bg-white/10 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.04]">
              <div className="aspect-square bg-white/10 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <h1 className="text-2xl font-semibold mb-2">Collection</h1>
        <p className="text-amber-300">{msg || "Not found."}</p>
        <div className="mt-4">
          <Link to="/" className="btn">
            Back home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden">
        {collection.banner_url ? (
          <div className="h-40 sm:h-56 w-full overflow-hidden">
            <img
              src={collection.banner_url}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="h-24 w-full bg-white/[0.03]" />
        )}

        <div className="p-4 flex items-start gap-3">
          {collection.logo_url ? (
            <img
              src={collection.logo_url}
              className="h-14 w-14 rounded-xl object-cover border border-white/10"
            />
          ) : (
            <div className="h-14 w-14 rounded-xl bg-white/10 border border-white/10" />
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">{collection.name}</h1>
            <div className="text-sm text-white/70">
              by{" "}
              {owner ? (
                <Link to={ownerHandle ?? "#"} className="underline">
                  {owner.display_name || owner.username || "creator"}
                </Link>
              ) : (
                "—"
              )}
              {" · "}
              <span className="text-white/60">/{collection.slug}</span>
            </div>
            {collection.description ? (
              <p className="text-sm text-white/80 mt-2 whitespace-pre-wrap">
                {collection.description}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {artworks.length === 0 ? (
          <div className="col-span-full text-white/70">
            No active items in this collection yet.
          </div>
        ) : (
          artworks.map((a) => (
            <Link
              key={a.id}
              to={`/art/${a.id}`}
              className="group rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden hover:border-white/30 transition"
            >
              <div className="aspect-square bg-neutral-950">
                {a.image_url ? (
                  <img
                    src={a.image_url}
                    alt={a.title ?? "Artwork"}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-white/40">
                    No image
                  </div>
                )}
              </div>
              <div className="p-3">
                <div className="truncate font-medium">{a.title || "Untitled"}</div>
              </div>
            </Link>
          ))
        )}
      </div>

      <div className="pt-2">
        <Link to="/" className="btn">
          Back
        </Link>
      </div>
    </div>
  );
}
