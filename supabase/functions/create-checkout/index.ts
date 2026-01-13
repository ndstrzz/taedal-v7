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
  status: string | null; // "active" | "ended" | "paid" | ...
  type?: string | null;  // "fixed" | "auction" (your schema)
  reserve_price?: number | null;
};

const ZERO_DEC = new Set(["JPY", "KRW"]);
const toStripeAmount = (amount: number, currency: string) =>
  Math.round(amount * (ZERO_DEC.has(currency.toUpperCase()) ? 1 : 100));

async function fetchTopBidAmount(sb: any, listingId: string): Promise<{ amount: number; bidder_id: string } | null> {
  const { data, error } = await sb
    .from("bids")
    .select("amount,bidder_id")
    .eq("listing_id", listingId)
    .order("amount", { ascending: false })
    .limit(1);

  if (error) throw error;
  const row = (data?.[0] ?? null) as any;
  if (!row?.amount || !row?.bidder_id) return null;
  return { amount: Number(row.amount), bidder_id: String(row.bidder_id) };
}

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

    // Who’s paying?
    const { data: me } = await sb.auth.getUser();
    if (!me?.user?.id) return t("Unauthorized", 401);
    const buyerId = me.user.id;

    // Fetch listing
    const { data: listing, error } = await sb
      .from("listings")
      .select("id, sale_currency, fixed_price, seller_id, artwork_id, status, type, reserve_price")
      .eq("id", listing_id)
      .maybeSingle<Listing>();
    if (error) throw error;
    if (!listing) return t("Listing not found", 404);

    const listingType = (listing.type ?? "fixed").toLowerCase();
    const currencyRaw = listing.sale_currency ?? "USD";
    const currency = currencyRaw.toLowerCase();

    // Fetch artwork (for product title/images)
    const { data: art } = await sb
      .from("artworks")
      .select("title,image_url")
      .eq("id", listing.artwork_id)
      .maybeSingle();

    // Decide charge amount
    let unitPrice: number | null = null;

    if (listingType === "auction") {
      // Auction: must be ended (or closed), and caller must be winner
      const st = (listing.status ?? "").toLowerCase();
      const endedOk = st === "ended" || st === "closed";
      if (!endedOk) return t("Auction is not ended yet", 400);

      const top = await fetchTopBidAmount(sb, listing.id);
      if (!top) return t("No bids found for this auction", 400);

      // reserve gate (if reserve exists)
      const reserve = listing.reserve_price == null ? null : Number(listing.reserve_price);
      if (reserve != null && Number(top.amount) < reserve) {
        return t("Reserve not met", 400);
      }

      // winner gate
      if (String(top.bidder_id) !== String(buyerId)) {
        return t("Only the auction winner can pay", 403);
      }

      unitPrice = Number(top.amount);
      if (!isFinite(unitPrice) || unitPrice <= 0) return t("Invalid auction price", 400);
    } else {
      // Fixed price: must be active
      const st = (listing.status ?? "").toLowerCase();
      if (st !== "active") return t("Listing is not active", 400);
      if (!listing.fixed_price || !listing.sale_currency) return t("Listing missing price/currency", 400);

      unitPrice = Number(listing.fixed_price);
      if (!isFinite(unitPrice) || unitPrice <= 0) return t("Invalid listing price", 400);
    }

    // Stripe session
    const Stripe = (await import("https://esm.sh/stripe@14?target=deno")).default;
    const stripe = new Stripe(STRIPE_SK, { httpClient: Stripe.createFetchHttpClient() });

    const unit_amount = toStripeAmount(unitPrice, currency);

    const success = (success_url || `${SITE}/checkout/success?listing=${listing.id}`).replace(/\/$/, "");
    const cancel = (cancel_url || `${SITE}/art/${listing.artwork_id}?cancelled=1`).replace(/\/$/, "");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: success,
      cancel_url: cancel,
      line_items: [
        {
          quantity: Math.max(1, Number(quantity || 1)),
          price_data: {
            currency,
            unit_amount,
            product_data: {
              name:
                listingType === "auction"
                  ? `${art?.title || "Artwork"} (Auction winner payment)`
                  : art?.title || "Artwork",
              images: art?.image_url ? [art.image_url] : [],
            },
          },
        },
      ],
      metadata: {
        listing_id: listing.id,
        buyer_id: buyerId,
        listing_type: listingType,
        charged_amount: String(unitPrice),
        charged_currency: currencyRaw,
      },
    });

    return j({ url: session.url });
  } catch (e: any) {
    console.error("create-checkout error:", e);
    return j({ error: e?.message || "Server error" }, 500);
  }
});
