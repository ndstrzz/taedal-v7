// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SERVICE_ROLE_KEY")!;
const STRIPE_SK = Deno.env.get("STRIPE_SECRET_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:5173";
// ---- CORS helpers ----
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// One Deno.serve per file
Deno.serve(async (req) => {
  // Handle CORS preflight early
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ---------------------------
    // YOUR EXISTING LOGIC HERE...
    // e.g. parse JSON body, call APIs, etc.
    // Make sure every return includes the corsHeaders!
    // ---------------------------

    // Example success:
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err?.message ?? err) }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

type Listing = { id: string; sale_currency: string | null; fixed_price: number | null; seller_id: string; artwork_id: string; };

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function text(body: string, status = 200) {
  return new Response(body, { status, headers: cors });
}

// Convert decimal price to the integer amount for Stripe (e.g. USD cents). For zero-decimal currencies, multiply by 1.
const ZERO_DEC = new Set(["JPY","KRW"]);
function toStripeAmount(amount: number, currency: string) {
  return Math.round(amount * (ZERO_DEC.has(currency.toUpperCase()) ? 1 : 100));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return text("ok");

  try {
    if (req.method !== "POST") return text("Method not allowed", 405);
    if (!STRIPE_SK) return text("Stripe secret not set", 500);

    const auth = req.headers.get("Authorization");
    if (!auth) return text("Missing Authorization", 401);

    const { listing_id, quantity = 1 } = await req.json();
    if (!listing_id) return text("listing_id required", 400);

    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const server = createClient(SUPABASE_URL, SERVICE);

    const { data: me } = await userClient.auth.getUser();
    if (!me?.user) return text("Unauthorized", 401);
    const buyerId = me.user.id;

    const { data: listing, error } = await userClient
      .from("listings")
      .select("id, sale_currency, fixed_price, seller_id, artwork_id")
      .eq("id", listing_id)
      .eq("status", "active")
      .maybeSingle<Listing>();
    if (error) throw error;
    if (!listing) return text("Listing not found", 404);
    if (!listing.fixed_price || !listing.sale_currency) return text("Listing missing price/currency", 400);

    // Fetch artwork title for prettier Checkout
    const { data: art } = await userClient
      .from("artworks")
      .select("title, image_url")
      .eq("id", listing.artwork_id)
      .maybeSingle();

    const Stripe = (await import("https://esm.sh/stripe@14?target=deno")).default;
    const stripe = new Stripe(STRIPE_SK, { httpClient: Stripe.createFetchHttpClient() });

    const amount = toStripeAmount(listing.fixed_price, listing.sale_currency);
    const currency = listing.sale_currency.toLowerCase();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${SITE_URL}/checkout/success?listing=${listing.id}`,
      cancel_url: `${SITE_URL}/art/${listing.artwork_id}?cancelled=1`,
      line_items: [{
        quantity,
        price_data: {
          currency,
          unit_amount: amount,
          product_data: {
            name: art?.title || "Artwork",
            images: art?.image_url ? [art.image_url] : [],
          }
        },
      }],
      metadata: {
        listing_id: listing.id,
        artwork_id: listing.artwork_id,
        seller_id: listing.seller_id,
        buyer_id: buyerId,
        quantity: String(quantity),
      }
    });

    return json({ url: session.url });
  } catch (e: any) {
    return json({ error: e?.message || "Server error" }, 500);
  }
});
