//C:\Users\User\Downloads\taedal-v7\app\src\routes\app\Dashboard.tsx
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { apiFetch } from "../../lib/api";

export default function Dashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [artworkId, setArtworkId] = useState("");
  const [listingId, setListingId] = useState("");
  const [price, setPrice] = useState<number>(0);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null);
    });
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/signin";
  };

  const createListing = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!token) return setMsg("Not signed in");

    // Minimal payload for fixed-price active listing
    const res = await apiFetch("/api/listings", {
      method: "POST",
      body: JSON.stringify({
        artwork_id: artworkId,
        type: "fixed_price",
        status: "active",
        sale_currency: "USD",
        fixed_price: Number(price),
        quantity: 1
      })
    }, token);

    const data = await res.json();
    if (!res.ok) {
      setMsg("Error: " + (data?.error ?? "unknown"));
    } else {
      setListingId(data.id);
      setMsg("Listing created: " + data.id);
    }
  };

  const buyNow = async () => {
    setMsg(null);
    if (!token) return setMsg("Not signed in");
    if (!listingId) return setMsg("Create or paste a listingId first");

    const res = await apiFetch("/api/checkout", {
      method: "POST",
      body: JSON.stringify({ listing_id: listingId, quantity: 1 })
    }, token);
    const data = await res.json();
    if (!res.ok) return setMsg("Error: " + (data?.error ?? "unknown"));
    window.location.href = data.checkout_url; // redirect to Stripe
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Taedal — Dashboard</h1>
        <button className="btn" onClick={signOut}>Sign out</button>
      </header>

      <section className="card space-y-3">
        <h2 className="font-semibold">Create Fixed-Price Listing</h2>
        <form onSubmit={createListing} className="grid gap-3">
          <input className="input" placeholder="Artwork ID (UUID)"
            value={artworkId} onChange={e=>setArtworkId(e.target.value)} />
          <input className="input" placeholder="Fixed price (e.g. 19.99 USD)"
            type="number" step="0.01"
            value={price} onChange={e=>setPrice(Number(e.target.value))} />
          <button className="btn" type="submit">Create Listing</button>
        </form>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Buy Now</h2>
        <input className="input" placeholder="Listing ID (UUID)"
          value={listingId} onChange={e=>setListingId(e.target.value)} />
        <button className="btn" onClick={buyNow}>Go to Stripe Checkout</button>
      </section>

      {msg && <p className="text-sm text-amber-300">{msg}</p>}
    </div>
  );
}
