import { useEffect, useRef } from "react";
import Composer from "../../components/social/Composer";
import PostCard from "../../components/social/PostCard";
import { useFeed } from "../../hooks/useFeed";

export default function Feed() {
  const { loading, error, items, hasMore, loadMore, refresh } = useFeed(20);

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) loadMore();
        });
      },
      { rootMargin: "1000px 0px 1000px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  useEffect(() => {
    document.title = "Social — taedal";
  }, []);

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-4">
      <Composer onPosted={refresh} />

      {error && <div className="text-amber-300 text-sm">{error}</div>}

      {loading && items.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-64 rounded-xl bg-neutral-900 border border-neutral-800 animate-pulse"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card text-sm text-neutral-400">
          No posts yet. Be the first to share!
        </div>
      ) : (
        <div className="space-y-4">
          {items.map(({ post, media, author }) => (
            <PostCard
              key={post.id}
              post={post}
              media={media}
              author={author}
              onDeleted={refresh}
            />
          ))}
        </div>
      )}

      <div ref={sentinelRef} />
      {hasMore && (
        <div className="pt-2">
          <button className="btn w-full" onClick={loadMore}>
            Load more
          </button>
        </div>
      )}
    </main>
  );
}
