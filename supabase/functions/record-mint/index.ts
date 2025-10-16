// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return text("ok");

  try {
    if (req.method !== "POST") return text("Method not allowed", 405);

    const auth = req.headers.get("Authorization");
    if (!auth) return text("Missing Authorization header", 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const serverClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Who is calling?
    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData?.user) return text("Invalid user session", 401);
    const callerId = authData.user.id;

    // Parse payload
    const body = await req.json();
    const {
      artwork_id,
      contract_address,
      token_id,                  // string or number as string
      tx_hash,
      chain = "sepolia",
      token_standard = "erc721",
    } = body || {};

    if (!artwork_id || !contract_address || !tx_hash) {
      return text("artwork_id, contract_address and tx_hash are required", 400);
    }

    // Verify the caller is the creator (v5 columns: creator, owner)
    const { data: art, error: artErr } = await userClient
      .from("artworks")
      .select("id, creator, owner")
      .eq("id", artwork_id)
      .maybeSingle();

    if (artErr) throw artErr;
    if (!art) return text("Artwork not found", 404);
    if (art.creator !== callerId) return text("Only the creator can record mint", 403);

    // Ensure we have an owner to persist (owner || creator || caller)
    const effectiveOwner = art.owner ?? art.creator ?? callerId;

    // Update artwork with on-chain refs (service role)
    const { error: upErr } = await serverClient
      .from("artworks")
      .update({
        contract_address,
        token_id: token_id ?? null,
        token_standard,
        chain,
        tx_hash,
        status: "active",
        owner: effectiveOwner,
      })
      .eq("id", artwork_id);

    if (upErr) throw upErr;

    // Upsert ownerships so the UI can list (ERC-721 => quantity = 1)
    try {
      // If the table doesn't exist, we just ignore the error.
      const { error: ownErr } = await serverClient
        .from("ownerships")
        .upsert(
          {
            artwork_id,
            owner_id: effectiveOwner,
            quantity: 1,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "artwork_id,owner_id" }
        );
      // Ignore missing-table error (code 42P01), rethrow others
      if (ownErr && (ownErr as PostgrestError).code !== "42P01") throw ownErr;
    } catch {
      /* best-effort; safe to ignore */
    }

    // Optional provenance (best-effort)
    try {
      await serverClient.from("provenance_events").insert({
        artwork_id,
        from_owner_id: null,
        to_owner_id: effectiveOwner,
        event_type: "mint",
        chain_id: chain === "sepolia" ? 11155111 : null,
        tx_hash,
        token_id: token_id ?? null,
        contract_address,
        source: "system",
        quantity: 1,
      });
    } catch {
      /* best-effort; ignore */
    }

    return json({ ok: true });
  } catch (e: any) {
    return json({ error: e?.message ?? "Server error" }, 500);
  }
});
