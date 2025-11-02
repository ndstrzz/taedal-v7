import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { fetchTopBid } from "../../lib/bids";

/** ----------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------- */
type Chain = "ethereum" | "polygon" | "solana";
type Status = "buy-now" | "on-auction" | "new" | "has-offers" | "all";
type TimeRange = "24h" | "7d" | "30d";
type Sort = "trending" | "recent" | "price-asc" | "price-desc";
type TrendingTab = "collections" | "items";

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

type TrendingItemRow = {
  artwork_id: string;
  title: string | null;
  image_url: string | null;
  creator_id: string | null;

  listing_id: string | null;
  listing_type: "fixed_price" | "auction" | "coming_soon" | null;
  listing_status: "draft" | "active" | "paused" | "ended" | "canceled" | null;
  currency: string | null;
  price_native: number | null;
  start_at: string | null;
  end_at: string | null;

  sales_24h_native: number | null;
  sales_7d_native: number | null;
  tx_24h: number | null;
  tx_7d: number | null;
  score: number | null;

  is_auction: boolean | null;
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
  is_auction?: boolean | null;

  end_at?: string | null;
  reserve_price?: number | null;
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

function inNextHours(iso: string | null | undefined, hours: number) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return false;
  return t - Date.now() <= hours * 3600 * 1000 && t > Date.now();
}

/** ----------------------------------------------------------------
 * Top-bid cache (front-end only, batched)
 * ---------------------------------------------------------------- */
function useTopBids(listingIds: (string | null)[]) {
  const [map, setMap] = useState<Record<string, number>>({});
  useEffect(() => {
    const ids = Array.from(new Set(listingIds.filter(Boolean) as string[])).filter(
      (id) => !(id in map)
    );
    if (ids.length === 0) return;

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const b = await fetchTopBid(id);
            return [id, b?.amount ?? 0] as const;
          } catch {
            return [id, 0] as const;
          }
        })
      );
      if (!cancelled && entries.length) {
        setMap((cur) => {
          const next = { ...cur };
          for (const [id, amt] of entries) next[id] = amt;
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(Array.from(new Set(listingIds.filter(Boolean) as string[])))]);
  return map;
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

      const { data: mv, error } = await supabase
        .from("mv_trending_collections")
        .select("*")
        .order(volCol as any, { ascending: false, nullsFirst: false })
        .limit(8);

      if (error) {
        console.error(error.message);
        if (!cancelled) {
          setData([]);
          setLoading(false);
        }
        return;
      }

      const base = (mv ?? []) as MVTrendingRow[];
      const ids = base.map((r) => r.collection_id);

      let metas: Record<string, CollectionMeta> = {};
      if (ids.length) {
        const { data: cMeta } = await supabase
          .from("collections")
          .select("id,name,title,logo_url,banner_url")
          .in("id", ids as any);
        (cMeta ?? []).forEach((c) => (metas[c.id] = c));
      }

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

function useTrendingItems(limit = 12) {
  const [rows, setRows] = useState<TrendingItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("mv_trending_items")
        .select("*")
        .order("score", { ascending: false, nullsFirst: false })
        .limit(limit);

      if (error) {
        console.error(error.message);
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
        return;
      }
      if (!cancelled) {
        setRows((data ?? []) as TrendingItemRow[]);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [limit]);
  return { rows, loading };
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
      if (error) {
        console.error(error.message);
        return;
      }
      if (!cancelled) setRows((data ?? []) as LiveActivityRow[]);
    })();

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

function useInfiniteGrid(params: {
  status: Status;
  sort: Sort;
  q: string;
  maxPrice?: number | null;
  endingSoon?: boolean;
  newToday?: boolean;
}) {
  const { status, sort, q, maxPrice, endingSoon, newToday } = params;
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 24;

  useEffect(() => {
    setItems([]);
    setPage(0);
    setHasMore(true);
  }, [status, sort, q, maxPrice, endingSoon, newToday]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!hasMore) return;
      setLoading(true);

      let qb = supabase.from("v_discover_items").select("*");

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

      const qstr = q.trim();
      if (qstr.length >= 2) {
        qb = qb.textSearch("search_tsv", qstr, { type: "websearch", config: "simple" });
      }

      if (typeof maxPrice === "number" && isFinite(maxPrice) && maxPrice > 0) {
        qb = qb.lte("price_native", maxPrice);
      }

      if (sort === "price-asc") qb = qb.order("price_native", { ascending: true, nullsFirst: false }).order("artwork_id", { ascending: true });
      else if (sort === "price-desc") qb = qb.order("price_native", { ascending: false, nullsFirst: true }).order("artwork_id", { ascending: true });
      else if (sort === "recent") qb = qb.order("listed_at", { ascending: false, nullsFirst: false }).order("artwork_id", { ascending: true });
      else qb = qb.order("updated_at", { ascending: false, nullsFirst: false }).order("artwork_id", { ascending: true });

      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await qb.range(from, to);

      if (error) {
        console.error(error.message);
        if (!cancelled) {
          setLoading(false);
          setHasMore(false);
        }
        return;
      }

      let batch = (data ?? []) as DiscoverItem[];
      if (endingSoon) {
        batch = batch.filter((it) => !!it.is_auction && inNextHours(it.end_at ?? null, 24));
      }
      if (newToday) {
        const since = Date.now() - 24 * 3600 * 1000;
        batch = batch.filter((it) => (it.listed_at ? new Date(it.listed_at).getTime() >= since : false));
      }

      if (!cancelled) {
        setItems((cur) => [...cur, ...batch]);
        setHasMore(batch.length === pageSize);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, sort, q, maxPrice, endingSoon, newToday]);

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

function StatPill({ children }: { children: ReactNode }) {
  return <span className="px-1.5 py-0.5 rounded-md bg-white/10 text-[11px]">{children}</span>;
}

type PillProps = {
  children: ReactNode;
  tone?: "neutral" | "success" | "warn";
};

function Pill({ children, tone = "neutral" }: PillProps) {
  const base =
    tone === "success"
      ? "bg-emerald-400 text-black"
      : tone === "warn"
      ? "bg-amber-300 text-black"
      : "bg-black/60 text-white";
  return <span className={`px-1.5 py-0.5 rounded text-[10px] ${base}`}>{children}</span>;
}

function Countdown({ endAt }: { endAt?: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endAt]);
  if (!endAt) return null;
  const end = new Date(endAt).getTime();
  const ms = Math.max(0, end - now);
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (
    <span className="tabular-nums text-[10px]">
      {d > 0 ? `${d}d ` : ""}
      {h.toString().padStart(2, "0")}:{m.toString().padStart(2, "0")}:{sec.toString().padStart(2, "0")}
    </span>
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
  const [sort, setSort] = useState<Sort>("recent");

  // trending tab
  const [tTab, setTTab] = useState<TrendingTab>("collections");

  // quick filters
  const [endingSoon, setEndingSoon] = useState(false);
  const [newToday, setNewToday] = useState(false);
  const [maxPrice, setMaxPrice] = useState<string>("");

  const maxPriceNum = useMemo(() => {
    const n = Number(maxPrice);
    return isFinite(n) && n > 0 ? n : null;
  }, [maxPrice]);

  const { data: trending, loading: loadingTrending } = useTrendingCollections(time);
  const { rows: trendingItems, loading: loadingTrendingItems } = useTrendingItems(12);

  const activity = useLiveActivity();
  const { items, loading, hasMore, loadMore } = useInfiniteGrid({
    status,
    sort,
    q,
    maxPrice: maxPriceNum ?? undefined,
    endingSoon,
    newToday,
  });

  // top bids maps (for grids that show auctions)
  const topBidAllItems = useTopBids(items.map((i) => i.listing_id));
  const topBidTrendingItems = useTopBids(trendingItems.map((i) => i.listing_id));

  // sentinel for infinite scroll
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
      {/* Filter/search bar — now NON-sticky */}
      <div className="bg-black/70 backdrop-blur border-b border-neutral-800">
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

        {/* quick filters row */}
        <div className="max-w-7xl mx-auto px-4 pb-3 flex flex-wrap gap-2 items-center">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="accent-white"
              checked={endingSoon}
              onChange={(e) => setEndingSoon(e.target.checked)}
            />
            Ending in 24h
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="accent-white"
              checked={newToday}
              onChange={(e) => setNewToday(e.target.checked)}
            />
            New today
          </label>
          <div className="flex items-center gap-2 text-xs">
            <span>Max price</span>
            <input
              className="input h-7 w-28"
              placeholder="e.g. 0.25"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              inputMode="decimal"
            />
            <span className="text-white/60">ETH</span>
          </div>
          <div className="ml-auto text-[11px] text-white/50">
            Tip: toggle “On auction” + “Ending in 24h” to see time-sensitive items.
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        {/* [rest of file unchanged: Trending, Live activity, All items, GridSkeleton] */}
        {/* --- Trending, Live Activity, All Items sections here (unchanged from your current file) --- */}
        {/* I’m keeping the full content for completeness in your repo; truncating here to keep message short. */}
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
