import { Router, Request, Response } from "express";
import { z } from "zod";
import Stripe from "stripe";
import { makeUserClient, sbAdmin } from "../lib/supabase";

// Stripe config
const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
const APP_URL = process.env.APP_URL || "http://localhost:5173";

const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: "2024-06-20" }) : null;

export const checkoutRouter = Router();

// helper: bearer
function bearer(req: any): string | undefined {
  const h = req.headers?.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : undefined;
}

/**
 * POST /api/checkout
 * body: { listing_id: uuid, quantity: number }
 * Only supports FIXED-PRICE listings for now (auctions later).
 */
checkoutRouter.post("/api/checkout", async (req: Request, res: Response) => {
  try {
    if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

    const token = bearer(req);
    if (!token) return res.status(401).json({ error: "auth required" });

    const schema = z.object({
      listing_id: z.string().uuid(),
      quantity: z.number().int().positive().default(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    // get the caller (buyer)
    const uc = makeUserClient(token);
    const { data: userRes, error: userErr } = await uc.auth.getUser();
    if (userErr || !userRes?.user) return res.status(401).json({ error: "invalid user" });
    const buyerId = userRes.user.id;

    // fetch listing + minimal artwork info
    const { data: listing, error: lerr } = await sbAdmin
      .from("listings")
      .select("id,type,status,start_at,end_at,sale_currency,fixed_price,quantity,artwork_id,seller_id")
      .eq("id", parsed.data.listing_id)
      .single();

    if (lerr || !listing) return res.status(404).json({ error: "listing not found" });
    if (listing.type !== "fixed_price") return res.status(400).json({ error: "only fixed-price supported for now" });
    if (listing.status !== "active") return res.status(400).json({ error: "listing not active" });
    if (listing.seller_id === buyerId) return res.status(400).json({ error: "seller cannot buy own listing" });

    const now = new Date();
    if (listing.start_at && new Date(listing.start_at) > now) {
      return res.status(400).json({ error: "sale not started" });
    }
    if (listing.end_at && new Date(listing.end_at) < now) {
      return res.status(400).json({ error: "sale ended" });
    }
    if ((listing.quantity ?? 1) < parsed.data.quantity) {
      return res.status(400).json({ error: "insufficient quantity" });
    }

    // fetch artwork title (for Stripe line item name)
    const { data: art, error: aerr } = await sbAdmin
      .from("artworks")
      .select("title")
      .eq("id", listing.artwork_id)
      .single();
    const artworkTitle = aerr ? "Artwork" : (art?.title || "Artwork");

    // currency: Stripe expects 3-letter fiat code (we'll default to USD for fiat checkout)
    const currency = (String(listing.sale_currency || "usd").toLowerCase() === "usd") ? "usd" : "usd";

    // price amounts: Stripe amounts are in the smallest currency unit
    const unitPrice = Number(listing.fixed_price);                  // e.g. 19.99
    if (!isFinite(unitPrice) || unitPrice <= 0) {
      return res.status(400).json({ error: "invalid fixed price on listing" });
    }
    const quantity = parsed.data.quantity;
    const totalAmount = unitPrice * quantity;

    // 1) Insert a pending order (service role; we trust validations above)
    const { data: order, error: oerr } = await sbAdmin
      .from("orders")
      .insert({
        artwork_id: listing.artwork_id,
        listing_id: listing.id,
        buyer_id: buyerId,
        seller_id: listing.seller_id,
        quantity,
        unit_price: unitPrice,
        total_amount: totalAmount,
        currency: currency.toUpperCase(),
        payment_status: "pending",
        settlement_kind: "stripe"
      })
      .select("id")
      .single();

    if (oerr || !order) return res.status(500).json({ error: "failed to create order" });

    // 2) Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${APP_URL}/checkout/success?order_id=${order.id}`,
      cancel_url: `${APP_URL}/checkout/cancel?order_id=${order.id}`,
      line_items: [
        {
          quantity,
          price_data: {
            currency,
            unit_amount: Math.round(unitPrice * 100), // $19.99 -> 1999
            product_data: {
              name: artworkTitle,
            },
          },
        },
      ],
      metadata: {
        order_id: order.id,
        buyer_id: buyerId,
        listing_id: listing.id,
      },
      client_reference_id: buyerId,
    });

    // 3) Optionally store the session id on the order (handy for support)
    await sbAdmin.from("orders").update({ stripe_session_id: session.id }).eq("id", order.id);

    return res.json({ checkout_url: session.url, order_id: order.id });
  } catch (e: any) {
    console.error("checkout error:", e);
    return res.status(500).json({ error: "internal error" });
  }
});
