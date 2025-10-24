import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";

/** ----------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------- */
type Chain = "ethereum" | "polygon" | "solana";
type Status = "buy-now" | "on-auction" | "new" | "has-offers" | "all";
type TimeRange = "24h" | "7d" | "30d";
type Sort = "trending" | "recent" | "price-asc" | "price-desc";

/** Supabase view shapes */
type MVTrendingRow = {
  collection_id: string;
  floor_native: number | null;
  vol_24h_native: number | null;
  vol_7d_native: number | null;
  vol_30d_native: number | null;
  tx_24h: number | null;
  tx_7d: number | null;
  tx_30d: number | null;
  owners: number | null;
  items: number | null;
  refreshed_at: string;
};

type CollectionMeta = {
  id: string;
  name?: string | null;
  title?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
};

type LiveActivityRow = {
  id: string;
  kind: "sale" | "mint" | "list";
  artwork_id: string;
  title: string | null;
  image_url: string | null;
  price_eth: number | null;
  actor: string | null;
  created_at: string;
  actor_name: string | null;
};

type DiscoverItem = {
  artwork_id: string;
  title: string | null;
  image_url: string | null;
  creator_id: string | null;
  creator_name: string | null;
  creator_handle: string | null;
  listing_id: string | null;
  listing_status: string | null;
  currency: string | null;
  price_native: number | null;
  listed_at: string | null;
  updated_at: string | null;
  ships_worldwide: boolean | null;
  ships_from_country: string | null;
  is_licensable: boolean | null;
  contract_address: string | null;
  collection_id: string | null;
  is_phygital: boolean | null;
  is_auction?: boolean | null; // from view
};

/** ----------------------------------------------------------------
 * Small helpers
 * ---------------------------------------------------------------- */
function makeSparkline(n = 20) {
  const pts: number[] = [];
  let v = 0.9;
  for (let i = 0; i < n; i++) {
    v += (Math.random() - 0.48) * 0.12;
    v = Math.max(0.2, Math.min(1.3, v));
    pts.push(Number(v.toFixed(3)));
  }
  return pts;
}

function percentDelta(cur: number | null | undefined, ref: number | null | undefined) {
  const a = Number(cur ?? 0);
  const b = Number(ref ?? 0);
  if (!isFinite(a) || !isFinite(b) || b === 0) return 0;
  return Number((((a - b) / b) * 100).toFixed(1));
}

/** ----------------------------------------------------------------
 * Data hooks (Supabase)
 * ---------------------------------------------------------------- */
function useTrendingCollections(time: TimeRange) {
  const [data, setData] = useState<
    Array<{
      id: string;
      name: string;
      logo: string | null;
      banner: string | null;
      floor: number;
      volume: number;
      volumeChangePct: number;
      items: number;
      owners: number;
      sparkline: number[];
    }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);

      const volCol =
        time === "24h" ? "vol_24h_native" : time === "7d" ? "vol_7d_native" : "vol_30d_native";

      // 1) top collections by selected window
      const { data: mv, error } = await supabase
        .from("mv_trending_collections")
        .select("*")
        .order(volCol as any, { ascending: false, nullsFirst: false })
        .limit(8);

      console.log("[discover] trending query", {
        volCol,
        error,
        rows: mv?.length,
        sample: mv?.[0],
      });

      if (error) {
        console.error("[discover] trending error:", error.message);
        if (!cancelled) {
          setData([]);
          setLoading(false);
        }
        return;
      }

      const base = (mv ?? []) as MVTrendingRow[];
      const ids = base.map((r) => r.collection_id);

      // 2) optional enrichment from `collections`
      let metas: Record<string, CollectionMeta> = {};
      if (ids.length) {
        const { data: cMeta, error: metaErr } = await supabase
          .from("collections")
          .select("id,name,title,logo_url,banner_url")
          .in("id", ids as any);

        if (metaErr) console.warn("[discover] collections meta error:", metaErr.message);
        (cMeta ?? []).forEach((c) => (metas[c.id] = c));
      }

      // 3) compute a rough delta
      const normalized = base.map((r) => {
        const vol =
          time === "24h"
            ? r.vol_24h_native ?? 0
            : time === "7d"
            ? r.vol_7d_native ?? 0
            : r.vol_30d_native ?? 0;

        const ref =
          time === "24h"
            ? (r.vol_7d_native ?? 0) / 7
            : time === "7d"
            ? (r.vol_30d_native ?? 0) / 4
            : r.vol_30d_native ?? 0;

        const delta = percentDelta(vol, ref || 0);
        const m = metas[r.collection_id];

        return {
          id: r.collection_id,
          name: (m?.name ?? m?.title ?? `Collection ${r.collection_id.slice(0, 6)}`).trim(),
          logo: m?.logo_url ?? null,
          banner: m?.banner_url ?? null,
          floor: Number(r.floor_native ?? 0),
          volume: Number(vol ?? 0),
          volumeChangePct: delta,
          items: Number(r.items ?? 0),
          owners: Number(r.owners ?? 0),
          sparkline: makeSparkline(),
        };
      });

      if (!cancelled) {
        setData(normalized);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [time]);

  return { data, loading };
}

function useLiveActivity() {
  const [rows, setRows] = useState<LiveActivityRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("v_live_activity_recent")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      console.log("[discover] activity query", { error, rows: data?.length, sample: data?.[0] });

      if (error) {
        console.error("[discover] activity error:", error.message);
        return;
      }
      if (!cancelled) setRows((data ?? []) as LiveActivityRow[]);
    })();

    // optional realtime stream
    const ch = supabase
      .channel("activity-stream")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, () => {
        supabase
          .from("v_live_activity_recent")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1)
          .then(({ data }) => {
            if (data?.length) setRows((cur) => [data[0] as LiveActivityRow, ...cur].slice(0, 80));
          });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "listings" }, () => {
        supabase
          .from("v_live_activity_recent")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1)
          .then(({ data }) => {
            if (data?.length) setRows((cur) => [data[0] as LiveActivityRow, ...cur].slice(0, 80));
          });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
      cancelled = true;
    };
  }, []);

  return rows;
}

function useInfiniteGrid(params: { status: Status; sort: Sort; q: string }) {
  const { status, sort, q } = params;
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 24;

  useEffect(() => {
    setItems([]);
    setPage(0);
    setHasMore(true);
  }, [status, sort, q]);

  useEffect(() => {
    let cancelled = false;
    if (!hasMore || loading) return;

    (async () => {
      setLoading(true);
      let qb = supabase.from("v_discover_items").select("*");

      // STATUS filters
      if (status === "buy-now") {
        qb = qb.not("listing_id", "is", null).not("price_native", "is", null);
      } else if (status === "on-auction") {
        qb = qb.eq("listing_status", "active").eq("is_auction", true);
      } else if (status === "new") {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        qb = qb.gte("listed_at", sevenDaysAgo);
      } else if (status === "has-offers") {
        qb = qb.eq("has_offers", true);
      }

      // SERVER-SIDE SEARCH using tsvector
      const qstr = q.trim();
      if (qstr.length >= 2) {
        qb = qb.textSearch("search_tsv", qstr, { type: "websearch", config: "simple" });
      }

      // SORT
      if (sort === "price-asc") qb = qb.order("price_native", { ascending: true, nullsFirst: false });
      else if (sort === "price-desc") qb = qb.order("price_native", { ascending: false, nullsFirst: true });
      else if (sort === "recent") qb = qb.order("listed_at", { ascending: false, nullsFirst: false });
      else qb = qb.order("updated_at", { ascending: false, nullsFirst: false }); // trending fallback

      // paginate
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await qb.range(from, to);

      console.log("[discover] grid query", {
        status,
        sort,
        q: q.trim(),
        page,
        from,
        to,
        error,
        rows: data?.length,
        sample: data?.[0],
      });

      if (error) {
        console.error("[discover] grid error:", error.message);
        if (!cancelled) {
          setLoading(false);
          setHasMore(false);
        }
        return;
      }

      const batch = (data ?? []) as DiscoverItem[];
      if (!cancelled) {
        setItems((cur) => [...cur, ...batch]);
        setHasMore(batch.length === pageSize);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page, status, sort, q, hasMore, loading]);

  return { items, loading, hasMore, loadMore: () => setPage((p) => p + 1) };
}

/** ----------------------------------------------------------------
 * Small UI atoms
 * ---------------------------------------------------------------- */
function Sparkline({ points }: { points: number[] }) {
  const w = 100;
  const h = 28;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const path = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((v - min) / (max - min || 1)) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="opacity-90">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function StatPill({ children }: { children: React.ReactNode }) {
  return <span className="px-1.5 py-0.5 rounded-md bg-white/10 text-[11px]">{children}</span>;
}

/** ----------------------------------------------------------------
 * Page
 * ---------------------------------------------------------------- */
export default function Discover() {
  // filters
  const [q, setQ] = useState("");
  const [chain, setChain] = useState<Chain | "all">("all"); // reserved for future
  const [status, setStatus] = useState<Status>("all");
  const [time, setTime] = useState<TimeRange>("24h");
  const [sort, setSort] = useState<Sort>("trending");

  const { data: trending, loading: loadingTrending } = useTrendingCollections(time);
  const activity = useLiveActivity();
  const { items, loading, hasMore, loadMore } = useInfiniteGrid({ status, sort, q });

  // client-side filter narrows already-fetched rows
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((it) => (it.title ?? "").toLowerCase().includes(s));
  }, [items, q]);

  // infinite sentinel
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && hasMore && !loading) loadMore();
        });
      },
      { rootMargin: "800px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sentinelRef.current, hasMore, loading, loadMore]);

  const dbg = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("dbg");

  return (
    <div className="min-h-[100dvh]">
      {/* Sticky filter/search bar */}
      <div className="sticky top-14 z-30 bg-black/70 backdrop-blur border-b border-neutral-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap gap-3 items-center">
          <div className="flex-1 min-w-[220px]">
            <input
              className="input w-full"
              placeholder="Search items, collections, creators…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <select className="input" value={chain} onChange={(e) => setChain(e.target.value as any)}>
              <option value="all">All chains</option>
              <option value="ethereum">Ethereum</option>
              <option value="polygon">Polygon</option>
              <option value="solana">Solana</option>
            </select>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="all">All status</option>
              <option value="buy-now">Buy now</option>
              <option value="on-auction">On auction</option>
              <option value="has-offers">Has offers</option>
              <option value="new">New</option>
            </select>
            <select className="input" value={time} onChange={(e) => setTime(e.target.value as any)}>
              <option value="24h">24h</option>
              <option value="7d">7d</option>
              <option value="30d">30d</option>
            </select>
            <select className="input" value={sort} onChange={(e) => setSort(e.target.value as any)}>
              <option value="trending">Trending</option>
              <option value="recent">Recently listed</option>
              <option value="price-asc">Price ↑</option>
              <option value="price-desc">Price ↓</option>
            </select>

            {/* tiny debug ping only when ?dbg=1 */}
            {dbg && (
              <button
                className="text-xs px-2 py-1 rounded-md bg-white/10 border border-white/10"
                onClick={async () => {
                  const { data, error } = await supabase
                    .from("v_discover_items")
                    .select("*")
                    .order("updated_at", { ascending: false })
                    .limit(1);
                  alert(error ? `ERR: ${error.message}` : `OK: ${data?.length} row(s)`);
                }}
              >
                ping supabase
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        {/* Trending Collections */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Trending collections</h2>
            <div className="text-xs text-white/60">Time: {time}</div>
          </div>

          {loadingTrending ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-pulse">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden">
                  <div className="h-28 bg-white/10" />
                  <div className="p-3 space-y-2">
                    <div className="h-4 w-32 bg-white/10 rounded" />
                    <div className="h-4 w-24 bg-white/10 rounded" />
                    <div className="h-4 w-40 bg-white/10 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : trending && trending.length ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {trending.map((c) => (
                <Link
                  key={c.id}
                  to={`/collection/${encodeURIComponent(c.name)}`}
                  className="group rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden hover:border-white/20"
                >
                  <div className="relative h-28 bg-neutral-900 overflow-hidden">
                    {c.banner ? (
                      <img
                        src={c.banner}
                        className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:opacity-100 transition"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-white/5" />
                    )}
                    {c.logo ? (
                      <img
                        src={c.logo}
                        className="absolute -bottom-6 left-3 h-14 w-14 rounded-xl border-2 border-black object-cover shadow"
                      />
                    ) : null}
                  </div>
                  <div className="p-3 pt-7">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold truncate">{c.name}</div>
                      <div className={`text-xs ${c.volumeChangePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {c.volumeChangePct >= 0 ? "▲" : "▼"} {Math.abs(c.volumeChangePct)}%
                      </div>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <StatPill>Floor {c.floor}</StatPill>
                        <StatPill>Vol {c.volume}</StatPill>
                      </div>
                      <div className="text-white/60">
                        <Sparkline points={c.sparkline} />
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-white/60">
                      {c.items.toLocaleString()} items • {c.owners.toLocaleString()} owners
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="card">No trending data.</div>
          )}
        </section>

        {/* Split: Activity + Filters hint */}
        <section className="grid lg:grid-cols-12 gap-6">
          {/* Live activity */}
          <div className="lg:col-span-8 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Live activity</h2>
              <div className="text-xs text-white/60">Auto-updating</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden">
              <ul className="divide-y divide-white/10 max-h-[440px] overflow-auto">
                {activity.map((a) => (
                  <li key={a.id} className="p-3 flex items-center gap-3 hover:bg-white/[0.03]">
                    <div className="h-12 w-12 rounded-lg overflow-hidden bg-neutral-900 border border-white/10">
                      {a.image_url ? (
                        <img src={a.image_url} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm truncate">
                        {a.kind === "sale" ? "Sale" : a.kind === "mint" ? "Mint" : "Listing"} •{" "}
                        <span className="font-medium">{a.title ?? "Untitled"}</span>
                      </div>
                      <div className="text-xs text-white/60">
                        {new Date(a.created_at).toLocaleTimeString()} •
                        {a.actor ? <> Actor <code>{a.actor_name ?? a.actor}</code></> : null}
                      </div>
                    </div>
                    <div className="ml-auto text-sm">{a.price_eth ? `${a.price_eth} ETH` : ""}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Promo / tips / categories rail */}
          <div className="lg:col-span-4 space-y-3">
            <h2 className="text-xl font-semibold">Browse by category</h2>
            <div className="grid grid-cols-2 gap-3">
              {["Art", "Photography", "Gaming", "Music", "Domains", "Memberships"].map((cat) => (
                <button key={cat} className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-left hover:bg-white/10">
                  <div className="text-sm font-medium">{cat}</div>
                  <div className="text-xs text-white/60">Explore {cat.toLowerCase()}</div>
                </button>
              ))}
            </div>
            <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-4">
              <div className="text-sm text-white/80">
                Tip: Use the sticky bar to search, filter status, and change sort. The grid lazy-loads as you scroll.
              </div>
            </div>
          </div>
        </section>

        {/* All Items grid */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">All items</h2>
            <div className="text-xs text-white/60">
              {filtered.length.toLocaleString()} results {q ? `(filtered)` : ""}
            </div>
          </div>

          {filtered.length === 0 && loading ? (
            <GridSkeleton />
          ) : filtered.length === 0 ? (
            <div className="card">No items match your filters.</div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {filtered.map((it) => (
                  <Link
                    key={it.artwork_id}
                    to={`/art/${encodeURIComponent(it.artwork_id)}`}
                    className="group rounded-xl overflow-hidden border border-white/10 bg-white/[0.04] hover:border-white/20 transition"
                  >
                    <div className="relative aspect-square bg-neutral-900">
                      {it.image_url ? (
                        <img src={it.image_url} alt={it.title ?? ""} className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        <div className="absolute inset-0" />
                      )}
                      <div className="absolute left-2 top-2 flex gap-1">
                        <span className="px-1.5 py-0.5 rounded bg-black/60 text-[10px]">ETH</span>
                        {it.is_phygital ? (
                          <span className="px-1.5 py-0.5 rounded bg-black/60 text-[10px]">phygital</span>
                        ) : null}
                        {it.is_licensable ? (
                          <span className="px-1.5 py-0.5 rounded bg-black/60 text-[10px]">licensable</span>
                        ) : null}
                      </div>
                      <button
                        className="absolute right-2 top-2 h-8 w-8 rounded-md bg-black/50 backdrop-blur grid place-items-center opacity-0 group-hover:opacity-100 transition"
                        title="Favorite"
                        onClick={(e) => e.preventDefault()}
                      >
                        ♥
                      </button>
                    </div>
                    <div className="p-3">
                      <div className="font-medium truncate">#{it.title ?? "Untitled"}</div>
                      <div className="mt-1 flex items-center justify-between text-sm">
                        <div className="text-white/70">
                          {it.listing_id && it.price_native != null ? (
                            <>
                              {it.price_native} {it.currency ?? "ETH"}
                            </>
                          ) : (
                            <span className="text-white/40">Not listed</span>
                          )}
                        </div>
                        {/* Uses is_auction boolean from the view */}
                        <button className="text-xs px-2 py-1 rounded-md bg-white text-black hover:bg-white/90">
                          {it.is_auction ? "Bid" : it.listing_id ? "Buy" : "View"}
                        </button>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>

              {/* sentinel for infinite scroll */}
              <div ref={sentinelRef} className="h-12 grid place-items-center">
                {loading ? (
                  <span className="text-xs text-white/60">Loading more…</span>
                ) : hasMore ? null : (
                  <span className="text-xs text-white/40">You reached the end.</span>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** ----------------------------------------------------------------
 * Tiny skeleton
 * ---------------------------------------------------------------- */
function GridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-xl overflow-hidden border border-white/10 bg-white/[0.04]">
          <div className="aspect-square bg-white/10" />
          <div className="p-3 space-y-2">
            <div className="h-4 w-24 bg-white/10 rounded" />
            <div className="h-4 w-32 bg-white/10 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
