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
  | "failed"
  | "returned"
  | "unknown";

export const SHIPMENT_STATUSES: readonly ShipmentStatus[] = [
  "with_creator",
  "handed_to_carrier",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "failed",
  "returned",
  "unknown",
] as const;

/** Accept a few human strings and coerce → enum */
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
    failed: "failed",
    returned: "returned",
    unknown: "unknown",
  };
  const val = map[k] ?? (SHIPMENT_STATUSES.includes(k as ShipmentStatus) ? (k as ShipmentStatus) : null);
  return val;
}

function assertStatus(status: ShipmentStatus) {
  if (!SHIPMENT_STATUSES.includes(status)) {
    throw new Error(`Invalid shipment status '${status}'. Allowed: ${SHIPMENT_STATUSES.join(", ")}`);
  }
}

/** Date helpers: accept yyyy-mm-dd or empty */
function toDateOrNull(d?: string | null): string | null {
  if (!d) return null;
  // keep yyyy-mm-dd as-is; ignore obviously bad strings
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
  /** Optional override for first status; defaults to 'with_creator' */
  status?: ShipmentStatus | string | null;
}) {
  // Always start with a valid status to satisfy CHECK constraints.
  const status = normalizeStatus(input.status) ?? "with_creator";
  assertStatus(status);

  const payload = {
    artwork_id: input.artwork_id,
    owner_id: input.owner_id,
    carrier: input.carrier ?? null,
    tracking_number: input.tracking_number ?? null,
    note: input.note ?? null,
    estimated_delivery_date: toDateOrNull(input.estimated_delivery_date),
    status,
  };

  const { data, error } = await supabase
    .from("shipments")
    .insert(payload)
    .select("id,artwork_id,owner_id,carrier,tracking_number,status,note,estimated_delivery_date,created_at,updated_at")
    .single();
  if (error) throw error;

  // Seed the timeline with the initial status event (best-effort).
  try {
    await supabase.from("shipment_events").insert({
      shipment_id: data.id,
      code: status,
      message: input.note ?? null,
    });
  } catch {
    /* ignore */
  }

  return data;
}

export async function listShipments(artworkId: string) {
  const { data, error } = await supabase
    .from("shipments")
    .select(
      "id,artwork_id,owner_id,carrier,tracking_number,status,note,estimated_delivery_date,created_at,updated_at"
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
      "id,artwork_id,owner_id,carrier,tracking_number,status,note,estimated_delivery_date,created_at,updated_at"
    )
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function listShipmentEvents(shipmentId: string) {
  const { data, error } = await supabase
    .from("shipment_events")
    .select("id,code,message,created_at")
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

/** Minimal “move forward” status update with optional note */
export async function updateShipmentStatus(
  shipmentId: string,
  status: ShipmentStatus | string,
  message?: string | null
) {
  const next = normalizeStatus(status);
  if (!next) throw new Error(`Invalid status: ${status}`);
  assertStatus(next);

  const { error } = await supabase.from("shipments").update({ status: next }).eq("id", shipmentId);
  if (error) throw error;

  const { error: e2 } = await supabase.from("shipment_events").insert({
    shipment_id: shipmentId,
    code: next,
    message: message ?? null,
  });
  if (e2) throw e2;
}

/** Partial update for carrier/tracking/date/note and (optionally) status */
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

  // include status if provided
  if (fields.status != null) {
    const s = normalizeStatus(fields.status);
    if (!s) throw new Error(`Invalid status: ${fields.status}`);
    assertStatus(s);
    patch.status = s;
  }

  const { error } = await supabase.from("shipments").update(patch).eq("id", shipmentId);
  if (error) throw error;

  // If status was changed, log an event too.
  if (patch.status) {
    const { error: e2 } = await supabase.from("shipment_events").insert({
      shipment_id: shipmentId,
      code: patch.status as ShipmentStatus,
      message: fields.note ?? null,
    });
    if (e2) throw e2;
  }
}
