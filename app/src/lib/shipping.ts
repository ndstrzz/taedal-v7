// app/src/lib/shipping.ts
import { supabase } from "./supabase";

/** ------------------------------------------------------------------ */
/** Types & constants                                                  */
/** ------------------------------------------------------------------ */

export type ShipmentStatus =
  | "with_creator"
  | "handed_to_carrier"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "returned"
  | "exception"
  | "failed"    // legacy alias mapped to 'exception' or keep as text only
  | "unknown";  // keep for compatibility if DB enum includes it

export const SHIPMENT_STATUSES: readonly ShipmentStatus[] = [
  "with_creator",
  "handed_to_carrier",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "returned",
  "exception",
  "failed",
  "unknown",
] as const;

// Confirm delivered-by-buyer (calls Postgres RPC)
export async function confirmShipmentReceived(shipmentId: string) {
  const { data, error } = await supabase.rpc("confirm_shipment_received", {
    p_shipment_id: shipmentId,
  });
  if (error) throw error;
  // the RPC returns boolean (true on success)
  return Boolean(data);
}

/** Accept a few human strings and coerce → canonical enum we use in app */
function normalizeStatus(s?: string | null): ShipmentStatus | null {
  if (!s) return null;
  const k = s.toLowerCase().replace(/\s+/g, "_");
  const map: Record<string, ShipmentStatus> = {
    with_creator: "with_creator",
    creator: "with_creator",
    handed_to_carrier: "handed_to_carrier",
    handed: "handed_to_carrier",
    in_transit: "in_transit",
    transit: "in_transit",
    out_for_delivery: "out_for_delivery",
    delivered: "delivered",
    returned: "returned",
    exception: "exception",
    failed: "exception", // map legacy 'failed' to exception for status_v2
    unknown: "unknown",
  };
  return (map[k] ?? null) as ShipmentStatus | null;
}

function assertStatus(status: ShipmentStatus) {
  if (!SHIPMENT_STATUSES.includes(status)) {
    throw new Error(`Invalid shipment status '${status}'. Allowed: ${SHIPMENT_STATUSES.join(", ")}`);
  }
}

/** yyyy-mm-dd or null */
function toDateOrNull(d?: string | null): string | null {
  if (!d) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** ------------------------------------------------------------------ */
/** API                                                                */
/** ------------------------------------------------------------------ */

export async function createShipment(input: {
  artwork_id: string;
  owner_id: string;
  carrier?: string | null;
  tracking_number?: string | null;
  note?: string | null;
  estimated_delivery_date?: string | null; // yyyy-mm-dd
  status?: ShipmentStatus | string | null; // optional override
}) {
  const status = normalizeStatus(input.status) ?? "with_creator";
  assertStatus(status);

  const payload = {
    artwork_id: input.artwork_id,
    owner_id: input.owner_id,
    carrier: input.carrier ?? null,
    tracking_number: input.tracking_number ?? null,
    note: input.note ?? null,
    estimated_delivery_date: toDateOrNull(input.estimated_delivery_date),
    status,         // legacy text column
    status_v2: status === "failed" ? "exception" : status, // enum mirror
  };

  const { data, error } = await supabase
    .from("shipments")
    .insert(payload as any)
    .select(
      "id,artwork_id,owner_id,carrier,tracking_number,status,status_v2,note,estimated_delivery_date,created_at,updated_at"
    )
    .single();
  if (error) throw error;

  // Seed the timeline (best-effort).
  try {
    await supabase.from("shipment_events").insert({
      shipment_id: data.id,
      code: payload.status_v2 ?? status,
      message: input.note ?? null,
      source: "app",
    });
  } catch {}

  return data;
}

export async function listShipments(artworkId: string) {
  const { data, error } = await supabase
    .from("shipments")
    .select(
      "id,artwork_id,owner_id,carrier,tracking_number,status,status_v2,note,estimated_delivery_date,created_at,updated_at,tracking_slug,last_checkpoint,delivered_at,buyer_confirmed_at"
    )
    .eq("artwork_id", artworkId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getShipmentById(id: string) {
  const { data, error } = await supabase
    .from("shipments")
    .select(
      "id,artwork_id,owner_id,carrier,tracking_number,status,status_v2,note,estimated_delivery_date,created_at,updated_at,tracking_slug,last_checkpoint,delivered_at,buyer_confirmed_at"
    )
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function listShipmentEvents(shipmentId: string) {
  const { data, error } = await supabase
    .from("shipment_events")
    .select("id,code,message,created_at,source")
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

/** Minimal status change + event */
export async function updateShipmentStatus(
  shipmentId: string,
  status: ShipmentStatus | string,
  message?: string | null
) {
  const next = normalizeStatus(status);
  if (!next) throw new Error(`Invalid status: ${status}`);
  assertStatus(next);

  const patch: Record<string, any> = {
    status: next,
    status_v2: next === "failed" ? "exception" : next,
  };

  const { error } = await supabase.from("shipments").update(patch).eq("id", shipmentId);
  if (error) throw error;

  const { error: e2 } = await supabase.from("shipment_events").insert({
    shipment_id: shipmentId,
    code: patch.status_v2,
    message: message ?? null,
    source: "app",
  });
  if (e2) throw e2;
}

/** Partial update for fields + optional status change */
export async function updateShipmentDetails(
  shipmentId: string,
  fields: {
    status?: ShipmentStatus | string | null;
    carrier?: string | null;
    tracking_number?: string | null;
    estimated_delivery_date?: string | null;
    note?: string | null;
  }
) {
  const patch: Record<string, any> = {
    carrier: fields.carrier ?? undefined,
    tracking_number: fields.tracking_number ?? undefined,
    estimated_delivery_date: toDateOrNull(fields.estimated_delivery_date ?? null) ?? undefined,
    note: fields.note ?? undefined,
  };

  if (fields.status != null) {
    const s = normalizeStatus(fields.status);
    if (!s) throw new Error(`Invalid status: ${fields.status}`);
    assertStatus(s);
    patch.status = s;
    patch.status_v2 = s === "failed" ? "exception" : s;
  }

  const { error } = await supabase.from("shipments").update(patch).eq("id", shipmentId);
  if (error) throw error;

  if (patch.status_v2) {
    const { error: e2 } = await supabase.from("shipment_events").insert({
      shipment_id: shipmentId,
      code: patch.status_v2,
      message: fields.note ?? null,
      source: "app",
    });
    if (e2) throw e2;
  }
}
