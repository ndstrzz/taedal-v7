import { supabase } from "./supabase";

export type Order = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  artwork_id: string;
  quantity: number;
  total_amount: number;
  currency: string | null;
  kind: "fixed_price" | "auction";
  payment_status: "pending" | "paid" | "failed" | "refunded";
  delivery_status: "pending" | "transferred" | "failed";
  created_at: string;
  settled_at: string | null;
};

export async function buyNow(listingId: string, quantity = 1): Promise<Order> {
  const { data, error } = await supabase
    .rpc("buy_fixed_price", { p_listing_id: listingId, p_quantity: quantity })
    .single<Order>();
  if (error) throw error;
  return data!;
}
