import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";

/** ---------- types ---------- */
type Artwork = {
  id: string;
  title: string | null;
  image_url: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
  // optional columns, if present in your schema
  deleted_at?: string | null;
};

type Listing = {
  id: string;
  artwork_id: string;
  fixed_price: number | null;
  sale_currency: string | null;
  status: string;
  updated_at: string;
  // joined
  artwork_title?: string | null;
  artwork_image_url?: string | null;
};

type Sale = {
  id: string;
  artwork_id: string;
  price: number;
  currency: string;
  sold_at: string;
  // joined
  artwork_title?: string | null;
  artwork_image_url?: string | null;
};

export default function StudioHome() {
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingL, setLoadingL] = useState(false);
  const [loadingS, setLoadingS] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);

  // artwork_id -> min active price (floor)
  const floors = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of listings) {
      if (l.status !== "active" || l.fixed_price == null) continue;
      const cur = map.get(l.artwork_id);
      if (cur == null || l.fixed_price < cur) map.set(l.artwork_id, l.fixed_price);
    }
    return map;
  }, [listings]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        const me = data.session?.user?.id ?? null;
        setUid(me);
        if (!me) return;

        await Promise.all([loadMyArtworks(me), loadMyActiveListings(me), loadMyRecentSales(me)]);
      } catch (e: any) {
        setMsg(e?.message || "Failed to load Studio");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function loadMyArtworks(userId: string) {
    setLoadingA(true);
    try {
      const { data, error } = await supabase
        .from("artworks")
        .select("id,title,image_url,status,created_at,updated_at,deleted_at")
        .eq("creator_id", userId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setArtworks((data ?? []) as Artwork[]);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load artworks");
    } finally {
      setLoadingA(false);
    }
  }

  async function loadMyActiveListings(userId: string) {
    setLoadingL(true);
    try {
      const { data, error } = await supabase
        .from("listings")
        .select("id,artwork_id,fixed_price,sale_currency,status,updated_at,artworks!inner(id,title,image_url)")
        .eq("seller_id", userId)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = (data ?? []).map((r: any) => ({
        id: r.id,
        artwork_id: r.artwork_id,
        fixed_price: r.fixed_price,
        sale_currency: r.sale_currency,
        status: r.status,
        updated_at: r.updated_at,
        artwork_title: r.artworks?.title ?? null,
        artwork_image_url: r.artworks?.image_url ?? null,
      })) as Listing[];
      setListings(rows);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load listings");
    } finally {
      setLoadingL(false);
    }
  }

  async function loadMyRecentSales(userId: string) {
    setLoadingS(true);
    try {
      const { data, error } = await supabase
        .from("sales")
        .select("id,artwork_id,price,currency,sold_at,artworks!inner(id,title,image_url)")
        .eq("seller_id", userId)
        .order("sold_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      const rows = (data ?? []).map((r: any) => ({
        id: r.id,
        artwork_id: r.artwork_id,
        price: r.price,
        currency: r.currency,
        sold_at: r.sold_at,
        artwork_title: r.artworks?.title ?? null,
        artwork_image_url: r.artworks?.image_url ?? null,
      })) as Sale[];
      setSales(rows);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load sales");
    } finally {
      setLoadingS(false);
    }
  }

  const anyLoading = loading || loadingA || loadingL || loadingS;

  return (
    <div className="min-h-[calc(100vh-80px)] bg-black">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        {/* Top row */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold">Studio</h1>
          <div className="flex items-center gap-3">
            <div className="relative">
              <select className="input pr-8" defaultValue="recent" title="Sort">
                <option value="recent">Recently updated</option>
                <option value="created">Recently created</option>
                <option value="name">Name (A–Z)</option>
              </select>
              <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/40">▾</div>
            </div>
            <Link to="/studio/create" className="btn">Create</Link>
          </div>
        </div>

        {msg && <div className="text-sm text-amber-300">{msg}</div>}

        {/* Not signed in */}
        {!uid && (
          <div className="card">
            <div className="text-sm">You’re not signed in.</div>
            <Link to="/signin" className="btn mt-3 inline-block">Sign in</Link>
          </div>
        )}

        {/* My Artworks */}
        <SectionCard
          title="Your artworks"
          right={<Link to="/studio/create" className="btn px-3 py-1.5 text-sm">Create artwork</Link>}
          loading={anyLoading && artworks.length === 0}
          empty={!anyLoading && artworks.length === 0}
          emptyText={
            <div className="text-sm text-white/70">
              You don’t have any artworks yet. <Link to="/studio/create" className="underline">Create one</Link> to get started.
            </div>
          }
        >
          <div className="hidden md:grid grid-cols-12 text-xs text-white/60 px-3 pb-2">
            <div className="col-span-6">NAME</div>
            <div className="col-span-2">FLOOR</div>
            <div className="col-span-2">UPDATED</div>
            <div className="col-span-2 text-right">LISTED</div>
          </div>
          <div className="divide-y divide-white/10">
            {artworks.map(a => {
              const floor = floors.get(a.id);
              const listed = floor != null;
              return (
                <Link
                  key={a.id}
                  to={`/art/${a.id}`}
                  className="grid grid-cols-12 items-center gap-3 px-3 py-3 hover:bg-white/[0.04] rounded-lg"
                >
                  <div className="col-span-12 md:col-span-6 flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-lg bg-neutral-900 overflow-hidden border border-white/10">
                      {a.image_url ? <img src={a.image_url} className="h-full w-full object-cover" /> : null}
                    </div>
                    <div className="truncate">
                      <div className="truncate">{a.title || "Untitled"}</div>
                      <div className="text-xs text-white/50 truncate">{a.status || "—"}</div>
                    </div>
                  </div>
                  <div className="col-span-6 md:col-span-2 text-white/80">
                    {floor != null ? `${floor} ${pickCcy(listings, a.id)}` : "—"}
                  </div>
                  <div className="col-span-3 md:col-span-2 text-white/60">
                    {new Date(a.updated_at).toLocaleString()}
                  </div>
                  <div className="col-span-3 md:col-span-2 text-right">
                    {listed ? <span className="px-2 py-0.5 rounded-md text-xs bg-emerald-400 text-black">Active</span> : <span className="text-white/50 text-xs">No</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        </SectionCard>

        {/* Active Listings */}
        <SectionCard
          title="Active listings"
          loading={anyLoading && listings.length === 0}
          empty={!anyLoading && listings.length === 0}
          emptyText={<div className="text-sm text-white/70">You have no active listings.</div>}
        >
          <div className="hidden md:grid grid-cols-12 text-xs text-white/60 px-3 pb-2">
            <div className="col-span-6">ARTWORK</div>
            <div className="col-span-2">PRICE</div>
            <div className="col-span-2">STATUS</div>
            <div className="col-span-2">UPDATED</div>
          </div>
          <div className="divide-y divide-white/10">
            {listings.map(l => (
              <Link
                key={l.id}
                to={`/art/${l.artwork_id}`}
                className="grid grid-cols-12 items-center gap-3 px-3 py-3 hover:bg-white/[0.04] rounded-lg"
              >
                <div className="col-span-12 md:col-span-6 flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-lg bg-neutral-900 overflow-hidden border border-white/10">
                    {l.artwork_image_url ? <img src={l.artwork_image_url} className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="truncate">
                    <div className="truncate">{l.artwork_title || "Untitled"}</div>
                    <div className="text-xs text-white/50 truncate">#{l.artwork_id.slice(0, 6)}</div>
                  </div>
                </div>
                <div className="col-span-6 md:col-span-2">
                  {l.fixed_price != null ? `${l.fixed_price} ${(l.sale_currency || "").toUpperCase()}` : "—"}
                </div>
                <div className="col-span-3 md:col-span-2">
                  <span className={`px-2 py-0.5 rounded-md text-xs ${
                    l.status === "active" ? "bg-emerald-400 text-black" : "bg-white/10 text-white"
                  }`}>{l.status}</span>
                </div>
                <div className="col-span-3 md:col-span-2 text-white/60">{new Date(l.updated_at).toLocaleString()}</div>
              </Link>
            ))}
          </div>
        </SectionCard>

        {/* Recent Sales */}
        <SectionCard
          title="Recent sales"
          loading={anyLoading && sales.length === 0}
          empty={!anyLoading && sales.length === 0}
          emptyText={<div className="text-sm text-white/70">No sales yet.</div>}
        >
          <div className="hidden md:grid grid-cols-12 text-xs text-white/60 px-3 pb-2">
            <div className="col-span-6">ARTWORK</div>
            <div className="col-span-2">PRICE</div>
            <div className="col-span-2">SOLD AT</div>
            <div className="col-span-2"></div>
          </div>
          <div className="divide-y divide-white/10">
            {sales.map(s => (
              <Link
                key={s.id}
                to={`/art/${s.artwork_id}`}
                className="grid grid-cols-12 items-center gap-3 px-3 py-3 hover:bg-white/[0.04] rounded-lg"
              >
                <div className="col-span-12 md:col-span-6 flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-lg bg-neutral-900 overflow-hidden border border-white/10">
                    {s.artwork_image_url ? <img src={s.artwork_image_url} className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="truncate">
                    <div className="truncate">{s.artwork_title || "Untitled"}</div>
                    <div className="text-xs text-white/50 truncate">#{s.artwork_id.slice(0, 6)}</div>
                  </div>
                </div>
                <div className="col-span-6 md:col-span-2">{s.price} {(s.currency || "").toUpperCase()}</div>
                <div className="col-span-3 md:col-span-2 text-white/60">{new Date(s.sold_at).toLocaleString()}</div>
                <div className="col-span-3 md:col-span-2 text-right">
                  <span className="text-xs text-white/50">View</span>
                </div>
              </Link>
            ))}
          </div>
        </SectionCard>

        {/* Footer chips */}
        <div className="text-[11px] text-white/50 flex flex-wrap gap-x-4 gap-y-2">
          <span>Live</span><span>•</span><span>Aggregating</span><span>•</span>
          <span>Networks</span><span>•</span>
          <Link to="/support" className="hover:text-white">Support</Link>
          <span>•</span><span>USD</span>
          <span>•</span><span className="text-white/40">Solana (soon)</span>
        </div>
      </div>
    </div>
  );
}

/** ---------- tiny helpers / UI pieces ---------- */

function SectionCard({
  title,
  right,
  loading,
  empty,
  emptyText,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyText?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold">{title}</h3>
        {right}
      </div>
      {loading ? (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 rounded-md bg-white/10" />
          ))}
        </div>
      ) : empty ? (
        <div className="p-3">{emptyText}</div>
      ) : (
        children
      )}
    </div>
  );
}

// find the first listing currency for an artwork (used only for floor display)
function pickCcy(listings: Listing[], artworkId: string): string {
  const row = listings.find(l => l.artwork_id === artworkId && l.status === "active" && l.sale_currency);
  return (row?.sale_currency || "USD").toUpperCase();
}
