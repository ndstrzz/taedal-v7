// app/src/components/shipping/ShipmentsPanel.tsx
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  createShipment,
  listShipments,
  listShipmentEvents,
  updateShipmentStatus,
  type ShipmentStatus,
} from "../../lib/shipping";

type Shipment = {
  id: string;
  artwork_id: string;
  owner_id: string | null;
  carrier: string | null;
  tracking_number: string | null;
  status: ShipmentStatus | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type Event = {
  id: string;
  code: string;
  message: string | null;
  created_at: string;
};

/** Pretty-print statuses like "with_creator" → "With Creator" */
function prettyStatus(s: ShipmentStatus | null | undefined) {
  const str = String(s ?? "unknown");
  const spaced = str.replace(/_/g, " ");
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

const NEXT_STEPS: Record<ShipmentStatus, ShipmentStatus[]> = {
  with_creator: ["handed_to_carrier"],
  handed_to_carrier: ["in_transit"],
  in_transit: ["out_for_delivery", "delivered"],
  out_for_delivery: ["delivered"],
  delivered: [],
  failed: [],
  returned: [],
  unknown: [],
};

export default function ShipmentsPanel({
  artworkId,
  canEdit,
}: {
  artworkId: string;
  canEdit: boolean;
}) {
  const [uid, setUid] = useState<string | null>(null);
  const [rows, setRows] = useState<Shipment[]>([]);
  const [events, setEvents] = useState<Record<string, Event[]>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // form
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setUid(data.session?.user?.id ?? null);
      await reload();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artworkId]);

  async function reload() {
    setMsg(null);
    try {
      const list = await listShipments(artworkId);
      setRows((list as any) ?? []);
      // load events for each shipment
      const all: Record<string, Event[]> = {};
      for (const s of list ?? []) {
        all[s.id] = (await listShipmentEvents(s.id)) as any;
      }
      setEvents(all);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load shipments.");
    }
  }

  async function onCreate() {
    if (!uid) return setMsg("Please sign in.");
    if (!carrier && !tracking && !note) return setMsg("Add carrier, tracking, or a note.");
    setBusy(true);
    setMsg(null);
    try {
      await createShipment({
        artwork_id: artworkId,
        owner_id: uid,
        carrier,
        tracking_number: tracking,
        note,
      });
      setCarrier("");
      setTracking("");
      setNote("");
      await reload();
      // (optional) you could also reflect on artworks.physical_status here
    } catch (e: any) {
      setMsg(e?.message || "Failed to create shipment.");
    } finally {
      setBusy(false);
    }
  }

  async function move(shipmentId: string, next: ShipmentStatus) {
    setBusy(true);
    setMsg(null);
    try {
      await updateShipmentStatus(shipmentId, next, `Status changed to ${next}`);
      await reload();
    } catch (e: any) {
      setMsg(e?.message || "Failed to update status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Shipments</h3>
        {canEdit && (
          <div className="flex gap-2">
            <input
              className="input w-36"
              placeholder="Carrier"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
            />
            <input
              className="input w-44"
              placeholder="Tracking #"
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
            />
            <input
              className="input w-56"
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button className="btn" onClick={onCreate} disabled={busy}>
              {busy ? "Saving…" : "Add shipment"}
            </button>
          </div>
        )}
      </div>

      {msg && <div className="text-xs text-amber-300 mb-2">{msg}</div>}

      {rows.length === 0 ? (
        <div className="text-sm text-white/70">No shipments yet.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((s) => (
            <div key={s.id} className="p-3 rounded-xl bg-white/[0.04] border border-white/10">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <b>#{s.id.slice(0, 6)}</b>
                <span>
                  • Status: <span className="font-medium">{prettyStatus(s.status)}</span>
                </span>
                {s.carrier && <span>• Carrier: {s.carrier}</span>}
                {s.tracking_number && <span>• Tracking: {s.tracking_number}</span>}
                <span className="text-white/60">• {new Date(s.created_at).toLocaleString()}</span>
              </div>

              {/* timeline */}
              <ul className="mt-2 space-y-1 text-sm">
                {(events[s.id] ?? []).map((e) => (
                  <li key={e.id} className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 rounded-full bg-white/60" />
                    <div>
                      <div className="font-medium">{prettyStatus(e.code as ShipmentStatus)}</div>
                      {e.message && <div className="text-white/80 text-[13px]">{e.message}</div>}
                      <div className="text-white/50 text-[11px]">
                        {new Date(e.created_at).toLocaleString()}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {canEdit && s.status && NEXT_STEPS[s.status].length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {NEXT_STEPS[s.status].map((n) => (
                    <button
                      key={n}
                      className="btn px-2 py-1 text-xs"
                      onClick={() => move(s.id, n)}
                      disabled={busy}
                    >
                      Mark {prettyStatus(n)}
                    </button>
                  ))}
                  {/* exception quick actions */}
                  <button
                    className="btn px-2 py-1 text-xs"
                    onClick={() => move(s.id, "failed")}
                    disabled={busy}
                  >
                    Mark Failed
                  </button>
                  <button
                    className="btn px-2 py-1 text-xs"
                    onClick={() => move(s.id, "returned")}
                    disabled={busy}
                  >
                    Mark Returned
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
