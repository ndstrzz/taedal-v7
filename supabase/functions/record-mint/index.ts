// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />

/**
 * POST /functions/v1/record-mint
 * Body: {
 *   artwork_id: string (uuid),
 *   contract_address: string,
 *   token_id?: string | number,
 *   tx_hash: string,
 *   chain?: "sepolia" | string,
 *   token_standard?: "erc721" | "erc1155" | string
 * }
 */

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type PostgrestError } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SERVICE_ROLE_KEY")!;

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function text(body: string, status = 200) {
  return new Response(body, { status, headers: corsHeaders });
}

const CHAIN_ID: Record<string, number> = {
  sepolia: 11155111,
  // add others here if you’ll mint on different networks
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return text("ok");
  if (req.method !== "POST")   return text("Method not allowed", 405);

  try {
    // ── Auth ────────────────────────────────────────────────────────────────────
    const auth = req.headers.get("Authorization");
    if (!auth) return text("Missing Authorization header", 401);

    const userClient   = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } });
    const serverClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData?.user) return text("Invalid user session", 401);
    const callerId = authData.user.id;

    // ── Parse & validate body ──────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const {
      artwork_id,
      contract_address,
      token_id,
      tx_hash,
      chain = "sepolia",
      token_standard = "erc721",
    } = body || {};

    if (!artwork_id || !contract_address || !tx_hash) {
      return text("artwork_id, contract_address and tx_hash are required", 400);
    }

    // ── Fetch the artwork (v5 columns: creator, owner) ─────────────────────────
    const { data: art, error: artErr } = await userClient
      .from("artworks")
      .select("id, creator, owner")
      .eq("id", artwork_id)
      .maybeSingle();

    if (artErr) throw artErr;
    if (!art)   return text("Artwork not found", 404);

    // Only the creator is allowed to record the mint
    if (art.creator !== callerId) return text("Only the creator can record mint", 403);

    const effectiveOwner = art.owner ?? art.creator ?? callerId;
    const safeTokenId    = token_id == null ? null : String(token_id);
    const chainId        = CHAIN_ID[chain.toLowerCase?.() ?? chain] ?? null;

    // ── Update artwork with on-chain refs (service role) ───────────────────────
    {
      const { error } = await serverClient
        .from("artworks")
        .update({
          contract_address,
          token_id: safeTokenId,
          token_standard,
          chain,
          tx_hash,
          status: "active",
          owner: effectiveOwner,
        })
        .eq("id", artwork_id);
      if (error) throw error;
    }

    // ── Ensure ownerships row exists so UI can list (quantity ≥ 1) ────────────
    // If your table doesn’t exist in this project, this silently no-ops.
    try {
      const { error: ownErr } = await serverClient
        .from("ownerships")
        .upsert(
          {
            artwork_id,
            owner_id: effectiveOwner,
            quantity: 1, // ERC-721 => 1
            updated_at: new Date().toISOString(),
          },
          { onConflict: "artwork_id,owner_id" }
        );

      // Ignore “relation does not exist” (e.g. 42P01) to keep function portable
      if (ownErr && (ownErr as PostgrestError).code !== "42P01") throw ownErr;
    } catch { /* best-effort */ }

    // ── Best-effort provenance event ───────────────────────────────────────────
    try {
      await serverClient.from("provenance_events").insert({
        artwork_id,
        from_owner_id: null,
        to_owner_id: effectiveOwner,
        event_type: "mint",
        chain_id: chainId,
        tx_hash,
        token_id: safeTokenId,
        contract_address,
        source: "system",
        quantity: 1,
      });
    } catch { /* best-effort */ }

    return json({ ok: true });
  } catch (e: any) {
    // Surface Postgrest errors cleanly while still returning JSON
    const msg = e?.message ?? e?.error_description ?? "Server error";
    return json({ error: msg }, 500);
  }
});
