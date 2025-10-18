import { useState } from "react";
import { supabase } from "../lib/supabase";
import CurrencyPicker from "./CurrencyPicker";

type Props = {
  artworkId: string;
  onCreated: () => Promise<void> | void;
};

export default function OwnerAuctionPanel({ artworkId, onCreated }: Props) {
  const [reserve, setReserve] = useState<string>("0.1");
  const [minutes, setMinutes] = useState<string>("60");
  const [currency, setCurrency] = useState<string>("ETH");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCreate() {
    setBusy(true);
    setMsg(null);
    try {
      const reserveNum = reserve ? Number(reserve) : null;
      const minsNum = Number(minutes || 0);
      if (!isFinite(minsNum) || minsNum <= 0)
        throw new Error("Enter a valid duration in minutes.");

      const { error } = await supabase.rpc("create_auction_listing", {
        p_artwork_id: artworkId,
        p_currency: currency,
        p_reserve_price: reserveNum,
        p_duration_minutes: Math.round(minsNum),
      });

      if (error) throw error;
      setMsg("Auction created ✅");
      await onCreated();
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to create auction");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4">
      <h3 className="font-semibold">Start an auction</h3>

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-white/70 mb-1">Reserve (optional)</div>
          <input
            className="input w-full"
            placeholder="0.00"
            value={reserve}
            onChange={(e) => setReserve(e.target.value)}
            type="number"
            step="0.00000001"
            min="0"
          />
        </div>

        <div>
          <div className="text-xs text-white/70 mb-1">Duration (minutes)</div>
          <input
            className="input w-full"
            placeholder="60"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            type="number"
            min="1"
          />
        </div>
      </div>

      <CurrencyPicker
        value={currency}
        onChange={setCurrency}
        label="Currency"
      />

      <div className="flex items-center gap-3">
        <button className="btn" onClick={onCreate} disabled={busy}>
          {busy ? "Creating…" : "Create auction"}
        </button>
        {msg && <div className="text-sm text-amber-300">{msg}</div>}
      </div>

      <div className="text-[11px] text-white/60">
        (Ends any existing active listing for this artwork, then starts an
        auction.)
      </div>
    </div>
  );
}
