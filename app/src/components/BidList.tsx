// app/src/components/BidList.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { type Bid, subscribeBids } from "../lib/bids";

type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export default function BidList({ listingId }: { listingId: string }) {
  const [bids, setBids] = useState<Bid[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [loading, setLoading] = useState(true);

  // initial load
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("bids")
          .select("id, listing_id, bidder_id, amount, created_at")
          .eq("listing_id", listingId)
          .order("amount", { ascending: false })
          .limit(50);
        if (error) throw error;
        if (!alive) return;
        setBids(data ?? []);

        // fetch involved bidder profiles
        const ids = Array.from(new Set((data ?? []).map(b => b.bidder_id)));
        if (ids.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id, username, display_name, avatar_url")
            .in("id", ids);
          const map = new Map<string, Profile>();
          (profs ?? []).forEach((p: any) => map.set(p.id, p as Profile));
          if (alive) setProfiles(map);
        }
      } catch {
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [listingId]);

  // realtime subscribe (top up / new inserts)
  useEffect(() => {
    const off = subscribeBids(listingId, (b) => {
      setBids((cur) => {
        const next = [...cur, b]
          .sort((a, z) => z.amount - a.amount)
          .slice(0, 50);
        return next;
      });
    });
    return () => { try { off(); } catch {} };
  }, [listingId]);

  const rows = useMemo(() => bids.sort((a,z)=>z.amount-a.amount), [bids]);

  if (loading) return <div className="text-sm text-neutral-400">Loading bids…</div>;
  if (rows.length === 0) return <div className="text-sm text-neutral-400">No bids yet.</div>;

  return (
    <ul className="space-y-2">
      {rows.map((b) => {
        const p = profiles.get(b.bidder_id);
        const who =
          p?.display_name || p?.username || (p ? p.id.slice(0,6) : "Bidder");
        const href = p
          ? p.username ? `/u/${p.username}` : `/u/${p.id}`
          : "#";
        return (
          <li key={b.id} className="p-3 rounded-lg bg-white/5 border border-white/10 flex items-center gap-3">
            {p?.avatar_url ? (
              <img src={p.avatar_url} className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-white/10" />
            )}
            <div className="flex-1">
              <div className="text-sm">
                <span className="font-medium">{b.amount}</span> <span className="text-white/70">ETH</span>
              </div>
              <div className="text-xs text-white/70">
                by <a className="underline" href={href}>{who}</a> •{" "}
                {new Date(b.created_at).toLocaleString()}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
