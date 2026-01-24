// supabase/functions/stripe-webhook/index.ts
// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SERVICE_ROLE_KEY")!;
const STRIPE_SK = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const res = (body: any, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": typeof body === "string" ? "text/plain" : "application/json",
    },
  });

const lower = (v: any) => String(v ?? "").toLowerCase();
const upper = (v: any) => String(v ?? "").toUpperCase();

function isPaidSession(session: any) {
  const ps = lower(session?.payment_status);
  const st = lower(session?.status);
  return ps === "paid" || st === "complete";
}

function parseClientRef(ref: any) {
  try {
    const [b, l, a, s] = String(ref || "").split(":");
    return {
      buyerId: b || null,
      listingId: l || null,
      artworkId: a || null,
      sellerId: s || null,
    };
  } catch {
    return { buyerId: null, listingId: null, artworkId: null, sellerId: null };
  }
}

async function safeDecrementSeller(db: any, artworkId: string, sellerId: string) {
  // Prefer your RPC if present
  try {
    await db.rpc("decrement_ownership_if_exists", {
      p_artwork_id: artworkId,
      p_owner_id: sellerId,
    });
    return;
  } catch {
    // fallback below
  }

  // Fallback: decrement manually (best effort)
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
  stripe_session_id: string;
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

async function fulfillStripeSession(db: any, session: any) {
  // 0) Idempotency guard
  const { data: existingFulfill } = await db
    .from("checkout_fulfillments")
    .select("stripe_session_id")
    .eq("stripe_session_id", session.id)
    .maybeSingle();

  if (existingFulfill?.stripe_session_id) {
    return { ok: true, already: true };
  }

  const md = (session.metadata ?? {}) as Record<string, string>;

  let listingId = md.listing_id || null;
  let artworkId = md.artwork_id || null;
  let sellerId = md.seller_id || null;
  let buyerId = md.buyer_id || null;
  const quantity = Math.max(1, Number(md.quantity || 1));

  if ((!listingId || !artworkId || !sellerId || !buyerId) && session.client_reference_id) {
    const p = parseClientRef(session.client_reference_id);
    buyerId = buyerId || p.buyerId;
    listingId = listingId || p.listingId;
    artworkId = artworkId || p.artworkId;
    sellerId = sellerId || p.sellerId;
  }

  if (!listingId || !artworkId || !sellerId || !buyerId) {
    throw new Error("stripe-webhook: missing ids (metadata/client_reference_id)");
  }

  const currency = upper(md.currency || session.currency || "USD");
  const listingType = lower(md.listing_type || md.type || "");

  // Amount from Stripe (smallest unit)
  const amountTotal: number = Number(session.amount_total ?? 0);
  if (!amountTotal || amountTotal <= 0) throw new Error("Stripe session missing amount_total");
  const totalAmount = ["JPY", "KRW"].includes(currency) ? amountTotal : amountTotal / 100;

  // 1) Load listing (authoritative)
  const { data: listing, error: lErr } = await db
    .from("listings")
    .select("id, artwork_id, seller_id, type, status, reserve_price, end_at, sale_currency")
    .eq("id", listingId)
    .maybeSingle();
  if (lErr) throw new Error(lErr.message);
  if (!listing) throw new Error("Listing not found");

  const dbListingType = lower((listing as any).type);
  const type = (listingType || dbListingType || "fixed").toLowerCase();
  const status = lower((listing as any).status);

  // 2) Auction: validate winner + reserve
  if (type === "auction") {
    const { data: topBid, error: bErr } = await db
      .from("bids")
      .select("bidder_id, amount, created_at")
      .eq("listing_id", listingId)
      .order("amount", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!topBid) throw new Error("No bids found for this auction");
    if (String((topBid as any).bidder_id) !== String(buyerId)) {
      throw new Error("Only the auction winner can be fulfilled");
    }

    const reserve = (listing as any).reserve_price == null ? null : Number((listing as any).reserve_price);
    const amt = Number((topBid as any).amount);
    if (reserve != null && amt < reserve) throw new Error("Reserve not met — cannot fulfill");
  }

  // 3) Listing status transition (consistent)
  if (type === "auction") {
    // Auction payments should end in "paid"
    if (status !== "paid") {
      await db
        .from("listings")
        .update({ status: "paid", updated_at: new Date().toISOString() })
        .eq("id", listingId);
    }
  } else {
    // Fixed-price ends in "ended"
    if (status !== "ended") {
      await db
        .from("listings")
        .update({ status: "ended", updated_at: new Date().toISOString() })
        .eq("id", listingId);
    }
  }

  // 4) Ownership bookkeeping (THIS is what your SQL model expects)
  await incrementBuyerOwnership(db, artworkId, buyerId, quantity);
  await safeDecrementSeller(db, artworkId, sellerId);

  // 5) Sync artworks.owner_id to buyer (keeps UI simple; your triggers can also handle this)
  await db
    .from("artworks")
    .update({ owner_id: buyerId, updated_at: new Date().toISOString() })
    .eq("id", artworkId);

  // 6) Orders
  const kind = type === "auction" ? "auction" : "fixed";
  await ensureOrderPaid(db, {
    listing_id: listingId,
    buyer_id: buyerId,
    seller_id: sellerId,
    artwork_id: artworkId,
    total_amount: totalAmount,
    currency,
    kind,
    stripe_session_id: session.id,
  });

  // 7) Sales (write once)
  await db.from("sales").insert({
    artwork_id: artworkId,
    buyer_id: buyerId,
    seller_id: sellerId,
    price: totalAmount,
    currency,
    tx_hash: null,
    sold_at: new Date().toISOString(),
  });

  // 8) Fulfillment marker (idempotency key)
  await db.from("checkout_fulfillments").insert({
    stripe_session_id: session.id,
    listing_id: listingId,
    artwork_id: artworkId,
    buyer_id: buyerId,
    seller_id: sellerId,
    created_at: new Date().toISOString(),
  });

  return { ok: true, already: false };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return res("Method not allowed", 405);
  if (!STRIPE_SK || !STRIPE_WEBHOOK_SECRET) return res("Stripe secrets not set", 500);

  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature") || "";

  try {
    const Stripe = (await import("https://esm.sh/stripe@14?target=deno")).default;
    const stripe = new Stripe(STRIPE_SK, { httpClient: Stripe.createFetchHttpClient() });

    const event = await stripe.webhooks.constructEventAsync(
      rawBody,
      sig,
      STRIPE_WEBHOOK_SECRET,
    );

    // We fulfill on checkout completion
    if (event.type === "checkout.session.completed") {
      const session: any = event.data.object;

      // Only fulfill paid sessions
      if (!isPaidSession(session)) {
        console.log("stripe-webhook: session not paid yet", {
          id: session?.id,
          status: session?.status,
          payment_status: session?.payment_status,
        });
        return res({ ok: true, skipped: "not_paid" });
      }

      const db = createClient(SUPABASE_URL, SERVICE);

      // Canonical fulfillment (idempotent)
      const out = await fulfillStripeSession(db, session);

      console.log("stripe-webhook ✔ fulfilled", {
        session_id: session.id,
        already: out.already,
        listing_id: session?.metadata?.listing_id,
        buyer_id: session?.metadata?.buyer_id,
      });

      return res({ ok: true, ...out });
    }

    return res({ received: true });
  } catch (e: any) {
    console.error("stripe-webhook fatal", e?.message || e);
    // Return 400 so Stripe retries if signature or processing failed
    return res({ error: e?.message || "Webhook error" }, 400);
  }
});
