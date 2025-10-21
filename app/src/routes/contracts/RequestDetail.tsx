// app/src/routes/contracts/RequestDetail.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  getRequestWithThread, postLicenseMessage, acceptPatch, acceptOffer, updateLicenseRequest,
  diffTerms, mergeTerms, LICENSE_TEMPLATES, listApprovals, upsertApproval,
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

  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<LicenseTerms>>({});
  const chatEndRef = useRef<HTMLDivElement>(null);

  const iAmOwner = useMemo(() => me && req && req.owner_id === me, [me, req]);
  const iAmRequester = useMemo(() => me && req && req.requester_id === me, [me, req]);
  const profileOf = (id: string | undefined) => (id === requester?.id ? requester : id === owner?.id ? owner : null);

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
        setMsg(e?.message || "Failed to load request.");
      } finally {
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

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

  // 1) Open the tab RIGHT NOW (synchronous to the click)
  const w = window.open("about:blank", "_blank");
  if (!w) {
    setMsg("Please allow pop-ups to preview the contract.");
    return;
  }
  // Minimal placeholder while we wait
  try {
    w.document.write(`
      <!doctype html><meta charset="utf-8">
      <title>Generating…</title>
      <style>html,body{background:#0b0b0b;color:#fff;font:14px system-ui;margin:0}
      .c{display:grid;place-items:center;min-height:100dvh;opacity:.8}</style>
      <div class="c">Generating contract…</div>
    `);
    w.document.close();
  } catch {
    // ignore—some extensions block document.write
  }

  setBusy(true);
  setMsg(null);
  try {
    const res = await generateContractPdf(req.id);
    await postLicenseMessage(req.id, `Generated contract document.`, null);
    setMsg("Draft document generated ✔️");

    // 2) Build a Blob URL so the browser definitely renders as HTML
    const html = res?.html || "<p>Empty document.</p>";
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    // 3) Navigate the already-open tab to the Blob URL
    w.location.replace(url);

    // (optional) you can keep res.url around if you want a shareable signed link later
    // console.debug("Signed URL:", res?.url);
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
// ...


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
              <div className="text-sm font-semibold mb-2">Contract Details</div>
              <FieldRow label="Purpose">{working.purpose}</FieldRow>
              <FieldRow label="Term">{working.term_months} months</FieldRow>
              <FieldRow label="Territory">{stringifyTerritory(working.territory)}</FieldRow>
              <FieldRow label="Media">{working.media.join(", ")}</FieldRow>
              <FieldRow label="Exclusivity">{working.exclusivity}</FieldRow>
              <FieldRow label="Fee">{formatMoney(working.fee || undefined)}</FieldRow>
              {working.deliverables && <FieldRow label="Deliverables">{working.deliverables}</FieldRow>}
              {working.usage_notes && <FieldRow label="Notes">{working.usage_notes}</FieldRow>}
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
          <ChatPane
            me={me!}
            msgs={msgs}
            req={req}
            profileOf={profileOf}
            onAcceptPatch={onAcceptPatch}
            input={input}
            setInput={setInput}
            send={send}
            chatEndRef={chatEndRef}
          />
        </div>
      </div>
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
  me, msgs, req, profileOf, onAcceptPatch, input, setInput, send, chatEndRef
}: any) {
  const sameAuthorRecent = (a: any, b: any, mins = 6) =>
    !!a && !!b && a.author_id === b.author_id &&
    Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) < mins * 60 * 1000;

  return (
    <div className="flex flex-col min-w-0">
      <div className="flex-1 overflow-auto p-4 space-y-2">
        {msgs.map((m: any, i: number) => {
          const prev = msgs[i - 1];
          const mine = m.author_id === me;
          const showHead = !sameAuthorRecent(prev, m);
          const author = profileOf(m.author_id);
          const working = req.requested;

          const patchedView = m.patch ? { ...working, ...m.patch } : null;
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
                </div>
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      <div className="p-3 border-t border-white/10 flex gap-2">
        <textarea
          className="flex-1 input min-h-[44px]"
          placeholder="Type your message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(input); }}
        />
        <button className="btn shrink-0" onClick={() => send(input)} title="Send">➤</button>
      </div>
    </div>
  );
}

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
