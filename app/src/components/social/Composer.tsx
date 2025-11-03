import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

/**
 * Simple Composer: caption + visibility + optional media (images/videos).
 * - Inserts into `posts` (author_id = auth.uid()).
 * - Uploads media to Storage bucket `post-media` under {uid}/{postId}/{filename}.
 * - Inserts rows into `post_media`.
 *
 * Props:
 *   onPosted?: () => void   // called after successful post (for refreshing the feed)
 */
export default function Composer({ onPosted }: { onPosted?: () => void }) {
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] =
    useState<"public" | "followers">("public");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filePreview = useMemo(
    () =>
      files.map((f) => ({
        name: f.name,
        url: URL.createObjectURL(f),
        kind: f.type.startsWith("video/") ? ("video" as const) : ("image" as const),
      })),
    [files]
  );

  useEffect(() => {
    return () => {
      // cleanup object URLs
      filePreview.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [filePreview]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const text = caption.trim();
    if (!text && files.length === 0) return;

    setSubmitting(true);
    try {
      // 1) who am I?
      const { data: auth } = await supabase.auth.getSession();
      const uid = auth.session?.user?.id;
      if (!uid) throw new Error("Please sign in.");

      // 2) create post
      const { data: postRow, error: postErr } = await supabase
        .from("posts")
        .insert({
          author_id: uid,
          caption: text || null,
          visibility,
          listing_id: null,
        })
        .select("*")
        .single();

      if (postErr) throw postErr;
      const postId = postRow.id as string;

      // 3) upload each file (if any) to storage + create post_media row
      if (files.length) {
        const bucket = supabase.storage.from("post-media");

        // upload sequentially to keep payload small & avoid rate limits
        for (const f of files) {
          const path = `${uid}/${postId}/${Date.now()}_${safeName(f.name)}`;
          const { error: upErr } = await bucket.upload(path, f, {
            cacheControl: "3600",
            upsert: false,
          });
          if (upErr) throw upErr;

          // public URL (for MVP you can keep bucket public)
          const { data: pub } = bucket.getPublicUrl(path);

          // detect basic metadata
          const kind: "image" | "video" = f.type.startsWith("video/")
            ? "video"
            : "image";

          await supabase.from("post_media").insert({
            post_id: postId,
            url: pub.publicUrl,
            kind,
          });
        }
      }

      // 4) reset form
      setCaption("");
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";

      // 5) let parent refresh
      onPosted?.();
    } catch (err: any) {
      alert(err?.message || "Failed to post.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-neutral-800 bg-neutral-900 p-3 space-y-3"
    >
      <textarea
        className="w-full resize-none rounded-lg bg-neutral-800/70 border border-neutral-700 px-3 py-2 outline-none focus:border-neutral-500"
        rows={3}
        placeholder="Share something…"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
      />

      {/* media preview */}
      {!!filePreview.length && (
        <div className="grid grid-cols-3 gap-2">
          {filePreview.map((p) =>
            p.kind === "video" ? (
              <video
                key={p.url}
                src={p.url}
                className="w-full rounded-lg"
                controls
                playsInline
                muted
              />
            ) : (
              <img
                key={p.url}
                src={p.url}
                className="w-full h-28 object-cover rounded-lg"
                alt=""
              />
            )
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="cursor-pointer text-sm px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              hidden
              onChange={(e) => {
                const f = Array.from(e.target.files || []);
                setFiles((prev) => [...prev, ...f]);
              }}
            />
            Add media
          </label>

          {!!files.length && (
            <button
              type="button"
              className="text-sm px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
              onClick={() => {
                setFiles([]);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              Clear media
            </button>
          )}

          <select
            value={visibility}
            onChange={(e) =>
              setVisibility(e.target.value as "public" | "followers")
            }
            className="text-sm rounded bg-neutral-800 border border-neutral-700 px-2 py-1"
          >
            <option value="public">Public</option>
            <option value="followers">Followers</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={submitting || (!caption.trim() && files.length === 0)}
          className="btn disabled:opacity-50"
        >
          {submitting ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}

function safeName(s: string) {
  return s.replace(/[^\w.\-]+/g, "_");
}
