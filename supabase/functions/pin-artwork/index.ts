// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Environment (from Supabase Edge secrets)
const SUPABASE_URL      = (Deno.env.get("SUPABASE_URL")      || "").trim();
const SUPABASE_ANON_KEY = (Deno.env.get("SUPABASE_ANON_KEY") || "").trim();
const SERVICE_ROLE_KEY  = (Deno.env.get("SERVICE_ROLE_KEY")  || "").trim();
const PINATA_JWT        = (Deno.env.get("PINATA_JWT")        || "").trim();

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function text(body: string, status = 200) {
  return new Response(body, { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return text("ok");

  try {
    if (req.method !== "POST") return text("Method not allowed", 405);
    if (!PINATA_JWT) return text("PINATA_JWT not set in secrets", 500);

    // Helpful preflight to surface bad/malformed JWT clearly
    const test = await fetch("https://api.pinata.cloud/data/testAuthentication", {
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
    });
    if (!test.ok) {
      const body = await test.text();
      return text(`Pinata auth failed: ${body}`, 502);
    }

    const auth = req.headers.get("Authorization");
    if (!auth) return text("Missing Authorization header", 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const serverClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { artwork_id } = await req.json();
    if (!artwork_id) return text("artwork_id is required", 400);

    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData?.user) return text("Invalid user session", 401);
    const callerId = authData.user.id;

    const { data: art, error: artErr } = await userClient
      .from("artworks")
      .select(`
        id, creator_id, image_url,
        title, description, medium, year_created,
        width, height, depth, dim_unit,
        edition_type, edition_size, is_nsfw
      `)
      .eq("id", artwork_id)
      .maybeSingle();
    if (artErr) throw artErr;
    if (!art) return text("Artwork not found", 404);
    if (art.creator_id !== callerId) return text("Only the creator can pin this artwork", 403);
    if (!art.image_url) return text("Artwork has no image_url to pin", 400);

    await serverClient.from("artworks")
      .update({ pin_status: "processing", pin_error: null })
      .eq("id", art.id);

    const imgRes = await fetch(art.image_url);
    if (!imgRes.ok) {
      await serverClient.from("artworks")
        .update({ pin_status: "error", pin_error: "Fetch image failed" })
        .eq("id", art.id);
      return text("Failed to fetch image from storage", 502);
    }
    const imgBuf  = await imgRes.arrayBuffer();
    const imgType = imgRes.headers.get("content-type") ?? "application/octet-stream";

    const form = new FormData();
    form.append("file", new Blob([imgBuf], { type: imgType }), `art-${art.id}`);

    const pinHeaders = { Authorization: `Bearer ${PINATA_JWT}` };

    const pinFileResp = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: pinHeaders,
      body: form,
    });
    if (!pinFileResp.ok) {
      const body = await pinFileResp.text();
      await serverClient.from("artworks")
        .update({ pin_status: "error", pin_error: body.slice(0, 500) })
        .eq("id", art.id);
      return text(`Pinata file pin failed: ${body}`, 502);
    }
    const { IpfsHash: imageCID } = await pinFileResp.json();

    const attributes: Array<{ trait_type: string; value: string | number | boolean }> = [];
    if (art.medium) attributes.push({ trait_type: "Medium", value: art.medium });
    if (art.year_created) attributes.push({ trait_type: "Year", value: art.year_created });
    if (art.width && art.height && art.dim_unit) {
      const dims = art.depth
        ? `${art.width} × ${art.height} × ${art.depth} ${art.dim_unit}`
        : `${art.width} × ${art.height} ${art.dim_unit}`;
      attributes.push({ trait_type: "Dimensions", value: dims });
    }
    if (art.edition_type) {
      attributes.push({
        trait_type: "Edition",
        value:
          art.edition_type === "limited" && art.edition_size
            ? `Limited / ${art.edition_size}`
            : art.edition_type === "unique"
            ? "Unique"
            : "Open",
      });
    }
    if (typeof art.is_nsfw === "boolean") attributes.push({ trait_type: "NSFW", value: art.is_nsfw });

    const metadata = {
      name: art.title ?? `Artwork ${art.id}`,
      description: art.description ?? "",
      image: `ipfs://${imageCID}`,
      attributes,
    };

    const pinJsonResp = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: { ...pinHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        pinataContent: metadata,
        pinataMetadata: { name: `meta-${art.id}` },
      }),
    });
    if (!pinJsonResp.ok) {
      const body = await pinJsonResp.text();
      await serverClient.from("artworks")
        .update({ pin_status: "error", pin_error: body.slice(0, 500) })
        .eq("id", art.id);
      return text(`Pinata JSON pin failed: ${body}`, 502);
    }
    const { IpfsHash: metadataCID } = await pinJsonResp.json();
    const tokenURI = `ipfs://${metadataCID}`;

    const { error: upErr } = await serverClient.from("artworks").update({
      ipfs_image_cid: imageCID,
      ipfs_metadata_cid: metadataCID,
      token_uri: tokenURI,
      pin_status: "pinned",
      pin_error: null,
    }).eq("id", art.id);
    if (upErr) throw upErr;

    return json({ imageCID, metadataCID, tokenURI });
  } catch (e: any) {
    return json({ error: e?.message ?? "Server error" }, 500);
  }
});
