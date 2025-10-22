import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const {
  PORT = 5000,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  PINATA_JWT,
  PUBLIC_APP_URL = "https://taedal.app",
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

/* ---------------- helpers ---------------- */

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function getUserAndClients(authHeader?: string) {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Missing auth");
  const userClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: authHeader } },
  });
  const serverClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const { data: u } = await userClient.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) throw new Error("Invalid session");
  return { uid, userClient, serverClient };
}

/* ---------------- pin-artwork (yours, unchanged) ---------------- */

app.post("/pin-artwork", async (req, res) => {
  try {
    if (!PINATA_JWT) return res.status(500).send("PINATA_JWT not set");
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return res.status(401).send("Missing auth");

    const userClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: auth } },
    });
    const serverClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

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

    // fetch image
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
    if ((art as any).medium) attrs.push({ trait_type: "Medium", value: (art as any).medium });
    if ((art as any).year_created) attrs.push({ trait_type: "Year", value: (art as any).year_created });
    if ((art as any).width && (art as any).height && (art as any).dim_unit) {
      const dims = (art as any).depth
        ? `${(art as any).width} × ${(art as any).height} × ${(art as any).depth} ${(art as any).dim_unit}`
        : `${(art as any).width} × ${(art as any).height} ${(art as any).dim_unit}`;
      attrs.push({ trait_type: "Dimensions", value: dims });
    }
    if ((art as any).edition_type) {
      attrs.push({
        trait_type: "Edition",
        value:
          (art as any).edition_type === "limited" && (art as any).edition_size
            ? `Limited / ${(art as any).edition_size}`
            : (art as any).edition_type === "unique"
            ? "Unique"
            : "Open",
      });
    }
    if (typeof (art as any).is_nsfw === "boolean") {
      attrs.push({ trait_type: "NSFW", value: (art as any).is_nsfw });
    }

    const metadata = {
      name: (art as any).title ?? `Artwork ${(art as any).id}`,
      description: (art as any).description ?? "",
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
        pinataMetadata: { name: `meta-${(art as any).id}` },
      }),
    });
    if (!pinJson.ok) {
      const text = await pinJson.text();
      await serverClient.from("artworks").update({
        pin_status: "error",
        pin_error: text.slice(0, 500),
      }).eq("id", (art as any).id);
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
    }).eq("id", (art as any).id);

    res.json({ imageCID, metadataCID, tokenURI });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message ?? "Server error" });
  }
});

/* ---------------- record-mint (yours, unchanged) ---------------- */

app.post("/record-mint", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return res.status(401).send("Missing auth");

    const userClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: auth } },
    });
    const serverClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

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

/* ---------------- NEW: shipments ---------------- */

app.get("/shipments", async (req, res) => {
  try {
    const { userClient } = await getUserAndClients(req.headers.authorization);
    const artworkId = String(req.query.artworkId || "");
    if (!artworkId) return res.status(400).send("artworkId is required");

    const { data, error } = await userClient
      .from("shipments")
      .select("*")
      .eq("artwork_id", artworkId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ rows: data || [] });
  } catch (e: any) {
    res.status(401).send(e?.message || "Unauthorized");
  }
});

app.post("/shipments", async (req, res) => {
  try {
    const { uid, serverClient } = await getUserAndClients(req.headers.authorization);
    const body = req.body || {};
    const payload = {
      artwork_id: body.artwork_id,
      created_by: uid,
      carrier: body.carrier ?? null,
      tracking_no: body.tracking_no ?? null,
      status: body.status ?? "label_created",
      eta: body.eta ?? null,
      legs: Array.isArray(body.legs) ? body.legs : [],
      notes: body.notes ?? null,
      updated_at: new Date().toISOString(),
    };
    if (!payload.artwork_id) return res.status(400).send("artwork_id required");

    const { data, error } = await serverClient.from("shipments").insert(payload).select("id").single();
    if (error) throw error;

    // notify creator/owner best-effort
    try {
      const { data: art } = await serverClient
        .from("artworks")
        .select("creator_id, owner_id")
        .eq("id", payload.artwork_id)
        .maybeSingle();
      const note = {
        type: "shipment_update",
        payload: { artwork_id: payload.artwork_id, status: payload.status, carrier: payload.carrier, tracking_no: payload.tracking_no },
      };
      if (art?.creator_id) await serverClient.from("notifications").insert({ user_id: art.creator_id, ...note });
      if (art?.owner_id && art.owner_id !== art.creator_id)
        await serverClient.from("notifications").insert({ user_id: art.owner_id, ...note });
    } catch {}

    res.json({ id: data.id });
  } catch (e: any) {
    res.status(401).send(e?.message || "Unauthorized");
  }
});

/* ---------------- NEW: notifications poll ---------------- */

app.get("/me/notifications", async (req, res) => {
  try {
    const { userClient } = await getUserAndClients(req.headers.authorization);
    const since = req.query.since ? new Date(String(req.query.since)) : null;
    let q = userClient.from("notifications").select("id,type,payload,created_at,read_at").order("created_at", { ascending: false }).limit(50);
    if (since && !isNaN(since.getTime())) q = q.gt("created_at", since.toISOString());
    const { data, error } = await q;
    if (error) throw error;
    res.json({ rows: data || [] });
  } catch (e: any) {
    res.status(401).send(e?.message || "Unauthorized");
  }
});

/* ---------------- NEW: QR register/verify ---------------- */

app.post("/qr/register", async (req, res) => {
  try {
    const { uid, userClient, serverClient } = await getUserAndClients(req.headers.authorization);
    const { artwork_id } = req.body || {};
    if (!artwork_id) return res.status(400).send("artwork_id required");

    const { data: art } = await userClient
      .from("artworks")
      .select("id, creator_id")
      .eq("id", artwork_id)
      .maybeSingle();
    if (!art) return res.status(404).send("Artwork not found");
    if ((art as any).creator_id !== uid) return res.status(403).send("Only creator can register QR");

    const secret = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 28);
    const hash = sha256Hex(secret);

    await serverClient.from("artworks").update({ qr_secret_hash: hash, tag_status: "bound" }).eq("id", artwork_id);

    const deepLink = `${PUBLIC_APP_URL}/a/${artwork_id}/qr?code=${encodeURIComponent(secret)}`;
    res.json({ secret, deepLink });
  } catch (e: any) {
    res.status(401).send(e?.message || "Unauthorized");
  }
});

app.get("/qr/verify", async (req, res) => {
  try {
    const serverClient = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const artworkId = String(req.query.artworkId || req.query.artwork_id || "");
    const code = String(req.query.code || "");
    if (!artworkId || !code) return res.status(400).send("artworkId & code required");

    const { data: art } = await serverClient
      .from("artworks")
      .select("id, qr_secret_hash, owner_id, creator_id, tag_status")
      .eq("id", artworkId)
      .maybeSingle();
    if (!art) return res.status(404).send("Artwork not found");

    const ok = !!(art as any).qr_secret_hash && sha256Hex(code) === (art as any).qr_secret_hash && (art as any).tag_status !== "revoked";
    const result = ok ? "verified" : "mismatch";

    try {
      await serverClient.from("scan_events").insert({
        artwork_id: artworkId,
        tag_kind: "qr",
        result,
        ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0] || (req.socket.remoteAddress || null),
        ua: req.headers["user-agent"] || null,
      });
    } catch {}

    res.json({ result, owner_id: (art as any).owner_id, creator_id: (art as any).creator_id, tag_status: (art as any).tag_status });
  } catch (e: any) {
    res.status(500).send(e?.message || "Server error");
  }
});

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
