// supabase/functions/checkout-finalize/index.ts
// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";

// IMPORTANT: people often set ONE of these names — so we support all:
const SERVICE_ROLE =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_ROLE") ||
  Deno.env.get("SERVICE_ROLE_KEY") ||
  Deno.env.get("SERVICE_ROLE") ||
  "";

// Stripe secret key (must be set in Supabase secrets)
const STRIPE_SK = Deno.env.get("STRIPE_SECRET_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function isZeroDecimalCurrency(cur: string) {
  const c = String(cur || "").toUpperCase();
  return ["JPY", "KRW"].includes(c);
}

async function stripeRetrieveSession(sessionId: string) {
  if (!STRIPE_SK) throw new Error("Missing STRIPE_SECRET_KEY in Supabase Edge Function secrets.");

  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${STRIPE_SK}` },
    }
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "Failed to retrieve Stripe session");
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
    if (!ANON) throw new Error("Missing SUPABASE_ANON_KEY");
    if (!SERVICE_ROLE) {
      throw new Error(
        "Missing SERVICE ROLE key in Edge Function secrets. Set SUPABASE_SERVICE_ROLE_KEY (recommended)."
      );
    }

    const authHeader =
      req.headers.get("Authorization") ||
      req.headers.get("authorization") ||
      "";

    // 1) Identify caller (buyer)
    const supabaseUser = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: u, error: uErr } = await supabaseUser.auth.getUser();
    if (uErr) throw uErr;

    const userId = u.user?.id;
    if (!userId) throw new Error("Not signed in (buyer).");

    // 2) Parse request
    const body = await req.json().catch(() => ({}));
    const session_id = String(body?.session_id || "");
    if (!session_id) throw new Error("Missing session_id");

    // 3) Pull Stripe session and validate paid
    const session = await stripeRetrieveSession(session_id);

    const paid =
      String(session?.payment_status || "").toLowerCase() === "paid" ||
      String(session?.status || "").toLowerCase() === "complete";

    if (!paid) throw new Error("Stripe session is not paid/complete yet.");

    // 4) Use Stripe metadata as source of truth
    const meta = session?.metadata || {};
    const listing_id = String(meta?.listing_id || "");
    const artwork_id = String(meta?.artwork_id || "");
    const buyerFromMeta = String(meta?.buyer_id || "");

    if (!listing_id) throw new Error("Missing listing_id in Stripe metadata.");
    if (!artwork_id) throw new Error("Missing artwork_id in Stripe metadata.");

    if (buyerFromMeta && buyerFromMeta !== userId) {
      throw new Error("This Stripe session does not belong to the signed-in buyer.");
    }

    // 5) Amount/currency
    const amountTotalSmallest = Number(session?.amount_total ?? 0);
    const currency = String(session?.currency || meta?.currency || "usd").toUpperCase();
    const amountMajor = isZeroDecimalCurrency(currency)
      ? amountTotalSmallest
      : amountTotalSmallest / 100;

    // 6) Finalize in DB (service role bypasses RLS)
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data, error } = await supabaseAdmin.rpc("fulfill_stripe_purchase", {
      p_stripe_session_id: session_id,
      p_listing_id: listing_id,
      p_artwork_id: artwork_id,
      p_buyer_id: userId,
      p_amount: amountMajor,
      p_currency: currency,
    });

    if (error) throw error;

    // IMPORTANT: always return 200 so frontend can see the body
    return json({
      ok: true,
      paid: true,
      listing_id,
      artwork_id,
      currency,
      amount: amountMajor,
      session: {
        id: session?.id,
        payment_status: session?.payment_status,
        status: session?.status,
        metadata: meta,
      },
      result: data,
    });
  } catch (e: any) {
    // IMPORTANT: return 200 with ok:false so Success.tsx can show the real error
    return json({
      ok: false,
      error: e?.message ?? String(e),
    });
  }
});
