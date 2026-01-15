// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SK = Deno.env.get("STRIPE_SECRET_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function stripeRetrieveSession(sessionId: string) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${STRIPE_SK}`,
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "Failed to retrieve Stripe session");
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") || "";

    // User-context client (to confirm who is calling)
    const supabaseUser = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: u, error: uErr } = await supabaseUser.auth.getUser();
    if (uErr) throw uErr;
    const userId = u.user?.id;
    if (!userId) throw new Error("Not signed in.");

    const { session_id, listing_id, artwork_id } = await req.json();
    if (!session_id || !listing_id || !artwork_id) {
      throw new Error("Missing session_id / listing_id / artwork_id");
    }

    // Verify Stripe session
    const session = await stripeRetrieveSession(String(session_id));

    // Typical values:
    // - session.status: "complete"
    // - session.payment_status: "paid"
    const paid =
      String(session?.payment_status || "").toLowerCase() === "paid" ||
      String(session?.status || "").toLowerCase() === "complete";

    if (!paid) throw new Error("Stripe session is not paid/complete yet.");

    // Validate metadata (IMPORTANT)
    const meta = session?.metadata || {};
    const metaListing = String(meta?.listing_id || "");
    const metaArtwork = String(meta?.artwork_id || "");
    const metaBuyer = String(meta?.buyer_id || "");

    if (metaListing && metaListing !== String(listing_id)) throw new Error("Listing mismatch (metadata).");
    if (metaArtwork && metaArtwork !== String(artwork_id)) throw new Error("Artwork mismatch (metadata).");
    if (metaBuyer && metaBuyer !== userId) throw new Error("This Stripe session is not for the signed-in buyer.");

    // Amount + currency from Stripe
    const amountTotal = Number(session?.amount_total ?? 0) / 100; // Stripe uses cents
    const currency = String(session?.currency || "usd").toUpperCase();

    // Admin client (bypasses RLS)
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Atomic DB finalize
    const { data, error } = await supabaseAdmin.rpc("fulfill_stripe_purchase", {
      p_stripe_session_id: String(session_id),
      p_listing_id: String(listing_id),
      p_artwork_id: String(artwork_id),
      p_buyer_id: userId,
      p_amount: amountTotal,
      p_currency: currency,
    });

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, paid: true, result: data }), {
      headers: { ...cors, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      headers: { ...cors, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
