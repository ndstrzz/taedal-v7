// app/src/routes/contracts/RequestDetail.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  getRequestWithThread,
  postLicenseMessage,
  acceptPatch,
  acceptOffer,
  updateLicenseRequest,
  diffTerms,
  mergeTerms,
  LICENSE_TEMPLATES,
  listApprovals,
  upsertApproval,
  type LicenseRequest,
  type LicenseThreadMsg,
  type LicenseTerms,
  stringifyTerritory,
  asArrayTerritory,
} from "../../lib/licensing";

/* ----------------------------- local helpers ---------------------------- */

type Profile = { id: string; display_name: string | null; username: string | null; avatar_url: string | null };
type Artwork = { id: string; title: string | null; image_url: string | null };

const nameOf = (p?: Profile | null) => p?.display_name || p?.username || (p?.id ? p.id.slice(0, 6) : "—");

function Avatar({ url, name, size = 28 }: { url?: string | null; name: string; size?: number }) {
  const cls = `rounded-full object-cover ring-1 ring-white/10`;
  return url ? (
    <img src={url} alt={name} title={name} className={cls} style={{ width: size, height: size }} />
  ) : (
    <div
      title={name}
      className="grid place-items-center bg-white/10 ring-1 ring-white/10"
      style={{ width: size, height: size, borderRadius: size / 2, fontSize: Math.max(10, size / 3) }}
    >
      {(name[0] || "•").toUpperCase()}
    </div>
  );
}

const FieldRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-start gap-2 text-sm">
    <div className="text-white/60 w-28 shrink-0">{label}</div>
    <div className="flex-1">{children}</div>
  </div>
);

const formatMoney = (t?: LicenseTerms["fee"]) => (t?.amount != null ? `${t.amount.toLocaleString()} ${t.currency}` : "—");

const sameAuthorRecent = (a: LicenseThreadMsg | undefined, b: LicenseThreadMsg | undefined, mins = 6) =>
  !!a &&
  !!b &&
  a.author_id === b.author_id &&
  Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) < mins * 60 * 1000;

/* ---------------------------------- page ---------------------------------- */

export default function RequestDetail() {
  const { id } = useParams();
  const nav = useNavigate();

  const [me, setMe] = useState<string | null>(null);
  const [req, setReq] = useState<LicenseRequest | null>(null);
  const [msgs, setMsgs] = useState<LicenseThreadMsg[]>([]);
  const [art, setArt] = useState<Artwork | null>(null);
  const [requester, setRequester] = useState<Profile | null>(null);
  const [owner, setOwner] = useState<Profile | null>(null);
  const [approvals, setApprovals] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  // Edit-side panel local working patch (not immediately applied)
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<LicenseTerms>>({});

  // Quick counter chips
  const chips = [
    { label: "+6 months", patch: { term_months: (req?.requested.term_months ?? 0) + 6 } },
    { label: "US+CA", patch: { territory: ["US", "CA"] } },
    { label: "Non-exclusive", patch: { exclusivity: "non-exclusive" as const } },
    { label: "+$300", patch: { fee: { amount: ((req?.requested.fee?.amount ?? 0) + 300), currency: (req?.requested.fee?.currency ?? "USD") } } },
  ];

  const iAmOwner = useMemo(() => me && req && req.owner_id === me, [me, req]);
  const iAmRequester = useMemo(() => me && req && req.requester_id === me, [me, req]);
  const profileOf = (id: string | undefined) =>
    id === requester?.id ? requester : id === owner?.id ? owner : null;

  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length]);

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

        const [a, rq, ow, app] = await Promise.all([
          supabase.from("artworks").select("id,title,image_url").eq("id", request.artwork_id).maybeSingle(),
          supabase.from("profiles").select("id,display_name,username,avatar_url").eq("id", request.requester_id).maybeSingle(),
          supabase.from("profiles").select("id,display_name,username,avatar_url").eq("id", request.owner_id).maybeSingle(),
          listApprovals(request.id),
        ]);

        if (!alive) return;
        setArt(a.data as any);
        setRequester(rq.data as any);
        setOwner(ow.data as any);
        setApprovals(app);
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

  // Realtime thread
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`lr-${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "license_threads", filter: `request_id=eq.${id}` },
        (payload) => setMsgs((cur) => [...cur, payload.new as unknown as LicenseThreadMsg])
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  async function send(body: string, patch?: Partial<LicenseTerms> | null) {
    if (!body.trim() && !patch) return;
    setBusy(true);
    try {
      const m = await postLicenseMessage(id!, body.trim(), patch ?? null);
      setMsgs((list) => [...list, m]);
      setInput("");
    } catch (e: any) {
      setMsg(e?.message || "Failed to post message.");
    } finally {
      setBusy(false);
    }
  }

  async function onAcceptPatch(patch: Partial<LicenseTerms>, echo = true) {
    setBusy(true);
    try {
      const updated = await acceptPatch(id!, patch);
      setReq(updated);
      if (echo) {
        await postLicenseMessage(id!, "Accepted changes.", null);
      }
    } catch (e: any) {
      setMsg(e?.message || "Failed to apply changes.");
    } finally {
      setBusy(false);
    }
  }

  async function onAcceptOffer() {
    setBusy(true);
    try {
      const updated = await acceptOffer(id!);
      setReq(updated);
      await postLicenseMessage(id!, "Offer accepted. Contract finalized.", null);
    } catch (e: any) {
      setMsg(e?.message || "Failed to accept offer.");
    } finally {
      setBusy(false);
    }
  }

  async function onWithdrawOrDecline(kind: "withdrawn" | "declined") {
    setBusy(true);
    try {
      const updated = await updateLicenseRequest(id!, { status: kind });
      setReq(updated);
      await postLicenseMessage(id!, kind === "withdrawn" ? "Request withdrawn." : "Offer declined.", null);
    } catch (e: any) {
      setMsg(e?.message || "Failed to update.");
    } finally {
      setBusy(false);
    }
  }

  async function onDecision(stage: "legal" | "finance" | "brand", decision: "pending" | "approved" | "rejected") {
    try {
      const row = await upsertApproval({ request_id: id!, stage, decision });
      setApprovals((prev) => [...prev, row]);
    } catch (e: any) {
      setMsg(e?.message || "Approval failed.");
    }
  }

  if (loading || !req) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="h-7 w-40 bg-white/10 rounded mb-3 animate-pulse" />
        <div className="h-24 rounded-2xl bg-white/5 border border-white/10 animate-pulse" />
      </div>
    );
  }

  const working = req.requested; // the current working terms
  const start = working.start_date ? new Date(working.start_date) : null;
  const end =
    start && Number.isFinite(working.term_months)
      ? new Date(start.getTime() + working.term_months * 30 * 24 * 60 * 60 * 1000)
      : null;

  /* ------------------------------ UI building ------------------------------ */

  function startDraftFromCurrent() {
    setDraft({
      purpose: working.purpose,
      term_months: working.term_months,
      territory: working.territory,
      media: [...working.media],
      exclusivity: working.exclusivity,
      start_date: working.start_date,
      deliverables: working.deliverables,
      credit_required: working.credit_required,
      usage_notes: working.usage_notes,
      fee: working.fee ? { ...working.fee } : undefined,
      sublicense: working.sublicense,
      derivative_edits: working.derivative_edits ? [...working.derivative_edits] : undefined
    });
    setEditOpen(true);
  }

  function patchFromDraft(): Partial<LicenseTerms> {
    const base = working;
    const next = mergeTerms(base, draft);
    const differences = diffTerms(base, next);
    const patch: any = {};
    differences.forEach(d => (patch[d.key] = d.after));
    return patch;
  }

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="fixed inset-0 z-[60]">
      {/* dimmer */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => nav("/contracts")} />

      {/* dialog */}
      <div className="absolute inset-0 m-auto max-w-[1100px] w-[96vw] max-h-[92vh] rounded-2xl border border-white/15 bg-neutral-950 shadow-2xl overflow-hidden">
        {/* header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-white/[0.03]">
          <div className="h-10 w-10 rounded-lg overflow-hidden bg-neutral-900">
            {art?.image_url ? <img src={art.image_url} className="h-full w-full object-cover" /> : null}
          </div>
          <div className="min-w-0">
            <div className="font-semibold truncate">{art?.title || "Untitled"}</div>
            <div className="text-sm text-white/70 truncate">{working.purpose}, {working.term_months}-month {working.exclusivity} license</div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Avatar url={requester?.avatar_url} name={nameOf(requester)} />
              <span className="text-sm">{nameOf(requester)}</span>
              <span className="text-white/40">↔</span>
              <Avatar url={owner?.avatar_url} name={nameOf(owner)} />
              <span className="text-sm">{nameOf(owner)}</span>
            </div>
            <button className="h-8 w-8 grid place-items-center rounded-lg hover:bg-white/10" onClick={() => nav("/contracts")}>✕</button>
          </div>
        </div>

        {/* body */}
        <div className="grid grid-cols-1 md:grid-cols-[380px_minmax(0,1fr)] gap-0 h-[calc(92vh-60px)]">
          {/* LEFT: details / actions / approvals */}
          <div className="overflow-y-auto p-4 space-y-3 border-r border-white/10">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 space-y-2">
              <div className="text-sm font-semibold mb-2">Contract Details</div>

              <FieldRow label="Purpose">{working.purpose}</FieldRow>
              <FieldRow label="Term">
                {working.term_months} months {start ? `(${start.toLocaleDateString()} – ${end ? end.toLocaleDateString() : "?"})` : ""}
              </FieldRow>
              <FieldRow label="Territory">{stringifyTerritory(working.territory)}</FieldRow>
              <FieldRow label="Media">{working.media.join(", ")}</FieldRow>
              <FieldRow label="Exclusivity">{working.exclusivity}</FieldRow>
              <FieldRow label="Fee">{formatMoney(working.fee)}</FieldRow>
              {working.deliverables && <FieldRow label="Deliverables">{working.deliverables}</FieldRow>}
              {working.usage_notes && <FieldRow label="Notes">{working.usage_notes}</FieldRow>}

              <div className="mt-2 flex gap-2">
                <button className="btn" onClick={startDraftFromCurrent}>Edit terms</button>
                {iAmOwner && (
                  <button className="btn bg-white/0 border border-white/20 hover:bg-white/10" onClick={() => onAcceptOffer()} disabled={busy || req.status === "accepted"}>
                    Accept Offer
                  </button>
                )}
              </div>
              <div className="text-[12px] text-white/60">
                Status: <span className="capitalize">{req.status}</span>
              </div>
            </div>

            {/* Quick chips */}
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <div className="text-sm font-semibold mb-2">Quick counters</div>
              <div className="flex flex-wrap gap-2">
                {chips.map((c) => (
                  <button
                    key={c.label}
                    className="px-3 py-1.5 rounded-full text-sm bg-white/0 border border-white/20 hover:bg-white/10"
                    onClick={() => send(c.label, c.patch)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Approvals */}
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <div className="text-sm font-semibold mb-2">Approvals</div>
              <div className="space-y-1 text-sm">
                {["legal","finance","brand"].map((stage) => {
                  const rows = approvals.filter((a) => a.stage === stage);
                  const last = rows[rows.length - 1];
                  return (
                    <div key={stage} className="flex items-center justify-between">
                      <div className="text-white/80 capitalize">{stage}</div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs border ${
                          last?.decision === "approved" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                          : last?.decision === "rejected" ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
                          : "bg-white/10 text-white/80 border-white/10"
                        }`}>
                          {last?.decision ?? "pending"}
                        </span>
                        {/* Anyone can demo-approve; add real role gates later */}
                        <button className="text-xs px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20" onClick={() => onDecision(stage as any, "approved")}>Approve</button>
                        <button className="text-xs px-2 py-1 rounded-lg bg-white/0 border border-white/15 hover:bg-white/10" onClick={() => onDecision(stage as any, "rejected")}>Reject</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Withdraw / Decline */}
            <div className="flex gap-2">
              {iAmRequester && (
                <button className="btn bg-white/0 border border-white/20 hover:bg-white/10" onClick={() => onWithdrawOrDecline("withdrawn")} disabled={busy || req.status !== "open" && req.status !== "negotiating"}>
                  Withdraw
                </button>
              )}
              {iAmOwner && (
                <button className="btn bg-white/0 border border-white/20 hover:bg-white/10" onClick={() => onWithdrawOrDecline("declined")} disabled={busy || req.status === "accepted"}>
                  Decline
                </button>
              )}
            </div>

            <Link to="/contracts" className="btn w-full mt-2">Back to contracts</Link>
          </div>

          {/* RIGHT: chat with diffs */}
          <div className="flex flex-col min-w-0">
            <div className="flex-1 overflow-auto p-4 space-y-2">
              {msgs.length === 0 ? (
                <div className="text-sm text-white/60">No messages yet.</div>
              ) : (
                msgs.map((m, i) => {
                  const prev = msgs[i - 1];
                  const mine = m.author_id === me;
                  const showHead = !sameAuthorRecent(prev, m);
                  const author = profileOf(m.author_id);

                  // If this message contains a patch, compute a diff against current working (as of now).
                  const patchedView = m.patch ? mergeTerms(working, m.patch) : null;
                  const diffs = m.patch ? diffTerms(working, patchedView as any) : [];

                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div className={`flex items-end gap-2 max-w-[78%] ${mine ? "flex-row-reverse" : ""}`}>
                        {showHead ? (
                          <Avatar url={author?.avatar_url} name={nameOf(author)} size={32} />
                        ) : (
                          <div style={{ width: 32, height: 32 }} />
                        )}
                        <div className={`rounded-2xl px-3 py-2 ${mine ? "bg-indigo-500 text-black" : "bg-white/10"}`}>
                          {!mine && showHead && (
                            <div className="text-[11px] text-white/70 mb-0.5">{nameOf(author)}</div>
                          )}
                          {m.body && <div className="whitespace-pre-wrap text-sm mb-1">{m.body}</div>}

                          {/* Render diffs for patch messages */}
                          {m.patch && (
                            <div className={`rounded-lg ${mine ? "bg-black/10 text-black" : "bg-white/5"} p-2 text-xs`}>
                              {diffs.length === 0 ? (
                                <div>No visible changes.</div>
                              ) : (
                                <ul className="space-y-1">
                                  {diffs.map((d, idx) => (
                                    <li key={idx}>
                                      <span className="text-white/60">{String(d.key)}:</span>{" "}
                                      <span className="line-through opacity-70 mr-1">
                                        {formatVal(d.before)}
                                      </span>
                                      <span className="ml-1">→ <b>{formatVal(d.after)}</b></span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {/* Accept patch button */}
                              <div className="mt-2 flex gap-2">
                                <button
                                  className={`px-2 py-1 rounded-md text-xs ${mine ? "bg-black/20" : "bg-white/10 hover:bg-white/20"}`}
                                  onClick={() => onAcceptPatch(m.patch!)}
                                >
                                  Accept change
                                </button>
                              </div>
                            </div>
                          )}

                          <div className={`text-[10px] mt-1 ${mine ? "text-black/60 text-right" : "text-white/50"}`}>
                            {new Date(m.created_at).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            {/* composer */}
            <div className="p-3 border-t border-white/10 flex gap-2">
              <textarea
                className="flex-1 input min-h-[44px]"
                placeholder="Type your message..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    send(input);
                  }
                }}
              />
              <button className="btn shrink-0" onClick={() => send(input)} disabled={busy || !input.trim()} title="Send">
                ➤
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Edit terms drawer */}
      {editOpen && (
        <div className="fixed inset-0 z-[70]">
          <div className="absolute inset-0 bg-black/60" onClick={() => setEditOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full sm:w-[520px] bg-neutral-950 border-l border-white/10 shadow-2xl p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Edit terms</h3>
              <button className="text-sm text-white/70 hover:text-white" onClick={() => setEditOpen(false)}>
                Close
              </button>
            </div>

            {/* Template picker */}
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 mb-3">
              <div className="text-sm font-semibold mb-1">Templates</div>
              <div className="grid gap-2">
                {LICENSE_TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    className="text-left px-3 py-2 rounded-lg bg-white/0 border border-white/15 hover:bg-white/10"
                    onClick={() => setDraft(t.terms)}
                  >
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-white/70">{t.terms.purpose} • {t.terms.term_months}m • {t.terms.exclusivity}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Form */}
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-sm mb-1">Purpose</label>
                <input className="input w-full" value={draft.purpose ?? ""} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm mb-1">Term (months)</label>
                  <input type="number" className="input w-full" value={draft.term_months ?? ""} onChange={(e) => setDraft({ ...draft, term_months: Number(e.target.value || 0) })} />
                </div>
                <div>
                  <label className="block text-sm mb-1">Start date</label>
                  <input type="date" className="input w-full" value={draft.start_date ?? ""} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-sm mb-1">Territory (comma-separated)</label>
                <input
                  className="input w-full"
                  value={Array.isArray(draft.territory) ? draft.territory.join(", ") : (draft.territory ?? "")}
                  onChange={(e) => setDraft({ ...draft, territory: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Media (comma-separated)</label>
                <input
                  className="input w-full"
                  value={(draft.media ?? []).join(", ")}
                  onChange={(e) => setDraft({ ...draft, media: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Exclusivity</label>
                <select
                  className="input w-full"
                  value={draft.exclusivity ?? "non-exclusive"}
                  onChange={(e) => setDraft({ ...draft, exclusivity: e.target.value as any })}
                >
                  <option value="non-exclusive">non-exclusive</option>
                  <option value="exclusive">exclusive</option>
                  <option value="category-exclusive">category-exclusive</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm mb-1">Fee amount</label>
                  <input type="number" className="input w-full" value={draft.fee?.amount ?? ""} onChange={(e) => setDraft({ ...draft, fee: { amount: Number(e.target.value || 0), currency: draft.fee?.currency ?? "USD" } })} />
                </div>
                <div>
                  <label className="block text-sm mb-1">Currency</label>
                  <input className="input w-full" value={draft.fee?.currency ?? "USD"} onChange={(e) => setDraft({ ...draft, fee: { amount: draft.fee?.amount ?? 0, currency: e.target.value } })} />
                </div>
              </div>
              <div>
                <label className="block text-sm mb-1">Deliverables</label>
                <textarea className="input w-full" value={draft.deliverables ?? ""} onChange={(e) => setDraft({ ...draft, deliverables: e.target.value })} />
              </div>
              <div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" className="accent-white/90" checked={!!draft.credit_required} onChange={(e) => setDraft({ ...draft, credit_required: e.target.checked })} />
                  Credit required
                </label>
              </div>
              <div>
                <label className="block text-sm mb-1">Usage notes</label>
                <textarea className="input w-full" value={draft.usage_notes ?? ""} onChange={(e) => setDraft({ ...draft, usage_notes: e.target.value })} />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  className="btn"
                  onClick={() => {
                    const patch = patchFromDraft();
                    const label = "Proposing term changes";
                    send(label, patch);
                    setEditOpen(false);
                  }}
                >
                  Propose changes
                </button>
                <button
                  className="btn bg-white/0 border border-white/20 hover:bg-white/10"
                  onClick={() => {
                    const patch = patchFromDraft();
                    onAcceptPatch(patch); // apply immediately (useful internally)
                    setEditOpen(false);
                  }}
                >
                  Apply now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* inline error toast */}
      {msg && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-4 text-sm px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-500/30">
          {msg}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ renderer utils ------------------------------ */

function formatVal(v: any): string {
  if (Array.isArray(v)) return v.join(", ");
  if (v && typeof v === "object") {
    if ("amount" in v && "currency" in v) return `${(v.amount as number).toLocaleString()} ${(v.currency as string)}`;
    return JSON.stringify(v);
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  return v == null ? "—" : String(v);
}
