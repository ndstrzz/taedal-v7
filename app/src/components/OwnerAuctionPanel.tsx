// app/src/components/OwnerAuctionPanel.tsx
import { useState } from "react";
import { createAuctionListing } from "../lib/listings";

export default function OwnerAuctionPanel({
  artworkId,
  onUpdated,
}: {
  artworkId: string;
  onUpdated: () => Promise<void> | void;
}) {
  const [reserve, setReserve] = useState<string>("");
  const [duration, setDuration] = useState<string>("60"); // minutes
  const [currency, setCurrency] = useState<string>("ETH");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onCreate() {
    setBusy(true);
    setMsg(null);
    try {
      const r = Number(reserve || 0);
      const mins = Math.max(5, Math.floor(Number(duration || 0)));
      if (!isFinite(r) || r < 0) throw new Error("Enter a valid reserve (≥ 0)");
      if (!isFinite(mins) || mins < 5) throw new Error("Duration must be ≥ 5 minutes");
      await createAuctionListing(artworkId, r, mins, currency);
      setMsg("Auction is live ✅");
      await onUpdated();
      setReserve("");
      setDuration("60");
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to create auction");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-2">
      <div className="text-sm font-medium">Start an auction</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-white/70">
          Reserve (optional)
          <input
            className="input mt-1"
            placeholder="0.1"
            value={reserve}
            onChange={(e) => setReserve(e.target.value)}
            type="number"
            step="0.00000001"
            min="0"
          />
        </label>
        <label className="text-xs text-white/70">
          Duration (minutes)
          <input
            className="input mt-1"
            placeholder="60"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            type="number"
            min={5}
            step={5}
          />
        </label>
      </div>

      <div className="flex gap-2 items-center">
        <select
          className="input w-28"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          <option value="ETH">ETH</option>
        </select>

        <button className="btn" onClick={onCreate} disabled={busy}>
          {busy ? "Creating…" : "Create auction"}
        </button>
      </div>

      {msg && <div className="text-xs text-neutral-300">{msg}</div>}
      <div className="text-[11px] text-neutral-500">
        (Ends any existing active listing for this artwork, then starts an auction.)
      </div>
    </div>
  );
}
