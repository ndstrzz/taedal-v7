// app/src/lib/listings.ts
import { supabase } from "./supabase";

export type Listing = {
  id: string;
  artwork_id: string;
  seller_id: string;
  type: "fixed_price" | "auction" | "coming_soon";
  status: "draft" | "active" | "paused" | "ended" | "canceled";
  sale_currency: string | null;
  fixed_price: number | null;
  quantity?: number | null;
  created_at: string;
  updated_at: string;
};

export type JoinedListing = Listing & {
  artworks: {
    id: string;
    title: string | null;
    image_url: string | null;
    creator_id: string;
    status: string;
  };
};

/**
 * Create or update the user's active fixed-price listing for a given artwork.
 * Requires the SQL function:
 *   create_or_update_listing(p_artwork_id uuid, p_price numeric, p_currency text)
 */
export async function createOrUpdateFixedPriceListing(
  artworkId: string,
  price: number,
  currency = "ETH"
): Promise<Listing> {
  const { data, error } = await supabase
    .rpc("create_or_update_listing", {
      p_artwork_id: artworkId,
      p_price: price,
      p_currency: currency,
    })
    .single<Listing>(); // expect exactly one row back

  if (error) throw error;
  return data;
}

/** Fetch a grid of active listings with their artwork joined. */
export async function fetchActiveListings(
  limit = 24
): Promise<JoinedListing[]> {
  const { data, error } = await supabase
    .from("listings")
    .select(
      `
      id, artwork_id, seller_id, type, status, sale_currency, fixed_price, quantity, created_at, updated_at,
      artworks!inner (
        id, title, image_url, creator_id, status
      )
    `
    )
    .eq("status", "active")
    .limit(limit)
    .returns<JoinedListing[]>();

  if (error) throw error;
  return data ?? [];
}

/** Fetch the current active listing for a specific artwork (or null). */
export async function fetchActiveListingForArtwork(
  artworkId: string
): Promise<Listing | null> {
  const { data, error } = await supabase
    .from("listings")
    .select(
      "id, artwork_id, seller_id, type, status, sale_currency, fixed_price, quantity, created_at, updated_at"
    )
    .eq("artwork_id", artworkId)
    .eq("status", "active")
    .maybeSingle<Listing>();

  // PGRST116 = no rows
  if (error && (error as any).code !== "PGRST116") throw error;
  return data ?? null;
}
