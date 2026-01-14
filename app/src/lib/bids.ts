// app/src/lib/bids.ts
import { supabase } from "./supabase";

export type Bid = {
  id: string;
  listing_id: string;
  bidder_id: string;
  amount: number;
  created_at: string;
};

export type EndAuctionResult = {
  order_id: string | null;
  winning_bid_id: string | null;
};

export async function placeBid(listingId: string, amount: number): Promise<Bid> {
  const { data, error } = await supabase
    .rpc("place_bid", { p_listing_id: listingId, p_amount: amount })
    .single<Bid>();

  if (error) throw error;
  return data!;
}

export async function fetchTopBid(listingId: string): Promise<Bid | null> {
  const { data, error } = await supabase
    .from("bids")
    .select("id, listing_id, bidder_id, amount, created_at")
    .eq("listing_id", listingId)
    .order("amount", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Bid>();

  if (error && (error as any).code !== "PGRST116") throw error;
  return data ?? null;
}

export async function fetchBidById(bidId: string): Promise<Bid | null> {
  const { data, error } = await supabase
    .from("bids")
    .select("id, listing_id, bidder_id, amount, created_at")
    .eq("id", bidId)
    .maybeSingle<Bid>();

  if (error && (error as any).code !== "PGRST116") throw error;
  return data ?? null;
}

export async function fetchRecentBids(listingId: string, limit = 10): Promise<Bid[]> {
  const { data, error } = await supabase
    .from("bids")
    .select("id, listing_id, bidder_id, amount, created_at")
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as Bid[];
}

// compatibility alias
export const getHighestBid = fetchTopBid;

type Unsub = (() => void) & { unsubscribe: () => void };

export function subscribeBids(listingId: string, onInsert: (bid: Bid) => void): Unsub {
  const channel = supabase
    .channel(`bids_${listingId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "bids", filter: `listing_id=eq.${listingId}` },
      (payload) => onInsert(payload.new as Bid)
    )
    .subscribe();

  const off: Unsub = (() => {
    try {
      supabase.removeChannel(channel);
    } catch {}
  }) as Unsub;

  off.unsubscribe = () => {
    try {
      supabase.removeChannel(channel);
    } catch {}
  };

  return off;
}

// backwards-compat alias
export const subscribeToBids = subscribeBids;

/**
 * End auction and (if possible) auto-DM the winner with payment links.
 * Returns the SAME shape as public.end_auction: { order_id, winning_bid_id } or null.
 */
export async function endAuction(listingId: string): Promise<EndAuctionResult | null> {
  // 1) Prefer notify version (calls end_auction internally + sends DM)
  const r1 = await supabase
    .rpc("end_auction_notify", { p_listing_id: listingId })
    .maybeSingle<EndAuctionResult>();

  if (!r1.error) return r1.data ?? null;

  // IMPORTANT: do NOT silently fall back — log why notify failed
  console.warn("[endAuction] end_auction_notify failed, falling back to end_auction:", {
    message: r1.error.message,
    details: (r1.error as any).details,
    hint: (r1.error as any).hint,
    code: (r1.error as any).code,
  });

  // 2) Fallback to old end_auction (keeps system working even if notify not working)
  const r2 = await supabase
    .rpc("end_auction", { p_listing_id: listingId })
    .maybeSingle<EndAuctionResult>();

  // PGRST116 = no rows (no winner / reserve not met)
  if (r2.error && (r2.error as any).code !== "PGRST116") throw r2.error;

  return r2.data ?? null;
}
