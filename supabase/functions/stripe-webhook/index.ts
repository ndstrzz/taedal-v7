// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SERVICE_ROLE_KEY")!;
const STRIPE_SK = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

function res(body: any, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": typeof body === "string" ? "text/plain" : "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return res("Method not allowed", 405);
  if (!STRIPE_SK || !STRIPE_WEBHOOK_SECRET) return res("Stripe secrets not set", 500);

  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature") || "";

  try {
    const Stripe = (await import("https://esm.sh/stripe@14?target=deno")).default;
    const stripe = new Stripe(STRIPE_SK, { httpClient: Stripe.createFetchHttpClient() });
    const event = await stripe.webhooks.constructEventAsync(rawBody, sig, STRIPE_WEBHOOK_SECRET);

    if (event.type === "checkout.session.completed") {
      const session: any = event.data.object;
      const md = session.metadata || {};

      const listingId = md.listing_id;
      const artworkId = md.artwork_id;
      const sellerId = md.seller_id;
      const buyerId = md.buyer_id;
      const quantity = Number(md.quantity || 1);

      // Sanity check
      if (!listingId || !artworkId || !sellerId || !buyerId) {
        return res({ error: "Missing metadata" }, 400);
      }

      // Derive price/currency from session
      const amountTotal = session.amount_total; // in smallest unit
      const currency = (session.currency || "").toUpperCase();
      const price = ["JPY", "KRW"].includes(currency) ? amountTotal : amountTotal / 100;

      const db = createClient(SUPABASE_URL, SERVICE);

      // 1) End listing if still active
      await db.from("listings").update({ status: "ended" }).eq("id", listingId).eq("status", "active");

      // 2) Insert sales row
      await db.from("sales").insert({
        artwork_id: artworkId,
        buyer_id: buyerId,
        seller_id: sellerId,
        price,
        currency,
        sold_at: new Date().toISOString(),
        tx_hash: null, // not an on-chain tx
      });

      // 3) Transfer ownership — simplest: set owner_id on single-edition artwork
      await db.from("artworks").update({ owner_id: buyerId }).eq("id", artworkId);

      // 4) Update ownerships table (upsert buyer + decrement seller)
      // Buyer +1
      await db.from("ownerships").upsert({
        artwork_id: artworkId,
        owner_id: buyerId,
        quantity: 1,
        updated_at: new Date().toISOString(),
      }, { onConflict: "artwork_id,owner_id" });

      // Seller -1 (best-effort; ignore if it wasn't tracked)
      await db.rpc("decrement_ownership_if_exists", { p_artwork_id: artworkId, p_owner_id: sellerId }).catch(() => {});

      return res({ ok: true });
    }

    // No-op for other event types
    return res({ received: true });
  } catch (e: any) {
    return res({ error: e?.message || "Webhook error" }, 400);
  }
});
