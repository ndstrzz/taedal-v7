// app/src/components/shipping/ShipmentsPanel.tsx
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type Shipment = {
  id: string;
  artwork_id: string;
  owner_id: string | null;
  carrier: string | null;
  tracking_number: string | null;
  status: "with_creator" | "in_transit" | "with_buyer" | "in_gallery" | "unknown" | null;
  note: string | null;
  created_at: string;
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
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // form (simple inline inputs)
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setUid(data.session?.user?.id ?? null);
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artworkId]);

  async function load() {
    setMsg(null);
    const { data, error } = await supabase
      .from("shipments")
      .select("id,artwork_id,owner_id,carrier,tracking_number,status,note,created_at")
      .eq("artwork_id", artworkId)
      .order("created_at", { ascending: false });
    if (error) {
      setMsg(error.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as Shipment[]);
  }

  async function addShipment() {
    if (!uid) {
      setMsg("Please sign in.");
      return;
    }
    if (!carrier && !tracking && !note) {
      setMsg("Add at least one field (carrier, tracking, or note).");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      // create shipment row
      const { data, error } = await supabase
        .from("shipments")
        .insert({
          artwork_id: artworkId,
          owner_id: uid,
          carrier: carrier || null,
          tracking_number: tracking || null,
          status: "in_transit",
          note: note || null,
        })
        .select("*")
        .single();
      if (error) throw error;

      // optionally reflect on the artwork’s physical_status
      await supabase
        .from("artworks")
        .update({ physical_status: "in_transit" })
        .eq("id", artworkId);

      // prepend in UI
      setRows((cur) => [data as Shipment, ...cur]);
      setCarrier("");
      setTracking("");
      setNote("");
    } catch (e: any) {
      setMsg(e?.message || "Failed to add shipment.");
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
            <button className="btn" onClick={addShipment} disabled={busy}>
              {busy ? "Saving…" : "Add shipment"}
            </button>
          </div>
        )}
      </div>

      {msg && <div className="text-xs text-amber-300 mb-2">{msg}</div>}

      {rows.length === 0 ? (
        <div className="text-sm text-white/70">No shipments yet.</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((s) => (
            <li
              key={s.id}
              className="p-3 rounded-xl bg-white/[0.04] border border-white/10 text-sm"
            >
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  <b>Status:</b> {s.status ?? "unknown"}
                </span>
                {s.carrier && <span><b>Carrier:</b> {s.carrier}</span>}
                {s.tracking_number && <span><b>Tracking:</b> {s.tracking_number}</span>}
                <span className="text-white/60">
                  {new Date(s.created_at).toLocaleString()}
                </span>
              </div>
              {s.note && <div className="text-white/80 mt-1">{s.note}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
