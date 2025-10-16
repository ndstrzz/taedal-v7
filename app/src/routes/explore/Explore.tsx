import { useEffect, useState } from "react";
import ArtworkCard from "../../components/ArtworkCard";
import { fetchActiveListings, type JoinedListing } from "../../lib/listings";

export default function Explore() {
  const [items, setItems] = useState<JoinedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [limit, setLimit] = useState(24);
  const [busyMore, setBusyMore] = useState(false);

  async function load(initial = false) {
    if (initial) {
      setLoading(true);
      setErr(null);
    }
    try {
      const rows = await fetchActiveListings(limit);
      setItems(rows);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load listings.");
    } finally {
      if (initial) setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMore() {
    setBusyMore(true);
    setLimit((prev) => prev + 24);
    try {
      const rows = await fetchActiveListings(limit + 24);
      setItems(rows);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load more.");
    } finally {
      setBusyMore(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Explore</h1>
        <p className="text-sm text-neutral-400">
          Active fixed-price listings from creators across the platform.
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-72 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900"
            />
          ))}
        </div>
      ) : err ? (
        <div className="text-rose-400 text-sm">{err}</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-neutral-400">
          No active listings yet. Check back soon!
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((row) => (
              <ArtworkCard
                key={row.id}
                id={row.artworks.id}
                title={row.artworks.title}
                image_url={row.artworks.image_url}
                price={row.fixed_price}
                currency={row.sale_currency ?? undefined}
              />
            ))}
          </div>

          <div className="mt-6 flex justify-center">
            <button
              className="btn"
              onClick={loadMore}
              disabled={busyMore}
              aria-busy={busyMore}
            >
              {busyMore ? "Loading…" : "Load more"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
