// app/src/routes/art/ArtworkDetail.tsx
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  createOrUpdateFixedPriceListing,
  fetchActiveListingForArtwork,
  type Listing,
} from "../../lib/listings";
import { buyNow } from "../../lib/orders";


type Artwork = {
  id: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  creator_id: string;
  owner_id: string | null;
  created_at: string;
  ipfs_image_cid?: string | null;
  ipfs_metadata_cid?: string | null;
  token_uri?: string | null;
};

type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type PinResp = {
  imageCID: string;
  metadataCID: string;
  tokenURI: string;
};

export default function ArtworkDetail() {
  const { id } = useParams();
  const [viewerId, setViewerId] = useState<string | null>(null);

  const [art, setArt] = useState<Artwork | null>(null);
  const [creator, setCreator] = useState<Profile | null>(null);
  const [owner, setOwner] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  // Listing state (from listings table)
  const [activeListing, setActiveListing] = useState<Listing | null>(null);

  // Pinning
  const [pinLoading, setPinLoading] = useState(false);
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [pinData, setPinData] = useState<PinResp | null>(null);

  // who am I?
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setViewerId(data.session?.user?.id ?? null);
    })();
  }, []);

  // load artwork + creator/owner + active listing
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setMsg(null);
      try {
        const { data, error } = await supabase
          .from("artworks")
          .select(
            "id,title,description,image_url,creator_id,owner_id,created_at,ipfs_image_cid,ipfs_metadata_cid,token_uri"
          )
          .eq("id", id!)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          setMsg("Artwork not found.");
          setArt(null);
          return;
        }
        if (!alive) return;
        setArt(data as Artwork);

        const [c, o, l] = await Promise.all([
          supabase
            .from("profiles")
            .select("id,username,display_name,avatar_url")
            .eq("id", data.creator_id)
            .maybeSingle(),
          data.owner_id
            ? supabase
                .from("profiles")
                .select("id,username,display_name,avatar_url")
                .eq("id", data.owner_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          fetchActiveListingForArtwork(data.id),
        ]);

        if (!alive) return;
        setCreator((c.data as any) ?? null);
        setOwner((o?.data as any) ?? null);
        setActiveListing(l);
      } catch (e: any) {
        setMsg(e?.message || "Failed to load artwork.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  async function handlePin() {
    if (!art?.id) return;
    setPinLoading(true);
    setPinErr(null);
    setPinData(null);
    try {
      const { data, error } = await supabase.functions.invoke("pin-artwork", {
        body: { artwork_id: art.id },
      });
      if (error) throw error;
      setPinData(data as PinResp);

      // refresh artwork fields that pin-artwork updates
      const fresh = await supabase
        .from("artworks")
        .select(
          "id,title,description,image_url,creator_id,owner_id,created_at,ipfs_image_cid,ipfs_metadata_cid,token_uri"
        )
        .eq("id", art.id)
        .maybeSingle();
      if (fresh.data) setArt(fresh.data as Artwork);
    } catch (e: any) {
      setPinErr(e?.message ?? "Pin failed.");
    } finally {
      setPinLoading(false);
    }
  }

  // BUY NOW handler
  async function onBuy() {
    if (!activeListing || !art) return;
    try {
      setMsg("Processing purchase…");
      await buyNow(activeListing.id, 1);
      setMsg("Purchase complete ✅");

      // refresh owner + listing
      const freshArt = await supabase
        .from("artworks")
        .select(
          "id,title,description,image_url,creator_id,owner_id,created_at,ipfs_image_cid,ipfs_metadata_cid,token_uri"
        )
        .eq("id", art.id)
        .maybeSingle();
      if (freshArt.data) setArt(freshArt.data as Artwork);

      const l = await fetchActiveListingForArtwork(art.id);
      setActiveListing(l);
    } catch (e: any) {
      setMsg(e?.message ?? "Purchase failed");
    }
  }

  if (loading) return <div className="p-6">loading…</div>;
  if (!art) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        {msg ? <p className="text-amber-300">{msg}</p> : null}
        <Link to="/" className="btn mt-4 inline-block">
          Back home
        </Link>
      </div>
    );
  }

  const creatorHandle = creator?.username
    ? `/u/${creator.username}`
    : creator
    ? `/u/${creator.id}`
    : "#";

  const ownerHandle =
    owner?.username ? `/u/${owner.username}` : owner ? `/u/${owner.id}` : null;

  const isOwner = !!viewerId && !!art.owner_id && viewerId === art.owner_id;
  const isSeller = !!activeListing && viewerId === activeListing.seller_id;
  const canBuy = !!activeListing && !!viewerId && !isSeller;

  return (
    <div className="max-w-6xl mx-auto p-6 grid gap-6 md:grid-cols-[1.2fr,0.8fr]">
      <div className="rounded-xl overflow-hidden border border-neutral-800 bg-neutral-900">
        {art.image_url ? (
          <img
            src={art.image_url}
            alt={art.title ?? "Artwork"}
            className="w-full h-full object-contain bg-neutral-900"
          />
        ) : (
          <div className="aspect-square grid place-items-center text-neutral-400">
            No image
          </div>
        )}
      </div>

      <div className="space-y-4">
        {msg && <p className="text-sm text-amber-300">{msg}</p>}

        <div>
          <h1 className="text-2xl font-bold">{art.title || "Untitled"}</h1>
          <p className="text-sm text-neutral-400">
            Minted {new Date(art.created_at).toLocaleDateString()}
          </p>
        </div>

        <div className="card space-y-3">
          <div className="flex items-center gap-3">
            {creator?.avatar_url ? (
              <img
                src={creator.avatar_url}
                alt="creator avatar"
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : null}
            <div className="text-sm">
              <div>
                By{" "}
                {creator ? (
                  <Link to={creatorHandle} className="underline">
                    {creator.display_name || creator.username || "Creator"}
                  </Link>
                ) : (
                  "—"
                )}
              </div>
              {owner && (
                <div className="text-neutral-400">
                  Owner{" "}
                  <Link to={ownerHandle!} className="underline">
                    {owner.display_name || owner.username || "Collector"}
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>

        {art.description && (
          <div className="card">
            <h3 className="font-semibold mb-2">Description</h3>
            <p className="text-sm whitespace-pre-wrap">{art.description}</p>
          </div>
        )}

        {/* Listing (from listings table) */}
        <div className="card">
          <h3 className="font-semibold mb-2">Listing</h3>
          {activeListing ? (
            <p>
              {activeListing.fixed_price} {activeListing.sale_currency}
            </p>
          ) : (
            <p className="text-sm text-neutral-400">Not currently listed.</p>
          )}
        </div>

        {/* Buy Now (visible if there is a listing and you are not the seller) */}
        {canBuy && (
          <div className="card space-y-2">
            <div className="text-sm font-medium">Buy now</div>
            <button className="btn" onClick={onBuy}>
              Buy for {activeListing?.fixed_price} {activeListing?.sale_currency}
            </button>
            <div className="text-[11px] text-neutral-500">
              (Transfers ownership immediately for MVP.)
            </div>
          </div>
        )}

        {/* Owner-only: List for sale panel */}
        {isOwner && (
          <OwnerListPanel
            artworkId={art.id}
            onUpdated={async () => {
              const l = await fetchActiveListingForArtwork(art.id);
              setActiveListing(l);
            }}
          />
        )}

        {/* IPFS section */}
        <div className="card">
          <h3 className="font-semibold">IPFS</h3>

          {art.token_uri ? (
            <div className="text-xs space-y-1 mt-2">
              <div>✅ Already pinned</div>
              {art.ipfs_image_cid && (
                <div>
                  Image CID: <code>{art.ipfs_image_cid}</code>
                </div>
              )}
              {art.ipfs_metadata_cid && (
                <div>
                  Metadata CID: <code>{art.ipfs_metadata_cid}</code>{" "}
                  <a
                    className="underline"
                    href={`https://gateway.pinata.cloud/ipfs/${art.ipfs_metadata_cid}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open metadata
                  </a>
                </div>
              )}
              <div>
                Token URI: <code>{art.token_uri}</code>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                className="btn"
                onClick={handlePin}
                disabled={
                  pinLoading ||
                  !(viewerId && (viewerId === art.creator_id || viewerId === art.owner_id))
                }
                title={
                  viewerId && (viewerId === art.creator_id || viewerId === art.owner_id)
                    ? ""
                    : "Only the creator/owner can pin"
                }
              >
                {pinLoading ? "Pinning…" : "Pin to IPFS"}
              </button>
              {pinErr && <span className="text-rose-400 text-sm">{pinErr}</span>}
              {pinData && (
                <span className="text-xs text-neutral-300">
                  ✅ Pinned — CID: <code>{pinData.metadataCID}</code>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="font-semibold mb-2">Price history</h3>
          <p className="text-sm text-neutral-400">
            Chart coming soon. We’ll plot points from <code>artwork_prices</code>.
          </p>
        </div>

        <div className="flex gap-2">
          <Link to="/" className="btn">
            Back
          </Link>
          {creator && (
            <Link to={creatorHandle} className="btn">
              View creator
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Owner List Panel ---------- */

function OwnerListPanel({
  artworkId,
  onUpdated,
}: {
  artworkId: string;
  onUpdated: () => Promise<void> | void;
}) {
  const [price, setPrice] = useState<string>("");
  const [currency, setCurrency] = useState<string>("ETH");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onList() {
    setBusy(true);
    setMsg(null);
    try {
      const p = Number(price);
      if (!isFinite(p) || p <= 0) throw new Error("Enter a valid price");
      await createOrUpdateFixedPriceListing(artworkId, p, currency);
      setMsg("Listing is live ✅");
      await onUpdated();
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to list");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-2">
      <div className="text-sm font-medium">List this artwork</div>
      <div className="flex gap-2 items-center">
        <input
          className="input w-32"
          placeholder="Price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          type="number"
          step="0.00000001"
          min="0"
        />
        <select
          className="input w-28"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          <option value="ETH">ETH</option>
        </select>
        <button className="btn" onClick={onList} disabled={busy}>
          {busy ? "Listing…" : "List for sale"}
        </button>
      </div>
      {msg && <div className="text-xs text-neutral-300">{msg}</div>}
      <div className="text-[11px] text-neutral-500">
        (Creates/updates a fixed-price listing visible on Explore.)
      </div>
    </div>
  );
}
