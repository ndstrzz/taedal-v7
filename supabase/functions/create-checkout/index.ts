// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---- Env (set in Supabase: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_ROLE_KEY)
const SUPABASE_URL       = (Deno.env.get("SUPABASE_URL")       || "").trim();
const SUPABASE_ANON_KEY  = (Deno.env.get("SUPABASE_ANON_KEY")  || "").trim();
const SERVICE_ROLE_KEY   = (Deno.env.get("SERVICE_ROLE_KEY")   || "").trim();
const STRIPE_SECRET_KEY  = (Deno.env.get("STRIPE_SECRET_KEY")  || "").trim();

const corsHeaders: Record<string,string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function text(body: string, status=200) {
  return new Response(body, { status, headers: corsHeaders });
}
function json(body: unknown, status=200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" }});
}

const FIAT = new Set([
  "USD","EUR","GBP","JPY","KRW","CNY","INR","AUD","CAD","SGD","PHP","IDR","MYR","THB","VND",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return text("ok");

  try {
    if (!STRIPE_SECRET_KEY) return text("STRIPE_SECRET_KEY not set", 500);

    const { listing_id, quantity = 1, success_url, cancel_url } = await req.json();
    if (!listing_id || !success_url || !cancel_url) return text("listing_id, success_url, cancel_url required", 400);

    const auth = req.headers.get("Authorization");
    if (!auth) return text("Missing Authorization header", 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } }});
    const serverClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Fetch listing + artwork for description
    const { data: listing, error: lErr } = await userClient
      .from("listings")
      .select("id, artwork_id, seller_id, type, status, fixed_price, sale_currency, artworks!inner(id,title,image_url)")
      .eq("id", listing_id)
      .maybeSingle();
    if (lErr) throw lErr;
    if (!listing) return text("Listing not found", 404);
    if (listing.type !== "fixed_price") return text("Only fixed_price via Stripe in this function", 400);
    if (!FIAT.has(listing.sale_currency)) return text("Listing currency must be fiat for Stripe", 400);
    if (listing.status !== "active") return text("Listing is not active", 400);

    const price = Number(listing.fixed_price || 0);
    if (!isFinite(price) || price <= 0) return text("Bad price", 400);

    // Stripe fetch (Deno—no SDK)
    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("success_url", success_url);
    params.append("cancel_url", cancel_url);
    params.append("metadata[listing_id]", listing_id);
    params.append("metadata[quantity]", String(quantity));
    params.append("line_items[0][quantity]", String(quantity));
    params.append("line_items[0][price_data][currency]", listing.sale_currency.toLowerCase());
    params.append("line_items[0][price_data][product_data][name]", listing.artworks?.title || `Artwork ${listing.artwork_id}`);
    if (listing.artworks?.image_url) {
      params.append("line_items[0][price_data][product_data][images][0]", listing.artworks.image_url);
    }

    // Stripe expects amount in smallest unit (e.g., cents)
    const amount = Math.round(price * 100);
    params.append("line_items[0][price_data][unit_amount]", String(amount));

    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const body = await resp.json();
    if (!resp.ok) {
      console.error("Stripe error", body);
      return text(body?.error?.message || "Stripe checkout failed", 502);
    }

    // Optionally: mark an order draft here (not required since webhook finalizes)
    return json({ url: body.url });
  } catch (e: any) {
    return json({ error: e?.message || "Server error" }, 500);
  }
});
