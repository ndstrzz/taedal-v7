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

const lower = (v: any) => String(v ?? "").toLowerCase();
const upper = (v: any) => String(v ?? "").toUpperCase();

function isPaidSession(session: any) {
  const ps = lower(session?.payment_status);
  const st = lower(session?.status);
  return ps === "paid" || st === "complete";
}

async function safeDecrementSeller(db: any, artworkId: string, sellerId: string) {
  try {
    await db.rpc("decrement_ownership_if_exists", {
      p_artwork_id: artworkId,
      p_owner_id: sellerId,
    });
    return;
  } catch {
    // fallback
  }

  try {
    const { data: sOwn } = await db
      .from("ownerships")
      .select("quantity")
      .eq("artwork_id", artworkId)
      .eq("owner_id", sellerId)
      .maybeSingle();

    const q = Number((sOwn as any)?.quantity ?? 0);
    if (!Number.isFinite(q) || q <= 0) return;

    const next = q - 1;
    if (next <= 0) {
      await db
        .from("ownerships")
        .delete()
        .eq("artwork_id", artworkId)
        .eq("owner_id", sellerId);
    } else {
      await db
        .from("ownerships")
        .update({ quantity: next, updated_at: new Date().toISOString() })
        .eq("artwork_id", artworkId)
        .eq("owner_id", sellerId);
    }
  } catch (e) {
    console.warn("fallback decrement seller failed:", (e as any)?.message ?? e);
  }
}

async function incrementBuyerOwnership(db: any, artworkId: string, buyerId: string, delta: number) {
  const inc = Math.max(1, Number(delta || 1));

  const { data: own } = await db
    .from("ownerships")
    .select("quantity")
    .eq("artwork_id", artworkId)
    .eq("owner_id", buyerId)
    .maybeSingle();

  const prev = Number((own as any)?.quantity ?? 0);
  const next = (Number.isFinite(prev) ? prev : 0) + inc;

  await db
    .from("ownerships")
    .upsert(
      {
        artwork_id: artworkId,
        owner_id: buyerId,
        quantity: next,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "artwork_id,owner_id" },
    );
}

async function ensureOrderPaid(db: any, payload: {
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  artwork_id: string;
  total_amount: number;
  currency: string;
  kind: string;
}) {
  const { data: existing } = await db
    .from("orders")
    .select("id")
    .eq("listing_id", payload.listing_id)
    .maybeSingle();

  const patch = {
    payment_status: "paid",
    delivery_status: "transferred",
    currency: payload.currency,
    total_amount: payload.total_amount,
    settled_at: new Date().toISOString(),
    tx_hash: null,
    chain_id: null,
  };

  if (existing?.id) {
    await db.from("orders").update(patch).eq("id", existing.id);
    return existing.id as string;
  }

  const { data: inserted } = await db
    .from("orders")
    .insert({
      listing_id: payload.listing_id,
      buyer_id: payload.buyer_id,
      seller_id: payload.seller_id,
      artwork_id: payload.artwork_id,
      quantity: 1,
      total_amount: payload.total_amount,
      currency: payload.currency,
      kind: payload.kind,
      payment_status: "paid",
      delivery_status: "transferred",
      charity_amount: 0,
      platform_fee_amount: 0,
      royalty_amount: 0,
      chain_id: null,
      tx_hash: null,
      created_at: new Date().toISOString(),
      settled_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  return (inserted as any)?.id ?? null;
}

async function fulfillFromSession(db: any, session: any) {
  // Idempotency guard
  const { data: existingFulfill } = await db
    .from("checkout_fulfillments")
    .select("stripe_session_id")
    .eq("stripe_session_id", session.id)
    .maybeSingle();

  if (existingFulfill?.stripe_session_id) {
    return { ok: true, already: true };
  }

  const md = (session.metadata ?? {}) as Record<string, string>;

  const listing_id = asUUID(md.listing_id, "metadata.listing_id");
  const artwork_id = asUUID(md.artwork_id, "metadata.artwork_id");
  const seller_id = asUUID(md.seller_id, "metadata.seller_id");
  const buyer_id = asUUID(md.buyer_id, "metadata.buyer_id");
  const listing_type = lower(md.listing_type || "") || "fixed";
  const currency = upper(md.currency || session.currency || "USD");
  const quantity = Math.max(1, Number(md.quantity || 1));

  const amount_total = Number(session.amount_total || 0);
  if (!amount_total || amount_total <= 0) throw new Error("Stripe session missing amount_total");
  const total_amount =
    ["JPY", "KRW"].includes(currency) ? amount_total : amount_total / 100;

  // Load listing (authoritative)
  const { data: listing, error: lErr } = await db
    .from("listings")
    .select("id, status, type, reserve_price")
    .eq("id", listing_id)
    .maybeSingle();
  if (lErr) throw new Error(lErr.message);
  if (!listing) throw new Error("Listing not found");

  const type = listing_type || lower((listing as any).type);

  // Auction validation (winner + reserve)
  if (type === "auction") {
    const { data: topBid, error: bErr } = await db
      .from("bids")
      .select("bidder_id, amount, created_at")
      .eq("listing_id", listing_id)
      .order("amount", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!topBid) throw new Error("No bids found for this auction");
    if (String((topBid as any).bidder_id) !== buyer_id) {
      throw new Error("Only the auction winner can finalize payment");
    }
    const reserve = (listing as any).reserve_price == null ? null : Number((listing as any).reserve_price);
    const amt = Number((topBid as any).amount);
    if (reserve != null && amt < reserve) throw new Error("Reserve not met — cannot fulfill");
  }

  // Listing status transition (consistent)
  if (type === "auction") {
    await db
      .from("listings")
      .update({ status: "paid", updated_at: new Date().toISOString() })
      .eq("id", listing_id);
  } else {
    await db
      .from("listings")
      .update({ status: "ended", updated_at: new Date().toISOString() })
      .eq("id", listing_id);
  }

  // Ownership bookkeeping (matches your SQL truth model)
  await incrementBuyerOwnership(db, artwork_id, buyer_id, quantity);
  await safeDecrementSeller(db, artwork_id, seller_id);

  // Sync artworks.owner_id for UI
  await db
    .from("artworks")
    .update({ owner_id: buyer_id, updated_at: new Date().toISOString() })
    .eq("id", artwork_id);

  // Orders
  await ensureOrderPaid(db, {
    listing_id,
    buyer_id,
    seller_id,
    artwork_id,
    total_amount,
    currency,
    kind: type === "auction" ? "auction" : "fixed",
  });

  // Sales (write once)
  await db.from("sales").insert({
    artwork_id,
    buyer_id,
    seller_id,
    price: total_amount,
    currency,
    tx_hash: null,
    sold_at: new Date().toISOString(),
  });

  // Fulfillment marker (idempotency)
  await db.from("checkout_fulfillments").insert({
    stripe_session_id: session.id,
    listing_id,
    artwork_id,
    buyer_id,
    seller_id,
    created_at: new Date().toISOString(),
  });

  return { ok: true, already: false };
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

    const paid = isPaidSession(session);
    const md = (session.metadata ?? {}) as Record<string, string>;

    // If not paid, do not mutate DB
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

    // If already fulfilled, return quickly
    const { data: existingFulfill } = await db
      .from("checkout_fulfillments")
      .select("*")
      .eq("stripe_session_id", session.id)
      .maybeSingle();

    if (existingFulfill) {
      return json({
        ok: true,
        paid: true,
        callerId,
        finalized: true,
        already_finalized: true,
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

    // Manual catch-up fulfillment (idempotent)
    const out = await fulfillFromSession(db, session);

    return json({
      ok: true,
      paid: true,
      callerId,
      finalized: true,
      already_finalized: out.already,
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
