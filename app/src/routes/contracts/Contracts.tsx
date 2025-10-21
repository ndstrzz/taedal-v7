// app/src/routes/contracts/Contracts.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import type { LicenseRequest, LicenseTerms } from "../../lib/licensing";

/* ----------------------------- types & helpers ---------------------------- */

type Row = LicenseRequest & {
  artworks?: { id: string; title: string | null; image_url: string | null } | null;
  requester?: { id: string; display_name: string | null; username: string | null; avatar_url: string | null } | null;
  owner?: { id: string; display_name: string | null; username: string | null; avatar_url: string | null } | null;
};

const nameOf = (p?: Row["owner"]) => p?.display_name || p?.username || (p?.id ? p.id.slice(0, 6) : "—");

function Avatar({ url, name }: { url?: string | null; name: string }) {
  return url ? (
    <img src={url} alt={name} className="h-7 w-7 rounded-full object-cover ring-1 ring-white/10" />
  ) : (
    <div className="h-7 w-7 rounded-full bg-white/10 grid place-items-center text-[11px]">
      {(name[0] || "•").toUpperCase()}
    </div>
  );
}

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "active" | "done" }) {
  const cls =
    tone === "active"
      ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
      : tone === "done"
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
      : "bg-white/10 text-white/80 border-white/10";
  return <span className={`px-2 py-1 rounded-full text-xs border ${cls}`}>{children}</span>;
}

function statusLabel(s: LicenseRequest["status"]) {
  if (s === "open") return { text: "Pending", tone: "neutral" as const };
  if (s === "negotiating") return { text: "Active", tone: "active" as const };
  if (s === "accepted") return { text: "Completed", tone: "done" as const };
  if (s === "declined" || s === "withdrawn") return { text: "Rejected", tone: "neutral" as const };
  return { text: s, tone: "neutral" as const };
}

/* ---------------------------------- row ---------------------------------- */

function RowCard({ r, me }: { r: Row; me: string }) {
  const other = r.owner_id === me ? r.requester : r.owner;
  const role = r.owner_id === me ? "Incoming" : "Outgoing";
  const terms = r.accepted_terms ?? (r.requested as LicenseTerms);
  const st = statusLabel(r.status);

  return (
    <Link
      to={`/contracts/${r.id}`}
      className="block rounded-2xl border border-white/10 bg-white/[0.04] hover:border-white/30 transition overflow-hidden"
    >
      <div className="flex gap-3 p-4 items-center">
        <div className="h-16 w-16 rounded-lg bg-neutral-900 overflow-hidden shrink-0">
          {r.artworks?.image_url ? (
            <img src={r.artworks.image_url} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full grid place-items-center text-white/40">—</div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-semibold truncate">{r.artworks?.title || "Untitled"}</div>
            <div className="ml-auto">
              <Pill tone={st.tone}>{st.text}</Pill>
            </div>
          </div>
          <div className="text-sm text-white/70 mt-1 truncate">
            {terms.purpose} — {terms.term_months}-month {terms.exclusivity} license
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm text-white/80">
            <div className="flex items-center gap-2">
              <Avatar url={r.requester?.avatar_url} name={nameOf(r.requester)} />
              <span className="truncate">{nameOf(r.requester)}</span>
            </div>
            <span className="text-white/40">→</span>
            <div className="flex items-center gap-2">
              <Avatar url={r.owner?.avatar_url} name={nameOf(r.owner)} />
              <span className="truncate">{nameOf(r.owner)}</span>
            </div>
            <span className="ml-auto text-right text-white">
              {terms.fee?.amount ? `${terms.fee.amount.toLocaleString()} ${terms.fee.currency}` : "—"}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

/* --------------------------------- page ---------------------------------- */

const TABS = [
  { key: "all", label: "All Contracts" },
  { key: "open", label: "Pending" },
  { key: "negotiating", label: "Active" },
  { key: "accepted", label: "Completed" },
  { key: "rejected", label: "Rejected" }, // derived: declined or withdrawn
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function Contracts() {
  const [me, setMe] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [tab, setTab] = useState<TabKey>("all");

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
    return () => {
      alive = false;
    };
  }, []);

  const counts = useMemo(() => {
    const c = { all: rows.length, open: 0, negotiating: 0, accepted: 0, rejected: 0 };
    rows.forEach((r) => {
      if (r.status === "open") c.open++;
      else if (r.status === "negotiating") c.negotiating++;
      else if (r.status === "accepted") c.accepted++;
      else if (r.status === "declined" || r.status === "withdrawn") c.rejected++;
    });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const qlc = q.trim().toLowerCase();
    return rows.filter((r) => {
      // tab filter
      if (tab === "open" && r.status !== "open") return false;
      if (tab === "negotiating" && r.status !== "negotiating") return false;
      if (tab === "accepted" && r.status !== "accepted") return false;
      if (tab === "rejected" && !(r.status === "declined" || r.status === "withdrawn")) return false;

      // search filter
      if (!qlc) return true;
      const terms = r.accepted_terms ?? (r.requested as LicenseTerms);
      const hay = [
        r.artworks?.title ?? "",
        nameOf(r.requester),
        nameOf(r.owner),
        terms.purpose ?? "",
        Array.isArray(terms.media) ? terms.media.join(", ") : "",
        Array.isArray(terms.territory) ? terms.territory.join(", ") : terms.territory ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(qlc);
    });
  }, [rows, tab, q]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold">Contract Requests</span>
          </div>
          <div className="text-white/60 text-sm">Manage IP licensing and usage negotiations</div>
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="mt-4 flex items-center gap-2">
        <div className="flex-1">
          <div className="relative">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search contracts, artists, buyers..."
              className="w-full input pl-9 h-11"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60">🔎</span>
          </div>
        </div>
        <button className="h-11 px-3 rounded-xl bg-white/10 border border-white/10 text-sm hover:bg-white/15">
          Filter
        </button>
      </div>

      {/* Tabs */}
      <div className="mt-3 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-full text-sm border ${
              tab === t.key ? "bg-white text-black border-white" : "bg-white/0 border-white/15 text-white/85 hover:bg-white/10"
            }`}
          >
            {t.label}
            <span className={`ml-2 text-xs ${tab === t.key ? "text-black/70" : "text-white/50"}`}>
              ({(counts as any)[t.key] ?? counts.rejected})
            </span>
          </button>
        ))}
      </div>

      {msg && <div className="mt-3 text-amber-300 text-sm">{msg}</div>}

      {/* List */}
      {loading ? (
        <div className="mt-6 grid gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-white/[0.05] border border-white/10 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-6 text-white/70">
          No license requests yet. Open an artwork and click <b>Request license</b>.
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {filtered.map((r) => me && <RowCard key={r.id} r={r} me={me} />)}
        </div>
      )}
    </div>
  );
}
