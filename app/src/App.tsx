// app/src/App.tsx
import { Suspense, useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
} from "react-router-dom";

/* ---- layout ---- */
import Topbar from "./components/Topbar";

/* ---- pages ---- */
import CreateArtwork from "./routes/create/CreateArtwork";
import ArtworkDetail from "./routes/art/ArtworkDetail";
import CheckoutSuccess from "./routes/checkout/Success";
import PublicProfile from "./routes/profiles/PublicProfile";

/* ---- libs ---- */
import { fetchActiveListings, type JoinedListing } from "./lib/listings";

/* ---- styles ---- */
import "./App.css";

/* ----------------------------------------- */
/* Explore (Home)                            */
/* ----------------------------------------- */
function Explore() {
  const [items, setItems] = useState<JoinedListing[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setMsg(null);
      try {
        const data = await fetchActiveListings(30);
        if (!alive) return;
        setItems(data);
      } catch (e: any) {
        if (!alive) return;
        setMsg(e?.message ?? "Failed to load listings.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="h-7 w-40 bg-white/10 rounded mb-3 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden">
              <div className="aspect-square bg-white/10 animate-pulse" />
              <div className="p-3 space-y-2">
                <div className="h-4 w-2/3 bg-white/10 rounded animate-pulse" />
                <div className="h-3 w-1/2 bg-white/10 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Explore</h1>
      {msg && <p className="text-amber-300 text-sm mb-3">{msg}</p>}
      {!items || items.length === 0 ? (
        <div className="text-white/70">
          No active listings yet. Be the first to{" "}
          <Link className="underline" to="/create">create</Link> one.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((l) => (
            <Link
              key={l.id}
              to={`/art/${l.artwork_id}`}
              className="group rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden hover:border-white/30 transition"
            >
              <div className="aspect-square bg-neutral-950">
                {l.artworks?.image_url ? (
                  <img
                    src={l.artworks.image_url}
                    alt={l.artworks.title ?? "Artwork"}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-white/40">
                    No image
                  </div>
                )}
              </div>
              <div className="p-3">
                <div className="truncate font-medium">
                  {l.artworks?.title || "Untitled"}
                </div>
                <div className="text-sm text-white/70 mt-0.5">
                  {l.fixed_price != null && l.sale_currency
                    ? `${l.fixed_price} ${l.sale_currency}`
                    : l.type === "auction"
                      ? "Auction"
                      : "—"}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------- */
/* 404                                       */
/* ----------------------------------------- */
function NotFound() {
  return (
    <div className="max-w-xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
      <p className="text-white/70">The page you’re looking for doesn’t exist.</p>
      <div className="mt-4">
        <Link to="/" className="btn">Back home</Link>
      </div>
    </div>
  );
}

/* ----------------------------------------- */
/* App shell + routes                        */
/* ----------------------------------------- */
function App() {
  return (
    <BrowserRouter>
      <div className="min-h-dvh bg-neutral-950 text-white">
        <Topbar />

        <Suspense
          fallback={
            <div className="max-w-7xl mx-auto p-6">
              <div className="h-6 w-48 bg-white/10 rounded animate-pulse" />
              <div className="mt-4 h-4 w-72 bg-white/10 rounded animate-pulse" />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Explore />} />
            <Route path="/create" element={<CreateArtwork />} />
            <Route path="/art/:id" element={<ArtworkDetail />} />

            {/* Public profile routes (support both /u/:handle and legacy /profiles/:handle) */}
            <Route path="/u/:handle" element={<PublicProfile />} />
            <Route path="/profiles/:handle" element={<PublicProfile />} />

            {/* Stripe success landing */}
            <Route path="/checkout/success" element={<CheckoutSuccess />} />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </div>
    </BrowserRouter>
  );
}

export default App;
