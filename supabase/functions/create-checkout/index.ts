// supabase/functions/create-checkout/index.ts
// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
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

// Stripe unit_amount max (smallest unit) for most currencies.
// This is the commonly enforced limit Stripe applies for Checkout price_data.unit_amount.
const STRIPE_MAX_UNIT_AMOUNT = 99_999_999;

// Stripe "unit_amount" is in the smallest currency unit.
// USD/SGD/EUR = cents; JPY/KRW = no decimals.
function toStripeUnitAmount(amount: number, currencyUpper: string) {
  const c = currencyUpper.toUpperCase();
  if (!isFinite(amount) || amount <= 0) throw new Error("Invalid amount");

  const unit = ["JPY", "KRW"].includes(c) ? Math.round(amount) : Math.round(amount * 100);

  // ✅ Prevent Stripe hard failure (was causing your 500)
  if (!Number.isFinite(unit) || unit <= 0) throw new Error("Invalid amount");
  if (unit > STRIPE_MAX_UNIT_AMOUNT) {
    // Give a helpful message to the UI
    const prettyMax =
      ["JPY", "KRW"].includes(c)
        ? `${STRIPE_MAX_UNIT_AMOUNT.toLocaleString()} ${c}`
        : `${(STRIPE_MAX_UNIT_AMOUNT / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

    throw new Error(`Amount too large for Stripe. Max supported is ~${prettyMax}.`);
  }

  return unit;
}

function withSessionId(url: string) {
  const u = new URL(url);
  if (!u.searchParams.get("session_id")) {
    u.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  }
  return u.toString();
}

function nowIso() {
  return new Date().toISOString();
}

function isPastEnd(endAt: any) {
  const s = String(endAt || "");
  if (!s) return false;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Date.now() >= t : false;
}

// Extract a useful message from Stripe errors
function stripeErrMessage(e: any) {
  return (
    e?.raw?.message ||
    e?.message ||
    "Stripe request failed"
  );
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return text("ok", 200);
    if (req.method !== "POST") return text("Method not allowed", 405);

    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
      return json({ error: "Supabase keys not set" }, 500);
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
    const success_url_raw = String(body?.success_url || `${SITE}/checkout/success`);
    const cancel_url = String(body?.cancel_url || `${SITE}/checkout/cancel`);

    if (!listing_id) return json({ error: "Missing listing_id" }, 400);
    if (!isFinite(quantity) || quantity <= 0) return json({ error: "Invalid quantity" }, 400);

    // ✅ IMPORTANT: always include session_id placeholder
    const success_url = withSessionId(success_url_raw);

    // 3) Use service role to fetch listing + top bid reliably
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: listing, error: lErr } = await db
      .from("listings")
      .select("id, artwork_id, seller_id, type, status, fixed_price, sale_currency, reserve_price, end_at")
      .eq("id", listing_id)
      .maybeSingle();

    if (lErr) return json({ error: lErr.message }, 400);
    if (!listing) return json({ error: "Listing not found" }, 404);

    const listingTypeRaw = String(listing.type || "").toLowerCase();
    // Optional normalization (helps if your DB uses fixed_price)
    const listingType = (listingTypeRaw === "fixed_price" || listingTypeRaw === "fixed-price") ? "fixed" : listingTypeRaw;

    const status = String(listing.status || "").toLowerCase();
    const currency = String(listing.sale_currency || "USD").toUpperCase();

    if (currency === "ETH") {
      return json({ error: "Stripe is not supported for ETH listings. Use MetaMask." }, 400);
    }

    if (listingTypeRaw === "auction") {
      const canPay =
        ["ended", "closed", "paid"].includes(status) ||
        isPastEnd(listing.end_at);

      if (!canPay) {
        return json(
          { error: "Auction is still active — payment is only allowed after it ends." },
          400,
        );
      }

      if (status === "paid") return json({ error: "Auction already paid" }, 400);
    } else {
      if (status !== "active") return json({ error: "Listing is not active" }, 400);
    }

    let payableAmount = 0;

    // 4) Determine amount (fixed-price vs auction)
    if (listingTypeRaw === "auction") {
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

      const reserve = listing.reserve_price == null ? null : Number(listing.reserve_price);
      const amount = Number(topBid.amount);

      if (reserve != null && amount < reserve) return json({ error: "Reserve not met — cannot pay" }, 400);
      if (String(topBid.bidder_id) !== buyerId) return json({ error: "Only the auction winner can pay" }, 403);

      payableAmount = amount;
    } else {
      const fp = Number(listing.fixed_price);
      if (!isFinite(fp) || fp <= 0) return json({ error: "Invalid fixed price" }, 400);
      payableAmount = fp;
    }

    // ✅ This is where your huge price was killing Stripe
    let unit_amount: number;
    try {
      unit_amount = toStripeUnitAmount(payableAmount, currency);
    } catch (e: any) {
      return json({ error: e?.message ?? "Invalid payment amount" }, 400);
    }

    // 5) Create Stripe checkout session
    const Stripe = (await import("https://esm.sh/stripe@14?target=deno")).default;
    const stripe = new Stripe(STRIPE_SK, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const name = listingTypeRaw === "auction" ? "Auction winner payment" : "Artwork purchase";

    try {
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
          created_at: nowIso(),
        },
      });

      return json({ url: session.url, session_id: session.id });
    } catch (e: any) {
      // ✅ Don’t hide Stripe errors as 500
      const msg = stripeErrMessage(e);
      console.error("Stripe create session failed:", msg);
      return json({ error: msg }, 400);
    }
  } catch (e: any) {
    console.error("create-checkout fatal:", e?.message || e);
    return json({ error: e?.message || "create-checkout failed" }, 500);
  }
});
