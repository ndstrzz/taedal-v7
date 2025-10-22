// app/src/lib/shipping.ts
import { supabase } from "./supabase";

export type ShipmentStatus =
  | "with_creator"
  | "handed_to_carrier"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "failed"
  | "returned"
  | "unknown";

export async function createShipment(input: {
  artwork_id: string;
  owner_id: string;
  carrier?: string | null;
  tracking_number?: string | null;
  note?: string | null;
  estimated_delivery_date?: string | null; // yyyy-mm-dd
}) {
  const payload = {
    artwork_id: input.artwork_id,
    owner_id: input.owner_id,
    carrier: input.carrier ?? null,
    tracking_number: input.tracking_number ?? null,
    note: input.note ?? null,
    estimated_delivery_date: input.estimated_delivery_date ?? null,
    status: "with_creator" as ShipmentStatus,
  };
  const { data, error } = await supabase.from("shipments").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

export async function listShipments(artworkId: string) {
  const { data, error } = await supabase
    .from("shipments")
    .select("id,artwork_id,owner_id,carrier,tracking_number,status,note,estimated_delivery_date,created_at,updated_at")
    .eq("artwork_id", artworkId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function getShipmentById(id: string) {
  const { data, error } = await supabase
    .from("shipments")
    .select("id,artwork_id,owner_id,carrier,tracking_number,status,note,estimated_delivery_date,created_at,updated_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function updateShipmentStatus(shipmentId: string, status: ShipmentStatus, message?: string) {
  const { error } = await supabase.from("shipments").update({ status }).eq("id", shipmentId);
  if (error) throw error;

  // append an event
  const { error: e2 } = await supabase.from("shipment_events").insert({
    shipment_id: shipmentId,
    code: status,
    message: message ?? null,
  });
  if (e2) throw e2;
}

export async function updateShipmentDetails(
  shipmentId: string,
  fields: {
    status?: ShipmentStatus | null;
    carrier?: string | null;
    tracking_number?: string | null;
    estimated_delivery_date?: string | null;
    note?: string | null;
  }
) {
  const { error } = await supabase.from("shipments").update(fields).eq("id", shipmentId);
  if (error) throw error;

  if (fields.status) {
    // also record an event on status change
    const { error: e2 } = await supabase.from("shipment_events").insert({
      shipment_id: shipmentId,
      code: fields.status,
      message: fields.note ?? null,
    });
    if (e2) throw e2;
  }
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
