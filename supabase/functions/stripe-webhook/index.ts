// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SERVICE_ROLE_KEY")!;
const STRIPE_SK = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WH = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

function text(body: string, status = 200) {
  return new Response(body, { status, headers: cors });
}
function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return text("ok");
  if (req.method !== "POST") return text("Method not allowed", 405);

  try {
    const Stripe = (await import("https://esm.sh/stripe@14?target=deno")).default;
    const raw = await req.text();
    const sig = req.headers.get("stripe-signature") || "";
    const stripe = new Stripe(STRIPE_SK, { httpClient: Stripe.createFetchHttpClient() });

    let evt: any;
    try {
      evt = stripe.webhooks.constructEvent(raw, sig, STRIPE_WH);
    } catch (e: any) {
      return text(`Invalid signature: ${e.message}`, 400);
    }

    if (evt.type === "checkout.session.completed") {
      const session = evt.data.object as any;
      const { listing_id, buyer_id, quantity } = session.metadata || {};
      if (listing_id && buyer_id) {
        const server = createClient(SUPABASE_URL, SERVICE);
        // Let your SQL do the settlement so ownership/history are consistent
        const { data, error } = await server.rpc("buy_fixed_price", {
          p_listing_id: listing_id,
          p_quantity: Number(quantity || 1)
        });
        if (error) {
          console.error("buy_fixed_price failed:", error);
          // You could alert ops or record a failed state for manual recovery
        }
      }
    }

    return json({ ok: true });
  } catch (e: any) {
    return json({ error: e?.message || "Webhook error" }, 500);
  }
});
