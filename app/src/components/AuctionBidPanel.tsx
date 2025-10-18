import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { placeBid, getHighestBid, subscribeToBids, endAuction } from "../lib/bids";

type HighestBid = { id: string; amount: number; bidder_id: string; created_at: string } | null;

export default function AuctionBidPanel({
  listingId,
  saleCurrency = "ETH",
  reservePrice,
  endsAt,
  isSeller = false,
}: {
  listingId: string;
  saleCurrency?: string;
  reservePrice?: number | null;
  endsAt?: string | null;
  isSeller?: boolean;
}) {
  const [highest, setHighest] = useState<HighestBid>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // load current highest bid
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const hb = await getHighestBid(listingId);
        if (!alive) return;
        setHighest(hb);
      } catch (e: any) {
        // non-fatal
        setMsg(e?.message ?? null);
      }
    })();

    // subscribe to live bid inserts
    const sub = subscribeToBids(listingId, (row) => {
      setHighest((cur) =>
        !cur || Number(row.amount) >= Number(cur.amount)
          ? (row as any)
          : cur
      );
    });

    return () => {
      alive = false;
      try { sub?.unsubscribe(); } catch {}
    };
  }, [listingId]);

  // next minimum = max(reserve, highest*1.05) rounded to 6 dp
  const nextMin = useMemo(() => {
    const base = Math.max(
      reservePrice ?? 0,
      highest ? Number(highest.amount) * 1.05 : 0
    );
    return Math.round(base * 1e6) / 1e6;
  }, [highest, reservePrice]);

  const ended = useMemo(
    () => (endsAt ? Date.now() >= new Date(endsAt).getTime() : false),
    [endsAt]
  );

  async function onBid() {
    setBusy(true);
    setMsg(null);
    try {
      const v = Number(amount);
      if (!isFinite(v) || v <= 0) throw new Error("Enter a valid amount.");
      if (v < nextMin) throw new Error(`Bid must be at least ${nextMin} ${saleCurrency}.`);
      const bid = await placeBid(listingId, v);
      setHighest((cur) => (!cur || v >= Number(cur.amount) ? (bid as any) : cur));
      setAmount("");
      setMsg("Bid placed ✅");
    } catch (e: any) {
      setMsg(e?.message ?? "Bid failed");
    } finally {
      setBusy(false);
    }
  }

  async function onEndAuction() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await endAuction(listingId);
      setMsg(res?.order_id ? "Auction settled ✅" : "Auction ended (no sale)");
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to end auction");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-white/70">Current bid</div>
        {typeof nextMin === "number" && !Number.isNaN(nextMin) && (
          <div className="text-[11px] text-white/60">
            Min next bid: <b>{nextMin}</b> {saleCurrency}
          </div>
        )}
      </div>

      <div className="text-2xl font-semibold">
        {highest ? (
          <>
            {Number(highest.amount)} {saleCurrency}
          </>
        ) : reservePrice ? (
          <>
            {reservePrice} {saleCurrency} <span className="text-sm text-white/60">(reserve)</span>
          </>
        ) : (
          <span className="text-white/60">—</span>
        )}
      </div>

      {!ended ? (
        <div className="flex gap-2">
          <input
            className="input w-44"
            placeholder={`${nextMin || 0}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number"
            step="0.000001"
            min="0"
          />
          <button className="btn" onClick={onBid} disabled={busy}>
            {busy ? "Placing…" : "Place bid"}
          </button>
        </div>
      ) : (
        <div className="text-sm text-amber-300">Auction ended</div>
      )}

      {isSeller && ended && (
        <button className="btn" onClick={onEndAuction} disabled={busy}>
          {busy ? "Ending…" : "End auction"}
        </button>
      )}

      {msg && <div className="text-xs text-neutral-300">{msg}</div>}
    </div>
  );
}

/* --- tiny helper if you ever need a one-off list fetch in this component --- */
export async function fetchBids(listingId: string, limit = 20) {
  const { data, error } = await supabase
    .from("bids")
    .select("id, amount, bidder_id, created_at")
    .eq("listing_id", listingId)
    .order("amount", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) }));
}
