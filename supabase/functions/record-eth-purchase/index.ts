// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function j(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function t(body = "ok", status = 200) {
  return new Response(body, { status, headers: cors });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return t();
  try {
    if (req.method !== "POST") return t("Method not allowed", 405);

    const { listing_id, tx_hash, buyer_wallet, amount_eth, network } = await req.json();
    if (!listing_id || !tx_hash || !amount_eth) return j({ error: "Missing fields" }, 400);

    const db = createClient(SUPABASE_URL, SERVICE);

    // Read listing with seller/buyer IDs via joined info
    const { data: listing, error: lerr } = await db
      .from("listings")
      .select("id, artwork_id, seller_id, status")
      .eq("id", listing_id)
      .maybeSingle();
    if (lerr) throw lerr;
    if (!listing) return j({ error: "Listing not found" }, 404);

    // Buyer from Authorization (optional) — you can trust client or add wallet→user map.
    // For now, require Authorization so we can set buyer_id reliably.
    const auth = req.headers.get("Authorization");
    if (!auth) return j({ error: "Missing Authorization" }, 401);
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: me } = await userClient.auth.getUser();
    if (!me?.user) return j({ error: "Unauthorized" }, 401);
    const buyerId = me.user.id;

    // End listing if still active
    await db.from("listings").update({ status: "ended" }).eq("id", listing_id).eq("status", "active");

    // Insert sale
    await db.from("sales").insert({
      artwork_id: listing.artwork_id,
      buyer_id: buyerId,
      seller_id: listing.seller_id,
      price: amount_eth,
      currency: "ETH",
      sold_at: new Date().toISOString(),
      tx_hash,
    });

    // Transfer ownership
    await db.from("artworks").update({ owner_id: buyerId }).eq("id", listing.artwork_id);

    await db.from("ownerships").upsert({
      artwork_id: listing.artwork_id,
      owner_id: buyerId,
      quantity: 1,
      updated_at: new Date().toISOString(),
    }, { onConflict: "artwork_id,owner_id" });

    await db.rpc("decrement_ownership_if_exists", { p_artwork_id: listing.artwork_id, p_owner_id: listing.seller_id }).catch(() => {});

    return j({ ok: true });
  } catch (e: any) {
    return j({ error: e?.message || "Server error" }, 500);
  }
});
