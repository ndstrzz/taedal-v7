// app/src/routes/art/ArtworkDetail.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  createOrUpdateFixedPriceListing,
  fetchActiveListingForArtwork,
  type Listing,
} from "../../lib/listings";
import {
  fetchTopBid,
  placeBid,
  subscribeBids,
  endAuction,
  type Bid,
} from "../../lib/bids";
import RequestLicenseModal from "../../components/RequestLicenseModal";
import PhysicalBadge from "../../components/art/PhysicalBadge";
import ShipmentsPanel from "../../components/shipping/ShipmentsPanel";

/* ------------------------------ WalletModal ------------------------------ */

function WalletModal({
  open,
  onClose,
  onMetaMask,
  disabledText,
}: {
  open: boolean;
  onClose: () => void;
  onMetaMask: () => void;
  disabledText?: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-neutral-950 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Connect wallet</h3>
          <button className="text-sm text-white/70 hover:text-white" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="space-y-3">
          <button
            className="btn w-full flex items-center justify-center gap-2"
            onClick={onMetaMask}
          >
            <span>MetaMask</span>
          </button>
          {disabledText && (
            <p className="text-xs text-white/60 text-center">{disabledText}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ config ------------------------------ */

// Wallet to receive ETH on Sepolia during testing
const FALLBACK_PAYTO = (import.meta as any)?.env?.VITE_SEPOLIA_PAYTO ?? "";

// Sepolia chain params (MetaMask)
const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111
const SEPOLIA_PARAMS = {
  chainId: SEPOLIA_CHAIN_ID_HEX,
  chainName: "Sepolia",
  nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia.infura.io/v3/"],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

// simple parseEther without ethers.js
function parseEther(amount: string | number): bigint {
  const s = String(amount);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Invalid ETH amount");
  const [ints, decs = ""] = s.split(".");
  const d = (decs + "000000000000000000").slice(0, 18);
  return BigInt(ints) * 10n ** 18n + BigInt(d);
}
const toHex = (v: bigint) => "0x" + v.toString(16);

/* ------------------------------ types ------------------------------ */

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
  type?: "digital" | "physical" | null;
  physical_status?: "with_creator" | "in_transit" | "with_buyer" | "in_gallery" | "unknown" | null;
};

type ArtworkFile = {
  id: string;
  url: string;
  kind: string | null;
  position: number | null;
};

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

/* ------------------------------ small UI helpers ------------------------------ */

function Pill({
  children,
  tone = "neutral",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning";
  className?: string;
}) {
  const toneCls =
    tone === "success"
      ? "bg-emerald-400 text-black"
      : tone === "warning"
      ? "bg-amber-300 text-black"
      : "bg-white/10 text-white";
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${toneCls} ${className}`}>
      {children}
    </span>
  );
}

function StatBox({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-white/60">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function Card({
  title,
  right,
  children,
  className = "",
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between">
          {title ? <h3 className="text-sm font-semibold">{title}</h3> : <div />}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

/* ------------------------------ Countdown ------------------------------ */

function Countdown({
  endAt,
  onElapsed,
}: {
  endAt: string;
  onElapsed?: () => void;
}) {
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

  useEffect(() => {
    if (ms === 0 && onElapsed) onElapsed();
  }, [ms, onElapsed]);

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
      <Box v={mins} label="MIN" />
      <Box v={secs} label="SEC" />
    </div>
  );
}

/* ------------------------------ icons ------------------------------ */

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

/* ------------------------------ main page ------------------------------ */

export default function ArtworkDetail() {
  const { id } = useParams();
  const [viewerId, setViewerId] = useState<string | null>(null);

  const [art, setArt] = useState<Artwork | null>(null);
  const [creator, setCreator] = useState<Profile | null>(null);
  const [owner, setOwner] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  // listing
  const [activeListing, setActiveListing] = useState<
    | (Listing & {
        type?: string | null;
        end_at?: string | null;
        start_at?: string | null;
        reserve_price?: number | null;
        quantity?: number | null;
        seller_wallet?: string | null;
      })
    | null
  >(null);

  // bids (auction)
  const MIN_INC_BPS = 500;
  const [topBid, setTopBid] = useState<Bid | null>(null);

  // bid UI
  const [bidInput, setBidInput] = useState<string>("");
  const [bidMsg, setBidMsg] = useState<string | null>(null);
  const [bidBusy, setBidBusy] = useState(false);

  // gallery
  const [files, setFiles] = useState<ArtworkFile[]>([]);
  const [mainUrl, setMainUrl] = useState<string | null>(null);

  // tabs (OpenSea-like)
  const [tab, setTab] = useState<"details" | "orders" | "activity">("details");

  // owners & history
  const [owners, setOwners] = useState<
    { profile: Profile; quantity: number; updated_at: string }[]
  >([]);
  const [sales, setSales] = useState<
    (SaleRow & { buyer?: Profile | null; seller?: Profile | null })[]
  >([]);

  // pinning
  const [pinLoading, setPinLoading] = useState(false);
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [pinData, setPinData] = useState<PinResp | null>(null);

  // wallet modal
  const [walletOpen, setWalletOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);

  // seller console (UI-only)
  const [sellerOpen, setSellerOpen] = useState(false);

  // per-owner visibility
  const [myHidden, setMyHidden] = useState<boolean | null>(null);
  const [hideBusy, setHideBusy] = useState(false);

  // license modal
  const [showLicense, setShowLicense] = useState(false);

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
        if (!id) throw new Error("Missing artwork id");
        const { data, error } = await supabase
          .from("artworks")
          .select(
            "id,title,description,image_url,creator_id,owner_id,created_at,ipfs_image_cid,ipfs_metadata_cid,token_uri,type,physical_status"
          )
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          setMsg("Artwork not found.");
          setArt(null);
          return;
        }
        if (!alive) return;
        setArt(data as Artwork);
        setMainUrl((data as Artwork).image_url || null);

        const [c, o, l, af] = await Promise.all([
          supabase
            .from("profiles")
            .select("id,username,display_name,avatar_url")
            .eq("id", (data as Artwork).creator_id)
            .maybeSingle(),
          (data as Artwork).owner_id
            ? supabase
                .from("profiles")
                .select("id,username,display_name,avatar_url")
                .eq("id", (data as Artwork).owner_id as string)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          fetchActiveListingForArtwork((data as Artwork).id),
          supabase
            .from("artwork_files")
            .select("id,url,kind,position")
            .eq("artwork_id", (data as Artwork).id)
            .order("position", { ascending: true }),
        ]);

        if (!alive) return;
        setCreator((c.data as any) ?? null);
        setOwner((o?.data as any) ?? null);
        setActiveListing(l as any);
        setFiles(((af.data as any[]) ?? []).filter((f) => !!f?.url));

        await Promise.all([loadOwners((data as Artwork).id), loadSales((data as Artwork).id)]);

        if (l && (l as any).type === "auction") {
          const tb = await fetchTopBid((l as any).id);
          if (alive) setTopBid(tb);
        }

        if (viewerId) {
          const { data: own } = await supabase
            .from("ownerships")
            .select("hidden")
            .eq("artwork_id", (data as Artwork).id)
            .eq("owner_id", viewerId)
            .maybeSingle();
          if (alive) setMyHidden(own ? Boolean(own.hidden) : null);
        }
      } catch (e: any) {
        setMsg(e?.message || "Failed to load artwork.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, viewerId]);

  useEffect(() => {
    if (!activeListing || (activeListing as any).type !== "auction") return;
    const off = subscribeBids(activeListing.id, (b) => {
      setTopBid((cur) => (!cur || b.amount >= cur.amount ? b : cur));
    });
    return off;
  }, [activeListing?.id]);

  async function loadOwners(artworkId: string) {
    const { data } = await supabase
      .from("ownerships")
      .select("owner_id, quantity, updated_at")
      .eq("artwork_id", artworkId);

    const rows =
      (data ?? []) as { owner_id: string; quantity: number; updated_at: string }[];
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
        .map((r) => ({
          profile: map.get(r.owner_id)!,
          quantity: r.quantity,
          updated_at: r.updated_at,
        }))
        .filter((x) => !!x.profile)
    );
  }

  async function loadSales(artworkId: string) {
    const { data } = await supabase
      .from("sales")
      .select("id,buyer_id,seller_id,price,currency,sold_at,tx_hash")
      .eq("artwork_id", artworkId)
      .order("sold_at", { ascending: false });

    const rows = (data ?? []) as SaleRow[];
    const ids = Array.from(
      new Set(rows.flatMap((r) => [r.buyer_id, r.seller_id]).filter(Boolean))
    ) as string[];
    let map = new Map<string, Profile>();
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,username,display_name,avatar_url")
        .in("id", ids);
      (profs ?? []).forEach((p: any) => map.set(p.id, p as Profile));
    }
    setSales(
      rows.map((r) => ({
        ...r,
        buyer: r.buyer_id ? map.get(r.buyer_id) ?? null : null,
        seller: r.seller_id ? map.get(r.seller_id) ?? null : null,
      }))
    );
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
          "id,title,description,image_url,creator_id,owner_id,created_at,ipfs_image_cid,ipfs_metadata_cid,token_uri,type,physical_status"
        )
        .eq("id", art.id)
        .maybeSingle();
      if (fresh.data) {
        setArt(fresh.data as Artwork);
        setMainUrl((fresh.data as Artwork).image_url || null);
      }
    } catch (e: any) {
      setPinErr(e?.message ?? "Pin failed.");
    } finally {
      setPinLoading(false);
    }
  }

  function asMsg(e: unknown) {
    if (!e) return "Unknown error";
    if (typeof e === "string") return e;
    if (typeof (e as any)?.message === "string") return (e as any).message;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }

  /* ------------------------------ visibility toggle ------------------------------ */

  async function ensureOwnershipRow() {
    if (!viewerId || !art?.id) return;
    const { data } = await supabase
      .from("ownerships")
      .select("owner_id")
      .eq("artwork_id", art.id)
      .eq("owner_id", viewerId)
      .maybeSingle();

    if (!data) {
      await supabase.from("ownerships").upsert({
        artwork_id: art.id,
        owner_id: viewerId,
        quantity: 1,
        hidden: false,
        updated_at: new Date().toISOString(),
      });
    }
  }

  async function toggleHidden(next: boolean) {
    if (!viewerId || !art?.id) return;
    setHideBusy(true);
    setMsg(null);
    try {
      await ensureOwnershipRow();
      const { error } = await supabase
        .from("ownerships")
        .update({ hidden: next, updated_at: new Date().toISOString() })
        .eq("artwork_id", art.id)
        .eq("owner_id", viewerId);
      if (error) throw error;
      setMyHidden(next);
    } catch (e) {
      setMsg(asMsg(e));
    } finally {
      setHideBusy(false);
    }
  }

  /* ------------------------------ Buy handlers ------------------------------ */

  async function onBuy() {
    if (!activeListing || !art) return;

    const ccy = (activeListing.sale_currency || "").toUpperCase();
    if (ccy === "ETH") {
      setMsg(null);
      setWalletOpen(true);
      return;
    }

    try {
      setMsg("Redirecting to Stripe…");
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: {
          listing_id: activeListing.id,
          title: art.title ?? "Artwork purchase",
          success_url: `${location.origin}/checkout/success`,
          cancel_url: location.href,
        },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("Stripe session URL not returned");
      window.location.href = data.url;
    } catch (e) {
      setMsg(asMsg(e));
    }
  }

  // MetaMask flow (Sepolia)
  async function onBuyWithMetaMask() {
    if (!activeListing) return;
    setPayBusy(true);
    setMsg(null);

    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) throw new Error("MetaMask not found. Please install it.");

      const accounts: string[] = await ethereum.request({ method: "eth_requestAccounts" });
      const from = accounts?.[0];
      if (!from) throw new Error("No account authorized in MetaMask.");

      let chainId = await ethereum.request({ method: "eth_chainId" });
      if (chainId !== SEPOLIA_CHAIN_ID_HEX) {
        try {
          await ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
          });
        } catch {
          await ethereum.request({ method: "wallet_addEthereumChain", params: [SEPOLIA_PARAMS] });
        }
        chainId = await ethereum.request({ method: "eth_chainId" });
        if (chainId !== SEPOLIA_CHAIN_ID_HEX) {
          throw new Error("Please switch MetaMask to Sepolia.");
        }
      }

      const priceEth = Number(activeListing.fixed_price || 0);
      if (!isFinite(priceEth) || priceEth <= 0) {
        throw new Error("Invalid price for listing.");
      }

      const to = (activeListing as any).seller_wallet || FALLBACK_PAYTO || "";
      if (!to) throw new Error("No receiving wallet configured (VITE_SEPOLIA_PAYTO).");

      const value = toHex(parseEther(priceEth));
      const txHash: string = await ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from, to, value }],
      });

      try {
        await supabase.functions.invoke("record-eth-purchase", {
          body: {
            listing_id: activeListing.id,
            tx_hash: txHash,
            buyer_wallet: from,
            amount_eth: priceEth,
            network: "sepolia",
          },
        });
      } catch (e) {
        console.warn("record-eth-purchase failed:", e);
      }

      setWalletOpen(false);
      setMsg("Payment sent ✔️");
    } catch (e) {
      setMsg(asMsg(e));
    } finally {
      setPayBusy(false);
    }
  }

  // ------------------------------ bids ------------------------------
  async function onPlaceBid() {
    if (!activeListing) return;
    setBidBusy(true);
    setBidMsg(null);
    try {
      const amt = Number(bidInput || 0);
      if (!isFinite(amt) || amt <= 0) throw new Error("Enter a valid amount");

      const b = await placeBid(activeListing.id, amt);
      setTopBid(b);
      setBidMsg("Bid placed ✅");
      setBidInput("");
    } catch (e: any) {
      setBidMsg(e?.message || "Bid failed");
    } finally {
      setBidBusy(false);
    }
  }

  /* ------------------------------ computed ------------------------------ */

  const isAuction =
    (activeListing as any)?.type === "auction" && !!(activeListing as any)?.end_at;

  const creatorHandle = creator?.username
    ? `/u/${creator.username}`
    : creator
    ? `/u/${creator.id}`
    : "#";
  const ownerHandle = owner?.username ? `/u/${owner.username}` : owner ? `/u/${owner.id}` : null;

  const isOwner = !!viewerId && !!art?.owner_id && viewerId === art.owner_id;
  const isSeller = !!activeListing && viewerId === (activeListing as any).seller_id;
  const canBuy = !!activeListing && !!viewerId && !isSeller;

  const minNextBid = useMemo(() => {
    if (!isAuction) return 0;
    const reserve = (activeListing as any)?.reserve_price ?? 0;
    const base = topBid ? topBid.amount * (1 + MIN_INC_BPS / 10000) : 0;
    return Math.max(reserve, base || reserve || 0);
  }, [topBid, activeListing, isAuction]);

  // ✅ This hook must be above any early returns to keep hook order stable
  const galleryThumbs = useMemo(
    () =>
      ([{ url: art?.image_url } as any, ...(Array.isArray(files) ? files : [])] as { url?: string }[])
        .filter((f) => !!f?.url)
        .slice(0, 10),
    [art?.image_url, files]
  );

  /* ------------------------------ render ------------------------------ */

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="animate-pulse grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="aspect-square rounded-2xl bg-white/[0.06]" />
          </div>
          <div className="lg:col-span-5 space-y-4">
            <div className="h-6 w-48 bg-white/[0.06] rounded" />
            <div className="h-4 w-64 bg-white/[0.06] rounded" />
            <div className="rounded-2xl bg-white/[0.06] h-44" />
            <div className="rounded-2xl bg-white/[0.06] h-36" />
          </div>
        </div>
      </div>
    );
  }

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

  const usdApprox =
    activeListing &&
    activeListing.sale_currency?.toUpperCase() === "ETH" &&
    activeListing.fixed_price
      ? ""
      : "";

  const canRequestLicense = !!viewerId && viewerId !== art.creator_id;

  return (
    <>
      <div className="max-w-7xl mx-auto p-6 grid gap-8 lg:grid-cols-12">
        {/* Left */}
        <div className="lg:col-span-7 space-y-3">
          <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-neutral-950">
            {mainUrl ? (
              <img
                src={mainUrl}
                alt={art.title ?? "Artwork"}
                className="w-full h-full object-contain bg-neutral-950"
                onError={() => setMainUrl(art.image_url || null)}
              />
            ) : (
              <div className="aspect-square grid place-items-center text-neutral-400">No image</div>
            )}
          </div>

          {galleryThumbs.length > 0 && (
            <div className="grid grid-cols-5 gap-2">
              {galleryThumbs.map((f, i) => (
                <button
                  key={i}
                  onClick={() => setMainUrl(f.url || null)}
                  className={`aspect-square overflow-hidden rounded-xl border transition ${
                    mainUrl === f.url ? "border-white/50" : "border-white/10 hover:border-white/30"
                  } bg-neutral-900`}
                >
                  {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
                  {/* @ts-ignore — url is guaranteed by filter */}
                  <img src={f.url} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right */}
        <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-6 self-start">
          {msg && <p className="text-xs text-amber-300">{msg}</p>}

          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-3xl font-semibold leading-tight truncate">
                {art.title || "Untitled"}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {creator?.avatar_url ? (
                  <img src={creator.avatar_url} className="h-5 w-5 rounded-full object-cover" />
                ) : (
                  <div className="h-5 w-5 rounded-full bg-white/10" />
                )}
                <span className="text-white/80">
                  {creator ? (
                    <Link
                      to={creator.username ? `/u/${creator.username}` : `/u/${creator.id}`}
                      className="underline"
                    >
                      {creator.display_name || creator.username || "Creator"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </span>
                <span className="text-white/40">•</span>
                <span className="text-white/80">
                  Owned by{" "}
                  {owner ? (
                    <Link to={ownerHandle ?? "#"} className="underline">
                      {owner.display_name || owner.username || "Collector"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <Pill>ERC721</Pill>
                <Pill>ETHEREUM</Pill>
                {art.type === "physical" ? (
                  <PhysicalBadge status={art.physical_status || "with_creator"} />
                ) : (
                  <Pill>TOKEN</Pill>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {isOwner && (
                <>
                  <button
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm hover:bg-white/10"
                    title="Seller tools"
                    onClick={() => setSellerOpen(true)}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm hover:bg-white/10"
                    onClick={() => toggleHidden(!myHidden)}
                    disabled={hideBusy || myHidden === null}
                    title="Hide from your public profile"
                  >
                    {hideBusy ? "…" : myHidden ? "Unhide" : "Hide"}
                  </button>
                </>
              )}
              <button className="rounded-lg p-2 hover:bg-white/10" title="Copy link">⧉</button>
              <button className="rounded-lg p-2 hover:bg-white/10" title="Favorite">
                <HeartIcon />
              </button>
              <button className="rounded-lg p-2 hover:bg-white/10" title="More">⋯</button>
            </div>
          </div>

          {/* Stats */}
          <Card>
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/10 rounded-xl bg-white/[0.03]">
              <StatBox
                label="Top offer"
                value={topBid ? `${topBid.amount} ${activeListing?.sale_currency || "ETH"}` : "—"}
              />
              <StatBox
                label="Collection floor"
                value={
                  activeListing
                    ? `${activeListing.fixed_price ?? "—"} ${activeListing.sale_currency ?? ""}`
                    : "—"
                }
              />
              <StatBox label="Rarity" value={"—"} />
              <StatBox
                label="Last sale"
                value={sales[0] ? `${sales[0].price} ${sales[0].currency}` : "—"}
              />
            </div>
          </Card>

          {/* Listing / Buy */}
          <Card title="Listing" right={isAuction ? <Pill tone="warning">AUCTION</Pill> : null}>
            {activeListing ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  {isAuction ? (
                    <div className="text-sm">
                      <div className="text-white/60">Highest bid</div>
                      <div className="text-2xl font-semibold mt-0.5">
                        {topBid ? `${topBid.amount} ${activeListing.sale_currency}` : "—"}
                      </div>
                      {(activeListing as any).reserve_price && (
                        <div className="text-[11px] text-white/60 mt-1">
                          Reserve: {(activeListing as any).reserve_price} {activeListing.sale_currency}
                          {!topBid || topBid.amount < (activeListing as any).reserve_price ? " (not met)" : ""}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="text-3xl font-semibold">
                        {activeListing.fixed_price} {activeListing.sale_currency}
                      </div>
                      {usdApprox && <div className="text-xs text-white/60">{usdApprox}</div>}
                    </div>
                  )}

                  {isAuction && (activeListing as any).end_at ? (
                    <Countdown
                      endAt={(activeListing as any).end_at as string}
                      onElapsed={async () => {
                        try {
                          await endAuction(activeListing!.id);
                        } catch {}
                        const l = await fetchActiveListingForArtwork(art.id);
                        setActiveListing(l as any);
                      }}
                    />
                  ) : null}
                </div>

                <div className="mt-3 flex gap-2">
                  {isAuction ? (
                    viewerId && !isSeller ? (
                      <>
                        <input
                          className="input flex-1"
                          type="number"
                          min={minNextBid || 0}
                          step="0.00000001"
                          placeholder={minNextBid ? `≥ ${minNextBid}` : "Your bid"}
                          value={bidInput}
                          onChange={(e) => setBidInput(e.target.value)}
                        />
                        <button className="btn flex-1" onClick={onPlaceBid} disabled={bidBusy}>
                          {bidBusy ? "Bidding…" : "Place bid"}
                        </button>
                      </>
                    ) : (
                      <div className="text-sm text-white/70">
                        {isSeller ? "Sellers can’t bid on their own auction." : "Sign in to bid."}
                      </div>
                    )
                  ) : (
                    <>
                      {canBuy && (
                        <button className="btn flex-1" onClick={onBuy}>
                          Buy now
                        </button>
                      )}
                      <button className="btn bg-white/0 border border-white/20 hover:bg-white/10 flex-1">
                        Make offer
                      </button>
                    </>
                  )}
                </div>

                {canRequestLicense && (
                  <div className="mt-3">
                    <button className="btn w-full" onClick={() => setShowLicense(true)}>
                      Request license
                    </button>
                  </div>
                )}

                {isOwner && (
                  <div className="mt-3">
                    <button className="btn w-full" onClick={() => setSellerOpen(true)}>
                      {activeListing ? "Edit listing" : "List this artwork"}
                    </button>
                  </div>
                )}

                {isAuction && (
                  <div className="text-[12px] text-white/60 mt-2">
                    Min next bid: {minNextBid || "—"} {activeListing.sale_currency}
                    {viewerId && topBid?.bidder_id === viewerId ? " • You’re winning" : ""}
                  </div>
                )}
                {bidMsg && <div className="text-xs text-neutral-200 mt-2">{bidMsg}</div>}
              </>
            ) : (
              <>
                <p className="text-sm text-white/70">Not currently listed.</p>

                {canRequestLicense && (
                  <div className="mt-3">
                    <button className="btn w-full" onClick={() => setShowLicense(true)}>
                      Request license
                    </button>
                  </div>
                )}

                {isOwner && (
                  <div className="mt-3">
                    <button className="btn w-full" onClick={() => setSellerOpen(true)}>
                      List this artwork
                    </button>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* IPFS */}
          <Card title="IPFS">
            {art.token_uri ? (
              <div className="text-xs space-y-1">
                <div>
                  <Pill tone="success">Pinned</Pill>
                </div>
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
                    pinLoading || !(viewerId && (viewerId === art.creator_id || viewerId === art.owner_id))
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
          </Card>
        </div>

        {/* Tabs area */}
        <div className="lg:col-span-12">
          <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.04]">
            <div className="flex gap-4 px-4 pt-3 border-b border-white/10">
              {(["details", "orders", "activity"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-2 pb-3 text-sm border-b-2 ${
                    tab === t ? "border-white text-white" : "border-transparent text-white/70 hover:text-white"
                  }`}
                >
                  {t === "details" ? "Details" : t === "orders" ? "Orders" : "Activity"}
                </button>
              ))}
            </div>

            {tab === "details" && (
              <div className="p-4 space-y-4">
                {art.type === "physical" && (
                  <ShipmentsPanel
                    artworkId={art.id}
                    canEdit={!!viewerId && (viewerId === art.creator_id || viewerId === art.owner_id)}
                  />
                )}

                <Card
                  title={
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold">Traits</span>
                      <Pill className="ml-1">Soon</Pill>
                    </div>
                  }
                  right={
                    <div className="flex gap-1">
                      <button className="px-2 py-1 rounded-lg hover:bg-white/10" title="Grid">▦</button>
                      <button className="px-2 py-1 rounded-lg hover:bg-white/10" title="List">☰</button>
                    </div>
                  }
                >
                  <div className="text-sm text-white/70">Traits UI coming soon.</div>
                </Card>

                <Card title={<span className="text-base font-semibold">Price history</span>}>
                  <p className="text-sm text-white/70">
                    Chart coming soon. We’ll plot points from <code>artwork_prices</code>.
                  </p>
                </Card>

                <Card title={<span className="text-base font-semibold">About</span>}>
                  <div className="space-y-4">
                    <div>
                      <div className="font-medium">About {art.title || "this artwork"}</div>
                      <div className="mt-1 text-sm text-white/80 whitespace-pre-wrap">
                        {art.description || "No description provided."}
                      </div>
                    </div>
                    {creator && (
                      <>
                        <div className="h-px bg-white/10" />
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {creator.avatar_url ? (
                              <img src={creator.avatar_url} className="h-6 w-6 rounded-full object-cover" />
                            ) : (
                              <div className="h-6 w-6 rounded-full bg-white/10" />
                            )}
                            <span>
                              A collection by{" "}
                              <Link to={creatorHandle} className="underline">
                                {creator.display_name || creator.username || "Creator"}
                              </Link>
                            </span>
                          </div>
                          <div className="mt-1 text-sm text-white/70">Creator bio coming soon.</div>
                        </div>
                      </>
                    )}
                  </div>
                </Card>

                <Card title={<span className="text-base font-semibold">Blockchain details</span>}>
                  <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                    <div className="text-white/60">Contract Address</div>
                    <div className="truncate">
                      {art.token_uri ? (
                        <a className="underline" href={art.token_uri} target="_blank" rel="noreferrer">
                          {art.token_uri.length > 20
                            ? `${art.token_uri.slice(0, 10)}…${art.token_uri.slice(-8)}`
                            : art.token_uri}
                        </a>
                      ) : (
                        "—"
                      )}
                    </div>
                    <div className="text-white/60">Token ID</div>
                    <div>{art.id}</div>
                    <div className="text-white/60">Token Standard</div>
                    <div>ERC721</div>
                    <div className="text-white/60">Chain</div>
                    <div>Ethereum (Sepolia)</div>
                  </div>
                </Card>

                <Card title={<span className="text-base font-semibold">More from this collection</span>}>
                  <div className="text-sm text-white/70">Collection grid coming soon.</div>
                </Card>
              </div>
            )}

            {tab === "orders" && (
              <div className="p-4">
                <Card>
                  <div className="text-sm text-white/70">Orders UI coming soon.</div>
                </Card>
              </div>
            )}

            {tab === "activity" && (
              <div className="p-4">
                {sales.length === 0 ? (
                  <div className="text-sm text-white/70">No activity yet.</div>
                ) : (
                  <ul className="space-y-3">
                    {sales.map((s) => (
                      <li key={s.id} className="p-3 rounded-xl bg-white/[0.04] border border-white/10">
                        <div className="text-sm">
                          Sale • <b>{s.price} {s.currency}</b> on {new Date(s.sold_at).toLocaleString()}
                        </div>
                        <div className="text-xs text-white/70">
                          From{" "}
                          {s.seller ? (
                            <Link
                              className="underline"
                              to={s.seller.username ? `/u/${s.seller.username}` : `/u/${s.seller.id}`}
                            >
                              {s.seller.display_name || s.seller.username || "Seller"}
                            </Link>
                          ) : "—"}{" "}
                          to{" "}
                          {s.buyer ? (
                            <Link
                              className="underline"
                              to={s.buyer.username ? `/u/${s.buyer.username}` : `/u/${s.buyer.id}`}
                            >
                              {s.buyer.display_name || s.buyer.username || "Buyer"}
                            </Link>
                          ) : "—"}
                          {s.tx_hash ? <> • tx: <code className="break-all">{s.tx_hash}</code></> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <Link to="/" className="btn">Back</Link>
            {creator && <Link to={creatorHandle} className="btn">View creator</Link>}
          </div>
        </div>
      </div>

      <WalletModal
        open={walletOpen}
        onClose={() => (payBusy ? null : setWalletOpen(false))}
        onMetaMask={onBuyWithMetaMask}
        disabledText="Coming soon"
      />

      {art && (
        <RequestLicenseModal
          open={showLicense}
          onClose={() => setShowLicense(false)}
          artworkId={art.id}
          ownerId={art.creator_id}
        />
      )}

      {isOwner && (
        <SellerConsole
          open={sellerOpen}
          onClose={() => setSellerOpen(false)}
          artworkId={art.id}
          onListingUpdated={async () =>
            setActiveListing((await fetchActiveListingForArtwork(art.id)) as any)
          }
        />
      )}
    </>
  );
}

/* ------------------------------ Owner List Panel ------------------------------ */

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
      const m =
        typeof e?.message === "string"
          ? e.message
          : (() => {
              try {
                return JSON.stringify(e);
              } catch {
                return String(e);
              }
            })();
      setMsg(m ?? "Failed to list");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Fixed price">
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
          <option value="USD">USD</option>
        </select>
        <button className="btn" onClick={onList} disabled={busy}>
          {busy ? "Listing…" : "List for sale"}
        </button>
      </div>
      {msg && <div className="text-xs text-neutral-200 mt-2">{msg}</div>}
      <div className="text-[11px] text-white/60 mt-1">
        (Creates/updates a fixed-price listing visible on Explore.)
      </div>
    </Card>
  );
}

/* ------------------------------ Seller Console (UI only) ------------------------------ */

function SellerConsole({
  open,
  onClose,
  artworkId,
  onListingUpdated,
}: {
  open: boolean;
  onClose: () => void;
  artworkId: string;
  onListingUpdated: () => Promise<void> | void;
}) {
  const [tab, setTab] = useState<"price" | "auction" | "details">("price");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[520px] bg-neutral-950 border-l border-white/10 shadow-2xl p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Seller tools</h3>
          <button className="text-sm text-white/70 hover:text-white" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="flex gap-2 mb-3">
          {(["price", "auction", "details"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                tab === t
                  ? "bg-white text-black font-medium"
                  : "bg-white/0 text-white/80 hover:bg-white/10 border border-white/10"
              }`}
            >
              {t === "price" ? "Price" : t === "auction" ? "Auction" : "Details"}
            </button>
          ))}
        </div>

        {tab === "price" && (
          <div className="space-y-3">
            <div className="text-sm text-white/70">Create or update a fixed-price listing.</div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <OwnerListPanel artworkId={artworkId} onUpdated={onListingUpdated} />
            </div>
          </div>
        )}

        {tab === "auction" && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3 opacity-60 pointer-events-none select-none">
            <div className="text-sm text-white/70">Configure an auction (UI only for now).</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm">Reserve price</label>
                <input className="input" placeholder="e.g. 0.2" />
              </div>
              <div>
                <label className="block text-sm">Currency</label>
                <select className="input">
                  <option>ETH</option>
                </select>
              </div>
              <div>
                <label className="block text-sm">Start time</label>
                <input className="input" type="datetime-local" />
              </div>
              <div>
                <label className="block text-sm">End time</label>
                <input className="input" type="datetime-local" />
              </div>
            </div>
            <div className="text-xs text-white/60">
              (Disabled to keep backend unchanged. When you’re ready, wire this to auction endpoints.)
            </div>
          </div>
        )}

        {tab === "details" && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
            <div className="text-sm text-white/70">Update artwork metadata (title/description, tags, etc.).</div>
            <div className="flex gap-2">
              <a href={`/art/${artworkId}/edit`} className="btn">
                Go to edit page
              </a>
              <span className="text-xs text-white/60 self-center">
                (If you don’t have an edit route yet, we can add a read-only preview here.)
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
