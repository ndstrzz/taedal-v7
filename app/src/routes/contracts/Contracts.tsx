// app/src/routes/contracts/Contracts.tsx
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import type { LicenseRequest, LicenseTerms } from "../../lib/licensing";

type Row = LicenseRequest & {
  artworks?: { id: string; title: string | null; image_url: string | null } | null;
  requester?: { id: string; display_name: string | null; username: string | null; avatar_url: string | null } | null;
  owner?: { id: string; display_name: string | null; username: string | null; avatar_url: string | null } | null;
};

function RowCard({ r, me }: { r: Row; me: string }) {
  const otherParty = r.owner_id === me ? r.requester : r.owner;
  const role = r.owner_id === me ? "Incoming" : "Outgoing";
  const terms = r.accepted_terms ?? (r.requested as LicenseTerms);

  return (
    <Link
      to={`/contracts/${r.id}`}
      className="block rounded-2xl border border-white/10 bg-white/[0.04] hover:border-white/30 transition overflow-hidden"
    >
      <div className="flex gap-3 p-3">
        <div className="h-16 w-16 rounded-lg bg-neutral-900 overflow-hidden shrink-0">
          {r.artworks?.image_url ? (
            <img src={r.artworks.image_url} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full grid place-items-center text-white/40">—</div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10">{role}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10">{r.status}</span>
          </div>
          <div className="mt-1 font-medium truncate">
            {r.artworks?.title || "Untitled"} • {terms.purpose}
          </div>
          <div className="text-sm text-white/70 truncate">
            {Array.isArray(terms.territory) ? terms.territory.join(", ") : terms.territory} • {terms.term_months} mo
          </div>
        </div>

        <div className="w-36 text-right text-sm">
          <div className="text-white">{terms.fee?.amount ? `${terms.fee.amount} ${terms.fee.currency}` : "—"}</div>
          <div className="text-white/60 truncate">
            {otherParty
              ? otherParty.display_name || otherParty.username || otherParty.id.slice(0, 6)
              : "—"}
          </div>
          <div className="text-white/40 text-xs">{new Date(r.updated_at).toLocaleString()}</div>
        </div>
      </div>
    </Link>
  );
}

export default function Contracts() {
  const [me, setMe] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setMsg(null);
      try {
        const { data: sess } = await supabase.auth.getSession();
        const uid = sess.session?.user?.id;
        if (!uid) throw new Error("Please sign in.");
        if (!alive) return;
        setMe(uid);

        // pull requests where I'm requester or owner
        const { data, error } = await supabase
          .from("license_requests")
          .select(`
            *,
            artworks:artworks(id,title,image_url),
            requester:profiles!license_requests_requester_id_fkey(id,display_name,username,avatar_url),
            owner:profiles!license_requests_owner_id_fkey(id,display_name,username,avatar_url)
          `)
          .or(`requester_id.eq.${uid},owner_id.eq.${uid}`)
          .order("updated_at", { ascending: false });

        if (error) throw error;
        if (!alive) return;
        setRows((data as unknown as Row[]) ?? []);
      } catch (e: any) {
        if (!alive) return;
        setMsg(e?.message || "Failed to load contracts.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contracts</h1>
        <div className="text-sm text-white/60">Requests you’ve sent or received</div>
      </div>

      {msg && <div className="mt-3 text-amber-300 text-sm">{msg}</div>}

      {loading ? (
        <div className="mt-6 grid gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-white/[0.05] border border-white/10 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6 text-white/70">
          No license requests yet. Open an artwork and click <b>Request license</b>.
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {rows.map((r) => <RowCard key={r.id} r={r} me={me!} />)}
        </div>
      )}
    </div>
  );
}
