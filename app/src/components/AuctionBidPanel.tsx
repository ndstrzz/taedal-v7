// app/src/components/AuctionBidPanel.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  placeBid,
  fetchTopBid,
  subscribeBids,
  endAuction,
  fetchBidById,
  type Bid,
} from "../lib/bids";

function Countdown({ endAt, onElapsed }: { endAt: string; onElapsed?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const end = useMemo(() => new Date(endAt).getTime(), [endAt]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ms = Math.max(0, end - now);
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  useEffect(() => {
    if (ms === 0 && onElapsed) onElapsed();
  }, [ms, onElapsed]);

  const Box = ({ v, label }: { v: number; label: string }) => (
    <div className="px-2 py-1 rounded-md bg-white/10 border border-white/10 text-center">
      <div className="text-sm font-semibold tabular-nums">{v.toString().padStart(2, "0")}</div>
      <div className="text-[10px] text-white/70">{label}</div>
    </div>
  );

  return (
    <div className="flex gap-2 items-center">
      <Box v={d} label="DAYS" />
      <Box v={h} label="HOURS" />
      <Box v={m} label="MINUTES" />
      <Box v={sec} label="SECONDS" />
    </div>
  );
}

type Props = {
  listingId: string;
  saleCurrency: string; // e.g. "ETH"
  reservePrice?: number | null;
  endAt?: string | null;
  viewerId?: string | null;
  isSeller?: boolean;
};

export default function AuctionBidPanel({
  listingId,
  saleCurrency,
  reservePrice = null,
  endAt = null,
  viewerId = null,
  isSeller = false,
}: Props) {
  const [topBid, setTopBid] = useState<Bid | null>(null);
  const [bidInput, setBidInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const endedOnceRef = useRef(false);

  const MIN_INC_BPS = 500; // 5%

  const endedByTime = useMemo(() => {
    if (!endAt) return false;
    return Date.now() >= new Date(endAt).getTime();
  }, [endAt]);

  // initial load
  useEffect(() => {
    let alive = true;
    (async () => {
      const tb = await fetchTopBid(listingId);
      if (alive) setTopBid(tb);
    })();
    return () => {
      alive = false;
    };
  }, [listingId]);

  // realtime
  useEffect(() => {
    const off = subscribeBids(listingId, (b) => {
      setTopBid((cur) => (!cur || b.amount >= cur.amount ? b : cur));
    });
    return () => {
      try {
        off();
      } catch {}
    };
  }, [listingId]);

  // polling fallback (every 5s)
  useEffect(() => {
    let t: any;
    let alive = true;
    async function tick() {
      try {
        const tb = await fetchTopBid(listingId);
        if (alive) setTopBid(tb);
      } catch {}
    }
    tick();
    t = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [listingId]);

  const minNextBid = useMemo(() => {
    const base = topBid ? topBid.amount * (1 + MIN_INC_BPS / 10000) : 0;
    return Math.max(reservePrice ?? 0, base || (reservePrice ?? 0) || 0);
  }, [topBid, reservePrice]);

  const canBidNow = !!viewerId && !isSeller && !endedByTime;

  async function onPlaceBid() {
    setBusy(true);
    setMsg(null);
    try {
      if (endedByTime) throw new Error("Auction ended");
      const amt = Number(bidInput || 0);
      if (!isFinite(amt) || amt <= 0) throw new Error("Enter a valid amount");
      if (minNextBid && amt < minNextBid) throw new Error(`Bid must be ≥ ${minNextBid}`);

      const b = await placeBid(listingId, amt);
      setTopBid(b);
      setBidInput("");
      setMsg("Bid placed ✅");
    } catch (e: any) {
      setMsg(e?.message || "Bid failed");
    } finally {
      setBusy(false);
    }
  }

  async function finalizeIfNeeded() {
    if (!endAt) return;
    if (endedOnceRef.current) return;
    if (!endedByTime) return;

    endedOnceRef.current = true;
    try {
      const res = await endAuction(listingId);
      const winBid = res?.winning_bid_id ? await fetchBidById(res.winning_bid_id) : null;
      const finalAmt = winBid?.amount ?? topBid?.amount ?? null;

      if (finalAmt != null) setMsg(`Auction ended • Final: ${finalAmt} ${saleCurrency}`);
      else setMsg("Auction ended");
    } catch {
      setMsg("Auction ended");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <div className="text-neutral-400">Highest bid</div>
          <div className="text-lg font-semibold">
            {topBid ? `${topBid.amount} ${saleCurrency}` : "—"}
          </div>
          {reservePrice != null && (
            <div className="text-[11px] text-neutral-500">
              Reserve: {reservePrice} {saleCurrency}
              {!topBid || topBid.amount < (reservePrice ?? 0) ? " (not met)" : ""}
            </div>
          )}
        </div>

        {endAt ? (
          <Countdown
            endAt={endAt}
            onElapsed={() => {
              finalizeIfNeeded();
            }}
          />
        ) : null}
      </div>

      <div className="flex gap-2">
        {viewerId && !isSeller ? (
          <>
            <input
              className="input flex-1"
              type="number"
              min={minNextBid || 0}
              step="0.00000001"
              placeholder={minNextBid ? `≥ ${minNextBid}` : "Your bid"}
              value={bidInput}
              onChange={(e) => setBidInput(e.target.value)}
              disabled={!canBidNow || busy}
            />
            <button className="btn" onClick={onPlaceBid} disabled={!canBidNow || busy}>
              {endedByTime ? "Ended" : busy ? "Bidding…" : "Place bid"}
            </button>
          </>
        ) : (
          <div className="text-sm text-neutral-400">
            {isSeller ? "Sellers can’t bid on their own auction." : "Sign in to bid."}
          </div>
        )}
      </div>

      <div className="text-[11px] text-neutral-500">
        Min next bid: {minNextBid || "—"} {saleCurrency}
        {viewerId && topBid?.bidder_id === viewerId ? " • You’re winning" : ""}
      </div>

      {endAt && endedByTime ? (
        <div className="text-xs text-amber-300">Auction has ended.</div>
      ) : null}

      {msg && <div className="text-xs text-neutral-300">{msg}</div>}
    </div>
  );
}
