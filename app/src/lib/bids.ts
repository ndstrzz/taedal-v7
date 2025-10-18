// app/src/lib/bids.ts
import { supabase } from "./supabase";

export type Bid = {
  id: string;
  listing_id: string;
  bidder_id: string;
  amount: number;
  created_at: string;
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
    .limit(1)
    .maybeSingle<Bid>();
  if (error && (error as any).code !== "PGRST116") throw error;
  return data ?? null;
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

  const off: Unsub = (() => { try { supabase.removeChannel(channel); } catch {} }) as Unsub;
  off.unsubscribe = () => { try { supabase.removeChannel(channel); } catch {} };
  return off;
}

// backwards-compat alias
export const subscribeToBids = subscribeBids;

export async function endAuction(
  listingId: string
): Promise<{ order_id: string | null; winning_bid_id: string | null } | null> {
  const { data, error } = await supabase
    .rpc("end_auction", { p_listing_id: listingId })
    .single<{ order_id: string | null; winning_bid_id: string | null }>();
  if (error) throw error;
  return data ?? null;
}
