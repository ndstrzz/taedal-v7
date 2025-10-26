// app/src/routes/explore/Explore.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ArtworkCard from "../../components/ArtworkCard";
import { fetchActiveListings, type JoinedListing } from "../../lib/listings";
import { supabase } from "../../lib/supabase";

/* ------------------------------- types ------------------------------- */

type CollectionRow = {
  id: string;
  name: string | null;
  slug: string | null;
  logo_url?: string | null;   // optional — may not exist in your schema
  banner_url?: string | null; // optional — may not exist in your schema
  owner_id?: string | null;   // optional — may not exist in your schema
  created_at?: string | null; // optional — may not exist in your schema
};

type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

/* ----------------------------- CollectionCard ----------------------------- */

function CollectionCard({
  c,
  creator,
  itemsCount,
}: {
  c: CollectionRow;
  creator?: Profile | null;
  itemsCount?: number | null;
}) {
  const to = `/collection/${encodeURIComponent(c.slug || c.id)}`;
  const creatorName =
    creator?.display_name || creator?.username || (creator?.id ? creator.id.slice(0, 6) : "—");

  return (
    <Link
      to={to}
      className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.05] transition"
    >
      <div className="relative aspect-[16/9] bg-neutral-900">
        {c.banner_url ? (
          <img
            src={c.banner_url}
            alt={c.name ?? "Collection banner"}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-white/40 text-xs">
            No banner
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/0" />
        <div className="absolute -bottom-6 left-4 h-12 w-12 rounded-xl overflow-hidden border border-white/20 bg-neutral-800">
          {c.logo_url ? (
            <img src={c.logo_url} alt="Logo" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full grid place-items-center text-[10px] text-white/50">
              No logo
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pt-7 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-semibold">{c.name || c.slug || "Untitled collection"}</div>
            <div className="text-xs text-white/60">
              by{" "}
              {creator ? (
                <span className="underline">
                  {creatorName}
                </span>
              ) : (
                "—"
              )}
            </div>
          </div>
          <div className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/80">
            {itemsCount ?? "—"} items
          </div>
        </div>
      </div>
    </Link>
  );
}

/* --------------------------------- page --------------------------------- */

export default function Explore() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as "collections" | "listings") || "collections";

  /* ---------- shared UI state ---------- */
  function setTab(next: "collections" | "listings") {
    const nextSp = new URLSearchParams(sp);
    nextSp.set("tab", next);
    setSp(nextSp, { replace: true });
  }

  /* ========================= Collections tab state ========================= */

  const [q, setQ] = useState(sp.get("q") ?? "");
  const [sort, setSort] = useState<"new" | "alpha">((sp.get("sort") as any) || "new");

  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [creators, setCreators] = useState<Map<string, Profile>>(new Map());
  const [itemsCounts, setItemsCounts] = useState<Map<string, number>>(new Map());

  const [cLimit, setCLimit] = useState(24);
  const [cLoading, setCLoading] = useState(true);
  const [cBusyMore, setCBusyMore] = useState(false);
  const [cErr, setCErr] = useState<string | null>(null);

  async function loadCollections(initial = false) {
    if (initial) {
      setCLoading(true);
      setCErr(null);
    }
    try {
      const qq = (q || "").trim();
      let rows: CollectionRow[] = [];
      let hasOwnerId = true;     // assume wide shape until proven otherwise
      let canSortByCreated = true;

      // ---- Attempt WIDE projection (may fail if cols don't exist) ----
      try {
        let query = supabase
          .from("collections")
          .select("id,name,slug,logo_url,banner_url,owner_id,created_at")
          .limit(cLimit);

        if (qq) query = query.ilike("name", `%${qq}%`);
        if (sort === "alpha") {
          query = query.order("name", { ascending: true, nullsFirst: true });
        } else {
          query = query.order("created_at", { ascending: false, nullsFirst: true });
        }

        const { data, error } = await query;
        if (error) throw error;
        rows = (data as any) || [];
      } catch (e: any) {
        // ---- Fallback: MINIMAL shape (only guaranteed columns) ----
        hasOwnerId = false;
        canSortByCreated = false;
        let query = supabase
          .from("collections")
          .select("id,name,slug")
          .limit(cLimit);

        if (qq) query = query.ilike("name", `%${qq}%`);
        if (sort === "alpha") {
          query = query.order("name", { ascending: true, nullsFirst: true });
        } else {
          // created_at may not exist; use id as a stable fallback ordering
          query = query.order("id", { ascending: false });
        }

        const { data, error } = await query;
        if (error) throw error;
        rows = (data as any) || [];
      }

      setCollections(rows);

      // creators (only if owner_id column exists in returned rows)
      if (hasOwnerId) {
        const ownerIds = Array.from(
          new Set(rows.map((r: any) => r.owner_id).filter(Boolean) as string[])
        );
        if (ownerIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id,username,display_name,avatar_url")
            .in("id", ownerIds);
          const map = new Map<string, Profile>();
          (profs || []).forEach((p: any) => map.set(p.id, p as Profile));
          setCreators(map);
        } else {
          setCreators(new Map());
        }
      } else {
        setCreators(new Map());
      }

      // items count (safe)
      const countsMap = new Map<string, number>();
      await Promise.all(
        rows.map(async (r) => {
          const { count } = await supabase
            .from("artworks")
            .select("id", { count: "exact", head: true })
            .eq("collection_id", r.id);
          countsMap.set(r.id, count ?? 0);
        })
      );
      setItemsCounts(countsMap);
    } catch (e: any) {
      setCErr(e?.message ?? "Failed to load collections.");
    } finally {
      if (initial) setCLoading(false);
    }
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(sp);
    if (q) next.set("q", q);
    else next.delete("q");
    next.set("tab", "collections");
    setSp(next, { replace: true });
    loadCollections(true);
  }

  useEffect(() => {
    if (tab === "collections") {
      loadCollections(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sort, cLimit]);

  async function loadMoreCollections() {
    setCBusyMore(true);
    setCLimit((prev) => prev + 24);
    try {
      await loadCollections(false);
    } finally {
      setCBusyMore(false);
    }
  }

  /* ========================== Listings tab state ========================== */

  const [items, setItems] = useState<JoinedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [limit, setLimit] = useState(24);
  const [busyMore, setBusyMore] = useState(false);

  async function loadListings(initial = false) {
    if (initial) {
      setLoading(true);
      setErr(null);
    }
    try {
      const rows = await fetchActiveListings(limit);
      setItems(rows);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load listings.");
    } finally {
      if (initial) setLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "listings") {
      loadListings(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, limit]);

  async function loadMoreListings() {
    setBusyMore(true);
    setLimit((prev) => prev + 24);
    try {
      const rows = await fetchActiveListings(limit + 24);
      setItems(rows);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load more.");
    } finally {
      setBusyMore(false);
    }
  }

  /* -------------------------------- render -------------------------------- */

  return (
    <div className="mx-auto max-w-7xl p-6">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Explore</h1>
          <p className="text-sm text-neutral-400">
            {tab === "collections"
              ? "Discover curated collections across Taedal."
              : "Active fixed-price listings from creators across the platform."}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab("collections")}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              tab === "collections"
                ? "bg-white text-black font-medium"
                : "bg-white/0 text-white/80 hover:bg-white/10 border border-white/10"
            }`}
          >
            Collections
          </button>
          <button
            onClick={() => setTab("listings")}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              tab === "listings"
                ? "bg-white text-black font-medium"
                : "bg-white/0 text-white/80 hover:bg-white/10 border border-white/10"
            }`}
          >
            Listings
          </button>
        </div>
      </div>

      {/* Collections controls */}
      {tab === "collections" && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <form onSubmit={onSearchSubmit} className="flex w-full gap-2 sm:max-w-md">
            <input
              className="input flex-1"
              placeholder="Search collections…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="btn" type="submit">
              Search
            </button>
          </form>

          <div className="flex items-center gap-2">
            <label className="text-sm text-white/70">Sort</label>
            <select
              className="input"
              value={sort}
              onChange={(e) => setSort(e.target.value as any)}
            >
              <option value="new">Newest</option>
              <option value="alpha">A → Z</option>
            </select>
          </div>
        </div>
      )}

      {/* CONTENT */}
      {tab === "collections" ? (
        cLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-56 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900"
              />
            ))}
          </div>
        ) : cErr ? (
          <div className="text-rose-400 text-sm">{cErr}</div>
        ) : collections.length === 0 ? (
          <div className="text-sm text-neutral-400">No collections yet. Create one to get started.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {collections.map((c) => (
                <CollectionCard
                  key={c.id}
                  c={c}
                  creator={c.owner_id ? creators.get(c.owner_id) : undefined}
                  itemsCount={itemsCounts.get(c.id) ?? 0}
                />
              ))}
            </div>

            <div className="mt-6 flex justify-center">
              <button
                className="btn"
                onClick={loadMoreCollections}
                disabled={cBusyMore}
                aria-busy={cBusyMore}
              >
                {cBusyMore ? "Loading…" : "Load more"}
              </button>
            </div>
          </>
        )
      ) : (
        // Listings (original view)
        <>
          {loading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-72 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900"
                />
              ))}
            </div>
          ) : err ? (
            <div className="text-rose-400 text-sm">{err}</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-neutral-400">No active listings yet. Check back soon!</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((row) => (
                  <ArtworkCard
                    key={row.id}
                    id={row.artworks.id}
                    title={row.artworks.title}
                    image_url={row.artworks.image_url}
                    price={row.fixed_price}
                    currency={row.sale_currency ?? undefined}
                  />
                ))}
              </div>

              <div className="mt-6 flex justify-center">
                <button
                  className="btn"
                  onClick={loadMoreListings}
                  disabled={busyMore}
                  aria-busy={busyMore}
                >
                  {busyMore ? "Loading…" : "Load more"}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
