// C:\Users\User\Downloads\taedal-v7\app\src\features\messages\ChatView.tsx

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DMMessageRow, DMThreadRow, DMKind } from "./types";
import { dmFetchMessages, dmGetOrCreateThread, dmSendMessageV2, dmUploadMedia } from "./api";
import { supabase } from "../../lib/supabase";
import { Link } from "react-router-dom";
import MediaEditModal from "./MediaEditModal";
import LinkifyText from "./LinkifyText";
import { extractUrls, shortHost } from "../../lib/urls";
import { getLinkPreview, type LinkPreview } from "../../lib/linkPreview";

function isSynthetic(threadId: string) {
  return threadId.startsWith("friend:");
}

function asMsg(e: any) {
  return e?.message ?? String(e ?? "Unknown error");
}

// consistent card look for bubbles
function bubbleCardCls(me: boolean) {
  return `rounded-2xl border border-white/10 bg-white/[0.04] text-white ${me ? "ml-auto" : "mr-auto"}`;
}

type ArtPreview = { id: string; title: string | null; image_url: string | null };

type PendingAttachment = {
  file: File;
  previewUrl: string;
  meta?: any;
};

function isDirectImageUrl(u: string) {
  try {
    const p = new URL(u).pathname.toLowerCase();
    return p.endsWith(".png") || p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".webp") || p.endsWith(".gif");
  } catch {
    return false;
  }
}

function LinkUnfurlCard({ p, me }: { p: LinkPreview; me: boolean }) {
  const href = p.finalUrl || p.url;
  const host = shortHost(href);

  // prefer og:image; fallback if user pasted a direct image URL
  const imgSrc = p.image || (isDirectImageUrl(href) ? href : null);

  // “iMessage-ish” top strip color
  const topCls = me ? "bg-sky-500/90 text-white" : "bg-white/10 text-white/90";
  const bottomCls = "bg-black/40";

  const title = (p.title || "").trim();
  const site = (p.siteName || host || "").trim();

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`block rounded-2xl overflow-hidden border border-white/10 ${me ? "ml-auto" : "mr-auto"} max-w-[70%] hover:border-white/20 transition`}
      title={href}
    >
      {/* top strip: URL */}
      <div className={`px-3 py-2 text-sm font-medium ${topCls}`}>
        <div className="truncate">{href}</div>
      </div>

      {/* image */}
      <div className="bg-black">
        {imgSrc ? (
          <img src={imgSrc} className="w-full aspect-[16/9] object-cover" alt={title || site || "Link preview"} />
        ) : (
          <div className="w-full aspect-[16/9] bg-white/5 flex items-center justify-center text-white/60 text-sm">
            Preview
          </div>
        )}
      </div>

      {/* bottom strip: site + title */}
      <div className={`px-3 py-2 ${bottomCls}`}>
        {site ? <div className="text-xs text-white/70 truncate">{site}</div> : null}
        {title ? <div className="text-sm text-white/90 font-medium line-clamp-2">{title}</div> : null}
      </div>
    </a>
  );
}

export default function ChatView({
  meId,
  thread,
  onThreadMetaMaybeChanged,
}: {
  meId: string;
  thread: DMThreadRow;
  onThreadMetaMaybeChanged: () => void;
}) {
  const [realThreadId, setRealThreadId] = useState<string | null>(
    isSynthetic(thread.thread_id) ? null : thread.thread_id
  );

  const [items, setItems] = useState<DMMessageRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // media draft (pick -> edit -> preview -> send)
  const [editOpen, setEditOpen] = useState(false);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [pendingAtt, setPendingAtt] = useState<PendingAttachment | null>(null);

  // voice recording
  const [recOn, setRecOn] = useState(false);
  const [recBusy, setRecBusy] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const recChunks = useRef<BlobPart[]>([]);
  const recStartedAt = useRef<number>(0);

  // cache artwork previews for artwork_share cards
  const [artCache, setArtCache] = useState<Record<string, ArtPreview>>({});

  // link preview cache keyed by STRING message id
  const [lpCache, setLpCache] = useState<Record<string, LinkPreview>>({});

  // autoscroll
  const endRef = useRef<HTMLDivElement | null>(null);

  const displayName = thread.other_username ?? "User";

  function msgKey(m: { id: any }) {
    return String(m.id);
  }

  function clearPending() {
    if (pendingAtt?.previewUrl) {
      try {
        URL.revokeObjectURL(pendingAtt.previewUrl);
      } catch {}
    }
    setPendingAtt(null);
  }

  useEffect(() => {
    setErr(null);
    setItems([]);
    setText("");
    setRealThreadId(isSynthetic(thread.thread_id) ? null : thread.thread_id);

    setEditOpen(false);
    setPickedFile(null);
    clearPending();
    setLpCache({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.thread_id]);

  useEffect(() => {
    return () => {
      if (pendingAtt?.previewUrl) {
        try {
          URL.revokeObjectURL(pendingAtt.previewUrl);
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    if (!realThreadId) return;
    setErr(null);
    try {
      const rows = await dmFetchMessages(realThreadId);
      setItems(rows);
    } catch (e: any) {
      setErr(asMsg(e));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realThreadId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length]);

  async function ensureRealThread(): Promise<string> {
    if (realThreadId) return realThreadId;

    setBusy(true);
    setErr(null);
    try {
      const id = await dmGetOrCreateThread(thread.other_user_id);
      setRealThreadId(id);
      onThreadMetaMaybeChanged();
      return id;
    } catch (e: any) {
      setErr(asMsg(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function send(
    kind: DMKind,
    payload: {
      body?: string | null;
      shared_post_id?: string | null;
      shared_artwork_id?: string | null;
      meta?: Record<string, any>;
    },
    threadIdOverride?: string
  ) {
    setErr(null);
    const tid = threadIdOverride ?? (await ensureRealThread());

    await dmSendMessageV2({
      threadId: tid,
      kind,
      body: payload.body ?? null,
      shared_post_id: payload.shared_post_id ?? null,
      shared_artwork_id: payload.shared_artwork_id ?? null,
      meta: payload.meta ?? {},
    });

    await load();
    onThreadMetaMaybeChanged();
  }

  async function onSendDraft() {
    const caption = text.trim();
    if (!pendingAtt && !caption) return;

    setBusy(true);
    setErr(null);

    try {
      const tid = await ensureRealThread();

      // attachment send (caption optional)
      if (pendingAtt) {
        const file = pendingAtt.file;
        const { url, path } = await dmUploadMedia(tid, file);

        await send(
          "image",
          {
            body: caption || null,
            meta: {
              url,
              path,
              mime: file.type || "application/octet-stream",
              name: file.name,
              size: file.size,
              ...(pendingAtt.meta ?? {}),
            },
          },
          tid
        );

        setText("");
        clearPending();
        return;
      }

      // text send + store link preview into meta (best effort)
      const urls = extractUrls(caption);
      let link_preview: LinkPreview | null = null;

      if (urls[0]) {
        link_preview = await getLinkPreview(urls[0]);
      }

      await send(
        "text",
        {
          body: caption,
          meta: link_preview ? { link_preview } : {},
        },
        tid
      );

      setText("");
    } catch (e: any) {
      setErr(asMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function onPickMedia(file: File) {
    setPickedFile(file);
    setEditOpen(true);
  }

  function onEditedConfirm(res: { file: File; meta?: any; warning?: string }) {
    if (res.warning) setErr(res.warning);

    clearPending();
    const previewUrl = URL.createObjectURL(res.file);
    setPendingAtt({ file: res.file, previewUrl, meta: res.meta });

    setEditOpen(false);
    setPickedFile(null);
  }

  async function startRec() {
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr("Voice messages not supported in this browser.");
      return;
    }

    setRecBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      recChunks.current = [];
      recStartedAt.current = Date.now();

      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recChunks.current.push(ev.data);
      };

      mr.onstop = async () => {
        try {
          const ms = Date.now() - recStartedAt.current;
          const blob = new Blob(recChunks.current, { type: mr.mimeType || "audio/webm" });
          const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });

          const tid = await ensureRealThread();
          const { url, path } = await dmUploadMedia(tid, file);

          await send("voice", {
            meta: { url, path, mime: blob.type || "audio/webm", duration_ms: ms },
          });
        } catch (e: any) {
          setErr(asMsg(e));
        } finally {
          stream.getTracks().forEach((t) => t.stop());
          setRecOn(false);
          setRecBusy(false);
        }
      };

      recRef.current = mr;
      mr.start();
      setRecOn(true);
      setRecBusy(false);
    } catch (e: any) {
      setErr(asMsg(e));
      setRecOn(false);
      setRecBusy(false);
    }
  }

  function stopRec() {
    try {
      recRef.current?.stop();
    } catch {}
  }

  // Fetch missing artwork previews for artwork_share messages
  useEffect(() => {
    const ids = Array.from(
      new Set(
        items
          .filter((m) => m.kind === "artwork_share")
          .map((m) => String(m.shared_artwork_id ?? "").trim())
          .filter(Boolean)
      )
    );

    const missing = ids.filter((id) => !artCache[id]);
    if (missing.length === 0) return;

    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("artworks")
          .select("id,title,image_url")
          .in("id", missing)
          .limit(50);

        if (error) throw error;
        if (!alive) return;

        const next: Record<string, ArtPreview> = {};
        (data ?? []).forEach((r: any) => {
          next[String(r.id)] = {
            id: String(r.id),
            title: r.title ?? null,
            image_url: r.image_url ?? null,
          };
        });

        setArtCache((cur) => ({ ...cur, ...next }));
      } catch {
        // ignore
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, realThreadId]);

  // For older text messages without meta.link_preview, generate preview (best effort)
  useEffect(() => {
    let alive = true;

    (async () => {
      const candidates = items
        .filter((m) => m.kind === "text" && (m.body ?? "").trim().length > 0)
        .filter((m) => !lpCache[msgKey(m)])
        .map((m) => {
          const body = (m.body ?? "").trim();
          const url = extractUrls(body)[0];
          if (!url) return null;

          const embedded = (m.meta?.link_preview as LinkPreview | undefined) ?? undefined;
          return { key: msgKey(m), url, embedded };
        })
        .filter((x): x is { key: string; url: string; embedded?: LinkPreview } => !!x);

      for (const c of candidates.slice(0, 6)) {
        if (!alive) return;

        if (c.embedded) {
          setLpCache((cur) => ({ ...cur, [c.key]: c.embedded! }));
          continue;
        }

        try {
          const p = await getLinkPreview(c.url);
          if (!alive) return;
          setLpCache((cur) => ({ ...cur, [c.key]: p }));
        } catch {
          // ignore
        }
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const headerRight = useMemo(() => {
    return (
      <div className="text-xs text-white/60">
        {realThreadId ? "Chat" : thread.is_friend ? "Start chat" : "Pending"}
      </div>
    );
  }, [realThreadId, thread.is_friend]);

  const canSend = !!(text.trim() || pendingAtt);

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-white/10 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {thread.other_avatar_url ? (
            <img
              src={thread.other_avatar_url}
              className="h-8 w-8 rounded-full object-cover border border-white/10"
              alt={displayName}
            />
          ) : (
            <div className="h-8 w-8 rounded-full bg-white/5 border border-white/10" />
          )}
          <div className="min-w-0">
            <div className="truncate font-medium text-white/90">{displayName}</div>
            <div className="text-xs text-white/50 truncate">
              {thread.is_friend ? "Friends" : thread.is_request ? "Request" : "Conversation"}
            </div>
          </div>
        </div>
        {headerRight}
      </div>

      {err ? <div className="p-3 text-sm text-red-300">{err}</div> : null}

      <div className="flex-1 overflow-auto p-3 space-y-2">
        {!realThreadId && items.length === 0 ? (
          <div className="text-sm text-white/60">No messages yet. Send a message to start the chat.</div>
        ) : null}

        {items.map((m) => {
          const me = m.sender_id === meId;
          const key = msgKey(m);

          if (m.kind === "image") {
            const url = m.meta?.url as string | undefined;
            const mime = (m.meta?.mime as string | undefined) ?? "";
            const isVid = mime.startsWith("video/");

            return (
              <div key={key} className={`max-w-[70%] ${me ? "ml-auto" : "mr-auto"}`}>
                <div className="rounded-2xl overflow-hidden border border-white/10 bg-white/[0.04]">
                  {url ? (
                    isVid ? (
                      <video src={url} className="block w-full h-auto" controls playsInline />
                    ) : (
                      <img src={url} className="block w-full h-auto" alt="sent" />
                    )
                  ) : (
                    <div className="p-3 text-sm text-white/70 bg-white/10">
                      {isVid ? "Video" : "Image"}
                    </div>
                  )}
                </div>

                {m.body ? (
                  <div className={`${bubbleCardCls(me)} mt-2 px-3 py-2 text-sm whitespace-pre-wrap`}>
                    <LinkifyText text={m.body} />
                  </div>
                ) : null}
              </div>
            );
          }

          if (m.kind === "voice") {
            const url = m.meta?.url as string | undefined;
            return (
              <div key={key} className={`max-w-[70%] ${me ? "ml-auto" : "mr-auto"}`}>
                <div className={`${bubbleCardCls(me)} px-3 py-2`}>
                  {url ? <audio controls src={url} className="w-full" /> : <div>🎤 Voice</div>}
                </div>
              </div>
            );
          }

          if (m.kind === "artwork_share") {
            const artId = String(m.shared_artwork_id ?? "").trim();
            const cached = artId ? artCache[artId] : undefined;

            const title = (m.meta?.title as string | undefined) ?? cached?.title ?? "Artwork";
            const img =
              (m.meta?.image_url as string | undefined) ?? cached?.image_url ?? undefined;

            return (
              <div key={key} className={`max-w-[70%] ${me ? "ml-auto" : "mr-auto"}`}>
                <Link
                  to={artId ? `/art/${artId}` : "#"}
                  className="block rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden hover:bg-white/10 transition"
                >
                  {img ? (
                    <img src={img} className="w-full aspect-video object-cover" alt={title} />
                  ) : (
                    <div className="p-4 text-sm text-white/70">🖼️ {title}</div>
                  )}
                  <div className="p-3">
                    <div className="text-sm font-medium text-white/90 truncate">🖼️ {title}</div>
                    <div className="text-xs text-white/60 truncate">
                      {artId ? `Open /art/${artId}` : "Artwork link"}
                    </div>
                  </div>
                </Link>
              </div>
            );
          }

          if (m.kind === "post_share") {
            const postId = m.shared_post_id ?? null;
            return (
              <div key={key} className={`max-w-[70%] ${me ? "ml-auto" : "mr-auto"}`}>
                <div className={`${bubbleCardCls(me)} px-3 py-2 text-sm`}>
                  📌 Shared a post{postId ? ` • ${postId}` : ""}
                </div>
              </div>
            );
          }

          // text message + link unfurl
          const body = (m.body ?? "").trim();
          const embedded = (m.meta?.link_preview as LinkPreview | undefined) ?? undefined;
          const detectedUrl = extractUrls(body)[0];
          const preview = embedded || lpCache[key];

          const onlyUrl =
            !!detectedUrl &&
            body.replace(/\s+/g, "").toLowerCase() === detectedUrl.replace(/\s+/g, "").toLowerCase();

          // If it's ONLY a URL, render just the rich card (like your screenshot)
          if (onlyUrl && (preview?.url || detectedUrl)) {
            const p = preview?.url ? preview : ({ url: detectedUrl, siteName: shortHost(detectedUrl) } as LinkPreview);
            return <LinkUnfurlCard key={key} p={p} me={me} />;
          }

          return (
            <div key={key} className={`max-w-[70%] ${me ? "ml-auto" : "mr-auto"}`}>
              <div className={`${bubbleCardCls(me)} px-3 py-2 text-sm whitespace-pre-wrap`}>
                <LinkifyText text={body || "Message"} />
              </div>

              {preview?.url ? (
                <div className="mt-2">
                  <LinkUnfurlCard p={preview} me={me} />
                </div>
              ) : detectedUrl ? (
                <div className="mt-2">
                  <LinkUnfurlCard p={{ url: detectedUrl, siteName: shortHost(detectedUrl) } as LinkPreview} me={me} />
                </div>
              ) : null}
            </div>
          );
        })}

        <div ref={endRef} />
      </div>

      <div className="border-t border-white/10 p-3">
        {pendingAtt ? (
          <div className="mb-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <div className="flex items-start gap-3">
              <div className="w-28 h-20 rounded-xl overflow-hidden border border-white/10 bg-black">
                {pendingAtt.file.type.startsWith("video/") ? (
                  <video
                    src={pendingAtt.previewUrl}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                  />
                ) : (
                  <img
                    src={pendingAtt.previewUrl}
                    className="w-full h-full object-cover"
                    alt="draft"
                  />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm text-white/90 font-medium">Attachment ready</div>
                <div className="text-xs text-white/60 truncate">{pendingAtt.file.name}</div>

                <div className="mt-2 flex items-center gap-2">
                  <button
                    className="text-xs px-3 py-1.5 rounded-lg bg-white/10 text-white hover:bg-white/15"
                    onClick={() => {
                      setPickedFile(pendingAtt.file);
                      setEditOpen(true);
                    }}
                    disabled={busy}
                    title="Re-edit"
                  >
                    Edit
                  </button>

                  <button
                    className="text-xs px-3 py-1.5 rounded-lg bg-white/10 text-white hover:bg-white/15"
                    onClick={clearPending}
                    disabled={busy}
                    title="Remove"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-sm text-white/80 hover:bg-white/10"
            title="Upload media"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            📎
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              onPickMedia(f);
            }}
          />

          <button
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-sm text-white/80 hover:bg-white/10"
            title={recOn ? "Stop recording" : "Record voice"}
            onClick={() => (recOn ? stopRec() : startRec())}
            disabled={busy || recBusy}
          >
            {recOn ? "⏹️" : "🎤"}
          </button>

          <input
            className="input flex-1"
            placeholder={pendingAtt ? "Add a caption… (optional)" : "Type a message…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSendDraft();
              }
            }}
            disabled={busy}
          />

          <button className="btn" onClick={onSendDraft} disabled={busy || !canSend}>
            {busy ? "…" : "Send"}
          </button>
        </div>

        {recOn ? <div className="mt-2 text-xs text-amber-200">Recording… press ⏹️ to send</div> : null}
      </div>

      <MediaEditModal
        open={editOpen}
        file={pickedFile}
        onCancel={() => {
          setEditOpen(false);
          setPickedFile(null);
        }}
        onConfirm={onEditedConfirm}
      />
    </div>
  );
}
