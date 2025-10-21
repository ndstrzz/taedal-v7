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

type Profile = { id: string; display_name: string | null; username: string | null; avatar_url: string | null };
type Artwork = { id: string; title: string | null; image_url: string | null };

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
    return () => { alive = false; };
  }, [id]);

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
        <Link to="/contracts" className="btn mt-4">Back to contracts</Link>
      </div>
    );
  }

  const terms = req.accepted_terms ?? req.requested;

  return (
    <div className="max-w-5xl mx-auto p-6 grid gap-4 lg:grid-cols-12">
      {msg && <div className="lg:col-span-12 text-amber-300 text-sm">{msg}</div>}

      {/* Summary */}
      <div className="lg:col-span-5 space-y-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-start gap-3">
            <div className="h-16 w-16 rounded-lg bg-neutral-900 overflow-hidden">
              {art?.image_url ? <img src={art.image_url} className="h-full w-full object-cover" /> : null}
            </div>
            <div className="min-w-0">
              <div className="text-sm text-white/60">Status</div>
              <div className="font-semibold">{req.status}</div>
              <div className="mt-1 text-sm">{art?.title || "Untitled"}</div>
            </div>
          </div>

          <div className="mt-3 text-sm">
            <div><span className="text-white/60">Purpose:</span> {terms.purpose}</div>
            <div><span className="text-white/60">Term:</span> {terms.term_months} months</div>
            <div><span className="text-white/60">Territory:</span> {Array.isArray(terms.territory) ? terms.territory.join(", ") : terms.territory}</div>
            <div><span className="text-white/60">Media:</span> {terms.media.join(", ")}</div>
            <div><span className="text-white/60">Exclusivity:</span> {terms.exclusivity}</div>
            <div><span className="text-white/60">Fee:</span> {terms.fee?.amount ? `${terms.fee.amount} ${terms.fee.currency}` : "—"}</div>
            {terms.deliverables && <div><span className="text-white/60">Deliverables:</span> {terms.deliverables}</div>}
            {terms.usage_notes && <div><span className="text-white/60">Notes:</span> {terms.usage_notes}</div>}
          </div>

          {/* Actions */}
          <div className="mt-3 flex gap-2">
            {iAmOwner && (
              <>
                <button className="btn" disabled={busy || req.status === "accepted"} onClick={() => setStatus("accepted")}>
                  Accept
                </button>
                <button className="btn bg-white/0 border border-white/20 hover:bg-white/10" disabled={busy} onClick={() => setStatus("declined")}>
                  Decline
                </button>
              </>
            )}
            {iAmRequester && (
              <button className="btn bg-white/0 border border-white/20 hover:bg-white/10" disabled={busy || req.status === "withdrawn"} onClick={() => setStatus("withdrawn")}>
                Withdraw
              </button>
            )}
          </div>
        </div>

        {/* Parties */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="text-sm font-semibold mb-2">Participants</div>
          <div className="text-sm">
            <div className="text-white/60">Requester</div>
            <div>{requester?.display_name || requester?.username || requester?.id}</div>
          </div>
          <div className="mt-2 text-sm">
            <div className="text-white/60">Owner</div>
            <div>{owner?.display_name || owner?.username || owner?.id}</div>
          </div>
        </div>
      </div>

      {/* Thread */}
      <div className="lg:col-span-7 rounded-2xl border border-white/10 bg-white/[0.04] p-4 flex flex-col">
        <div className="text-sm font-semibold mb-2">Negotiation thread</div>
        <div className="flex-1 space-y-3 overflow-auto pr-1">
          {msgs.length === 0 ? (
            <div className="text-sm text-white/60">No messages yet.</div>
          ) : (
            msgs.map((m) => (
              <div key={m.id} className={`p-2 rounded-lg ${m.author_id === me ? "bg-white/10" : "bg-white/5"}`}>
                <div className="text-xs text-white/60">{new Date(m.created_at).toLocaleString()}</div>
                <div className="whitespace-pre-wrap">{m.body}</div>
              </div>
            ))
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <textarea
            className="flex-1 input min-h-[44px]"
            placeholder="Write a message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="btn shrink-0" onClick={send} disabled={busy || !input.trim()}>
            Send
          </button>
        </div>
      </div>

      <div className="lg:col-span-12">
        <Link to="/contracts" className="btn">Back to contracts</Link>
      </div>
    </div>
  );
}
