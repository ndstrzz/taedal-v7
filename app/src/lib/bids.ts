// app/src/lib/bids.ts
import { supabase } from "./supabase";

export type Bid = {
  id: string;
  listing_id: string;
  bidder_id: string;
  amount: number;
  status: "active" | "canceled" | "retracted" | "won" | "lost";
  created_at: string;
};

export async function fetchTopBid(listingId: string): Promise<Bid | null> {
  const { data, error } = await supabase
    .from("bids")
    .select("*")
    .eq("listing_id", listingId)
    .eq("status", "active")
    .order("amount", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<Bid>();
  if (error && (error as any).code !== "PGRST116") throw error;
  return data ?? null;
}

export async function placeBid(listingId: string, amount: number): Promise<Bid> {
  const { data, error } = await supabase
    .rpc("place_bid", { p_listing_id: listingId, p_amount: amount })
    .single<Bid>();
  if (error) throw error;
  return data!;
}

export async function endAuction(listingId: string): Promise<{ order_id?: string; winning_bid_id?: string; } | null> {
  const { data, error } = await supabase
    .rpc("end_auction", { p_listing_id: listingId });
  if (error) throw error;
  return (data as any[] | null)?.[0] ?? null;
}

/** Realtime subscription to bids for a listing */
export function subscribeBids(listingId: string, onInsert: (b: Bid) => void) {
  const ch = supabase
    .channel(`bids_${listingId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "bids", filter: `listing_id=eq.${listingId}` },
      (payload) => onInsert(payload.new as Bid)
    )
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}
