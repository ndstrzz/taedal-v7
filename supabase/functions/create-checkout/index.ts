// supabase/functions/create-checkout/index.ts
// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SERVICE_ROLE_KEY") ||
  Deno.env.get("SERVICE_ROLE") ||
  "";
const STRIPE_SK = Deno.env.get("STRIPE_SECRET_KEY")!;
const SITE = (Deno.env.get("SITE_URL") || "http://localhost:5173").replace(/\/$/, "");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function text(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/plain" },
  });
}

function currencyToStripe(code: string) {
  return String(code || "USD").toLowerCase();
}

// Stripe "unit_amount" is in the smallest currency unit.
// USD/SGD/EUR = cents; JPY/KRW = no decimals.
function toStripeUnitAmount(amount: number, currencyUpper: string) {
  const c = currencyUpper.toUpperCase();
  if (!isFinite(amount) || amount <= 0) throw new Error("Invalid amount");
  if (["JPY", "KRW"].includes(c)) return Math.round(amount);
  return Math.round(amount * 100);
}

/**
 * IMPORTANT:
 * Stripe ONLY replaces the placeholder if it appears literally as:
 *   {CHECKOUT_SESSION_ID}
 * If you build it via URLSearchParams, the braces get encoded -> Stripe won't replace.
 */
function ensureSessionIdPlaceholderRaw(url: string) {
  // Fix common bad encoding produced by URL()/searchParams:
  url = url.replace(
    /session_id=%7B(CHECKOUT_SESSION_ID)%7D/gi,
    "session_id={$1}"
  );

  // If already has session_id=..., keep it
  if (url.includes("session_id=")) return url;

  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}session_id={CHECKOUT_SESSION_ID}`;
}

function ensureParam(url: string, key: string, value: string) {
  const u = new URL(url);
  if (!u.searchParams.get(key)) u.searchParams.set(key, value);
  return u.toString();
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return text("ok", 200);
    if (req.method !== "POST") return text("Method not allowed", 405);

    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
      return json({ error: "Supabase keys not set (SUPABASE_URL / SUPABASE_ANON_KEY / SERVICE ROLE)" }, 500);
    }
    if (!STRIPE_SK) return json({ error: "Stripe secret not set" }, 500);

    const authHeader =
      req.headers.get("authorization") ||
      req.headers.get("Authorization") ||
      "";
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    // 1) Identify user (MUST be the payer)
    const authed = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await authed.auth.getUser();

    if (userErr || !user?.id) return json({ error: "Not authenticated" }, 401);
    const buyerId = user.id;

    // 2) Read request body
    const body = await req.json().catch(() => ({}));
    const listing_id = String(body?.listing_id || "");
    const quantity = Number(body?.quantity || 1);

    // Default URLs (safe defaults)
    let success_url = String(body?.success_url || `${SITE}/checkout/success`);
    let cancel_url = String(body?.cancel_url || `${SITE}/checkout/cancel`);

    if (!listing_id) return json({ error: "Missing listing_id" }, 400);
    if (!isFinite(quantity) || quantity <= 0) return json({ error: "Invalid quantity" }, 400);

    // 3) Use service role to fetch listing + top bid reliably
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: listing, error: lErr } = await db
      .from("listings")
      .select(
        "id, artwork_id, seller_id, type, status, fixed_price, sale_currency, reserve_price, end_at"
      )
      .eq("id", listing_id)
      .maybeSingle();

    if (lErr) return json({ error: lErr.message }, 400);
    if (!listing) return json({ error: "Listing not found" }, 404);

    const listingType = String(listing.type || "").toLowerCase();
    const status = String(listing.status || "").toLowerCase();
    const currency = String(listing.sale_currency || "USD").toUpperCase();

    if (currency === "ETH") {
      return json(
        { error: "Stripe is not supported for ETH listings. Use MetaMask." },
        400
      );
    }

    // Ensure success url includes listing/artwork ids (helps Success.tsx + back button)
    success_url = ensureParam(success_url, "listing_id", String(listing.id));
    success_url = ensureParam(success_url, "artwork_id", String(listing.artwork_id));

    cancel_url = ensureParam(cancel_url, "listing_id", String(listing.id));
    cancel_url = ensureParam(cancel_url, "artwork_id", String(listing.artwork_id));

    // ✅ IMPORTANT: ensure raw placeholder (NOT url-encoded)
    success_url = ensureSessionIdPlaceholderRaw(success_url);

    let payableAmount = 0;

    // 4) Determine amount (fixed-price vs auction)
    if (listingType === "auction") {
      const { data: topBid, error: bErr } = await db
        .from("bids")
        .select("id, amount, bidder_id, created_at")
        .eq("listing_id", listing_id)
        .order("amount", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (bErr) return json({ error: bErr.message }, 400);
      if (!topBid) return json({ error: "No bids found for this auction" }, 400);

      const reserve =
        listing.reserve_price == null ? null : Number(listing.reserve_price);
      const amount = Number(topBid.amount);

      if (reserve != null && amount < reserve) {
        return json({ error: "Reserve not met — cannot pay" }, 400);
      }

      if (String(topBid.bidder_id) !== buyerId) {
        return json({ error: "Only the auction winner can pay" }, 403);
      }

      if (status === "paid" || status === "sold") {
        return json({ error: "Auction already paid" }, 400);
      }

      payableAmount = amount;
    } else {
      if (status !== "active") {
        return json({ error: "Listing is not active" }, 400);
      }

      const fp = Number(listing.fixed_price);
      if (!isFinite(fp) || fp <= 0) return json({ error: "Invalid fixed price" }, 400);
      payableAmount = fp;
    }

    const unit_amount = toStripeUnitAmount(payableAmount, currency);

    // 5) Create Stripe checkout session
    const Stripe = (await import("https://esm.sh/stripe@14?target=deno")).default;
    const stripe = new Stripe(STRIPE_SK, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const name = listingType === "auction"
      ? "Auction winner payment"
      : "Artwork purchase";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url,
      cancel_url,
      line_items: [
        {
          quantity,
          price_data: {
            currency: currencyToStripe(currency),
            unit_amount,
            product_data: {
              name,
              description: `Listing ${listing_id}`,
            },
          },
        },
      ],
      client_reference_id: `${buyerId}:${listing.id}:${listing.artwork_id}:${listing.seller_id}`,
      metadata: {
        listing_id: String(listing.id),
        artwork_id: String(listing.artwork_id),
        seller_id: String(listing.seller_id),
        buyer_id: String(buyerId),
        quantity: String(quantity),
        listing_type: listingType,
        currency: currency,
      },
    });

    return json({ url: session.url, session_id: session.id });
  } catch (e: any) {
    console.error("create-checkout fatal:", e?.message || e);
    return json({ error: e?.message || "create-checkout failed" }, 500);
  }
});
