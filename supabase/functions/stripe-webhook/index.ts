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
    headers: { "Content-Type": typeof body === "string" ? "text/plain" : "application/json" },
  });

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
      const db = createClient(SUPABASE_URL, SERVICE);

      // Pull what we can from metadata
      const md = session.metadata || {};
      let listingId = md.listing_id || null;
      let artworkId = md.artwork_id || null;
      let sellerId  = md.seller_id  || null;
      let buyerId   = md.buyer_id   || null;
      const quantity = Number(md.quantity || 1);

      // Fallback: if we have listing_id but missing artwork/seller, fetch them
      if (listingId && (!artworkId || !sellerId)) {
        const { data: listing, error } = await db
          .from("listings")
          .select("artwork_id, seller_id, status")
          .eq("id", listingId)
          .maybeSingle();
        if (error) console.error("lookup listing error", error.message);
        if (listing) {
          artworkId = artworkId || listing.artwork_id;
          sellerId  = sellerId  || listing.seller_id;
        }
      }

      // Optional fallback: parse client_reference_id if present (format buyer:listing:artwork:seller)
      if ((!listingId || !artworkId || !sellerId || !buyerId) && session.client_reference_id) {
        try {
          const [b, l, a, s] = String(session.client_reference_id).split(":");
          buyerId   = buyerId   || b;
          listingId = listingId || l;
          artworkId = artworkId || a;
          sellerId  = sellerId  || s;
        } catch {}
      }

      if (!listingId || !artworkId || !sellerId || !buyerId) {
        console.error("stripe-webhook: missing ids", {
          listingId, artworkId, sellerId, buyerId,
          meta: session.metadata, client_reference_id: session.client_reference_id,
        });
        return res({ error: "Missing metadata" }, 400);
      }

      const amountTotal: number = session.amount_total; // smallest unit
      const currency: string = (session.currency || "").toUpperCase();
      const price = ["JPY", "KRW"].includes(currency) ? amountTotal : amountTotal / 100;

      // 1) End listing (idempotent)
      await db.from("listings").update({ status: "ended" }).eq("id", listingId).eq("status", "active");

      // 2) Record sale
      await db.from("sales").insert({
        artwork_id: artworkId,
        buyer_id: buyerId,
        seller_id: sellerId,
        price,
        currency,
        sold_at: new Date().toISOString(),
        tx_hash: null,
      }).then(({ error }) => error && console.error("sales insert error", error.message));

      // 3) Transfer ownership
      await db.from("artworks").update({ owner_id: buyerId }).eq("id", artworkId)
        .then(({ error }) => error && console.error("artworks update error", error.message));

      // 4) Ownership bookkeeping (+ buyer)
      await db.from("ownerships").upsert({
        artwork_id: artworkId,
        owner_id: buyerId,
        quantity: quantity > 0 ? quantity : 1,
        updated_at: new Date().toISOString(),
      }, { onConflict: "artwork_id,owner_id" })
        .then(({ error }) => error && console.error("ownerships upsert error", error.message));

      // 5) Optional: decrement seller qty if you support editions
      try {
        await db.rpc("decrement_ownership_if_exists", { p_artwork_id: artworkId, p_owner_id: sellerId });
      } catch (e) {
        console.warn("RPC decrement_ownership_if_exists not present or failed", (e as any)?.message ?? e);
      }

      console.log("stripe-webhook ✔ processed", { listingId, artworkId, buyerId, sellerId, price, currency });
      return res({ ok: true });
    }

    return res({ received: true });
  } catch (e: any) {
    console.error("stripe-webhook fatal", e?.message || e);
    return res({ error: e?.message || "Webhook error" }, 400);
  }
});
