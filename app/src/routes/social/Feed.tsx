import { useEffect, useMemo, useRef } from "react";
import PostCard from "../../components/social/PostCard";
import { useFeed } from "../../hooks/useFeed";
import { useRealtimeSocial } from "../../hooks/useRealtimeSocial";

export default function Feed() {
  const { loading, error, items, hasMore, loadMore, refresh, toggleLike, addComment } = useFeed(20);

  useRealtimeSocial(() => refresh());

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const observer = useMemo(
    () =>
      new IntersectionObserver(
        (entries) => {
          const first = entries[0];
          if (first?.isIntersecting && hasMore && !loading) loadMore();
        },
        { rootMargin: "800px 0px 800px 0px" }
      ),
    [hasMore, loading, loadMore]
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    observer.observe(el);
    return () => observer.disconnect();
  }, [observer]);

  useEffect(() => {
    document.title = "Feed — taedal";
  }, []);

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-4">
      {error && (
        <div className="text-amber-300 text-sm border border-amber-700/40 bg-amber-900/20 rounded-lg p-2">
          {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-64 rounded-xl bg-neutral-900 border border-neutral-800 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card text-sm text-neutral-400">No posts yet. Be the first to share!</div>
      ) : (
        <div className="space-y-4">
          {items.map(({ post, media, author }) => (
            <PostCard
              key={post.id}
              post={post}
              media={media}
              author={author}
              onToggleLike={toggleLike}
              onAddComment={addComment}
              onDeleted={refresh}
            />
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-10" />

      {hasMore && (
        <div className="pt-2">
          <button className="btn w-full" onClick={loadMore} disabled={loading} aria-disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </main>
  );
}
