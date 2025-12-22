// C:\Users\User\Downloads\taedal-v7\app\src\features\messages\ShareToDMModal.tsx

import React, { useEffect, useState } from "react";
import { dmGetOrCreateThread, dmListFriends, dmSendArtworkShare } from "./api";
import type { DMFriendRow } from "./types";

export default function ShareToDMModal({
  open,
  onClose,
  artwork,
}: {
  open: boolean;
  onClose: () => void;
  artwork: { id: string; title: string | null; image_url: string | null };
}) {
  const [rows, setRows] = useState<DMFriendRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let alive = true;

    (async () => {
      setErr(null);
      setBusy(true);
      try {
        const f = await dmListFriends();
        if (!alive) return;
        setRows(f);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Failed to load friends");
      } finally {
        if (!alive) return;
        setBusy(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open]);

  async function onSend(toUserId: string) {
    setErr(null);
    setBusy(true);

    try {
      const threadId = await dmGetOrCreateThread(toUserId);

      // ✅ IMPORTANT: artwork_share must set shared_artwork_id (DB constraint)
      await dmSendArtworkShare(threadId, artwork.id, {
        title: artwork.title ?? "Untitled",
        image_url: artwork.image_url,
      });

      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to send");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-950 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-lg font-semibold">Send artwork</div>
          <button className="text-sm text-white/70 hover:text-white" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 flex gap-3">
          {artwork.image_url ? (
            <img
              src={artwork.image_url}
              className="h-14 w-14 rounded-lg object-cover border border-white/10"
              alt={artwork.title ?? "Artwork"}
            />
          ) : (
            <div className="h-14 w-14 rounded-lg bg-white/5 border border-white/10" />
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium text-white/90 truncate">
              {artwork.title ?? "Untitled"}
            </div>
            <div className="text-xs text-white/60 truncate">/art/{artwork.id}</div>
          </div>
        </div>

        {err ? <div className="mb-2 text-sm text-red-300">{err}</div> : null}
        {busy ? <div className="text-sm text-white/60 p-2">Loading…</div> : null}

        <div className="max-h-[50vh] overflow-auto divide-y divide-white/10 rounded-xl border border-white/10">
          {rows.length === 0 && !busy ? (
            <div className="p-3 text-sm text-white/60">No friends yet.</div>
          ) : (
            rows.map((r) => {
              const name = r.other_username ?? r.other_display_name ?? "User";
              return (
                <button
                  key={r.other_user_id}
                  className="w-full text-left p-3 hover:bg-white/5 transition flex items-center justify-between gap-3"
                  onClick={() => onSend(r.other_user_id)}
                  disabled={busy}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {r.other_avatar_url ? (
                      <img
                        src={r.other_avatar_url}
                        className="h-9 w-9 rounded-full object-cover border border-white/10"
                        alt={name}
                      />
                    ) : (
                      <div className="h-9 w-9 rounded-full bg-white/5 border border-white/10" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm text-white/90 font-medium">{name}</div>
                      <div className="truncate text-xs text-white/60">Send via DM</div>
                    </div>
                  </div>

                  <span className="text-xs rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-white/80">
                    Send
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="mt-2 text-xs text-white/40">
          Tip: after sending, we’ll open Messages on that thread.
        </div>
      </div>
    </div>
  );
}
