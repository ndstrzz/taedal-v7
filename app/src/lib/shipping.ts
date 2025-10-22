import { supabase } from "../lib/supabase";

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
  carrier?: string;
  tracking_number?: string;
  note?: string;
  shipping_to?: any;
  shipping_from?: any;
  weight_grams?: number;
}) {
  const { data, error } = await supabase
    .from("shipments")
    .insert({
      artwork_id: input.artwork_id,
      owner_id: input.owner_id,
      carrier: input.carrier ?? null,
      tracking_number: input.tracking_number ?? null,
      note: input.note ?? null,
      shipping_to: input.shipping_to ?? null,
      shipping_from: input.shipping_from ?? null,
      weight_grams: input.weight_grams ?? null,
      status: "with_creator",
    })
    .select("*")
    .single();
  if (error) throw error;
  // also add an event
  await addShipmentEvent(data.id, "created", "Shipment created");
  return data;
}

export async function updateShipmentStatus(shipmentId: string, next: ShipmentStatus, msg?: string, meta?: any) {
  const { error } = await supabase.from("shipments").update({ status: next }).eq("id", shipmentId);
  if (error) throw error;
  await addShipmentEvent(shipmentId, next === "with_creator" ? "created" : next, msg ?? null, meta);
}

export async function addShipmentEvent(
  shipmentId: string,
  code: string,
  message?: string | null,
  meta?: any
) {
  const { error } = await supabase
    .from("shipment_events")
    .insert({ shipment_id: shipmentId, code, message: message ?? null, meta: meta ?? null });
  if (error) throw error;
}

export async function listShipments(artworkId: string) {
  const { data, error } = await supabase
    .from("shipments")
    .select("*")
    .eq("artwork_id", artworkId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function listShipmentEvents(shipmentId: string) {
  const { data, error } = await supabase
    .from("shipment_events")
    .select("*")
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}
