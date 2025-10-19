// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const STRIPE_SK = Deno.env.get("STRIPE_SECRET_KEY")!;
const SITE = (Deno.env.get("SITE_URL") || "http://localhost:5173").replace(/\/$/, "");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const j = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const t = (body = "ok", status = 200) => new Response(body, { status, headers: cors });

type Listing = {
  id: string;
  sale_currency: string | null;
  fixed_price: number | null;
  seller_id: string;
  artwork_id: string;
  status: "active" | "ended";
};

const ZERO_DEC = new Set(["JPY", "KRW"]);
const toStripeAmount = (amount: number, currency: string) =>
  Math.round(amount * (ZERO_DEC.has(currency.toUpperCase()) ? 1 : 100));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return t();

  try {
    if (req.method !== "POST") return t("Method not allowed", 405);
    if (!STRIPE_SK) return t("Stripe secret not set", 500);

    const auth = req.headers.get("Authorization");
    if (!auth) return t("Missing Authorization", 401);

    const { listing_id, quantity = 1, success_url, cancel_url } = await req.json();
    if (!listing_id) return t("listing_id required", 400);

    // Auth’d client (uses caller’s JWT)
    const sb = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });

    // Who’s buying?
    const { data: me } = await sb.auth.getUser();
    if (!me?.user?.id) return t("Unauthorized", 401);
    const buyerId = me.user.id;

    // Fetch listing & artwork (trusted server-side)
    const { data: listing, error } = await sb
      .from("listings")
      .select("id, sale_currency, fixed_price, seller_id, artwork_id, status")
      .eq("id", listing_id)
      .maybeSingle<Listing>();
    if (error) throw error;
    if (!listing) return t("Listing not found", 404);
    if (listing.status !== "active") return t("Listing is not active", 400);
    if (!listing.fixed_price || !listing.sale_currency) return t("Listing missing price/currency", 400);

    const { data: art } = await sb
      .from("artworks")
      .select("title,image_url")
      .eq("id", listing.artwork_id)
      .maybeSingle();

    // Stripe session
    const Stripe = (await import("https://esm.sh/stripe@14?target=deno")).default;
    const stripe = new Stripe(STRIPE_SK, { httpClient: Stripe.createFetchHttpClient() });

    const currency = listing.sale_currency.toLowerCase();
    const unit_amount = toStripeAmount(listing.fixed_price, currency);

    const success = (success_url || `${SITE}/checkout/success?listing=${listing.id}`).replace(/\/$/, "");
    const cancel = (cancel_url || `${SITE}/art/${listing.artwork_id}?cancelled=1`).replace(/\/$/, "");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: success,
      cancel_url: cancel,
      line_items: [
        {
          quantity,
          price_data: {
            currency,
            unit_amount,
            product_data: {
              name: art?.title || "Artwork",
              images: art?.image_url ? [art.image_url] : [],
            },
          },
        },
      ],
      // 👇 critical metadata for webhook
      metadata: {
        listing_id: listing.id,
        buyer_id: buyerId,
      },
    });

    return j({ url: session.url });
  } catch (e: any) {
    console.error("create-checkout error:", e);
    return j({ error: e?.message || "Server error" }, 500);
  }
});
