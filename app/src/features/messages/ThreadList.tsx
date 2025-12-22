import React from "react";
import type { DMThreadRow } from "./types";

function initials(name: string) {
  const s = (name || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/);
  return (parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "");
}

export default function ThreadList({
  threads,
  selectedThreadId,
  onSelect,
  onAccept,
}: {
  threads: DMThreadRow[];
  selectedThreadId: string | null;
  onSelect: (t: DMThreadRow) => void;
  onAccept: (t: DMThreadRow) => void;
}) {
  return (
    <div className="h-full overflow-auto">
      {threads.length === 0 ? (
        <div className="p-4 text-sm text-white/60">No conversations yet.</div>
      ) : (
        <div className="divide-y divide-white/10">
          {threads.map((t) => {
            const name = t.other_username ?? "User";
            const active = selectedThreadId === t.thread_id;

            // If I accepted but they haven't, it’s pending on their side (common for non-friends)
            const pendingForThem = t.accepted_by_me && !t.accepted_by_other;

            // Requests: they messaged me first (or not mutual) and I haven't accepted
            const isRequest = t.is_request;

            return (
              <button
                key={t.thread_id}
                onClick={() => onSelect(t)}
                className={[
                  "w-full text-left p-3 transition",
                  "hover:bg-white/5",
                  active ? "bg-white/5" : "",
                  isRequest ? "relative" : "",
                ].join(" ")}
              >
                {/* subtle left accent for requests */}
                {isRequest ? (
                  <div className="absolute left-0 top-0 h-full w-[3px] bg-amber-400/40" />
                ) : null}

                <div className="flex items-center gap-3">
                  {t.other_avatar_url ? (
                    <img
                      src={t.other_avatar_url}
                      alt={name}
                      className="h-10 w-10 rounded-full object-cover border border-white/10"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full border border-white/10 bg-white/5 flex items-center justify-center text-xs text-white/70">
                      {initials(name)}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate font-medium text-white/90">{name}</div>

                      {t.is_friend ? (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-200 border border-emerald-500/20">
                          Friends
                        </span>
                      ) : null}

                      {isRequest ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-200 border border-amber-500/20">
                          Request
                        </span>
                      ) : pendingForThem ? (
                        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/70 border border-white/10">
                          Pending
                        </span>
                      ) : null}
                    </div>

                    <div className="truncate text-xs text-white/60">
                      {t.last_message_preview ?? (isRequest ? "New request 👋" : "Say hi 👋")}
                    </div>

                    {isRequest ? (
                      <div className="mt-1 text-[11px] text-amber-200/80">
                        Accept to move to Inbox and reply.
                      </div>
                    ) : null}
                  </div>

                  {isRequest ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onAccept(t);
                      }}
                      className={[
                        "shrink-0 rounded-xl px-3 py-1.5 text-xs font-medium",
                        "border border-amber-500/30",
                        "bg-amber-500/15 text-amber-200",
                        "hover:bg-amber-500/20",
                      ].join(" ")}
                      title="Accept request"
                    >
                      Accept
                    </button>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
