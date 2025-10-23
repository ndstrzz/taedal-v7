// app/src/components/shipping/ShipmentManager.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  getShipmentById,
  listShipmentEvents,
  updateShipmentDetails,
  confirmShipmentReceived,
  type ShipmentStatus,
  SHIPMENT_STATUSES,
} from "../../lib/shipping";

type Shipment = {
  id: string;
  artwork_id: string;
  owner_id: string | null;
  carrier: string | null;
  tracking_number: string | null;
  status: ShipmentStatus | null;       // legacy
  status_v2?: ShipmentStatus | null;   // new enum
  note: string | null;
  estimated_delivery_date: string | null;
  created_at: string;
  updated_at: string;
  delivered_at?: string | null;
  buyer_confirmed_at?: string | null;
  buyer_confirmed_by?: string | null;
  tracking_slug?: string | null;
  last_checkpoint?: {
    code?: string;
    message?: string;
    checkpoint_time?: string;
    city?: string;
    state?: string;
    country?: string;
  } | null;
};

type EventRow = {
  id: string;
  code: string;
  message: string | null;
  source?: string | null;
  created_at: string;
};

type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type Artwork = {
  id: string;
  title: string | null;
  image_url: string | null;
  owner_id: string | null;
};

export default function ShipmentManager({
  open,
  onClose,
  shipmentId,
  artworkId,
  canEdit,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  shipmentId: string;
  artworkId: string;
  canEdit: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const [viewerId, setViewerId] = useState<string | null>(null);

  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [art, setArt] = useState<Artwork | null>(null);
  const [buyer, setBuyer] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // form fields
  const [status, setStatus] = useState<ShipmentStatus | "">("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [eta, setEta] = useState(""); // yyyy-mm-dd
  const [note, setNote] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setViewerId(data.session?.user?.id ?? null);
    })();
  }, []);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setMsg(null);
      try {
        const s = (await getShipmentById(shipmentId)) as Shipment;
        setShipment(s);
        const initial = (s.status_v2 as ShipmentStatus) || (s.status as ShipmentStatus) || "with_creator";
        setStatus(initial);
        setCarrier(s.carrier || "");
        setTracking(s.tracking_number || "");
        setEta(s.estimated_delivery_date || "");
        setNote("");

        const ev = (await listShipmentEvents(shipmentId)) as EventRow[];
        setEvents(ev);

        // artwork + buyer (current owner)
        const { data: a } = await supabase
          .from("artworks")
          .select("id,title,image_url,owner_id")
          .eq("id", artworkId)
          .maybeSingle();
        if (a) setArt(a as Artwork);
        if (a?.owner_id) {
          const { data: p } = await supabase
            .from("profiles")
            .select("id,username,display_name,avatar_url")
            .eq("id", a.owner_id as string)
            .maybeSingle();
          if (p) setBuyer(p as Profile);
        }
      } catch (e: any) {
        setMsg(e?.message || "Failed to load shipment.");
      }
    })();
  }, [open, shipmentId, artworkId]);

  const statusOptions = useMemo(
    () =>
      SHIPMENT_STATUSES
        .filter((s) => s !== "unknown")
        .map((s) => ({
          key: s,
          label: s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
        })),
    []
  );

  async function onUpdate() {
    if (!shipment) return;
    setBusy(true);
    setMsg(null);
    try {
      await updateShipmentDetails(shipment.id, {
        status: status || null,
        carrier: carrier || null,
        tracking_number: tracking || null,
        estimated_delivery_date: eta || null,
        note: note || null,
      });
      if (onChanged) await onChanged();

      // refresh
      const fresh = (await getShipmentById(shipment.id)) as Shipment;
      setShipment(fresh);
      setStatus((fresh.status_v2 as ShipmentStatus) || (fresh.status as ShipmentStatus) || "");
      const ev = (await listShipmentEvents(shipment.id)) as EventRow[];
      setEvents(ev);
      setNote("");
    } catch (e: any) {
      setMsg(e?.message || "Failed to update shipment.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const currentStatus = (shipment?.status_v2 as ShipmentStatus) || (shipment?.status as ShipmentStatus) || "unknown";
  const isDelivered = currentStatus === "delivered";
  const viewerIsBuyer = !!viewerId && !!art?.owner_id && viewerId === art.owner_id;

  const StatusPill = ({ v }: { v: ShipmentStatus | null }) => {
    const code = (v || "unknown") as ShipmentStatus;
    const t = code.replace(/_/g, " ");
    const tone =
      code === "delivered" ? "bg-emerald-400 text-black" :
      code === "returned" || code === "exception" ? "bg-rose-300 text-black" :
      "bg-white/10 text-white";
    return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${tone}`}>{t}</span>;
  };

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="absolute right-0 top-0 h-full w-full xl:w-[1100px] bg-neutral-950 border-l border-white/10 shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-neutral-950/80 backdrop-blur border-b border-white/10">
          <div className="px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg overflow-hidden bg-white/5 border border-white/10">
                {art?.image_url ? <img src={art.image_url} className="h-full w-full object-cover" /> : null}
              </div>
              <div className="min-w-0">
                <div className="font-medium truncate">{art?.title || "Artwork"}</div>
                <div className="text-xs text-white/60">Update and track artwork shipment status</div>
              </div>
              <div className="ml-3">
                <StatusPill v={currentStatus as ShipmentStatus} />
              </div>
            </div>
            <button
              className="text-sm rounded-lg px-3 py-1.5 bg-white/0 border border-white/20 hover:bg-white/10"
              onClick={onClose}
              disabled={busy}
            >
              Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 grid gap-5 lg:grid-cols-12">
          {/* Left: buyer confirm + form */}
          <div className="lg:col-span-7 space-y-5">
            {/* Buyer confirm block */}
            {isDelivered && viewerIsBuyer && !shipment?.buyer_confirmed_at && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-400/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">Mark as received</div>
                    <div className="text-sm text-white/70">Confirm you’ve received the artwork.</div>
                  </div>
                  <button
                    className="btn"
                    disabled={confirmBusy}
                    onClick={async () => {
                      try {
                        setConfirmBusy(true);
                        await confirmShipmentReceived(shipment!.id);
                        if (onChanged) await onChanged();
                        const fresh = (await getShipmentById(shipment!.id)) as Shipment;
                        setShipment(fresh);
                        const ev = (await listShipmentEvents(shipment!.id)) as EventRow[];
                        setEvents(ev);
                        setMsg("Thanks — receipt confirmed ✅");
                      } catch (e: any) {
                        setMsg(e?.message || "Failed to confirm.");
                      } finally {
                        setConfirmBusy(false);
                      }
                    }}
                  >
                    {confirmBusy ? "Confirming…" : "Confirm received"}
                  </button>
                </div>
              </div>
            )}

            {/* Update box (seller/creator) */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04]">
              <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                <span className="text-base font-semibold">Update Shipment Status</span>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-sm mb-1">Shipment Status</label>
                  <div className="relative">
                    <select
                      className="input w-full pr-8"
                      value={status}
                      onChange={(e) => setStatus(e.target.value as ShipmentStatus)}
                      disabled={!canEdit}
                    >
                      {statusOptions.map((o) => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/40">▾</div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm mb-1">Shipping Carrier</label>
                  <div className="relative">
                    <select
                      className="input w-full pr-8"
                      value={carrier}
                      onChange={(e) => setCarrier(e.target.value)}
                      disabled={!canEdit}
                    >
                      <option value="">—</option>
                      <option>FedEx</option>
                      <option>UPS</option>
                      <option>DHL</option>
                      <option>USPS</option>
                      <option>Other</option>
                    </select>
                    <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/40">▾</div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm mb-1">Tracking Number</label>
                  <input
                    className="input w-full"
                    value={tracking}
                    onChange={(e) => setTracking(e.target.value)}
                    placeholder="1Z999AA10123456784"
                    disabled={!canEdit}
                  />
                </div>

                <div>
                  <label className="block text-sm mb-1">Estimated Delivery Date</label>
                  <input
                    className="input w-full"
                    type="date"
                    value={eta}
                    onChange={(e) => setEta(e.target.value)}
                    disabled={!canEdit}
                  />
                </div>

                <div>
                  <label className="block text-sm mb-1">Add Note (Optional)</label>
                  <textarea
                    className="input w-full min-h-[90px]"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Any relevant notes about this status update…"
                    disabled={!canEdit}
                  />
                </div>

                {msg && <div className="text-xs text-amber-300">{msg}</div>}

                <div>
                  <button className="btn w-full" onClick={onUpdate} disabled={!canEdit || busy}>
                    {busy ? "Updating…" : "Update Shipment Status"}
                  </button>
                </div>
              </div>
            </div>

            {/* Status history */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04]">
              <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                <span className="text-base font-semibold">Status History</span>
              </div>
              <div className="p-4">
                {events.length === 0 ? (
                  <div className="text-sm text-white/70">No events yet.</div>
                ) : (
                  <ul className="space-y-5">
                    {events.map((e) => (
                      <li key={e.id} className="flex items-start gap-3">
                        <div className="mt-1 h-3 w-3 rounded-full bg-white/30" />
                        <div className="flex-1">
                          <div className="font-medium">
                            {e.code.replace(/_/g, " ")}{" "}
                            <span className="text-xs text-white/50">
                              {e.source ? `• ${e.source}` : null}
                            </span>
                          </div>
                          {e.message && <div className="text-white/80 text-[13px]">{e.message}</div>}
                          <div className="text-white/50 text-[11px]">{new Date(e.created_at).toLocaleString()}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Right: info cards */}
          <div className="lg:col-span-5 space-y-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04]">
              <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                <span className="text-base font-semibold">Buyer Information</span>
              </div>
              <div className="p-4 text-sm space-y-2">
                {buyer ? (
                  <>
                    <div className="flex items-center gap-2">
                      {buyer.avatar_url ? (
                        <img src={buyer.avatar_url} className="h-7 w-7 rounded-full object-cover" />
                      ) : (
                        <div className="h-7 w-7 rounded-full bg-white/10" />
                      )}
                      <div className="font-medium">{buyer.display_name || buyer.username || "Collector"}</div>
                    </div>
                    <div className="text-white/60">Email</div>
                    <div>—</div>
                    <div className="text-white/60">Phone</div>
                    <div>—</div>
                  </>
                ) : (
                  <div className="text-white/70">No buyer profile available.</div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04]">
              <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                <span className="text-base font-semibold">Shipping Address</span>
              </div>
              <div className="p-4 text-sm">
                <div className="text-white/70">Address management not yet connected.</div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04]">
              <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                <span className="text-base font-semibold">Tracking Information</span>
              </div>
              <div className="p-4 text-sm space-y-2">
                <div className="text-white/60">Carrier</div>
                <div>{shipment?.carrier || shipment?.tracking_slug || "—"}</div>
                <div className="text-white/60">Tracking Number</div>
                <div>{shipment?.tracking_number || "—"}</div>
                <div className="text-white/60">Estimated Delivery</div>
                <div>{shipment?.estimated_delivery_date || "—"}</div>
                {shipment?.last_checkpoint && (
                  <>
                    <div className="text-white/60">Last Checkpoint</div>
                    <div>
                      {shipment.last_checkpoint.message || "—"}
                      <div className="text-xs text-white/50">
                        {[
                          shipment.last_checkpoint.city,
                          shipment.last_checkpoint.state,
                          shipment.last_checkpoint.country,
                        ].filter(Boolean).join(", ")}
                        {shipment.last_checkpoint.checkpoint_time
                          ? ` • ${new Date(shipment.last_checkpoint.checkpoint_time).toLocaleString()}`
                          : ""}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04]">
              <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                <span className="text-base font-semibold">Quick Actions</span>
              </div>
              <div className="p-4 space-y-2">
                <button className="w-full rounded-lg border border-white/20 px-3 py-2 text-left hover:bg-white/10">
                  Report Issue
                </button>
                <button className="w-full rounded-lg border border-white/20 px-3 py-2 text-left hover:bg-white/10">
                  View Contract
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
