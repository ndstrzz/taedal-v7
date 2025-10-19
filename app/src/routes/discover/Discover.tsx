// app/src/routes/discover/Discover.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

/** ----------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------- */
type Chain = "ethereum" | "polygon" | "solana";
type Status = "buy-now" | "on-auction" | "new" | "has-offers" | "all";
type TimeRange = "24h" | "7d" | "30d";
type Sort = "trending" | "recent" | "price-asc" | "price-desc";

type CollectionCard = {
  id: string;
  name: string;
  logo: string;
  banner: string;
  floor: number;
  volume: number;
  volumeChangePct: number; // over selected time window
  items: number;
  owners: number;
  sparkline: number[]; // 20 points
};

type ActivityRow = {
  id: string;
  kind: "sale" | "mint" | "list";
  artId: string;
  artTitle: string;
  img: string;
  price: number;
  currency: "ETH" | "SOL" | "MATIC" | "USD";
  ts: number; // ms
  from?: string;
  to?: string;
  chain: Chain;
};

type GridItem = {
  id: string;
  title: string;
  img: string;
  price?: number | null;
  currency?: "ETH" | "SOL" | "MATIC" | "USD" | null;
  listed?: boolean;
  chain: Chain;
  status: Status;
};

/** ----------------------------------------------------------------
 * Mock data helpers (replace with Supabase later)
 * ---------------------------------------------------------------- */
function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}
function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function fakeAddress() {
  const hex = [...Array(40)].map(() => pick("abcdef0123456789".split(""))).join("");
  return `0x${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

function makeSparkline(n = 20) {
  const pts: number[] = [];
  let v = rand(0.6, 1.0);
  for (let i = 0; i < n; i++) {
    v += rand(-0.08, 0.09);
    v = Math.max(0.2, Math.min(1.3, v));
    pts.push(v);
  }
  return pts;
}

const CHAINS: Chain[] = ["ethereum", "polygon", "solana"];

function useTrendingCollections(time: TimeRange, chain: Chain | "all") {
  const [data, setData] = useState<CollectionCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    const id = setTimeout(() => {
      const rows = Array.from({ length: 8 }).map((_, i) => {
        const c = chain === "all" ? pick(CHAINS) : chain;
        return {
          id: `col_${time}_${c}_${i}`,
          name: `${c.toUpperCase()} Collection #${i + 1}`,
          logo: `https://picsum.photos/seed/logo${i}${time}/96/96`,
          banner: `https://picsum.photos/seed/banner${i}${time}/800/300`,
          floor: Number(rand(0.01, 5).toFixed(2)),
          volume: Number(rand(8, 420).toFixed(2)),
          volumeChangePct: Number(rand(-35, 120).toFixed(1)),
          items: Math.floor(rand(300, 10000)),
          owners: Math.floor(rand(120, 6500)),
          sparkline: makeSparkline(),
        } as CollectionCard;
      });
      setData(rows);
      setLoading(false);
    }, 450);
    return () => clearTimeout(id);
  }, [time, chain]);
  return { data, loading };
}

function useLiveActivity(chain: Chain | "all") {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  useEffect(() => {
    // seed
    const seed: ActivityRow[] = Array.from({ length: 12 }).map((_, i) => {
      const c = chain === "all" ? pick(CHAINS) : chain;
      const kind = pick<ActivityRow["kind"]>(["sale", "mint", "list"]);
      return {
        id: `act_${i}`,
        kind,
        artId: `a_${i}`,
        artTitle: `Piece #${Math.floor(rand(100, 9999))}`,
        img: `https://picsum.photos/seed/act${i}/200/200`,
        price: Number(rand(0.01, 3).toFixed(3)),
        currency: pick(["ETH", "SOL", "MATIC", "USD"]),
        ts: Date.now() - Math.floor(rand(5 * 60 * 1000, 60 * 60 * 1000)),
        from: kind !== "mint" ? fakeAddress() : undefined,
        to: kind !== "list" ? fakeAddress() : undefined,
        chain: c,
      };
    });
    setRows(seed);
    // pseudo-stream: append an item every few seconds
    const t = setInterval(() => {
      setRows((r) => {
        const c = chain === "all" ? pick(CHAINS) : chain;
        const kind = pick<ActivityRow["kind"]>(["sale", "mint", "list"]);
        const next: ActivityRow = {
          id: `act_${Date.now()}`,
          kind,
          artId: `a_${Math.floor(rand(1, 999999))}`,
          artTitle: `Piece #${Math.floor(rand(100, 9999))}`,
          img: `https://picsum.photos/seed/act${Math.floor(Math.random() * 999999)}/200/200`,
          price: Number(rand(0.01, 8).toFixed(3)),
          currency: pick(["ETH", "SOL", "MATIC", "USD"]),
          ts: Date.now(),
          from: kind !== "mint" ? fakeAddress() : undefined,
          to: kind !== "list" ? fakeAddress() : undefined,
          chain: c,
        };
        return [next, ...r].slice(0, 30);
      });
    }, 4000);
    return () => clearInterval(t);
  }, [chain]);
  return rows;
}

function useInfiniteGrid(params: {
  chain: Chain | "all";
  status: Status;
  sort: Sort;
}) {
  const { chain, status, sort } = params;
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<GridItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    // reset when filters change
    setItems([]);
    setPage(0);
    setHasMore(true);
  }, [chain, status, sort]);

  useEffect(() => {
    if (!hasMore || loading) return;
    setLoading(true);
    const id = setTimeout(() => {
      // produce 24 items per page
      const batch: GridItem[] = Array.from({ length: 24 }).map((_, i) => {
        const c = chain === "all" ? pick(CHAINS) : chain;
        const st: Status =
          status === "all" ? pick(["buy-now", "on-auction", "new", "has-offers"]) : status;
        return {
          id: `it_${c}_${sort}_${page}_${i}`,
          title: `#${page * 24 + i + 1}`,
          img: `https://picsum.photos/seed/grid_${c}_${sort}_${page}_${i}/600/600`,
          price: st !== "new" ? Number(rand(0.01, 8).toFixed(3)) : null,
          currency: st !== "new" ? pick(["ETH", "SOL", "MATIC"]) : null,
          listed: st !== "new",
          chain: c,
          status: st,
        };
      });
      setItems((cur) => [...cur, ...batch]);
      setHasMore(page < 12); // ~13 pages
      setLoading(false);
    }, 500);
    return () => clearTimeout(id);
  }, [page, chain, status, sort, hasMore, loading]);

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
  return (
    <span className="px-1.5 py-0.5 rounded-md bg-white/10 text-[11px]">{children}</span>
  );
}

/** ----------------------------------------------------------------
 * Page
 * ---------------------------------------------------------------- */
export default function Discover() {
  // filters
  const [q, setQ] = useState("");
  const [chain, setChain] = useState<Chain | "all">("all");
  const [status, setStatus] = useState<Status>("all");
  const [time, setTime] = useState<TimeRange>("24h");
  const [sort, setSort] = useState<Sort>("trending");

  const { data: trending, loading: loadingTrending } = useTrendingCollections(time, chain);
  const activity = useLiveActivity(chain);
  const { items, loading, hasMore, loadMore } = useInfiniteGrid({ chain, status, sort });

  // simple client-side search filter for the grid (mock only)
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((it) => it.title.toLowerCase().includes(s));
  }, [items, q]);

  // infinite scroll sentinel
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
                    <img src={c.banner} className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:opacity-100 transition" />
                    <img
                      src={c.logo}
                      className="absolute -bottom-6 left-3 h-14 w-14 rounded-xl border-2 border-black object-cover shadow"
                    />
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
                        <StatPill>Floor {c.floor} ETH</StatPill>
                        <StatPill>Vol {c.volume} {chain === "solana" ? "SOL" : "ETH"}</StatPill>
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
                      <img src={a.img} className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm truncate">
                        {a.kind === "sale" ? "Sale" : a.kind === "mint" ? "Mint" : "Listing"} •{" "}
                        <span className="font-medium">{a.artTitle}</span>
                      </div>
                      <div className="text-xs text-white/60">
                        {new Date(a.ts).toLocaleTimeString()} • {a.chain.toUpperCase()}{" "}
                        {a.from ? <>• From <code>{a.from}</code></> : null}{" "}
                        {a.to ? <>• To <code>{a.to}</code></> : null}
                      </div>
                    </div>
                    <div className="ml-auto text-sm">
                      {a.price} {a.currency}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Promo / tips / categories rail (static for now) */}
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
                Tip: Use the sticky bar to filter by chain, status, and sort order. The grid will lazy-load as you scroll.
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
                    key={it.id}
                    to={`/art/${encodeURIComponent(it.id)}`}
                    className="group rounded-xl overflow-hidden border border-white/10 bg-white/[0.04] hover:border-white/20 transition"
                  >
                    <div className="relative aspect-square bg-neutral-900">
                      <img src={it.img} alt={it.title} className="absolute inset-0 w-full h-full object-cover" />
                      <div className="absolute left-2 top-2 flex gap-1">
                        <span className="px-1.5 py-0.5 rounded bg-black/60 text-[10px]">
                          {it.chain.toUpperCase()}
                        </span>
                        {it.status !== "all" && (
                          <span className="px-1.5 py-0.5 rounded bg-black/60 text-[10px]">
                            {it.status.replace("-", " ")}
                          </span>
                        )}
                      </div>
                      <button
                        className="absolute right-2 top-2 h-8 w-8 rounded-md bg-black/50 backdrop-blur grid place-items-center opacity-0 group-hover:opacity-100 transition"
                        title="Favorite"
                        onClick={(e) => {
                          e.preventDefault();
                        }}
                      >
                        ♥
                      </button>
                    </div>
                    <div className="p-3">
                      <div className="font-medium truncate">#{it.title}</div>
                      <div className="mt-1 flex items-center justify-between text-sm">
                        <div className="text-white/70">
                          {it.listed ? (
                            <>
                              {it.price} {it.currency}
                            </>
                          ) : (
                            <span className="text-white/40">Not listed</span>
                          )}
                        </div>
                        <button className="text-xs px-2 py-1 rounded-md bg-white text-black hover:bg-white/90">
                          {it.status === "on-auction" ? "Bid" : it.listed ? "Buy" : "View"}
                        </button>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>

              {/* sentinel for infinite scroll */}
              <div ref={sentinelRef} className="h-12 grid place-items-center">
                {loading ? <span className="text-xs text-white/60">Loading more…</span> : hasMore ? null : (
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
