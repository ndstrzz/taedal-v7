// app/src/components/shipping/ShipmentManager.tsx
import { useEffect, useMemo, useState } from "react";
import {
  getShipmentById,
  listShipmentEvents,
  updateShipmentDetails,
  updateShipmentStatus,
  type ShipmentStatus,
} from "../../lib/shipping";

type Shipment = {
  id: string;
  artwork_id: string;
  carrier: string | null;
  tracking_number: string | null;
  status: ShipmentStatus | null;
  note: string | null;
  estimated_delivery_date: string | null; // ISO date (yyyy-mm-dd)
  created_at: string;
};

type Event = {
  id: string;
  code: string;
  message: string | null;
  created_at: string;
};

const STATUS_OPTIONS: ShipmentStatus[] = [
  "with_creator",
  "handed_to_carrier",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "failed",
  "returned",
  "unknown",
];

export default function ShipmentManager({
  shipmentId,
  onClose,
  canEdit,
}: {
  shipmentId: string;
  onClose: (changed: boolean) => void;
  canEdit: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  const [row, setRow] = useState<Shipment | null>(null);
  const [events, setEvents] = useState<Event[]>([]);

  // form state
  const [status, setStatus] = useState<ShipmentStatus>("with_creator");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [eta, setEta] = useState<string>(""); // yyyy-mm-dd
  const [note, setNote] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg(null);
      try {
        const s = await getShipmentById(shipmentId);
        const ev = await listShipmentEvents(shipmentId);
        setRow(s as any);
        setEvents(ev as any);
        setStatus(((s as any)?.status ?? "with_creator") as ShipmentStatus);
        setCarrier((s as any)?.carrier ?? "");
        setTracking((s as any)?.tracking_number ?? "");
        setEta((s as any)?.estimated_delivery_date ?? "");
        setNote((s as any)?.note ?? "");
      } catch (e: any) {
        setMsg(e?.message || "Failed to load shipment.");
      } finally {
        setLoading(false);
      }
    })();
  }, [shipmentId]);

  const title = useMemo(() => `Shipment #${shipmentId.slice(0, 6)}`, [shipmentId]);

  async function onSave() {
    if (!row) return;
    setMsg(null);
    setLoading(true);
    try {
      await updateShipmentDetails(row.id, {
        status,
        carrier: carrier || null,
        tracking_number: tracking || null,
        estimated_delivery_date: eta || null,
        note: note || null,
      });
      setChanged(true);
    } catch (e: any) {
      setMsg(e?.message || "Failed to update shipment.");
    } finally {
      setLoading(false);
    }
  }

  async function mark(newStatus: ShipmentStatus) {
    if (!row) return;
    setMsg(null);
    setLoading(true);
    try {
      await updateShipmentStatus(row.id, newStatus, `Status changed to ${newStatus}`);
      const s = await getShipmentById(row.id);
      const ev = await listShipmentEvents(row.id);
      setRow(s as any);
      setEvents(ev as any);
      setStatus(((s as any)?.status ?? "with_creator") as ShipmentStatus);
      setChanged(true);
    } catch (e: any) {
      setMsg(e?.message || "Failed to update status.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] bg-black/60 backdrop-blur-sm">
      <div className="absolute right-0 top-0 h-full w-full max-w-4xl bg-neutral-950 border-l border-white/10 overflow-auto">
        <div className="p-6 flex items-center justify-between border-b border-white/10">
          <div className="space-y-1">
            <div className="text-xl font-semibold">{title}</div>
            {row && <div className="text-sm text-white/60">Created {new Date(row.created_at).toLocaleString()}</div>}
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <button className="btn" onClick={onSave} disabled={loading}>
                {loading ? "Saving…" : "Update Shipment Status"}
              </button>
            )}
            <button className="btn" onClick={() => onClose(changed)}>Close</button>
          </div>
        </div>

        <div className="p-6 grid lg:grid-cols-12 gap-6">
          {/* Left: edit form */}
          <div className="lg:col-span-7">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-4">
              <div className="text-sm font-semibold">Update Shipment Status</div>

              {msg && <div className="text-xs text-amber-300">{msg}</div>}

              <label className="block text-sm">Shipment Status</label>
              <select className="input" disabled={!canEdit} value={status} onChange={(e)=>setStatus(e.target.value as ShipmentStatus)}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {String(s).split("_").join(" ")}
                  </option>
                ))}
              </select>

              <label className="block text-sm mt-3">Shipping Carrier</label>
              <input className="input" disabled={!canEdit} placeholder="UPS / FedEx / DHL / …" value={carrier} onChange={(e)=>setCarrier(e.target.value)} />

              <label className="block text-sm mt-3">Tracking Number</label>
              <input className="input" disabled={!canEdit} value={tracking} onChange={(e)=>setTracking(e.target.value)} />

              <label className="block text-sm mt-3">Estimated Delivery Date</label>
              <input className="input" type="date" disabled={!canEdit} value={eta ?? ""} onChange={(e)=>setEta(e.target.value)} />

              <label className="block text-sm mt-3">Add Note (Optional)</label>
              <textarea className="input min-h-[90px]" disabled={!canEdit} value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Any extra context about this update…" />

              {canEdit && (
                <div className="flex gap-2 pt-2">
                  <button className="btn" onClick={onSave} disabled={loading}>
                    {loading ? "Saving…" : "Update Shipment Status"}
                  </button>
                  <button className="btn" onClick={() => mark("delivered")} disabled={loading}>
                    Mark delivered
                  </button>
                </div>
              )}
            </div>

            {/* Status history */}
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-sm font-semibold mb-2">Status History</div>
              <div className="space-y-3">
                {events.length === 0 ? (
                  <div className="text-sm text-white/60">No events yet.</div>
                ) : (
                  events.map((e) => (
                    <div key={e.id} className="flex items-start gap-3">
                      <div className="mt-1 h-3 w-3 rounded-full bg-white/30" />
                      <div>
                        <div className="font-medium">{e.code}</div>
                        {e.message && <div className="text-sm text-white/80">{e.message}</div>}
                        <div className="text-[11px] text-white/50">{new Date(e.created_at).toLocaleString()}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right: summary cards */}
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-sm font-semibold mb-2">Tracking Information</div>
              <div className="text-sm space-y-1">
                <div><span className="text-white/60">Carrier:</span> {carrier || "—"}</div>
                <div><span className="text-white/60">Tracking #:</span> {tracking || "—"}</div>
                <div><span className="text-white/60">Estimated delivery:</span> {eta ? new Date(eta).toLocaleDateString() : "—"}</div>
                <div><span className="text-white/60">Current status:</span> {String(status).split("_").join(" ")}</div>
              </div>
            </div>

            {/* You can plug real buyer/address data here when available */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-sm font-semibold mb-2">Buyer Information</div>
              <div className="text-xs text-white/60">Connect to your order data to populate this card.</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-sm font-semibold mb-2">Quick Actions</div>
              <div className="flex flex-col gap-2">
                <button className="btn">Report issue</button>
                <button className="btn">View contract</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
