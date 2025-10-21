// app/src/routes/contracts/RequestDetail.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  getRequestWithThread,
  postLicenseMessage,
  updateLicenseRequest,
  type LicenseRequest,
  type LicenseThreadMsg,
} from "../../lib/licensing";

/* ----------------------------- types & utils ----------------------------- */

type Profile = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};
type Artwork = { id: string; title: string | null; image_url: string | null };

const nameOf = (p?: Profile | null) =>
  p?.display_name || p?.username || (p?.id ? p.id.slice(0, 6) : "—");

const timeShort = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });

/** Whether two messages should be visually grouped (same author within N min) */
const isGrouped = (a: LicenseThreadMsg | undefined, b: LicenseThreadMsg | undefined, mins = 6) =>
  !!a &&
  !!b &&
  a.author_id === b.author_id &&
  Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) < mins * 60 * 1000;

/* ----------------------------- avatar component ----------------------------- */

function Avatar({ url, name, me }: { url?: string | null; name: string; me?: boolean }) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        title={name}
        className={`h-8 w-8 rounded-full object-cover ring-1 ring-white/10 ${me ? "order-2" : ""}`}
      />
    );
  }
  // fallback initials
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      title={name}
      className={`h-8 w-8 rounded-full grid place-items-center bg-white/10 text-xs ${me ? "order-2" : ""}`}
    >
      {initials || "•"}
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export default function RequestDetail() {
  const { id } = useParams();
  const [me, setMe] = useState<string | null>(null);

  const [req, setReq] = useState<LicenseRequest | null>(null);
  const [msgs, setMsgs] = useState<LicenseThreadMsg[]>([]);
  const [art, setArt] = useState<Artwork | null>(null);
  const [requester, setRequester] = useState<Profile | null>(null);
  const [owner, setOwner] = useState<Profile | null>(null);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const iAmOwner = useMemo(() => me && req && req.owner_id === me, [me, req]);
  const iAmRequester = useMemo(() => me && req && req.requester_id === me, [me, req]);

  const profileMap = useMemo(() => {
    const map = new Map<string, Profile>();
    if (requester) map.set(requester.id, requester);
    if (owner) map.set(owner.id, owner);
    return map;
  }, [requester, owner]);

  /* ------------------------------- initial load ------------------------------- */

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

        const { request, messages } = await getRequestWithThread(id!);
        if (!alive) return;
        setReq(request);
        setMsgs(messages);

        const [a, rq, ow] = await Promise.all([
          supabase.from("artworks").select("id,title,image_url").eq("id", request.artwork_id).maybeSingle(),
          supabase.from("profiles").select("id,display_name,username,avatar_url").eq("id", request.requester_id).maybeSingle(),
          supabase.from("profiles").select("id,display_name,username,avatar_url").eq("id", request.owner_id).maybeSingle(),
        ]);

        if (!alive) return;
        setArt(a.data as any);
        setRequester(rq.data as any);
        setOwner(ow.data as any);
      } catch (e: any) {
        if (!alive) return;
        setMsg(e?.message || "Failed to load request.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  /* ------------------------------- live updates ------------------------------- */

  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`lr-${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "license_threads", filter: `request_id=eq.${id}` },
        (payload) => {
          setMsgs((cur) => [...cur, payload.new as unknown as LicenseThreadMsg]);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  /* --------------------------------- actions --------------------------------- */

  async function send() {
    if (!input.trim()) return;
    setBusy(true);
    try {
      const m = await postLicenseMessage(id!, input.trim());
      setMsgs((list) => [...list, m]);
      setInput("");
    } catch (e: any) {
      setMsg(e?.message || "Failed to post message.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(next: LicenseRequest["status"]) {
    if (!req) return;
    setBusy(true);
    setMsg(null);
    try {
      const updated = await updateLicenseRequest(req.id, { status: next });
      setReq(updated);
    } catch (e: any) {
      setMsg(e?.message || "Failed to update.");
    } finally {
      setBusy(false);
    }
  }

  /* ---------------------------------- UI ---------------------------------- */

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="h-7 w-40 bg-white/10 rounded mb-3 animate-pulse" />
        <div className="h-24 rounded-2xl bg-white/5 border border-white/10 animate-pulse" />
      </div>
    );
  }

  if (!req) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-amber-300">Request not found.</div>
        <Link to="/contracts" className="btn mt-4">
          Back to contracts
        </Link>
      </div>
    );
  }

  const terms = req.accepted_terms ?? req.requested;
  const otherParty = me && req.owner_id === me ? requester : owner;

  return (
    <div className="max-w-6xl mx-auto p-6 grid gap-4 lg:grid-cols-12">
      {msg && <div className="lg:col-span-12 text-amber-300 text-sm">{msg}</div>}

      {/* LEFT: summary / actions */}
      <div className="lg:col-span-5 space-y-3">
        {/* Header card */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-start gap-3">
            <div className="h-16 w-16 rounded-lg bg-neutral-900 overflow-hidden">
              {art?.image_url ? <img src={art.image_url} className="h-full w-full object-cover" /> : null}
            </div>
            <div className="min-w-0">
              <div className="text-sm text-white/60">Status</div>
              <div className="font-semibold">{req.status}</div>
              <div className="mt-1 text-sm">{art?.title || "Untitled"}</div>
              <div className="mt-2 text-xs text-white/60">
                Chat with <span className="text-white">{nameOf(otherParty)}</span>
              </div>
            </div>
          </div>

          {/* Terms */}
          <div className="mt-3 text-sm">
            <div>
              <span className="text-white/60">Purpose:</span> {terms.purpose}
            </div>
            <div>
              <span className="text-white/60">Term:</span> {terms.term_months} months
            </div>
            <div>
              <span className="text-white/60">Territory:</span>{" "}
              {Array.isArray(terms.territory) ? terms.territory.join(", ") : terms.territory}
            </div>
            <div>
              <span className="text-white/60">Media:</span> {terms.media.join(", ")}
            </div>
            <div>
              <span className="text-white/60">Exclusivity:</span> {terms.exclusivity}
            </div>
            <div>
              <span className="text-white/60">Fee:</span>{" "}
              {terms.fee?.amount ? `${terms.fee.amount} ${terms.fee.currency}` : "—"}
            </div>
            {terms.deliverables && (
              <div>
                <span className="text-white/60">Deliverables:</span> {terms.deliverables}
              </div>
            )}
            {terms.usage_notes && (
              <div>
                <span className="text-white/60">Notes:</span> {terms.usage_notes}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="mt-3 flex gap-2">
            {iAmOwner && (
              <>
                <button
                  className="btn"
                  disabled={busy || req.status === "accepted"}
                  onClick={() => setStatus("accepted")}
                >
                  Accept
                </button>
                <button
                  className="btn bg-white/0 border border-white/20 hover:bg-white/10"
                  disabled={busy}
                  onClick={() => setStatus("declined")}
                >
                  Decline
                </button>
              </>
            )}
            {iAmRequester && (
              <button
                className="btn bg-white/0 border border-white/20 hover:bg-white/10"
                disabled={busy || req.status === "withdrawn"}
                onClick={() => setStatus("withdrawn")}
              >
                Withdraw
              </button>
            )}
          </div>
        </div>

        {/* Participants */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="text-sm font-semibold mb-2">Participants</div>
          <div className="flex items-center gap-2 text-sm">
            <Avatar url={requester?.avatar_url || undefined} name={nameOf(requester)} />
            <div>
              <div className="text-white/60 leading-tight">Requester</div>
              <div className="leading-tight">{nameOf(requester)}</div>
            </div>
          </div>
          <div className="h-3" />
          <div className="flex items-center gap-2 text-sm">
            <Avatar url={owner?.avatar_url || undefined} name={nameOf(owner)} />
            <div>
              <div className="text-white/60 leading-tight">Owner</div>
              <div className="leading-tight">{nameOf(owner)}</div>
            </div>
          </div>
        </div>

        <Link to="/contracts" className="btn">Back to contracts</Link>
      </div>

      {/* RIGHT: “Instagram-like” thread */}
      <div className="lg:col-span-7 rounded-2xl border border-white/10 bg-white/[0.04] p-0 flex flex-col">
        {/* Chat header (sticky) */}
        <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3 sticky top-0 bg-white/[0.04] backdrop-blur z-10">
          <Avatar url={otherParty?.avatar_url || undefined} name={nameOf(otherParty)} />
          <div className="leading-tight">
            <div className="text-sm font-medium">{nameOf(otherParty)}</div>
            <div className="text-xs text-white/60">Negotiation thread</div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-auto px-3 py-4 space-y-1">
          {msgs.length === 0 ? (
            <div className="text-sm text-white/60 px-1">No messages yet.</div>
          ) : (
            msgs.map((m, i) => {
              const prev = msgs[i - 1];
              const showAvatar = !isGrouped(prev, m);
              const author = profileMap.get(m.author_id);
              const mine = m.author_id === me;

              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`flex items-end gap-2 max-w-[76%] ${mine ? "flex-row-reverse" : ""}`}>
                    {/* avatar */}
                    {showAvatar ? (
                      <Avatar url={(author?.avatar_url) || undefined} name={nameOf(author)} me={mine} />
                    ) : (
                      <div className="w-8" />
                    )}

                    {/* bubble */}
                    <div className={`rounded-2xl px-3 py-2 ${mine ? "bg-indigo-500 text-black" : "bg-white/10"} `}>
                      {/* name (only at start of group and for the other party) */}
                      {!mine && showAvatar && (
                        <div className="text-[11px] text-white/70 mb-0.5">{nameOf(author)}</div>
                      )}
                      <div className="whitespace-pre-wrap text-sm">{m.body}</div>
                      {/* timestamp (tiny, bottom-right) */}
                      <div className={`text-[10px] mt-1 ${mine ? "text-black/60 text-right" : "text-white/50"}`}>
                        {timeShort(m.created_at)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Composer */}
        <div className="p-3 border-t border-white/10 flex gap-2">
          <textarea
            className="flex-1 input min-h-[44px]"
            placeholder="Message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="btn shrink-0" onClick={send} disabled={busy || !input.trim()}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
