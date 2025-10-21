// app/src/routes/contracts/RequestDetail.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  getRequestWithThread, postLicenseMessage, acceptPatch, acceptOffer,
  type LicenseRequest, type LicenseThreadMsg, type LicenseTerms,
  stringifyTerritory, formatMoney, generateContractPdf, uploadExecutedPdf, uploadAttachment
} from "../../lib/licensing";

type Profile = { id: string; display_name: string | null; username: string | null; avatar_url: string | null };
type Artwork = { id: string; title: string | null; image_url: string | null };

const nameOf = (p?: Profile | null) => p?.display_name || p?.username || (p?.id ? p.id.slice(0, 6) : "—");

function Avatar({ url, name, size = 28 }: { url?: string | null; name: string; size?: number }) {
  return url ? (
    <img src={url} alt={name} title={name} className="rounded-full object-cover ring-1 ring-white/10" style={{ width: size, height: size }} />
  ) : (
    <div title={name} className="grid place-items-center bg-white/10 ring-1 ring-white/10"
      style={{ width: size, height: size, borderRadius: size / 2, fontSize: Math.max(10, size / 3) }}>
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

/* ---------- tiny helpers for bullets + typing throttle ---------- */
function continueBullet(text: string, selStart: number) {
  // Determine current line
  const before = text.slice(0, selStart);
  const after = text.slice(selStart);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart);
  const mNum = line.match(/^\s*(\d+)\.\s+/);
  const mDash = line.match(/^\s*-\s+/);
  const mDot = line.match(/^\s*•\s+/);

  if (mNum) {
    const n = parseInt(mNum[1], 10) + 1;
    const insert = `\n${"".padStart(mNum[0].length - (mNum[1].length + 2))}${n}. `;
    return { text: before + insert + after, deltaCaret: insert.length };
  }
  if (mDash) {
    const pad = "".padStart(mDash[0].length - 2);
    const insert = `\n${pad}- `;
    return { text: before + insert + after, deltaCaret: insert.length };
  }
  if (mDot) {
    const pad = "".padStart(mDot[0].length - 2);
    const insert = `\n${pad}• `;
    return { text: before + insert + after, deltaCaret: insert.length };
  }
  return null;
}

function throttle<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let last = 0;
  let timer: any = null;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = last + ms - now;
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  };
}

export default function RequestDetail() {
  const { id } = useParams();
  const nav = useNavigate();

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

  // Edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<LicenseTerms>>({});

  // Typing & seen
  const [typingBy, setTypingBy] = useState<Record<string, number>>({});
  const [seenBy, setSeenBy] = useState<Record<string, { msgId: string; ts: number }>>({});
  const messagesWrapRef = useRef<HTMLDivElement>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const iAmOwner = useMemo(() => me && req && req.owner_id === me, [me, req]);
  const profileOf = (uid: string | undefined) => (uid === requester?.id ? requester : uid === owner?.id ? owner : null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const uid = sess.session?.user?.id;
        if (!uid) throw new Error("Please sign in.");
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
        setMsg(e?.message || "Failed to load request.");
      } finally {
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // Realtime: new messages
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`lr-${id}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "license_threads", filter: `request_id=eq.${id}` },
        (payload) => setMsgs((cur) => [...cur, payload.new as unknown as LicenseThreadMsg])
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  // Fallback poller: fetch latest if realtime misses
  useEffect(() => {
    if (!id) return;
    const interval = setInterval(async () => {
      try {
        const lastAt = msgs.length ? msgs[msgs.length - 1].created_at : null;
        let q = supabase
          .from("license_threads")
          .select("*")
          .eq("request_id", id)
          .order("created_at", { ascending: true });

        const { data, error } = lastAt ? await q.gt("created_at", lastAt) : await q;
        if (!error && data && data.length) {
          setMsgs((cur) => [...cur, ...data as any]);
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [id, msgs]);

  // Realtime: typing + seen presence/broadcast
  useEffect(() => {
    if (!id) return;
    let unsubbed = false;
    let chan: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id;
      if (!uid) return;

      chan = supabase.channel(`lr-${id}-rt`, {
        config: { broadcast: { self: false }, presence: { key: uid } },
      });

      chan.on("broadcast", { event: "typing" }, (payload: any) => {
        const from = payload?.payload?.user_id;
        const at = payload?.payload?.at;
        if (!from || from === uid) return;
        setTypingBy((cur) => ({ ...cur, [from]: Number(at) || Date.now() }));
      });

      chan.on("broadcast", { event: "seen" }, (payload: any) => {
        const from = payload?.payload?.user_id;
        const msgId = payload?.payload?.msg_id;
        const ts = payload?.payload?.ts;
        if (!from || from === uid || !msgId) return;
        setSeenBy((cur) => ({ ...cur, [from]: { msgId, ts: Number(ts) || Date.now() } }));
      });

      await chan.subscribe((s) => {
        if (s === "SUBSCRIBED") {
          chan?.track({ user_id: uid, ts: Date.now() });
        }
      });
      if (unsubbed) supabase.removeChannel(chan);
    })();

    return () => {
      unsubbed = true;
      if (chan) supabase.removeChannel(chan);
    };
  }, [id]);

  // prune typing indicators
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setTypingBy((cur) => {
        const next: Record<string, number> = {};
        for (const k in cur) if (now - cur[k] < 3500) next[k] = cur[k];
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // emit typing (throttled)
  const sendTyping = useMemo(() => throttle(async () => {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user?.id;
    if (!uid || !id) return;
    await supabase.channel(`lr-${id}-rt`).send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: uid, at: Date.now() },
    });
  }, 1200), [id]);

  // seen helper
  async function sendSeenIfNeeded() {
    if (!id || !me || msgs.length === 0) return;
    const last = msgs[msgs.length - 1];
    if (last.author_id === me) return; // only send seen if last is NOT mine
    await supabase.channel(`lr-${id}-rt`).send({
      type: "broadcast",
      event: "seen",
      payload: { user_id: me, msg_id: last.id, ts: Date.now() },
    });
  }

  // observe scroll: at bottom => send "seen"
  useEffect(() => {
    const el = messagesWrapRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 8) {
        sendSeenIfNeeded();
      }
    };
    el.addEventListener("scroll", onScroll);
    // also on mount/update
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [msgs.length]);

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

  async function onAcceptPatch(patch: Partial<LicenseTerms>) {
    setBusy(true);
    try {
      const updated = await acceptPatch(id!, patch);
      setReq(updated);
      await postLicenseMessage(id!, "Accepted changes.", null);
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

  async function onUploadExecuted(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !req) return;
    try {
      setMsg(null);
      setBusy(true);
      const signer_name = iAmOwner ? nameOf(owner) : nameOf(requester);
      const { updated, sha256 } = await uploadExecutedPdf(req.id, file, { name: signer_name || "" });
      setReq(updated);
      await postLicenseMessage(req.id, `Uploaded executed PDF (sha256: ${sha256}).`, null);
      setMsg("Executed PDF uploaded ✔️");
    } catch (e: any) {
      setMsg(e?.message || "Upload failed");
    } finally {
      setBusy(false);
      (e.target as any).value = "";
    }
  }

  async function onGeneratePdf() {
    if (!req) return;
    // Open tab synchronously to avoid popup blockers
    const w = window.open("about:blank", "_blank");
    if (!w) {
      setMsg("Please allow pop-ups to preview the contract.");
      return;
    }
    try {
      w.document.write(`
        <!doctype html><meta charset="utf-8">
        <title>Generating…</title>
        <style>html,body{background:#0b0b0b;color:#fff;font:14px system-ui;margin:0}
        .c{display:grid;place-items:center;min-height:100dvh;opacity:.8}</style>
        <div class="c">Generating contract…</div>
      `);
      w.document.close();
    } catch {}

    setBusy(true);
    setMsg(null);
    try {
      const res = await generateContractPdf(req.id);
      await postLicenseMessage(req.id, `Generated contract document.`, null);
      setMsg("Draft document generated ✔️");

      const html = res?.html || "<p>Empty document.</p>";
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      w.location.replace(url);
    } catch (e: any) {
      setMsg(e?.message || "Document generation failed");
      try {
        w.document.open();
        w.document.write(`<pre style="padding:24px;color:#fff;background:#1a1a1a">Error: ${String(e?.message || e)}</pre>`);
        w.document.close();
      } catch {}
    } finally {
      setBusy(false);
    }
  }

  async function onAttachFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !req) return;
    try {
      setBusy(true);
      await uploadAttachment(req.id, file);
      await postLicenseMessage(req.id, `Attached file: ${file.name}`, null);
      setMsg("Attachment added ✔️");
    } catch (e: any) {
      setMsg(e?.message || "Attachment failed");
    } finally {
      setBusy(false);
      (e.target as any).value = "";
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

  const working = req.requested;
  const othersTyping = Object.keys(typingBy).filter((uid) => uid !== me);
  const lastMine = [...msgs].reverse().find((m) => m.author_id === me);
  const someoneSeenMyLast =
    lastMine &&
    Object.entries(seenBy).some(([uid, s]) => uid !== me && s.msgId === lastMine.id);

  /* ------------------------------ UI ------------------------------ */
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => nav("/contracts")} />
      <div className="absolute inset-0 m-auto max-w-[1100px] w-[96vw] max-h-[92vh] rounded-2xl border border-white/15 bg-neutral-950 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-white/[0.03]">
          <div className="h-10 w-10 rounded-lg overflow-hidden bg-neutral-900">
            {art?.image_url ? <img src={art.image_url} className="h-full w-full object-cover" /> : null}
          </div>
          <div className="min-w-0">
            <div className="font-semibold truncate">{art?.title || "Untitled"}</div>
            <div className="text-sm text-white/70 truncate">
              {working.purpose}, {working.term_months}-month {working.exclusivity} license
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Avatar url={requester?.avatar_url} name={nameOf(requester)} />
            <span className="text-sm">{nameOf(requester)}</span>
            <span className="text-white/40">↔</span>
            <Avatar url={owner?.avatar_url} name={nameOf(owner)} />
            <span className="text-sm">{nameOf(owner)}</span>
            <button className="h-8 w-8 grid place-items-center rounded-lg hover:bg-white/10" onClick={() => nav("/contracts")}>✕</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[380px_minmax(0,1fr)] h-[calc(92vh-60px)]">
          {/* LEFT: Details + actions */}
          <div className="overflow-y-auto p-4 space-y-3 border-r border-white/10">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold mb-2">Contract Details</div>
                <button
                  className="text-xs px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20"
                  onClick={() => {
                    setDraft({
                      purpose: working.purpose,
                      term_months: working.term_months,
                      territory: working.territory,
                      media: [...(working.media || [])],
                      exclusivity: working.exclusivity,
                      fee: working.fee ? { ...working.fee } : undefined,
                      credit_required: working.credit_required,
                      credit_line: (working as any).credit_line,
                      deliverables: working.deliverables,
                      usage_notes: working.usage_notes,
                    });
                    setEditOpen(true);
                  }}
                >
                  Propose edits
                </button>
              </div>

              {/* Basics */}
              <FieldRow label="Purpose">{working.purpose}</FieldRow>
              <FieldRow label="Term">{working.term_months} months</FieldRow>
              <FieldRow label="Territory">{stringifyTerritory(working.territory)}</FieldRow>
              <FieldRow label="Media">{working.media.join(", ")}</FieldRow>
              <FieldRow label="Exclusivity">{working.exclusivity}</FieldRow>
              <FieldRow label="Fee">{formatMoney(working.fee || undefined)}</FieldRow>
              {working.deliverables && (
                <FieldRow label="Deliverables">
                  {/* preserve bullets/lines */}
                  <div className="whitespace-pre-wrap">{working.deliverables}</div>
                </FieldRow>
              )}
              {working.usage_notes && (
                <FieldRow label="Notes">
                  <div className="whitespace-pre-wrap">{working.usage_notes}</div>
                </FieldRow>
              )}
              {typeof working.credit_required === "boolean" && (
                <FieldRow label="Attribution">
                  {working.credit_required ? `yes${(working as any).credit_line ? ` — ${(working as any).credit_line}` : ""}` : "no"}
                </FieldRow>
              )}

              <div className="text-[12px] text-white/60">Status: <span className="capitalize">{req.status}</span></div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <button className="btn" onClick={onGeneratePdf} disabled={busy}>Generate PDF</button>
                <label className="btn bg-white/0 border border-white/20 hover:bg-white/10 cursor-pointer text-center">
                  <input type="file" accept="application/pdf" className="hidden" onChange={onUploadExecuted} />
                  Upload signed PDF
                </label>
                {req.status !== "accepted" && iAmOwner && (
                  <button className="btn col-span-2" onClick={onAcceptOffer} disabled={busy}>Accept Offer</button>
                )}
              </div>

              {/* Execution record */}
              {(req.executed_pdf_url || req.signed_at) && (
                <div className="rounded-lg bg-white/[0.06] p-3 text-xs space-y-1">
                  <div className="font-semibold text-sm">Execution record</div>
                  {req.executed_pdf_url && (
                    <div>
                      PDF:{" "}
                      <a className="underline" href={req.executed_pdf_url} target="_blank" rel="noreferrer">
                        Open file
                      </a>
                    </div>
                  )}
                  {req.executed_pdf_sha256 && <div>SHA-256: <code className="break-all">{req.executed_pdf_sha256}</code></div>}
                  {req.signed_at && <div>Signed at: {new Date(req.signed_at).toLocaleString()}</div>}
                  {req.signer_name && <div>Signer: {req.signer_name}{req.signer_title ? `, ${req.signer_title}` : ""}</div>}
                </div>
              )}
            </div>

            {/* Attachments */}
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold">Attachments</div>
                <label className="text-xs px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer">
                  <input type="file" className="hidden" onChange={onAttachFile} />
                  Add file
                </label>
              </div>
              <AttachmentList requestId={req.id} />
            </div>

            <Link to="/contracts" className="btn w-full">Back to contracts</Link>
          </div>

          {/* RIGHT: Thread */}
          <div className="flex flex-col min-w-0">
            <div ref={messagesWrapRef} className="flex-1 overflow-auto p-4 space-y-2">
              <ChatPane
                me={me!}
                msgs={msgs}
                req={req}
                profileOf={profileOf}
                onAcceptPatch={onAcceptPatch}
                chatEndRef={chatEndRef}
                seenBy={seenBy}
              />
            </div>

            {/* typing row */}
            <div className="px-3 h-5 text-[12px] text-white/60">
              {othersTyping.length > 0 && (
                <span>{nameOf(profileOf(othersTyping[0]) as any)} is typing…</span>
              )}
            </div>

            {/* composer */}
            <div className="p-3 border-t border-white/10 flex gap-2">
              <textarea
                className="flex-1 input min-h-[44px]"
                placeholder="Type your message… (Enter to send, Shift+Enter for newline)"
                value={input}
                onChange={(e) => { setInput(e.target.value); sendTyping(); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
              />
              <button className="btn shrink-0" onClick={() => send(input)} title="Send">➤</button>
            </div>

            {/* seen below my last message */}
            {someoneSeenMyLast && (
              <div className="px-3 pb-2 text-[11px] text-white/50">Seen</div>
            )}
          </div>
        </div>
      </div>

      {/* EDIT TERMS MODAL */}
      {editOpen && (
        <EditTermsModal
          initial={draft}
          onClose={() => setEditOpen(false)}
          onSubmit={async (patch) => {
            setEditOpen(false);
            await send("Proposed changes.", patch);
          }}
        />
      )}

      {msg && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-4 text-sm px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-500/30">
          {msg}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ ChatPane ------------------------------ */

function ChatPane({
  me, msgs, req, profileOf, onAcceptPatch, chatEndRef, seenBy
}: any) {
  const sameAuthorRecent = (a: any, b: any, mins = 6) =>
    !!a && !!b && a.author_id === b.author_id &&
    Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) < mins * 60 * 1000;

  const hasSeen = (msgId: string) => {
    // if any other user seen this message id
    return Object.entries(seenBy || {}).some(([_, s]: any) => s?.msgId === msgId);
  };

  return (
    <>
      {msgs.map((m: any, i: number) => {
        const prev = msgs[i - 1];
        const mine = m.author_id === me;
        const showHead = !sameAuthorRecent(prev, m);
        const author = profileOf(m.author_id);
        const working = req.requested;

        const diffs = m.patch ? ((): any[] => {
          const out: any[] = [];
          const keys = Object.keys(m.patch!);
          for (const k of keys) out.push({ key: k, before: (working as any)[k], after: (m.patch as any)[k] });
          return out;
        })() : [];

        return (
          <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`flex items-end gap-2 max-w-[78%] ${mine ? "flex-row-reverse" : ""}`}>
              {showHead ? <Avatar url={author?.avatar_url} name={author ? (author.display_name || author.username || author.id) : "User"} size={32} /> : <div style={{ width: 32, height: 32 }} />}
              <div className={`rounded-2xl px-3 py-2 ${mine ? "bg-indigo-500 text-black" : "bg-white/10"}`}>
                {!mine && showHead && (
                  <div className="text-[11px] text-white/70 mb-0.5">
                    {author ? (author.display_name || author.username || author.id) : "User"}
                  </div>
                )}
                {m.body && <div className="whitespace-pre-wrap text-sm mb-1">{m.body}</div>}

                {m.patch && (
                  <div className={`rounded-lg ${mine ? "bg-black/10 text-black" : "bg-white/5"} p-2 text-xs`}>
                    <ul className="space-y-1">
                      {diffs.map((d, idx) => (
                        <li key={idx}>
                          <span className="text-white/60">{String(d.key)}:</span>{" "}
                          <span className="line-through opacity-70 mr-1">{formatVal(d.before)}</span>
                          <span>→ <b>{formatVal(d.after)}</b></span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2">
                      <button className={`px-2 py-1 rounded-md text-xs ${mine ? "bg-black/20" : "bg-white/10 hover:bg-white/20"}`} onClick={() => onAcceptPatch(m.patch!)}>
                        Accept change
                      </button>
                    </div>
                  </div>
                )}

                <div className={`text-[10px] mt-1 ${mine ? "text-black/60 text-right" : "text-white/50"}`}>
                  {new Date(m.created_at).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}
                </div>

                {/* per-message seen tick (only on the latest) */}
                {mine && i === msgs.length - 1 && hasSeen(m.id) && (
                  <div className="text-[10px] mt-1 text-black/60 text-right">Seen</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={chatEndRef} />
    </>
  );
}

/* ------------------------------ Edit Modal ------------------------------ */

function EditTermsModal({
  initial,
  onClose,
  onSubmit,
}: {
  initial: Partial<LicenseTerms>;
  onClose: () => void;
  onSubmit: (patch: Partial<LicenseTerms>) => void | Promise<void>;
}) {
  const [form, setForm] = useState<Partial<LicenseTerms>>(initial);

  function set<K extends keyof LicenseTerms>(k: K, v: LicenseTerms[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  const parseList = (s: string) =>
    s.split(",").map((x) => x.trim()).filter(Boolean);

  const [feeAmount, setFeeAmount] = useState<string>(
    initial.fee?.amount != null ? String(initial.fee.amount) : ""
  );
  const [feeCurrency, setFeeCurrency] = useState<string>(initial.fee?.currency || "USD");

  // Refs for bullet-friendly textareas
  const delivRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const handleBulletEnter = (ref: React.RefObject<HTMLTextAreaElement>, key: "deliverables" | "usage_notes") => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || !ref.current) return;
    // Shift+Enter still enters newline (we also handle bullets)
    const sel = ref.current.selectionStart;
    const res = continueBullet(ref.current.value, sel);
    if (res) {
      e.preventDefault();
      const next = res.text;
      setForm((f) => ({ ...f, [key]: next } as any));
      queueMicrotask(() => {
        if (!ref.current) return;
        const pos = sel + res.deltaCaret;
        ref.current.selectionStart = ref.current.selectionEnd = pos;
      });
    }
  };

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute inset-0 m-auto max-w-[720px] w-[94vw] max-height-[88vh] overflow-auto rounded-2xl border border-white/15 bg-neutral-950 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-lg font-semibold">Propose edits</div>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-white/10">✕</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm">
            <div className="text-white/60 mb-1">Purpose</div>
            <input
              className="input w-full"
              value={form.purpose || ""}
              onChange={(e) => set("purpose", e.target.value)}
            />
          </label>

          <label className="text-sm">
            <div className="text-white/60 mb-1">Term (months)</div>
            <input
              type="number"
              className="input w-full"
              value={form.term_months ?? ""}
              onChange={(e) => set("term_months", Math.max(0, Number(e.target.value || 0)) as any)}
            />
          </label>

          <label className="text-sm md:col-span-2">
            <div className="text-white/60 mb-1">Territory (comma-separated for multiple)</div>
            <input
              className="input w-full"
              value={
                Array.isArray(form.territory)
                  ? form.territory.join(", ")
                  : (form.territory ?? "")
              }
              onChange={(e) => {
                const raw = e.target.value;
                set("territory", raw.includes(",") ? (parseList(raw) as any) : (raw as any));
              }}
            />
          </label>

          <label className="text-sm md:col-span-2">
            <div className="text-white/60 mb-1">Media (comma-separated)</div>
            <input
              className="input w-full"
              value={(form.media || []).join(", ")}
              onChange={(e) => set("media", parseList(e.target.value) as any)}
            />
          </label>

          <label className="text-sm">
            <div className="text-white/60 mb-1">Exclusivity</div>
            <select
              className="input w-full"
              value={form.exclusivity || "non-exclusive"}
              onChange={(e) => set("exclusivity", e.target.value as any)}
            >
              <option value="exclusive">exclusive</option>
              <option value="non-exclusive">non-exclusive</option>
              <option value="category-exclusive">category-exclusive</option>
            </select>
          </label>

          <div className="text-sm grid grid-cols-[1fr_auto] gap-2">
            <label>
              <div className="text-white/60 mb-1">Fee amount</div>
              <input
                className="input w-full"
                inputMode="decimal"
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
              />
            </label>
            <label>
              <div className="text-white/60 mb-1">Currency</div>
              <input
                className="input w-24"
                value={feeCurrency}
                onChange={(e) => setFeeCurrency(e.target.value.toUpperCase())}
              />
            </label>
          </div>

          <label className="text-sm md:col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!form.credit_required}
              onChange={(e) => set("credit_required", e.target.checked as any)}
            />
            <span>Attribution required</span>
          </label>

          {form.credit_required && (
            <label className="text-sm md:col-span-2">
              <div className="text-white/60 mb-1">Credit line</div>
              <input
                className="input w-full"
                value={(form as any).credit_line || ""}
                onChange={(e) => set("credit_line" as any, e.target.value as any)}
              />
            </label>
          )}

          <label className="text-sm md:col-span-2">
            <div className="text-white/60 mb-1">Deliverables (supports -, • and numbered lists)</div>
            <textarea
              ref={delivRef}
              className="input w-full"
              rows={5}
              value={form.deliverables || ""}
              onChange={(e) => set("deliverables", e.target.value)}
              onKeyDown={handleBulletEnter(delivRef, "deliverables")}
              placeholder={`- 3x resized banners (300x250, 728x90, 160x600)\n- Source file (PSD)\n- Social preview • 1080x1080`}
            />
          </label>

          <label className="text-sm md:col-span-2">
            <div className="text-white/60 mb-1">Notes</div>
            <textarea
              ref={notesRef}
              className="input w-full"
              rows={4}
              value={form.usage_notes || ""}
              onChange={(e) => set("usage_notes", e.target.value)}
              onKeyDown={handleBulletEnter(notesRef, "usage_notes")}
              placeholder={`• Link back to creator\n• No AI training\n• Provide final proofs before launch`}
            />
          </label>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20" onClick={onClose}>
            Cancel
          </button>
          <button
            className="px-3 py-2 rounded-lg bg-white text-black hover:bg-white/90"
            onClick={() => {
              const patch: Partial<LicenseTerms> = { ...form };
              if (feeAmount || feeCurrency) {
                const amt = Number(feeAmount);
                patch.fee = isFinite(amt) && amt > 0
                  ? { amount: amt, currency: feeCurrency || "USD" }
                  : undefined;
              }
              onSubmit(patch);
            }}
          >
            Submit proposal
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Attachments + utils ------------------------------ */

function AttachmentList({ requestId }: { requestId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("license_attachments").select("*").eq("request_id", requestId).order("created_at", { ascending: false });
      setRows(data ?? []);
    })();
  }, [requestId]);
  if (rows.length === 0) return <div className="text-xs text-white/60">No attachments yet.</div>;
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between">
          <div className="truncate">{r.path.split("/").pop()}</div>
          <a
            className="underline text-xs"
            href={(supabase.storage.from("license_attachments").getPublicUrl(r.path).data.publicUrl)}
            target="_blank" rel="noreferrer"
          >
            Open
          </a>
        </li>
      ))}
    </ul>
  );
}

function formatVal(v: any): string {
  if (Array.isArray(v)) return v.join(", ");
  if (v && typeof v === "object") {
    if ("amount" in v && "currency" in v) return `${(v.amount as number).toLocaleString()} ${(v.currency as string)}`;
    return JSON.stringify(v);
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  return v == null ? "—" : String(v);
}
