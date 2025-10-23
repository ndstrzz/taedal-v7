// supabase/functions/carrier-webhook/index.ts
// Deno (Supabase Edge) — provider-agnostic webhook skeleton with HMAC + normalization
// Env (Project Settings → Functions):
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - CARRIER_WEBHOOK_SECRET  (hex string you define)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";

// SUPABASE (service role; bypasses RLS for webhooks)
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type NormCode =
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception"
  | "returned";

type NormCheckpoint = {
  code: NormCode;
  message?: string;
  checkpoint_time?: string; // ISO 8601
  city?: string;
  state?: string;
  country?: string;
};

function mapToStatusV2(code: NormCode) {
  switch (code) {
    case "picked_up": return "handed_to_carrier";
    case "in_transit": return "in_transit";
    case "out_for_delivery": return "out_for_delivery";
    case "delivered": return "delivered";
    case "returned": return "returned";
    case "exception": return "exception";
    default: return null;
  }
}

async function hmacOk(body: string, headerSig: string | null, secret: string) {
  if (!headerSig) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
  const expected = headerSig.toLowerCase().replace(/^0x/, "");
  // constant-time-ish compare
  if (hex.length !== expected.length) return false;
  let acc = 0;
  for (let i = 0; i < hex.length; i++) acc |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return acc === 0;
}

// Very small normalizer supporting typical shapes (AfterShip/EasyPost/17TRACK-ish).
function normalizePayload(p: any): {
  tracking_number: string;
  carrier?: string;
  checkpoint?: NormCheckpoint;
  provider?: string;
} {
  // AfterShip-like
  if (p?.data?.tracking?.tracking_number) {
    const t = p.data.tracking;
    const last = (t.checkpoints || []).slice(-1)[0] || null;
    const tag = String(last?.tag ?? t.tag ?? "").toLowerCase();
    const map: Record<string, NormCode> = {
      "inforeceived": "picked_up",
      "intransit": "in_transit",
      "outfordelivery": "out_for_delivery",
      "delivered": "delivered",
      "exception": "exception",
      "returntosender": "returned",
    };
    return {
      tracking_number: String(t.tracking_number),
      carrier: t.slug,
      provider: "aftership",
      checkpoint: last
        ? {
            code: map[tag] ?? "in_transit",
            message: last.message ?? last.location ?? undefined,
            checkpoint_time: last.checkpoint_time ?? last.created_at ?? undefined,
            city: last.city ?? undefined,
            state: last.state ?? undefined,
            country: last.country ?? undefined,
          }
        : undefined,
    };
  }

  // EasyPost-like
  if (p?.result?.tracking_code) {
    const t = p.result;
    const last = (t.tracking_details || []).slice(-1)[0] || null;
    const status = String(t.status || "").toLowerCase();
    const map: Record<string, NormCode> = {
      "pre_transit": "picked_up",
      "in_transit": "in_transit",
      "out_for_delivery": "out_for_delivery",
      "delivered": "delivered",
      "return_to_sender": "returned",
      "failure": "exception",
      "unknown": "in_transit",
    };
    return {
      tracking_number: String(t.tracking_code),
      carrier: t.carrier,
      provider: "easypost",
      checkpoint: last
        ? {
            code: map[status] ?? "in_transit",
            message: last.message ?? last.description ?? undefined,
            checkpoint_time: last.datetime ?? undefined,
            city: last.tracking_location?.city ?? undefined,
            state: last.tracking_location?.state ?? undefined,
            country: last.tracking_location?.country ?? undefined,
          }
        : undefined,
    };
  }

  // 17TRACK-like
  if (p?.data?.track_info?.tracking_number) {
    const t = p.data.track_info;
    const s = String(t.latest_status || "").toLowerCase();
    const code: NormCode =
      s.includes("delivered") ? "delivered" :
      s.includes("out for delivery") ? "out_for_delivery" :
      s.includes("return") ? "returned" :
      s.includes("exception") ? "exception" :
      s.includes("in transit") ? "in_transit" :
      "in_transit";
    return {
      tracking_number: String(t.tracking_number),
      carrier: t.carrier_code,
      provider: "17track",
      checkpoint: {
        code,
        message: t.latest_event ?? undefined,
        checkpoint_time: t.latest_time ?? undefined,
        city: t.latest_city ?? undefined,
        state: t.latest_state ?? undefined,
        country: t.latest_country ?? undefined,
      },
    };
  }

  // Minimal fallback (useful for manual tests)
  return {
    tracking_number: String(p?.tracking_number || ""),
    carrier: p?.carrier || undefined,
    provider: String(p?.provider || "carrier_webhook"),
    checkpoint: p?.checkpoint,
  };
}

serve(async (req) => {
  try {
    const raw = await req.text();
    const secret = Deno.env.get("CARRIER_WEBHOOK_SECRET") ?? "";
    const ok = await hmacOk(raw, req.headers.get("x-taedal-signature"), secret);
    if (!ok) return new Response("bad signature", { status: 401 });

    const payload = JSON.parse(raw);
    const n = normalizePayload(payload);
    if (!n.tracking_number) return new Response("no tracking", { status: 400 });

    // locate shipment
    const { data: ship, error: se } = await supabase
      .from("shipments")
      .select("id, status_v2")
      .eq("tracking_number", n.tracking_number)
      .maybeSingle();
    if (se) throw se;
    if (!ship) return new Response("shipment not found", { status: 404 });

    const newStatus = n.checkpoint?.code ? mapToStatusV2(n.checkpoint.code) : null;

    // patch shipment (status_v2, delivered_at, tracking_slug, last_checkpoint, webhook_source)
    const patch: Record<string, unknown> = {
      webhook_source: n.provider ?? "carrier_webhook",
      tracking_slug: n.carrier ?? null,
      last_checkpoint: n.checkpoint ?? null,
      updated_at: new Date().toISOString(),
    };
    if (newStatus) patch.status_v2 = newStatus;
    if (newStatus === "delivered") patch.delivered_at = new Date().toISOString();

    const { error: ue } = await supabase.from("shipments").update(patch).eq("id", ship.id);
    if (ue) throw ue;

    // append event (idempotent enough via (shipment_id, code, created_at) unique where source=carrier_webhook)
    const createdAt = n.checkpoint?.checkpoint_time ?? new Date().toISOString();
    const { error: ie } = await supabase.from("shipment_events").insert({
      shipment_id: ship.id,
      code: n.checkpoint?.code ?? "update",
      message: n.checkpoint?.message ?? null,
      source: "carrier_webhook",
      payload,
      created_at: createdAt,
    });
    if (ie && !String(ie.message || "").includes("duplicate key")) throw ie;

    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});
