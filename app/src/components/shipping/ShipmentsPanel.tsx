// app/src/components/shipping/ShipmentsPanel.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  createShipment,
  listShipments,
  listShipmentEvents,
  updateShipmentStatus,
  type ShipmentStatus,
} from "../../lib/shipping";

/* ---------- types ---------- */
type Shipment = {
  id: string;
  artwork_id: string;
  owner_id: string | null;
  carrier: string | null;
  tracking_number: string | null;
  status: ShipmentStatus | null;
  note: string | null;
  eta_date: string | null;          // NEW (optional)
  ship_to?: any | null;             // JSON snapshot (optional)
  created_at: string;
  updated_at: string;
};

type Event = {
  id: string;
  code: string;
  message: string | null;
  created_at: string;
};

type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

/* ---------- helpers ---------- */

const STATUS_LABEL: Record<ShipmentStatus, string> = {
  with_creator: "With creator",
  handed_to_carrier: "Handed to carrier",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  failed: "Failed",
  returned: "Returned",
  unknown: "Unknown",
};

const STATUS_FLOW: ShipmentStatus[] = [
  "with_creator",
  "handed_to_carrier",
  "in_transit",
  "out_for_delivery",
  "delivered",
];

const CARRIERS = ["UPS", "FedEx", "DHL", "USPS", "Other"];

/** Allowed next transitions (soft-gated in UI, server can still enforce) */
const NEXT_STEPS: Record<ShipmentStatus, ShipmentStatus[]> = {
  with_creator: ["handed_to_carrier"],
  handed_to_carrier: ["in_transit"],
  in_transit: ["out_for_delivery", "delivered"],
  out_for_delivery: ["delivered"],
  delivered: [],
  failed: [],
  returned: [],
  unknown: ["with_creator", "handed_to_carrier", "in_transit", "out_for_delivery", "delivered", "failed", "returned"],
};

function SectionCard({
  title,
  children,
  right,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between">
          {title ? <h3 className="text-sm font-semibold">{title}</h3> : <div />}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1 text-sm">
      <div className="text-white/60">{label}</div>
      <div className="col-span-2">{value ?? "—"}</div>
    </div>
  );
}

/* ---------- component ---------- */

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

  // “Buyer” derived from most recent sale of this artwork (fallback: current owner)
  const [buyer, setBuyer] = useState<Profile | null>(null);

  // form state (for current/first shipment)
  const current: Shipment | undefined = rows[0];
  const [status, setStatus] = useState<ShipmentStatus>("with_creator");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [eta, setEta] = useState<string>("");
  const [note, setNote] = useState("");

  // bootstrap
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setUid(data.session?.user?.id ?? null);
      await reload();
      await loadBuyer();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artworkId]);

  // keep form in sync with selected shipment
  useEffect(() => {
    if (!current) return;
    setStatus((current.status ?? "unknown") as ShipmentStatus);
    setCarrier(current.carrier ?? "");
    setTracking(current.tracking_number ?? "");
    setEta(current.eta_date ?? "");
    setNote(current.note ?? "");
  }, [current?.id]);

  async function reload() {
    setMsg(null);
    try {
      const list = await listShipments(artworkId);
      setRows((list ?? []) as any);
      const all: Record<string, Event[]> = {};
      for (const s of list ?? []) {
        all[s.id] = (await listShipmentEvents(s.id)) as any;
      }
      setEvents(all);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load shipments.");
    }
  }

  async function loadBuyer() {
    // Try most recent sale buyer, fallback to current owner profile
    const [{ data: sale }] = await Promise.all([
      supabase
        .from("sales")
        .select("buyer_id")
        .eq("artwork_id", artworkId)
        .order("sold_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const buyerId = sale?.buyer_id;
    if (buyerId) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("id,username,display_name,avatar_url")
        .eq("id", buyerId)
        .maybeSingle();
      setBuyer((prof as any) ?? null);
    } else {
      // fallback to current owner of the artwork
      const { data: art } = await supabase
        .from("artworks")
        .select("owner_id")
        .eq("id", artworkId)
        .maybeSingle();
      if (art?.owner_id) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("id,username,display_name,avatar_url")
          .eq("id", art.owner_id)
          .maybeSingle();
        setBuyer((prof as any) ?? null);
      } else {
        setBuyer(null);
      }
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
        eta_date: eta || null,
      } as any);
      // reset form
      setNote("");
      await reload();
    } catch (e: any) {
      setMsg(e?.message || "Failed to create shipment.");
    } finally {
      setBusy(false);
    }
  }

  async function onUpdate() {
    if (!current) return;
    setBusy(true);
    setMsg(null);
    try {
      // 1) update status + create event (3-arg signature max)
      await updateShipmentStatus(current.id, status, note || undefined);

      // 2) update extra fields separately
      await supabase
        .from("shipments")
        .update({
          carrier: carrier || null,
          tracking_number: tracking || null,
          eta_date: eta || null,
          note: note || null,
        })
        .eq("id", current.id);

      await reload();
    } catch (e: any) {
      setMsg(e?.message || "Failed to update status.");
    } finally {
      setBusy(false);
    }
  }

  const statusOptions = useMemo(
    () =>
      STATUS_FLOW.concat(["failed", "returned", "unknown"] as ShipmentStatus[]).map((s) => ({
        key: s,
        label: STATUS_LABEL[s],
      })),
    []
  );

  return (
    <div className="space-y-4">
      {/* HEADER + CREATE */}
      <SectionCard
        title="Shipments"
        right={
          canEdit ? (
            <div className="flex gap-2">
              <input className="input w-32" placeholder="Carrier" value={carrier} onChange={(e)=>setCarrier(e.target.value)} />
              <input className="input w-40" placeholder="Tracking #" value={tracking} onChange={(e)=>setTracking(e.target.value)} />
              <input className="input w-40" type="date" placeholder="ETA" value={eta} onChange={(e)=>setEta(e.target.value)} />
              <input className="input w-48" placeholder="Note (optional)" value={note} onChange={(e)=>setNote(e.target.value)} />
              <button className="btn" onClick={onCreate} disabled={busy}>{busy ? "Saving…" : "Add shipment"}</button>
            </div>
          ) : null
        }
      >
        {msg && <div className="text-xs text-amber-300 mb-2">{msg}</div>}
        {rows.length === 0 ? (
          <div className="text-sm text-white/70">No shipments yet.</div>
        ) : null}
      </SectionCard>

      {/* WHEN WE HAVE A SHIPMENT, SHOW THE MANAGEMENT UI */}
      {current && (
        <div className="grid lg:grid-cols-12 gap-4">
          {/* LEFT: Update shipment status */}
          <div className="lg:col-span-7 space-y-4">
            <SectionCard title="Update Shipment Status">
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-white/60 mb-1">Shipment Status</div>
                  <select
                    className="input"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as ShipmentStatus)}
                  >
                    {statusOptions.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="text-xs text-white/60 mb-1">Shipping Carrier</div>
                  <select className="input" value={carrier} onChange={(e)=>setCarrier(e.target.value)}>
                    <option value=""></option>
                    {CARRIERS.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select>
                </div>

                <div>
                  <div className="text-xs text-white/60 mb-1">Tracking Number</div>
                  <input className="input" value={tracking} onChange={(e)=>setTracking(e.target.value)} placeholder="e.g. 1Z999..." />
                </div>

                <div>
                  <div className="text-xs text-white/60 mb-1">Estimated Delivery</div>
                  <input className="input" type="date" value={eta ?? ""} onChange={(e)=>setEta(e.target.value)} />
                </div>

                <div>
                  <div className="text-xs text-white/60 mb-1">Add Note (Optional)</div>
                  <textarea className="input min-h-[100px]" value={note} onChange={(e)=>setNote(e.target.value)} placeholder="Any relevant details…"/>
                </div>

                {canEdit && (
                  <div>
                    <button className="btn w-full" onClick={onUpdate} disabled={busy}>
                      {busy ? "Updating…" : "Update Shipment Status"}
                    </button>
                  </div>
                )}
              </div>
            </SectionCard>

            {/* Status history */}
            <SectionCard title="Status History">
              {((events[current.id] ?? []).length === 0) ? (
                <div className="text-sm text-white/70">No events yet.</div>
              ) : (
                <ul className="space-y-3">
                  {(events[current.id] ?? []).map((e) => (
                    <li key={e.id} className="p-3 rounded-xl bg-white/[0.04] border border-white/10">
                      <div className="text-sm font-medium">{e.code}</div>
                      {e.message && <div className="text-sm text-white/80">{e.message}</div>}
                      <div className="text-[11px] text-white/60 mt-1">{new Date(e.created_at).toLocaleString()}</div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          {/* RIGHT: Buyer / Address / Tracking summary */}
          <div className="lg:col-span-5 space-y-4">
            <SectionCard title="Buyer Information">
              {buyer ? (
                <div className="flex items-center gap-3">
                  {buyer.avatar_url ? (
                    <img src={buyer.avatar_url} className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-white/10" />
                  )}
                  <div className="text-sm">
                    <div className="font-medium">{buyer.display_name || buyer.username || "Buyer"}</div>
                    <div className="text-white/60 text-xs">User #{buyer.id.slice(0,6)}</div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-white/70">No buyer info yet.</div>
              )}
            </SectionCard>

            <SectionCard title="Shipping Address">
              {current.ship_to ? (
                <div className="text-sm">
                  <div className="font-medium">{current.ship_to.name}</div>
                  <div>{current.ship_to.line1}</div>
                  {current.ship_to.line2 ? <div>{current.ship_to.line2}</div> : null}
                  <div>
                    {current.ship_to.city}{current.ship_to.region ? `, ${current.ship_to.region}` : ""} {current.ship_to.postal_code}
                  </div>
                  <div>{current.ship_to.country}</div>
                  {(current.ship_to.email || current.ship_to.phone) && (
                    <div className="text-white/60 text-xs mt-1">
                      {current.ship_to.email ? `Email: ${current.ship_to.email}` : ""} {current.ship_to.phone ? `• Phone: ${current.ship_to.phone}` : ""}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-white/70">No address on file.</div>
              )}
            </SectionCard>

            <SectionCard title="Tracking Information">
              <Info label="Carrier" value={carrier || "—"} />
              <Info label="Tracking #" value={tracking || "—"} />
              <Info label="Estimated delivery" value={eta ? new Date(eta).toDateString() : "—"} />
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
}
