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
  | "failed"        // legacy alias → maps to 'exception'
  | "unknown";

export const SHIPMENT_STATUSES: readonly ShipmentStatus[] = [
  "with_creator",
  "handed_to_carrier",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "returned",
  "exception",
  "failed",   // legacy
  "unknown",
] as const;

/** Coerce human strings → enum (with legacy aliases) */
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
    failed: "exception",      // map to exception
    exception: "exception",
    returned: "returned",
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
  const next = normalizeStatus(input.status) ?? "with_creator";
  assertStatus(next);

  const payload = {
    artwork_id: input.artwork_id,
    owner_id: input.owner_id,
    carrier: input.carrier ?? null,
    tracking_number: input.tracking_number ?? null,
    note: input.note ?? null,
    estimated_delivery_date: toDateOrNull(input.estimated_delivery_date),
    status: next,            // keep legacy column in sync
    status_v2: normalizeStatus(next) === "exception" ? "exception" : (next as any),
  };

  const { data, error } = await supabase
    .from("shipments")
    .insert(payload)
    .select(`
      id, artwork_id, owner_id, carrier, tracking_number,
      status, status_v2, note, estimated_delivery_date,
      created_at, updated_at, delivered_at, buyer_confirmed_at, buyer_confirmed_by
    `)
    .single();
  if (error) throw error;

  // seed timeline
  try {
    await supabase.from("shipment_events").insert({
      shipment_id: data.id,
      code: normalizeStatus(next) ?? next,
      message: input.note ?? null,
      source: "system",
    });
  } catch { /* ignore */ }

  return data;
}

export async function listShipments(artworkId: string) {
  const { data, error } = await supabase
    .from("shipments")
    .select(`
      id, artwork_id, owner_id, carrier, tracking_number,
      status, status_v2, note, estimated_delivery_date,
      created_at, updated_at, delivered_at, buyer_confirmed_at
    `)
    .eq("artwork_id", artworkId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getShipmentById(id: string) {
  const { data, error } = await supabase
    .from("shipments")
    .select(`
      id, artwork_id, owner_id, carrier, tracking_number,
      status, status_v2, note, estimated_delivery_date,
      created_at, updated_at, delivered_at,
      buyer_confirmed_at, buyer_confirmed_by,
      tracking_slug, last_checkpoint
    `)
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function listShipmentEvents(shipmentId: string) {
  const { data, error } = await supabase
    .from("shipment_events")
    .select("id, code, message, source, created_at")
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function updateShipmentStatus(
  shipmentId: string,
  status: ShipmentStatus | string,
  message?: string | null
) {
  const next = normalizeStatus(status);
  if (!next) throw new Error(`Invalid status: ${status}`);
  assertStatus(next);

  const { error } = await supabase
    .from("shipments")
    .update({
      status: next,            // legacy
      status_v2: next === "failed" ? "exception" : (next as any),
      delivered_at: next === "delivered" ? new Date().toISOString() : undefined,
    })
    .eq("id", shipmentId);
  if (error) throw error;

  const { error: e2 } = await supabase.from("shipment_events").insert({
    shipment_id: shipmentId,
    code: next,
    message: message ?? null,
    source: "seller",
  });
  if (e2) throw e2;
}

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

  let changedStatus: ShipmentStatus | null = null;
  if (fields.status != null) {
    const s = normalizeStatus(fields.status);
    if (!s) throw new Error(`Invalid status: ${fields.status}`);
    assertStatus(s);
    changedStatus = s;
    patch.status = s;
    patch.status_v2 = s === "failed" ? "exception" : (s as any);
    if (s === "delivered") patch.delivered_at = new Date().toISOString();
  }

  const { error } = await supabase.from("shipments").update(patch).eq("id", shipmentId);
  if (error) throw error;

  if (changedStatus) {
    const { error: e2 } = await supabase.from("shipment_events").insert({
      shipment_id: shipmentId,
      code: changedStatus,
      message: fields.note ?? null,
      source: "seller",
    });
    if (e2) throw e2;
  }
}

/** Buyer confirmation (calls SECURITY DEFINER RPC) */
export async function confirmShipmentReceived(shipment_id: string) {
  const { data, error } = await supabase.rpc("confirm_shipment_received", {
    p_shipment_id: shipment_id,
  });
  if (error) throw error;
  return data as boolean;
}

/** Public tracking (tokenized) — optional endpoint you can build a route on */
export async function getShipmentByPublicToken(token: string) {
  const { data, error } = await supabase
    .from("shipments")
    .select(`
      id, artwork_id, status, status_v2,
      carrier, tracking_number, tracking_slug,
      last_checkpoint, delivered_at, buyer_confirmed_at
    `)
    .eq("public_token", token)
    .maybeSingle();
  if (error) throw error;
  return data;
}
