// app/src/components/shipping/ShipmentsPanel.tsx
import { useEffect, useState, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import {
  createShipment,
  listShipments,
  listShipmentEvents,
  updateShipmentStatus,
  type ShipmentStatus,
} from "../../lib/shipping";
import ShipmentManager from "./ShipmentManager";

type Shipment = {
  id: string;
  artwork_id: string;
  owner_id: string | null;
  carrier: string | null;              // manual carrier label
  tracking_slug?: string | null;       // normalized carrier code from webhook
  tracking_number: string | null;
  status: ShipmentStatus | null;       // legacy text column
  status_v2?: ShipmentStatus | null;   // new enum column
  note: string | null;
  estimated_delivery_date?: string | null;
  created_at: string;
  updated_at: string;
  delivered_at?: string | null;
  buyer_confirmed_at?: string | null;
  last_checkpoint?: {
    code?: string;
    message?: string;
    checkpoint_time?: string;
    city?: string;
    state?: string;
    country?: string;
  } | null;
};

type Event = {
  id: string;
  code: string;
  message: string | null;
  created_at: string;
  source?: string | null;
};

// “happy path” next steps, plus exception/returned handled as dedicated buttons.
const NEXT_STEPS: Record<ShipmentStatus, ShipmentStatus[]> = {
  with_creator: ["handed_to_carrier"],
  handed_to_carrier: ["in_transit"],
  in_transit: ["out_for_delivery", "delivered"],
  out_for_delivery: ["delivered"],
  delivered: [],
  returned: [],
  exception: [],
  failed: [], // legacy alias; we keep empty here (use “Mark failed” button)
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

  // small inline create form
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [note, setNote] = useState("");

  // manager (full-screen) state
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerShipmentId, setManagerShipmentId] = useState<string | null>(null);

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
      const list = (await listShipments(artworkId)) as Shipment[];
      setRows(list || []);
      const all: Record<string, Event[]> = {};
      for (const s of list ?? []) {
        all[s.id] = (await listShipmentEvents(s.id)) as Event[];
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
      const s = await createShipment({
        artwork_id: artworkId,
        owner_id: uid,
        carrier,
        tracking_number: tracking,
        note,
      });
      setCarrier(""); setTracking(""); setNote("");
      await reload();
      // open the rich manager right away
      setManagerShipmentId(s.id);
      setManagerOpen(true);
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

  const StatusPill = ({ v }: { v: ShipmentStatus | null }) => {
    const code = (v || "unknown") as ShipmentStatus;
    const t = code.replace(/_/g, " ");
    const tone =
      code === "delivered" ? "bg-emerald-400 text-black" :
      code === "returned" || code === "exception" ? "bg-rose-300 text-black" :
      "bg-white/10 text-white";
    return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${tone}`}>{t}</span>;
  };

  const carrierLabel = (s: Shipment) =>
    s.tracking_slug || s.carrier || "—";

  const checkpointLine = (s: Shipment) => {
    const c = s.last_checkpoint;
    if (!c) return null;
    const where = [c.city, c.state, c.country].filter(Boolean).join(", ");
    const when = c.checkpoint_time ? new Date(c.checkpoint_time).toLocaleString() : null;
    return (
      <div className="text-xs text-white/60">
        {c.message || "Update"} {where ? `• ${where}` : ""} {when ? `• ${when}` : ""}
      </div>
    );
  };

  return (
    <>
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Shipments</h3>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <input className="input w-36" placeholder="Carrier" value={carrier} onChange={(e)=>setCarrier(e.target.value)} />
              <input className="input w-44" placeholder="Tracking #" value={tracking} onChange={(e)=>setTracking(e.target.value)} />
              <input className="input w-56" placeholder="Note (optional)" value={note} onChange={(e)=>setNote(e.target.value)} />
              <button className="btn" onClick={onCreate} disabled={busy}>{busy ? "Saving…" : "Add shipment"}</button>
            </div>
          )}
        </div>

        {msg && <div className="text-xs text-amber-300 mb-2">{msg}</div>}

        {rows.length === 0 ? (
          <div className="text-sm text-white/70">No shipments yet.</div>
        ) : (
          <div className="space-y-3">
            {rows.map((s) => {
              const curStatus: ShipmentStatus =
                (s.status_v2 as ShipmentStatus) || (s.status as ShipmentStatus) || "unknown";

              const nexts = useMemo(
                () => (NEXT_STEPS[curStatus] ?? []),
                [curStatus]
              );

              return (
                <div key={s.id} className="p-3 rounded-xl bg-white/[0.04] border border-white/10">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <b>#{s.id.slice(0, 6)}</b>
                    <span className="flex items-center gap-1">
                      • Status: <StatusPill v={curStatus} />
                    </span>
                    <span>• Carrier: {carrierLabel(s)}</span>
                    {s.tracking_number && <span>• Tracking: {s.tracking_number}</span>}
                    {s.estimated_delivery_date && <span>• ETA: {s.estimated_delivery_date}</span>}
                    <span className="text-white/60">• {new Date(s.created_at).toLocaleString()}</span>
                    <span className="ml-auto" />
                    <button
                      className="btn bg-white/0 border border-white/20 hover:bg-white/10"
                      onClick={() => { setManagerShipmentId(s.id); setManagerOpen(true); }}
                    >
                      View shipment options
                    </button>
                  </div>

                  {/* tiny timeline / checkpoint preview */}
                  <div className="mt-2">
                    {checkpointLine(s)}
                    <ul className="mt-2 space-y-1 text-sm">
                      {(events[s.id] ?? []).slice(0,3).map((e) => (
                        <li key={e.id} className="flex items-start gap-2">
                          <span className="mt-1 h-2 w-2 rounded-full bg-white/60" />
                          <div>
                            <div className="font-medium">{e.code.replace(/_/g, " ")}</div>
                            {e.message && <div className="text-white/80 text-[13px]">{e.message}</div>}
                            <div className="text-white/50 text-[11px]">{new Date(e.created_at).toLocaleString()}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {canEdit && nexts.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {nexts.map((n) => (
                        <button key={n} className="btn px-2 py-1 text-xs" onClick={() => move(s.id, n)} disabled={busy}>
                          Mark {`${n}`.replace(/_/g, " ")}
                        </button>
                      ))}
                      {/* exception quick actions */}
                      <button className="btn px-2 py-1 text-xs" onClick={() => move(s.id, "exception")} disabled={busy}>
                        Mark exception
                      </button>
                      <button className="btn px-2 py-1 text-xs" onClick={() => move(s.id, "returned")} disabled={busy}>
                        Mark returned
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Full-screen manager */}
      {managerOpen && managerShipmentId && (
        <ShipmentManager
          open
          onClose={() => setManagerOpen(false)}
          shipmentId={managerShipmentId}
          artworkId={artworkId}
          canEdit={canEdit}
          onChanged={reload}
        />
      )}
    </>
  );
}
