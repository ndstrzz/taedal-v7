// supabase/functions/checkout-finalize/index.ts
// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const STRIPE_SK = Deno.env.get("STRIPE_SECRET_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asUUID(x: any, name: string) {
  const s = String(x || "");
  if (!s || s.length < 10) throw new Error(`Missing/invalid ${name}`);
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { session_id } = await req.json().catch(() => ({}));
    if (!session_id) return json({ error: "Missing session_id" }, 400);

    if (!SUPABASE_URL || !ANON || !SERVICE_KEY) {
      return json({ error: "Supabase keys not set" }, 500);
    }
    if (!STRIPE_SK) return json({ error: "Stripe secret not set" }, 500);

    // Caller (for UI info only)
    const supabaseAuthed = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: authData } = await supabaseAuthed.auth.getUser();
    const callerId = authData?.user?.id ?? null;

    // Service role client (writes)
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

    // Stripe verify
    const stripe = new Stripe(STRIPE_SK, { apiVersion: "2023-10-16" });
    const session = await stripe.checkout.sessions.retrieve(session_id);

    const paid =
      session.payment_status === "paid" ||
      session.status === "complete";

    const md = (session.metadata ?? {}) as Record<string, string>;

    // We rely on create-checkout metadata
    const listing_id = asUUID(md.listing_id, "metadata.listing_id");
    const artwork_id = asUUID(md.artwork_id, "metadata.artwork_id");
    const seller_id = asUUID(md.seller_id, "metadata.seller_id");
    const buyer_id = asUUID(md.buyer_id, "metadata.buyer_id");
    const listing_type = String(md.listing_type || "").toLowerCase() || "fixed";
    const currency = String(md.currency || session.currency || "USD").toUpperCase();

    // Amount (Stripe is smallest unit)
    const amount_total = Number(session.amount_total || 0);
    if (!amount_total || amount_total <= 0) {
      return json({
        ok: false,
        paid,
        error: "Stripe session missing amount_total",
      }, 400);
    }

    const total_amount =
      ["JPY", "KRW"].includes(currency) ? amount_total : amount_total / 100;

    // If not paid, just return status (do not mutate DB)
    if (!paid) {
      return json({
        ok: true,
        paid: false,
        callerId,
        session: {
          id: session.id,
          status: session.status,
          payment_status: session.payment_status,
          amount_total: session.amount_total,
          currency: session.currency,
          metadata: md,
        },
      });
    }

    // -------------------------
    // Idempotency check:
    // Change the guard to NOT exit. Instead, treat it as "already finalized, but make sure status is correct".
    // -------------------------
    const { data: existingFulfill } = await db
      .from("checkout_fulfillments")
      .select("*")
      .eq("stripe_session_id", session.id)
      .maybeSingle();

    const alreadyFinalized = !!existingFulfill;
    // DO NOT return - continue to ensure listing/order/sale are correct

    // -------------------------
    // Load listing + determine auction amount if needed
    // -------------------------
    const { data: listing, error: lErr } = await db
      .from("listings")
      .select("id, artwork_id, seller_id, type, status, reserve_price, sale_currency, end_at")
      .eq("id", listing_id)
      .maybeSingle();

    if (lErr) return json({ error: lErr.message }, 400);
    if (!listing) return json({ error: "Listing not found" }, 404);

    // For auction, validate buyer is winner (top bid)
    if (listing_type === "auction") {
      const { data: topBid, error: bErr } = await db
        .from("bids")
        .select("bidder_id, amount, created_at")
        .eq("listing_id", listing_id)
        .order("amount", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (bErr) return json({ error: bErr.message }, 400);
      if (!topBid) return json({ error: "No bids found for this auction" }, 400);
      if (String(topBid.bidder_id) !== buyer_id) {
        return json({ error: "Only the auction winner can finalize payment" }, 403);
      }
    }

    // -------------------------
    // 1) End listing (Always ensure status is 'paid')
    // -------------------------
    await db
      .from("listings")
      .update({ 
        status: "paid", 
        updated_at: new Date().toISOString() 
      })
      .eq("id", listing_id);

    // -------------------------
    // 2) Transfer ownership (Always ensure buyer is the owner)
    // -------------------------
    await db
      .from("artworks")
      .update({ owner_id: buyer_id, updated_at: new Date().toISOString() })
      .eq("id", artwork_id);

    // -------------------------
    // 3) Create/Update order (Always ensure payment_status = 'paid')
    // -------------------------
    const { data: existingOrder } = await db
      .from("orders")
      .select("id")
      .eq("listing_id", listing_id)
      .maybeSingle();

    if (existingOrder?.id) {
      await db
        .from("orders")
        .update({
          payment_status: "paid",
          delivery_status: "transferred",
          currency,
          total_amount,
          settled_at: new Date().toISOString(),
        })
        .eq("id", existingOrder.id);
    } else {
      await db.from("orders").insert({
        listing_id,
        buyer_id,
        seller_id,
        artwork_id,
        quantity: 1,
        total_amount,
        currency,
        kind: listing_type === "auction" ? "auction" : "fixed",
        payment_status: "paid",
        delivery_status: "transferred",
        charity_amount: 0,
        platform_fee_amount: 0,
        royalty_amount: 0,
        chain_id: null,
        tx_hash: null,
        created_at: new Date().toISOString(),
        settled_at: new Date().toISOString(),
      });
    }

    // -------------------------
    // 4) Insert sale row (Deduplicated)
    // -------------------------
    const { data: saleExists } = await db
      .from("sales")
      .select("id")
      .eq("artwork_id", artwork_id)
      .eq("buyer_id", buyer_id)
      .order("sold_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!saleExists?.id) {
      await db.from("sales").insert({
        artwork_id,
        buyer_id,
        seller_id,
        price: total_amount,
        currency,
        tx_hash: null,
        sold_at: new Date().toISOString(),
      });
    }

    // -------------------------
    // 5) Record fulfillment only if it doesn't exist
    // -------------------------
    if (!alreadyFinalized) {
      await db.from("checkout_fulfillments").insert({
        stripe_session_id: session.id,
        listing_id,
        artwork_id,
        buyer_id,
        seller_id,
        created_at: new Date().toISOString(),
      });
    }

    return json({
      ok: true,
      paid: true,
      callerId,
      finalized: true,
      already_finalized: alreadyFinalized,
      session: {
        id: session.id,
        status: session.status,
        payment_status: session.payment_status,
        amount_total: session.amount_total,
        currency: session.currency,
        metadata: md,
      },
    });
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? String(e) }, 500);
  }
});