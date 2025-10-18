// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SERVICE_ROLE_KEY")!;
const CC_API_KEY = Deno.env.get("COINBASE_COMMERCE_API_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:5173";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function text(body: string, status = 200) {
  return new Response(body, { status, headers: cors });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return text("ok");
  if (req.method !== "POST") return text("Method not allowed", 405);
  try {
    if (!CC_API_KEY) return text("COINBASE_COMMERCE_API_KEY not set", 500);

    const auth = req.headers.get("Authorization");
    if (!auth) return text("Missing Authorization", 401);

    const { listing_id, quantity = 1 } = await req.json();
    if (!listing_id) return text("listing_id required", 400);

    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });

    const { data: me } = await userClient.auth.getUser();
    if (!me?.user) return text("Unauthorized", 401);
    const buyerId = me.user.id;

    const { data: listing, error } = await userClient
      .from("listings")
      .select("id, sale_currency, fixed_price, seller_id, artwork_id")
      .eq("id", listing_id)
      .eq("status", "active")
      .maybeSingle<any>();
    if (error) throw error;
    if (!listing) return text("Listing not found", 404);
    if (!listing.fixed_price || !listing.sale_currency) return text("Listing missing price/currency", 400);

    // Coinbase Commerce prefers fiat as local_price; it will quote crypto dynamically.
    // If your sale_currency is crypto, consider converting to USD here (your pricing policy).
    const localCurrency = ["USD","EUR","GBP"].includes((listing.sale_currency || "").toUpperCase())
      ? listing.sale_currency.toUpperCase()
      : "USD";
    const localAmount = listing.sale_currency.toUpperCase() === localCurrency
      ? listing.fixed_price
      : listing.fixed_price; // TODO: convert if you want strict parity

    const res = await fetch("https://api.commerce.coinbase.com/charges", {
      method: "POST",
      headers: {
        "X-CC-Api-Key": CC_API_KEY,
        "X-CC-Version": "2018-03-22",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Artwork",
        description: `Listing ${listing.id}`,
        pricing_type: "fixed_price",
        local_price: { amount: String(localAmount), currency: localCurrency },
        metadata: { listing_id: listing.id, artwork_id: listing.artwork_id, buyer_id: buyerId, quantity },
        redirect_url: `${SITE_URL}/checkout/crypto/success?listing=${listing.id}`,
        cancel_url: `${SITE_URL}/art/${listing.artwork_id}?cancelled=1`,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return json({ error: body }, 502);
    }
    const charge = await res.json();
    const hosted = charge?.data?.hosted_url;
    return json({ hosted_url: hosted });
  } catch (e: any) {
    return json({ error: e?.message || "Server error" }, 500);
  }
});
