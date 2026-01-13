import React, { useEffect, useMemo, useState } from "react";
import type { DMThreadRow, DMFriendRow } from "./types";
import { dmAcceptThread, dmListFriends, dmListThreads } from "./api";
import ThreadList from "./ThreadList";
import ChatView from "./ChatView";
import { supabase } from "../../lib/supabase";
import { useSearchParams } from "react-router-dom";

function makeFriendStub(f: DMFriendRow): DMThreadRow {
  const display = f.other_username ?? f.other_display_name ?? "User";

  return {
    thread_id: f.thread_id ?? `friend:${f.other_user_id}`, // synthetic id if no thread yet
    other_user_id: f.other_user_id,
    other_username: display,
    other_avatar_url: f.other_avatar_url,

    accepted_by_me: true,
    accepted_by_other: true,

    is_request: false,
    is_friend: true,

    last_message_at: null,
    last_message_preview: null,

    streak_count: 0,
    streak_visible: false,
  };
}

export default function MessagesPage() {
  const [sp, setSp] = useSearchParams();

  const [meId, setMeId] = useState<string | null>(null);
  const [tab, setTab] = useState<"inbox" | "requests">("inbox");
  const [threads, setThreads] = useState<DMThreadRow[]>([]);
  const [selected, setSelected] = useState<DMThreadRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const desiredThreadId = sp.get("t");
  const draftFromUrl = sp.get("draft") || "";

  const mergedInbox = useMemo(() => threads, [threads]);

  async function refreshThreads(nextTab = tab) {
    setErr(null);
    setBusy(true);

    try {
      const base = await dmListThreads(nextTab);

      // Inbox: merge friends (mutual follows) even if no thread exists
      if (nextTab === "inbox") {
        const friends = await dmListFriends();

        const byThreadId = new Set(base.map((t) => t.thread_id));
        const byOtherId = new Set(base.map((t) => t.other_user_id));

        const out: DMThreadRow[] = [...base];

        for (const f of friends) {
          // avoid duplicating someone already shown via a real dm_thread row
          if (byOtherId.has(f.other_user_id)) continue;

          const stub = makeFriendStub(f);

          // avoid duplicates by thread id if backend gave thread_id
          if (f.thread_id && byThreadId.has(f.thread_id)) continue;

          // avoid duplicates by synthetic id
          if (!f.thread_id && byThreadId.has(stub.thread_id)) continue;

          out.push(stub);
        }

        setThreads(out);

        // selection logic
        setSelected((prev) => {
          // 1) URL param
          if (desiredThreadId) {
            const found = out.find((t) => t.thread_id === desiredThreadId);
            if (found) return found;
          }

          // 2) keep current selection
          if (prev) {
            const same = out.find((t) => t.thread_id === prev.thread_id);
            if (same) return same;

            // if friend stub became real thread later, keep by other_user_id
            const byOther = out.find((t) => t.other_user_id === prev.other_user_id);
            if (byOther) return byOther;
          }

          // 3) fallback first
          return out[0] ?? null;
        });

        return;
      }

      // Requests: normal
      setThreads(base);
      setSelected((prev) => {
        if (desiredThreadId) {
          const found = base.find((t) => t.thread_id === desiredThreadId);
          if (found) return found;
        }
        if (prev) {
          const same = base.find((t) => t.thread_id === prev.thread_id);
          if (same) return same;
        }
        return base[0] ?? null;
      });
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load threads");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      setMeId(data.user?.id ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!meId) return;
    refreshThreads(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, meId, desiredThreadId]);

  async function onAccept(t: DMThreadRow) {
    setErr(null);
    try {
      await dmAcceptThread(t.thread_id);
      await refreshThreads(tab);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to accept");
    }
  }

  function onSelectThread(t: DMThreadRow) {
    setSelected(t);
    setSp(
      (cur) => {
        const copy = new URLSearchParams(cur);
        copy.set("t", t.thread_id);
        // keep draft if it exists (so selecting doesn’t wipe it)
        if (cur.get("draft")) copy.set("draft", cur.get("draft") as string);
        return copy;
      },
      { replace: true }
    );
  }

  if (!meId) {
    return <div className="p-6 text-sm text-white/60">Please sign in to view messages.</div>;
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xl font-semibold text-white/90">Messages</div>
          <div className="text-sm text-white/50">Inbox + TikTok-style Requests</div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setTab("inbox")}
            className={[
              "rounded-xl border px-3 py-2 text-sm",
              tab === "inbox"
                ? "border-white/20 bg-white/10 text-white/90"
                : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10",
            ].join(" ")}
          >
            Inbox
          </button>
          <button
            onClick={() => setTab("requests")}
            className={[
              "rounded-xl border px-3 py-2 text-sm",
              tab === "requests"
                ? "border-white/20 bg-white/10 text-white/90"
                : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10",
            ].join(" ")}
          >
            Requests
          </button>
        </div>
      </div>

      {err ? <div className="mb-3 text-sm text-red-300">{err}</div> : null}

      <div className="grid grid-cols-12 gap-4 h-[calc(100vh-160px)]">
        <div className="col-span-4 rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
          <div className="border-b border-white/10 p-3 text-sm text-white/70 flex items-center justify-between">
            <span>{tab === "inbox" ? "Inbox" : "Requests"}</span>
            <button
              onClick={() => refreshThreads(tab)}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
            >
              Refresh
            </button>
          </div>

          {busy ? <div className="p-3 text-sm text-white/60">Loading…</div> : null}

          <ThreadList
            threads={tab === "inbox" ? mergedInbox : threads}
            selectedThreadId={selected?.thread_id ?? null}
            onSelect={onSelectThread}
            onAccept={onAccept}
          />
        </div>

        <div className="col-span-8 rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
          {selected ? (
            <ChatView
              meId={meId}
              thread={selected}
              onThreadMetaMaybeChanged={() => refreshThreads(tab)}
              draftText={draftFromUrl}
              onDraftConsumed={() => {
                // Remove draft once ChatView has applied it (prevents reapplying on rerender)
                setSp(
                  (cur) => {
                    const copy = new URLSearchParams(cur);
                    copy.delete("draft");
                    return copy;
                  },
                  { replace: true }
                );
              }}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-white/60">
              Select a conversation.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
