// server/index.ts
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";

const {
  PORT = 5000,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  PINATA_JWT,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required Supabase env vars");
}
if (!PINATA_JWT) {
  console.warn("WARNING: PINATA_JWT is not set – /pin-artwork will fail.");
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

// health
app.get("/health", (_req, res) => res.json({ ok: true }));

/**
 * POST /pin-artwork
 * headers: Authorization: Bearer <supabase access token>
 * body: { artwork_id: string }
 */
app.post("/pin-artwork", async (req, res) => {
  try {
    if (!PINATA_JWT) return res.status(500).send("PINATA_JWT not set");
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return res.status(401).send("Missing auth");

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const serverClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: u } = await userClient.auth.getUser();
    const callerId = u?.user?.id;
    if (!callerId) return res.status(401).send("Invalid session");

    const { artwork_id } = req.body || {};
    if (!artwork_id) return res.status(400).send("artwork_id is required");

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
    if (!art) return res.status(404).send("Artwork not found");
    if (art.creator_id !== callerId) return res.status(403).send("Only creator can pin");

    await serverClient.from("artworks")
      .update({ pin_status: "processing", pin_error: null })
      .eq("id", art.id);

    // fetch image from storage
    const imgRes = await fetch(art.image_url);
    if (!imgRes.ok) {
      await serverClient.from("artworks").update({
        pin_status: "error",
        pin_error: "Fetch image failed",
      }).eq("id", art.id);
      return res.status(502).send("Failed to fetch image");
    }
    const buf = await imgRes.arrayBuffer();
    const mime = imgRes.headers.get("content-type") ?? "application/octet-stream";

    // pin file
    const form = new FormData();
    form.append("file", new Blob([buf], { type: mime }), `art-${art.id}`);
    const pinFile = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
      body: form,
    });
    if (!pinFile.ok) {
      const text = await pinFile.text();
      await serverClient.from("artworks").update({
        pin_status: "error",
        pin_error: text.slice(0, 500),
      }).eq("id", art.id);
      return res.status(502).send(text);
    }
    const { IpfsHash: imageCID } = await pinFile.json();

    // metadata
    const attrs: Array<{ trait_type: string; value: string | number | boolean }> = [];
    if (art.medium) attrs.push({ trait_type: "Medium", value: art.medium });
    if (art.year_created) attrs.push({ trait_type: "Year", value: art.year_created });
    if (art.width && art.height && art.dim_unit) {
      const dims = art.depth
        ? `${art.width} × ${art.height} × ${art.depth} ${art.dim_unit}`
        : `${art.width} × ${art.height} ${art.dim_unit}`;
      attrs.push({ trait_type: "Dimensions", value: dims });
    }
    if (art.edition_type) {
      attrs.push({
        trait_type: "Edition",
        value:
          art.edition_type === "limited" && art.edition_size
            ? `Limited / ${art.edition_size}`
            : art.edition_type === "unique"
            ? "Unique"
            : "Open",
      });
    }
    if (typeof art.is_nsfw === "boolean") {
      attrs.push({ trait_type: "NSFW", value: art.is_nsfw });
    }

    const metadata = {
      name: art.title ?? `Artwork ${art.id}`,
      description: art.description ?? "",
      image: `ipfs://${imageCID}`,
      attributes: attrs,
    };

    const pinJson = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PINATA_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pinataContent: metadata,
        pinataMetadata: { name: `meta-${art.id}` },
      }),
    });
    if (!pinJson.ok) {
      const text = await pinJson.text();
      await serverClient.from("artworks").update({
        pin_status: "error",
        pin_error: text.slice(0, 500),
      }).eq("id", art.id);
      return res.status(502).send(text);
    }
    const { IpfsHash: metadataCID } = await pinJson.json();
    const tokenURI = `ipfs://${metadataCID}`;

    await serverClient.from("artworks").update({
      ipfs_image_cid: imageCID,
      ipfs_metadata_cid: metadataCID,
      token_uri: tokenURI,
      pin_status: "pinned",
      pin_error: null,
    }).eq("id", art.id);

    res.json({ imageCID, metadataCID, tokenURI });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

/**
 * POST /record-mint
 * headers: Authorization: Bearer <supabase token>
 * body: { artwork_id, contract_address, token_id?, tx_hash, chain?, token_standard? }
 */
app.post("/record-mint", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return res.status(401).send("Missing auth");

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const serverClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: u } = await userClient.auth.getUser();
    const callerId = u?.user?.id;
    if (!callerId) return res.status(401).send("Invalid session");

    const {
      artwork_id,
      contract_address,
      token_id,
      tx_hash,
      chain = "sepolia",
      token_standard = "erc721",
    } = req.body || {};
    if (!artwork_id || !contract_address || !tx_hash) {
      return res.status(400).send("artwork_id, contract_address and tx_hash are required");
    }

    const { data: art } = await userClient
      .from("artworks")
      .select("id, creator_id, owner_id")
      .eq("id", artwork_id)
      .maybeSingle();
    if (!art) return res.status(404).send("Artwork not found");
    if (art.creator_id !== callerId) return res.status(403).send("Only creator can record mint");

    await serverClient.from("artworks")
      .update({
        contract_address,
        token_id: token_id ?? null,
        token_standard,
        chain,
        tx_hash,
        status: "active",
      })
      .eq("id", artwork_id);

    // best-effort provenance
    try {
      await serverClient.from("provenance_events").insert({
        artwork_id,
        from_owner_id: null,
        to_owner_id: art.owner_id ?? art.creator_id,
        event_type: "mint",
        chain_id: chain === "sepolia" ? 11155111 : null,
        tx_hash,
        token_id: token_id ?? null,
        contract_address,
        source: "system",
        quantity: 1,
      });
    } catch {}

    res.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
