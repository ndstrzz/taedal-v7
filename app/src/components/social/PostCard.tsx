import { useEffect, useState } from "react";
import type { MiniProfile, Post, PostMedia } from "../../hooks/useFeed";
import { useFeed } from "../../hooks/useFeed";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";

type Props = {
  post: Post;
  media: PostMedia[];
  author: MiniProfile | null;
  /** optional: parent can force-refresh the feed after deletion */
  onDeleted?: () => void;
};

export default function PostCard({ post, media, author, onDeleted }: Props) {
  const { toggleLike, addComment } = useFeed(); // using hook methods is fine
  const [commenting, setCommenting] = useState(false);
  const [text, setText] = useState("");

  // caption folding
  const [expanded, setExpanded] = useState(false);
  const CAP_LEN = 180;
  const caption = post.caption || "";
  const isLong = caption.length > CAP_LEN;
  const shown = !isLong || expanded ? caption : caption.slice(0, CAP_LEN) + "…";

  // author name
  const display = author?.display_name?.trim() || author?.username || "User";

  // author-only delete
  const [uid, setUid] = useState<string | null>(null);
  const canDelete = !!uid && !!author?.id && uid === author.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUid(data.session?.user?.id ?? null);
    });
  }, []);

  async function handleDelete() {
    if (!canDelete) return;
    if (!confirm("Delete this post? This action cannot be undone.")) return;

    try {
      // Best-effort cleanup: related rows first, then the post.
      await supabase.from("post_media").delete().eq("post_id", post.id);
      await supabase.from("post_comments").delete().eq("post_id", post.id);
      await supabase.from("post_likes").delete().eq("post_id", post.id);
      const { error } = await supabase
        .from("posts")
        .delete()
        .match({ id: post.id, author_id: uid! });
      if (error) throw error;

      onDeleted?.(); // parent will refresh the feed
    } catch (e: any) {
      alert(e?.message || "Failed to delete post.");
    }
  }

  return (
    <article className="rounded-2xl border border-neutral-800 bg-neutral-900 overflow-hidden">
      {/* Header */}
      <div className="p-3 flex items-center gap-3">
        <img
          src={author?.avatar_url || "/images/taedal-logo.svg"}
          className="h-9 w-9 rounded-full object-cover"
          alt=""
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <Link to={`/u/${author?.username || author?.id}`} className="block font-semibold truncate">
            {display}
          </Link>
          <div className="text-xs text-neutral-400">
            {new Date(post.created_at).toLocaleString()}
          </div>
        </div>

        {canDelete && (
          <button
            onClick={handleDelete}
            className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
            title="Delete post"
          >
            Delete
          </button>
        )}
      </div>

      {/* Caption (foldable) */}
      {caption && (
        <div className="px-3 pb-2 whitespace-pre-wrap">
          {shown}
          {isLong && (
            <button
              type="button"
              className="ml-2 text-sky-400 hover:underline text-sm"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      {/* Media grid */}
      {!!media.length && (
        <div className="grid grid-cols-2 gap-1 px-2 pb-2">
          {media.map((m) =>
            m.kind === "video" ? (
              <video key={m.id} src={m.url} className="w-full rounded-lg" controls playsInline />
            ) : (
              <img key={m.id} src={m.url} className="w-full rounded-lg object-cover" loading="lazy" />
            )
          )}
        </div>
      )}

      {/* Actions */}
      <div className="px-3 py-2 flex items-center gap-3 text-sm">
        <button
          className={`px-2 py-1 rounded ${post.did_like ? "bg-neutral-700" : "bg-neutral-800 hover:bg-neutral-700"}`}
          onClick={() => toggleLike(post.id, !post.did_like)}
          title={post.did_like ? "Unlike" : "Like"}
        >
          ♥ {post.like_count ?? 0}
        </button>
        <button
          className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
          onClick={() => setCommenting((v) => !v)}
          title="Comment"
        >
          💬 {post.comment_count ?? 0}
        </button>
      </div>

      {/* Comment box */}
      {commenting && (
        <form
          className="p-3 border-t border-neutral-800 flex items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const v = text.trim();
            if (!v) return;
            await addComment(post.id, v);
            setText("");
            setCommenting(false);
          }}
        >
          <input
            className="input flex-1"
            placeholder="Write a comment…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn" type="submit">
            Send
          </button>
        </form>
      )}
    </article>
  );
}
