// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = (Deno.env.get("SUPABASE_URL")      || "").trim();
const SERVICE_ROLE_KEY  = (Deno.env.get("SERVICE_ROLE_KEY")  || "").trim();
const STRIPE_SECRET     = (Deno.env.get("STRIPE_SECRET_KEY") || "").trim();
const WEBHOOK_SECRET    = (Deno.env.get("STRIPE_WEBHOOK_SECRET") || "").trim();

function text(body: string, status=200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" }});
}

async function readRawBody(req: Request): Promise<string> {
  const buf = await req.arrayBuffer();
  const dec = new TextDecoder("utf-8");
  return dec.decode(buf);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return text("Method not allowed", 405);
  if (!WEBHOOK_SECRET || !STRIPE_SECRET) return text("Stripe secrets not set", 500);

  try {
    const sig = req.headers.get("stripe-signature");
    if (!sig) return text("No stripe-signature", 400);

    // We can’t easily verify signature without Stripe SDK in Deno.
    // Lightweight approach: call Stripe /events with the ID to fetch & trust Stripe.
    const raw = await req.json();
    const eventId = raw?.id;
    if (!eventId) return text("No event id", 400);

    const evResp = await fetch(`https://api.stripe.com/v1/events/${eventId}`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET}` }
    });
    const event = await evResp.json();
    if (!evResp.ok) {
      console.error("Stripe fetch event failed", event);
      return text("Bad event", 400);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const listing_id = session?.metadata?.listing_id as string | undefined;
      const quantity = Number(session?.metadata?.quantity || 1);

      if (listing_id) {
        const server = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        // Finalize the sale using your existing SQL (transfers ownership, ends listing, records order)
        const { data, error } = await server.rpc("buy_fixed_price", {
          p_listing_id: listing_id,
          p_quantity: quantity,
        });
        if (error) {
          console.error("buy_fixed_price error", error);
          return text("buy_fixed_price failed", 500);
        }
      }
    }

    return text("ok", 200);
  } catch (e: any) {
    console.error("webhook error", e);
    return text("webhook error", 500);
  }
});
