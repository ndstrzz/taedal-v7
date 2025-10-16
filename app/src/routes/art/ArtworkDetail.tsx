import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  createOrUpdateFixedPriceListing,
  fetchActiveListingForArtwork,
  type Listing,
} from "../../lib/listings";
import { buyNow } from "../../lib/orders";

/* ───────────────────────────── helper types ───────────────────────────── */

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

type ArtworkFile = { id: string; url: string; kind: string | null; position: number | null };

type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type PinResp = { imageCID: string; metadataCID: string; tokenURI: string };

type SaleRow = {
  id: string;
  buyer_id: string | null;
  seller_id: string | null;
  price: number;
  currency: string;
  sold_at: string;
  tx_hash: string | null;
};

/* ───────────────────────── countdown component ───────────────────────── */

function Countdown({ endAt }: { endAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  const end = useMemo(() => new Date(endAt).getTime(), [endAt]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ms = Math.max(0, end - now);
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;

  const Box = ({ v, label }: { v: number; label: string }) => (
    <div className="px-2 py-1 rounded-md bg-white/10 border border-white/10 text-center">
      <div className="text-sm font-semibold tabular-nums">{v.toString().padStart(2, "0")}</div>
      <div className="text-[10px] text-white/70">{label}</div>
    </div>
  );

  return (
    <div className="flex gap-2 items-center">
      <Box v={days} label="DAYS" />
      <Box v={hours} label="HOURS" />
      <Box v={mins} label="MINUTES" />
      <Box v={secs} label="SECONDS" />
    </div>
  );
}

/* ─────────────────────────── icon doodads ─────────────────────────── */

function HeartIcon(props: any) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}>
      <path
        fill="currentColor"
        d="M12 21s-7.2-4.6-9.6-8.1C.7 10.1 2.1 6 6 6c2 0 3.2 1.1 4 2.2.8-1.1 2-2.2 4-2.2 3.9 0 5.3 4.1 3.6 6.9C19.2 16.4 12 21 12 21z"
      />
    </svg>
  );
}
function ShareIcon(props: any) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}>
      <path
        fill="currentColor"
        d="M18 8a3 3 0 1 0-2.7-4.1L8.9 7.2a3 3 0 0 0 0 5.6l6.4 3.3A3 3 0 1 0 16 18l-6.4-3.3a3 3 0 0 0 0-5.4L16 6a3 3 0 0 0 2 .8z"
      />
    </svg>
  );
}

/* ───────────────────────────── main page ───────────────────────────── */

export default function ArtworkDetail() {
  const { id } = useParams();
  const [viewerId, setViewerId] = useState<string | null>(null);

  const [art, setArt] = useState<Artwork | null>(null);
  const [creator, setCreator] = useState<Profile | null>(null);
  const [owner, setOwner] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  // listing
  const [activeListing, setActiveListing] = useState<Listing | (Listing & {
    type?: string | null;
    end_at?: string | null;
    start_at?: string | null;
    reserve_price?: number | null;
    quantity?: number | null;
  }) | null>(null);

  // gallery
  const [files, setFiles] = useState<ArtworkFile[]>([]);
  const [mainUrl, setMainUrl] = useState<string | null>(null);

  // tabs
  const [tab, setTab] = useState<"owner" | "comments" | "history">("owner");

  // owners & history
  const [owners, setOwners] = useState<{ profile: Profile; quantity: number; updated_at: string }[]>(
    []
  );
  const [sales, setSales] = useState<(SaleRow & { buyer?: Profile | null; seller?: Profile | null })[]>(
    []
  );

  // pinning
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

  // load artwork + creator/owner + listing + extra files
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
        setMainUrl((data as Artwork).image_url);

        // parallel fetches
        const [c, o, l, af] = await Promise.all([
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
          supabase
            .from("artwork_files")
            .select("id,url,kind,position")
            .eq("artwork_id", data.id)
            .order("position", { ascending: true }),
        ]);

        if (!alive) return;
        setCreator((c.data as any) ?? null);
        setOwner((o?.data as any) ?? null);
        setActiveListing(l as any);
        setFiles((af.data as any[]) ?? []);

        // load owners + history
        await Promise.all([loadOwners(data.id), loadSales(data.id)]);
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

  async function loadOwners(artworkId: string) {
    const { data, error } = await supabase
      .from("ownerships")
      .select("owner_id, quantity, updated_at")
      .eq("artwork_id", artworkId);
    if (error) return;

    const rows = (data ?? []) as { owner_id: string; quantity: number; updated_at: string }[];
    const ids = Array.from(new Set(rows.map((r) => r.owner_id))).filter(Boolean);
    if (ids.length === 0) {
      setOwners([]);
      return;
    }
    const { data: profs } = await supabase
      .from("profiles")
      .select("id,username,display_name,avatar_url")
      .in("id", ids);

    const map = new Map<string, Profile>();
    (profs ?? []).forEach((p: any) => map.set(p.id, p as Profile));
    setOwners(
      rows
        .map((r) => ({ profile: map.get(r.owner_id)!, quantity: r.quantity, updated_at: r.updated_at }))
        .filter((x) => !!x.profile)
    );
  }

  async function loadSales(artworkId: string) {
    const { data, error } = await supabase
      .from("sales")
      .select("id,buyer_id,seller_id,price,currency,sold_at,tx_hash")
      .eq("artwork_id", artworkId)
      .order("sold_at", { ascending: false });
    if (error) return;

    const rows = (data ?? []) as SaleRow[];
    const ids = Array.from(new Set(rows.flatMap((r) => [r.buyer_id, r.seller_id]).filter(Boolean))) as string[];
    let map = new Map<string, Profile>();
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,username,display_name,avatar_url")
        .in("id", ids);
      (profs ?? []).forEach((p: any) => map.set(p.id, p as Profile));
    }
    setSales(rows.map((r) => ({ ...r, buyer: r.buyer_id ? map.get(r.buyer_id) ?? null : null, seller: r.seller_id ? map.get(r.seller_id) ?? null : null })));
  }

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

      const fresh = await supabase
        .from("artworks")
        .select(
          "id,title,description,image_url,creator_id,owner_id,created_at,ipfs_image_cid,ipfs_metadata_cid,token_uri"
        )
        .eq("id", art.id)
        .maybeSingle();
      if (fresh.data) {
        setArt(fresh.data as Artwork);
        setMainUrl((fresh.data as Artwork).image_url);
      }
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

      const freshArt = await supabase
        .from("artworks")
        .select(
          "id,title,description,image_url,creator_id,owner_id,created_at,ipfs_image_cid,ipfs_metadata_cid,token_uri"
        )
        .eq("id", art.id)
        .maybeSingle();
      if (freshArt.data) setArt(freshArt.data as Artwork);

      const l = await fetchActiveListingForArtwork(art.id);
      setActiveListing(l as any);

      // refresh owners + history
      await Promise.all([loadOwners(art.id), loadSales(art.id)]);
    } catch (e: any) {
      setMsg(e?.message ?? "Purchase failed");
    }
  }

  if (loading) return <div className="p-6">loading…</div>;
  if (!art) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        {msg ? <p className="text-amber-300">{msg}</p> : null}
        <Link to="/" className="btn mt-4 inline-block">Back home</Link>
      </div>
    );
  }

  const creatorHandle = creator?.username ? `/u/${creator.username}` : creator ? `/u/${creator.id}` : "#";
  const ownerHandle   = owner?.username ? `/u/${owner.username}`   : owner   ? `/u/${owner.id}`   : null;

  const isOwner = !!viewerId && !!art.owner_id && viewerId === art.owner_id;
  const isSeller = !!activeListing && viewerId === (activeListing as any).seller_id;
  const canBuy = !!activeListing && !!viewerId && !isSeller;

  const isAuction = (activeListing as any)?.type === "auction" && !!(activeListing as any)?.end_at;

  return (
    <div className="max-w-7xl mx-auto p-6 grid gap-8 lg:grid-cols-12">
      {/* Left: Media & thumbs */}
      <div className="lg:col-span-7">
        <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-neutral-900">
          {mainUrl ? (
            <img src={mainUrl} alt={art.title ?? "Artwork"} className="w-full h-full object-contain bg-neutral-900" />
          ) : (
            <div className="aspect-square grid place-items-center text-neutral-400">No image</div>
          )}

          {/* Action rail */}
          <div className="hidden md:flex absolute right-3 top-3 flex-col gap-2">
            <button className="rounded-full p-2 bg-white text-black/90 hover:bg-white/90 transition" title="Favorite">
              <HeartIcon />
            </button>
            <button className="rounded-full p-2 bg-white/10 text-white hover:bg-white/20 border border-white/10 transition" title="Share">
              <ShareIcon />
            </button>
          </div>
        </div>

        {(files?.length || 0) > 0 && (
          <div className="mt-3 grid grid-cols-5 gap-2">
            {[{ url: art.image_url } as any, ...files].slice(0, 10).map((f, i) => (
              <button
                key={i}
                onClick={() => setMainUrl(f.url)}
                className={`aspect-square overflow-hidden rounded-lg border ${
                  mainUrl === f.url ? "border-white/40" : "border-white/10"
                } bg-neutral-900`}
              >
                <img src={f.url} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right: details */}
      <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-6">
        {msg && <p className="text-sm text-amber-300">{msg}</p>}

        <div className="space-y-1">
          {/* tiny category/label slot */}
          <div className="text-xs text-white/70">Artwork</div>
          <h1 className="text-3xl font-semibold">{art.title || "Untitled"}</h1>
          <p className="text-sm text-neutral-400">Minted {new Date(art.created_at).toLocaleDateString()}</p>
        </div>

        {/* creator/owner chip */}
        <div className="card space-y-3">
          <div className="flex items-center gap-3">
            {creator?.avatar_url ? <img src={creator.avatar_url} className="h-8 w-8 rounded-full object-cover" /> : null}
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

        {/* Listing summary with auction block */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Listing</h3>
            {isAuction && <span className="text-[11px] px-2 py-1 rounded bg-white text-black font-medium">AUCTION</span>}
          </div>

          {activeListing ? (
            <>
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">
                  {activeListing.fixed_price} {activeListing.sale_currency}
                </div>
                {isAuction && (activeListing as any).end_at && (
                  <Countdown endAt={(activeListing as any).end_at as string} />
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                {canBuy && (
                  <button className="btn flex-1" onClick={onBuy}>
                    {isAuction ? "Place bid (soon)" : `Purchase now`}
                  </button>
                )}
                {isOwner && (
                  <a href="#owner-panel" className="btn">Edit listing</a>
                )}
              </div>
              {isAuction && (
                <div className="text-[11px] text-neutral-500">
                  Bidding UI coming soon. Countdown uses <code>listings.end_at</code>.
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-neutral-400">Not currently listed.</p>
          )}
        </div>

        {/* Owner-only: list for sale panel */}
        {isOwner && (
          <div id="owner-panel">
            <OwnerListPanel
              artworkId={art.id}
              onUpdated={async () => setActiveListing(await fetchActiveListingForArtwork(art.id) as any)}
            />
          </div>
        )}

        {/* IPFS */}
        <div className="card">
          <h3 className="font-semibold">IPFS</h3>
          {art.token_uri ? (
            <div className="text-xs space-y-1 mt-2">
              <div>✅ Already pinned</div>
              {art.ipfs_image_cid && <div>Image CID: <code>{art.ipfs_image_cid}</code></div>}
              {art.ipfs_metadata_cid && (
                <div>
                  Metadata CID: <code>{art.ipfs_metadata_cid}</code>{" "}
                  <a className="underline" href={`https://gateway.pinata.cloud/ipfs/${art.ipfs_metadata_cid}`} target="_blank" rel="noreferrer">
                    Open metadata
                  </a>
                </div>
              )}
              <div>Token URI: <code>{art.token_uri}</code></div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                className="btn"
                onClick={handlePin}
                disabled={pinLoading || !(viewerId && (viewerId === art.creator_id || viewerId === art.owner_id))}
                title={viewerId && (viewerId === art.creator_id || viewerId === art.owner_id) ? "" : "Only the creator/owner can pin"}
              >
                {pinLoading ? "Pinning…" : "Pin to IPFS"}
              </button>
              {pinErr && <span className="text-rose-400 text-sm">{pinErr}</span>}
              {pinData && <span className="text-xs text-neutral-300">✅ Pinned — CID: <code>{pinData.metadataCID}</code></span>}
            </div>
          )}
        </div>
      </div>

      {/* Bottom section: tabs */}
      <div className="lg:col-span-12">
        <div className="mt-2 rounded-2xl border border-white/10 bg-white/5">
          <div className="flex gap-2 p-2 border-b border-white/10">
            {(["owner", "comments", "history"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-sm ${
                  tab === t ? "bg-white text-black font-medium" : "bg-white/0 text-white/80 hover:bg-white/10"
                }`}
              >
                {t === "owner" ? "Owner" : t === "comments" ? "Comments" : "History"}
              </button>
            ))}
          </div>

          {/* OWNER TAB */}
          {tab === "owner" && (
            <div className="p-4">
              {owners.length === 0 ? (
                <div className="text-sm text-neutral-400">No owners recorded yet.</div>
              ) : (
                <ul className="divide-y divide-white/10">
                  {owners.map((o, i) => (
                    <li key={i} className="py-3 flex items-center gap-3">
                      {o.profile.avatar_url ? (
                        <img src={o.profile.avatar_url} className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-white/10" />
                      )}
                      <div className="flex-1">
                        <Link to={o.profile.username ? `/u/${o.profile.username}` : `/u/${o.profile.id}`} className="font-medium hover:underline">
                          {o.profile.display_name || o.profile.username || "Collector"}
                        </Link>
                        <div className="text-xs text-white/60">
                          Since {new Date(o.updated_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="text-sm text-white/80">Qty {o.quantity}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* COMMENTS TAB (UI only for now) */}
          {tab === "comments" && (
            <div className="p-4 space-y-3">
              <div className="text-sm text-neutral-300">
                Comments coming soon. We’ll hook this up to your messaging or a lightweight comments table.
              </div>
              <div className="opacity-60">
                <div className="flex gap-2">
                  <div className="h-8 w-8 rounded-full bg-white/10" />
                  <input className="input flex-1" placeholder="Write a comment…" disabled />
                </div>
              </div>
            </div>
          )}

          {/* HISTORY TAB */}
          {tab === "history" && (
            <div className="p-4">
              {sales.length === 0 ? (
                <div className="text-sm text-neutral-400">No sales yet.</div>
              ) : (
                <ul className="space-y-3">
                  {sales.map((s) => (
                    <li key={s.id} className="p-3 rounded-lg bg-white/5 border border-white/10">
                      <div className="text-sm">
                        Sold for <b>{s.price} {s.currency}</b>{" "}
                        on {new Date(s.sold_at).toLocaleString()}
                      </div>
                      <div className="text-xs text-white/70">
                        From{" "}
                        {s.seller ? (
                          <Link className="underline" to={s.seller.username ? `/u/${s.seller.username}` : `/u/${s.seller.id}`}>
                            {s.seller.display_name || s.seller.username || "Seller"}
                          </Link>
                        ) : "—"}{" "}
                        to{" "}
                        {s.buyer ? (
                          <Link className="underline" to={s.buyer.username ? `/u/${s.buyer.username}` : `/u/${s.buyer.id}`}>
                            {s.buyer.display_name || s.buyer.username || "Buyer"}
                          </Link>
                        ) : "—"}
                        {s.tx_hash ? (
                          <>
                            {" "}• tx: <code className="break-all">{s.tx_hash}</code>
                          </>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────── Owner List Panel (unchanged logic) ───────────────────── */

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
        <select className="input w-28" value={currency} onChange={(e) => setCurrency(e.target.value)}>
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
