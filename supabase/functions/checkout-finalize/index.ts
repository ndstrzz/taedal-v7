// supabase/functions/checkout-finalize/index.ts
// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_ROLE") ||
  Deno.env.get("SUPABASE_SERVICE_KEY")!;
const STRIPE_SK = Deno.env.get("STRIPE_SECRET_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function j(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function isZeroDecimalCurrency(currencyUpper: string) {
  return ["JPY", "KRW"].includes(currencyUpper.toUpperCase());
}
function stripeAmountToNormal(amountTotalSmallest: number, currencyUpper: string) {
  if (!isFinite(amountTotalSmallest)) return 0;
  if (isZeroDecimalCurrency(currencyUpper)) return amountTotalSmallest;
  return amountTotalSmallest / 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ ok: false, error: "Method not allowed" }, 405);

  try {
    if (!SUPABASE_URL || !ANON || !SERVICE_ROLE) throw new Error("Supabase keys not set.");
    if (!STRIPE_SK) throw new Error("Stripe secret not set.");

    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
    if (!authHeader) throw new Error("Missing Authorization.");

    const supabaseUser = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: u, error: uErr } = await supabaseUser.auth.getUser();
    if (uErr) throw uErr;
    const buyerId = u.user?.id;
    if (!buyerId) throw new Error("Not signed in.");

    const body = await req.json().catch(() => ({}));
    const session_id = String(body?.session_id || "");
    if (!session_id) throw new Error("Missing session_id");

    const Stripe = (await import("https://esm.sh/stripe@14?target=deno")).default;
    const stripe = new Stripe(STRIPE_SK, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const session = await stripe.checkout.sessions.retrieve(session_id);

    const paid =
      String(session?.payment_status || "").toLowerCase() === "paid" ||
      String(session?.status || "").toLowerCase() === "complete";

    if (!paid) throw new Error("Stripe session is not paid/complete yet.");

    const meta: any = session?.metadata || {};
    const listingId = String(meta?.listing_id || "");
    const artworkId = String(meta?.artwork_id || "");
    const metaBuyer = String(meta?.buyer_id || "");
    const currency = String(meta?.currency || session?.currency || "usd").toUpperCase();

    if (!listingId || !artworkId) throw new Error("Stripe metadata missing listing_id/artwork_id.");
    if (metaBuyer && metaBuyer !== buyerId) throw new Error("This Stripe session is not for the signed-in buyer.");

    const amountTotalSmallest = Number(session?.amount_total ?? 0);
    const amountTotal = stripeAmountToNormal(amountTotalSmallest, currency);

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data, error } = await supabaseAdmin.rpc("fulfill_stripe_purchase", {
      p_stripe_session_id: String(session_id),
      p_listing_id: listingId,
      p_artwork_id: artworkId,
      p_buyer_id: buyerId,
      p_amount: amountTotal,
      p_currency: currency,
    });
    if (error) throw error;

    return j(
      {
        ok: true,
        paid: true,

        // ✅ important: return these as top-level
        listing_id: listingId,
        artwork_id: artworkId,

        result: data,
        session: {
          id: session?.id,
          status: session?.status,
          payment_status: session?.payment_status,
          currency: String(session?.currency || "").toUpperCase(),
          amount_total: session?.amount_total,
          metadata: meta,
        },
      },
      200
    );
  } catch (e: any) {
    return j({ ok: false, error: e?.message ?? String(e) }, 400);
  }
});
