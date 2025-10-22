import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { apiListShipments, apiUpsertShipment, type Shipment } from "../../lib/api";

export default function ShipmentsPanel({ artworkId, canEdit }: { artworkId: string; canEdit: boolean }) {
  const [rows, setRows] = useState<Shipment[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token!;
    const res = await apiListShipments(artworkId, token);
    setRows(res.shipments || []);
  }

  useEffect(() => {
    load().catch(() => {});
  }, [artworkId]);

  async function createOrUpdate() {
    const carrier = prompt("Carrier (e.g. DHL, UPS) — leave blank if manual") || "";
    const tracking_no = prompt("Tracking number (optional)") || "";
    const status =
      prompt(
        "Status: label_created | in_transit | out_for_delivery | delivered | exception | canceled"
      ) || "label_created";
    setBusy(true);
    setMsg(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token!;
      await apiUpsertShipment(
        { artwork_id: artworkId, carrier: carrier || null, tracking_no: tracking_no || null, status },
        token
      );
      await load();
      setMsg("Saved ✓");
    } catch (e: any) {
      setMsg(e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  const latest = rows[0];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Shipments</h3>
        {canEdit && (
          <button
            className="px-3 py-1.5 rounded-lg text-sm bg-white text-black hover:bg-white/90"
            onClick={createOrUpdate}
            disabled={busy}
          >
            {busy ? "Saving…" : rows.length ? "Update" : "Add shipment"}
          </button>
        )}
      </div>

      {!rows.length ? (
        <div className="text-sm text-white/70">No shipments yet.</div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm">
            <div>
              Status: <b>{latest.status}</b>
            </div>
            {latest.carrier || latest.tracking_no ? (
              <div className="text-white/70">
                {latest.carrier ?? "Manual"}
                {latest.tracking_no ? ` • ${latest.tracking_no}` : ""}
              </div>
            ) : null}
            {latest.eta ? (
              <div className="text-white/70">ETA: {new Date(latest.eta).toLocaleString()}</div>
            ) : null}
          </div>

          {(latest.legs || []).length > 0 && (
            <ul className="text-sm space-y-2">
              {latest.legs!.map((l: any, i: number) => (
                <li key={i} className="p-2 rounded-lg bg-white/[0.03] border border-white/10">
                  <div className="text-white/80">{l.note || "Update"}</div>
                  <div className="text-[11px] text-white/60">
                    {l.location || "—"} • {l.time ? new Date(l.time).toLocaleString() : "—"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {msg && <div className="text-xs text-neutral-200 mt-2">{msg}</div>}
    </div>
  );
}
