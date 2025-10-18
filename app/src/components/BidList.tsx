import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { subscribeToBids } from "../lib/bids";

type Row = { id: string; amount: number; bidder_id: string; created_at: string };

export default function BidList({ listingId }: { listingId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("bids")
          .select("id, amount, bidder_id, created_at")
          .eq("listing_id", listingId)
          .order("amount", { ascending: false })
          .limit(20);
        if (error) throw error;
        if (!alive) return;
        setRows((data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) })));
      } catch (e: any) {
        setMsg(e?.message ?? "Failed to load bids");
      }
    })();

    const sub = subscribeToBids(listingId, (row) => {
      setRows((cur) => {
        const next = [row as any, ...cur];
        next.sort((a, b) => Number(b.amount) - Number(a.amount));
        return next.slice(0, 20);
      });
    });

    return () => {
      alive = false;
      try { sub?.unsubscribe(); } catch {}
    };
  }, [listingId]);

  if (rows.length === 0) {
    return <div className="text-sm text-neutral-400">No bids yet.</div>;
  }

  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between p-2 rounded-md bg-white/5 border border-white/10">
          <div className="text-sm font-medium">{r.amount}</div>
          <div className="text-xs text-white/60">
            {new Date(r.created_at).toLocaleString()}
          </div>
        </li>
      ))}
      {msg && <div className="text-xs text-rose-400">{msg}</div>}
    </ul>
  );
}
