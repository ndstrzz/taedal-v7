import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

/* ------------------- shared types (match your Discover.tsx) ------------------- */
export type Chain = "ethereum" | "polygon" | "solana";
export type Status = "buy-now" | "on-auction" | "new" | "has-offers" | "all";
export type TimeRange = "24h" | "7d" | "30d";
export type Sort = "trending" | "recent" | "price-asc" | "price-desc";

/* --------------------------- Trending Collections ---------------------------- */

type MVTrendingRow = {
  collection_id: string;
  floor_native: number | null;
  vol_24h_native: number | null;
  vol_7d_native: number | null;
  vol_30d_native: number | null;
  tx_24h: number;
  tx_7d: number;
  tx_30d: number;
  owners: number;
  items: number;
  refreshed_at: string;
};

type CollectionMeta = {
  id: string;
  // use whatever you actually have; these are optional and safely nullable
  name?: string | null;
  title?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
};

export function useTrendingCollections(time: TimeRange, limit = 12) {
  const [rows, setRows] = useState<(MVTrendingRow & {
    name?: string | null;
    logo_url?: string | null;
    banner_url?: string | null;
  })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);

      // pick the volume column based on time window
      const col =
        time === "24h" ? "vol_24h_native" : time === "7d" ? "vol_7d_native" : "vol_30d_native";

      // top by the chosen window
      const { data: mv, error } = await supabase
        .from("mv_trending_collections")
        .select("*")
        .order(col as any, { ascending: false, nullsFirst: false })
        .limit(limit);

      if (error) {
        if (!cancelled) {
          setErr(error.message);
          setLoading(false);
        }
        return;
      }
      const base = (mv ?? []) as MVTrendingRow[];

      // optional enrichment from `collections` (if table/columns exist)
      const ids = base.map((r) => r.collection_id);
      let metas: Record<string, CollectionMeta> = {};
      if (ids.length) {
        const { data: cMeta } = await supabase
          .from("collections")
          .select("id,name,title,logo_url,banner_url")
          .in("id", ids as any);

        (cMeta ?? []).forEach((c) => (metas[c.id] = c));
      }

      const merged = base.map((r) => {
        const m = metas[r.collection_id];
        return {
          ...r,
          name: m?.name ?? m?.title ?? `Collection ${r.collection_id.slice(0, 6)}`,
          logo_url: m?.logo_url ?? null,
          banner_url: m?.banner_url ?? null,
        };
      });

      if (!cancelled) {
        setRows(merged);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [time, limit]);

  return { data: rows, loading, error };
}

/* -------------------------------- Live Activity ------------------------------- */

type ActivityRow = {
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

export function useLiveActivity(_chain: Chain | "all") {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [error, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("v_live_activity_recent")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (!cancelled) {
        if (error) setErr(error.message);
        setRows((data ?? []) as ActivityRow[]);
      }
    })();

    // realtime inserts on `activity` table (if replication enabled)
    const ch = supabase
      .channel("activity-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity" },
        (payload) => {
          // best-effort hydrate from payload; for richness, you can requery the view by id
          const rec = payload.new as any;
          const next: ActivityRow = {
            id: rec.id,
            kind: rec.kind,
            artwork_id: rec.artwork_id,
            title: null,
            image_url: null,
            price_eth: rec.price_eth ?? null,
            actor: rec.actor ?? null,
            created_at: rec.created_at,
            actor_name: null,
          };
          setRows((cur) => [next, ...cur].slice(0, 80));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
      cancelled = true;
    };
  }, [_chain]);

  return { rows, error };
}

/* ------------------------------ All Items (grid) ------------------------------ */

export type DiscoverGridItem = {
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
};

type GridParams = {
  status: Status;
  sort: Sort;
  pageSize?: number;
};

export function useInfiniteGrid({ status, sort, pageSize = 24 }: GridParams) {
  const [items, setItems] = useState<DiscoverGridItem[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setErr] = useState<string | null>(null);

  // reset when filters change
  useEffect(() => {
    setItems([]);
    setPage(0);
    setHasMore(true);
    setErr(null);
  }, [status, sort, pageSize]);

  useEffect(() => {
    let cancelled = false;
    if (!hasMore || loading) return;

    (async () => {
      setLoading(true);

      let q = supabase.from("v_discover_items").select("*");

      // STATUS → server-side filter
      switch (status) {
        case "buy-now":
          // listed with a price
          q = q.not("listing_id", "is", null).not("price_native", "is", null);
          break;
        case "new":
          // recently listed (no special flag yet; we use listed_at desc)
          break;
        case "has-offers":
          // todo: hook to offers table when ready; for now, skip
          break;
        case "on-auction":
          // requires listing_type; if you add it later, filter here
          break;
        case "all":
        default:
          break;
      }

      // SORT → server-side order
      if (sort === "price-asc") q = q.order("price_native", { ascending: true, nullsFirst: false });
      else if (sort === "price-desc")
        q = q.order("price_native", { ascending: false, nullsFirst: true });
      else if (sort === "recent") q = q.order("listed_at", { ascending: false, nullsFirst: false });
      else {
        // "trending" fallback: updated_at desc as a decent proxy
        q = q.order("updated_at", { ascending: false, nullsFirst: false });
      }

      // pagination (inclusive range)
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await q.range(from, to);

      if (cancelled) return;

      if (error) {
        setErr(error.message);
        setLoading(false);
        return;
      }

      const batch = (data ?? []) as DiscoverGridItem[];
      setItems((cur) => [...cur, ...batch]);
      setHasMore(batch.length === pageSize);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [page, status, sort, pageSize, hasMore, loading]);

  return { items, loading, hasMore, error, loadMore: () => setPage((p) => p + 1) };
}
