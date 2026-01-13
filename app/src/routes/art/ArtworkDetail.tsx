// C:\Users\User\Downloads\taedal-v7\app\src\routes\art\ArtworkDetail.tsx

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  createOrUpdateFixedPriceListing,
  fetchActiveListingForArtwork,
  fetchLatestListingForArtwork,
  fetchListingById,
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
import OwnerAuctionPanel from "../../components/OwnerAuctionPanel";
import QRCode from "qrcode";

/** ✅ DM helpers */
import {
  dmGetOrCreateThread,
  dmListFriends,
  dmSendArtworkShare,
} from "../../features/messages/api";

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
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-neutral-950 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Connect wallet</h3>
          <button
            className="text-sm text-white/70 hover:text-white"
            onClick={onClose}
          >
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

/* ------------------------------ Share QR (for all artworks) ------------------------------ */

function ShareQRModal({
  open,
  onClose,
  url,
  title = "Share QR",
}: {
  open: boolean;
  onClose: () => void;
  url: string;
  title?: string;
}) {
  const [img, setImg] = useState<string>("");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!open) return;
      const data = await QRCode.toDataURL(url, {
        errorCorrectionLevel: "M",
        scale: 6,
      });
      if (alive) setImg(data);
    })();
    return () => {
      alive = false;
    };
  }, [open, url]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-neutral-950 border border-white/10 rounded-2xl p-4 w-full max-w-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            className="text-sm text-white/70 hover:text-white"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="text-xs text-white/70 break-all mb-2">{url}</div>
        {img ? (
          <div className="flex flex-col items-center gap-2">
            <img src={img} alt="Artwork QR" className="bg-white p-2 rounded-md" />
            <a className="underline text-sm" href={img} download="artwork-qr.png">
              Download PNG
            </a>
          </div>
        ) : (
          <div className="text-sm text-white/70">Generating…</div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Share to DM Modal (friends list) ------------------------------ */

type DMFriendRow = {
  other_user_id: string;
  other_username: string | null;
  other_display_name: string | null;
  other_avatar_url: string | null;
  thread_id: string | null;
};

function ShareToDMModal({
  open,
  onClose,
  artwork,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  artwork: { id: string; title: string | null; image_url: string | null };
  onSent?: (threadId: string) => void;
}) {
  const [friends, setFriends] = useState<DMFriendRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!open) return;
      setErr(null);
      setBusy(true);
      try {
        const data = (await dmListFriends()) as unknown as DMFriendRow[];
        if (!alive) return;
        setFriends((data ?? []) as DMFriendRow[]);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Failed to load friends");
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  async function sendTo(otherUserId: string) {
    setErr(null);
    setBusy(true);
    try {
      const tid = await dmGetOrCreateThread(otherUserId);
      await dmSendArtworkShare(tid, artwork.id, {
        title: artwork.title ?? "Untitled",
        image_url: artwork.image_url,
      });

      onClose();
      onSent?.(tid);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to send");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-950 p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">Send artwork</div>
          <button
            className="text-sm text-white/70 hover:text-white"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 flex gap-3">
          {artwork.image_url ? (
            <img
              src={artwork.image_url}
              className="h-14 w-14 rounded-lg object-cover border border-white/10"
              alt={artwork.title ?? "Artwork"}
            />
          ) : (
            <div className="h-14 w-14 rounded-lg bg-white/5 border border-white/10" />
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium text-white/90 truncate">
              {artwork.title ?? "Untitled"}
            </div>
            <div className="text-xs text-white/60 truncate">/art/{artwork.id}</div>
          </div>
        </div>

        {err ? <div className="mb-2 text-sm text-red-300">{err}</div> : null}
        {busy ? <div className="text-sm text-white/60 p-2">Loading…</div> : null}

        <div className="max-h-[52vh] overflow-auto divide-y divide-white/10 rounded-xl border border-white/10">
          {friends.length === 0 && !busy ? (
            <div className="p-3 text-sm text-white/60">
              No mutual-follow friends yet.
            </div>
          ) : (
            friends.map((f) => {
              const name = f.other_username ?? f.other_display_name ?? "User";
              return (
                <button
                  key={f.other_user_id}
                  className="w-full text-left p-3 hover:bg-white/5 transition flex items-center justify-between gap-3 disabled:opacity-60"
                  onClick={() => sendTo(f.other_user_id)}
                  disabled={busy}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {f.other_avatar_url ? (
                      <img
                        src={f.other_avatar_url}
                        className="h-9 w-9 rounded-full object-cover border border-white/10"
                        alt={name}
                      />
                    ) : (
                      <div className="h-9 w-9 rounded-full bg-white/5 border border-white/10" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm text-white/90 font-medium">
                        {name}
                      </div>
                      <div className="truncate text-xs text-white/60">Send via DM</div>
                    </div>
                  </div>

                  <span className="text-xs rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-white/80">
                    Send
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="mt-3 text-[11px] text-white/50">
          Tip: after sending, we’ll open Messages on that thread.
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Auction ended modal ------------------------------ */

function AuctionEndedModal({
  open,
  onClose,
  outcome,
  isWinner,
  onPayNow,
  payBusy,
  paid,
}: {
  open: boolean;
  onClose: () => void;
  outcome: null | {
    amount: number | null;
    currency: string;
    reserve: number | null;
    reserveMet: boolean;
    winner: { id: string; display_name: string | null; username: string | null } | null;
  };
  isWinner: boolean;
  onPayNow: () => void;
  payBusy: boolean;
  paid: boolean;
}) {
  if (!open) return null;

  const winnerName =
    outcome?.winner?.display_name ||
    outcome?.winner?.username ||
    (outcome?.winner?.id ? outcome.winner.id.slice(0, 6) : null);

  const showPay =
    !paid && !!outcome?.reserveMet && isWinner && outcome?.amount != null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-neutral-950 p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-2">
          <div className="text-lg font-semibold">Auction ended</div>
          <button className="text-sm text-white/70 hover:text-white" onClick={onClose}>
            Close
          </button>
        </div>

        {outcome?.amount != null ? (
          <div className="mt-2 space-y-2">
            <div className="text-sm text-white/60">Final price</div>
            <div className="text-3xl font-semibold">
              {outcome.amount} {outcome.currency}
            </div>

            {outcome.reserve != null ? (
              <div className="text-xs text-white/60">
                Reserve: {outcome.reserve} {outcome.currency} •{" "}
                {outcome.reserveMet ? (
                  <span className="text-emerald-300">met</span>
                ) : (
                  <span className="text-amber-300">not met</span>
                )}
              </div>
            ) : null}

            {outcome.reserveMet ? (
              <div className="text-sm text-white/80">
                Winner: <span className="font-semibold">{winnerName ?? "—"}</span>
              </div>
            ) : (
              <div className="text-sm text-white/80">No winner (reserve not met).</div>
            )}

            {paid ? (
              <div className="text-sm text-emerald-300">✅ Payment received.</div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 text-sm text-white/70">No bids were placed.</div>
        )}

        <div className="mt-4 space-y-2">
          {showPay ? (
            <button className="btn w-full" onClick={onPayNow} disabled={payBusy}>
              {payBusy ? "Preparing payment…" : "Pay now"}
            </button>
          ) : null}
          <button
            className="btn w-full bg-white/0 border border-white/20 hover:bg-white/10"
            onClick={onClose}
          >
            Okay
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ config ------------------------------ */

const FALLBACK_PAYTO = (import.meta as any)?.env?.VITE_SEPOLIA_PAYTO ?? "";

const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111
const SEPOLIA_PARAMS = {
  chainId: SEPOLIA_CHAIN_ID_HEX,
  chainName: "Sepolia",
  nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia.infura.io/v3/"],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

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
  physical_status?:
    | "with_creator"
    | "in_transit"
    | "with_buyer"
    | "in_gallery"
    | "unknown"
    | null;
  collection_id?: string | null;
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

type CollectionMeta = {
  id: string;
  slug: string | null;
  name: string | null;
  logo_url: string | null;
  banner_url: string | null;
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

type OfferRow = {
  amount?: number | null;
  price?: number | null;
  currency?: string | null;
  status?: string | null;
};

type SiblingArt = { id: string; title: string | null; image_url: string | null };

type BidHistoryRow = {
  id: string;
  amount: number;
  created_at: string;
  bidder_id: string;
};

/* ------------------------------ small UI helpers ------------------------------ */

function Pill({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
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
    <span
      className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${toneCls} ${className}`}
    >
      {children}
    </span>
  );
}

function StatBox({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-white/60">
        {label}
      </div>
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
  title?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${className}`}
    >
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-3">
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
      <div className="text-sm font-semibold tabular-nums">
        {v.toString().padStart(2, "0")}
      </div>
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

/* ------------------------------ helpers ------------------------------ */

function fmtCurrency(n: number | null | undefined, code?: string | null) {
  if (n == null || !isFinite(Number(n))) return "—";
  const c = (code ?? "USD").toUpperCase();
  if (c === "ETH") return `${Number(n).toString()} ETH`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: c,
    }).format(Number(n));
  } catch {
    return `${Number(n)} ${c}`;
  }
}

function cmpBid(a: Bid | null, b: Bid | null) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  if (b.amount !== a.amount) return b.amount - a.amount;
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  return tb - ta;
}

function isAuctionListing(l: any): boolean {
  return !!l && String(l.type) === "auction" && !!l.end_at;
}

function isClosedStatus(status: any): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === "ended" || s === "closed" || s === "paid" || s === "canceled";
}

/* ------------------------------ main page ------------------------------ */

export default function ArtworkDetail() {
  const { id } = useParams();
  const nav = useNavigate();

  const [viewerId, setViewerId] = useState<string | null>(null);

  const [art, setArt] = useState<Artwork | null>(null);
  const [creator, setCreator] = useState<Profile | null>(null);
  const [owner, setOwner] = useState<Profile | null>(null);
  const [collection, setCollection] = useState<CollectionMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  // NOTE: can hold ACTIVE or ENDED auction listing (we use latest listing fallback)
  const [activeListing, setActiveListing] = useState<
    | (Listing & {
        type?: string | null;
        end_at?: string | null;
        start_at?: string | null;
        reserve_price?: number | null;
        quantity?: number | null;
        seller_wallet?: string | null;
        status?: string | null;
        seller_id?: string | null;
      })
    | null
  >(null);

  // 5% min increment
  const MIN_INC_BPS = 500;

  const [topBid, setTopBid] = useState<Bid | null>(null);

  /** ✅ Bid history */
  const [bidHistory, setBidHistory] = useState<
    (BidHistoryRow & { bidder?: Profile | null })[]
  >([]);
  const [bidHistoryBusy, setBidHistoryBusy] = useState(false);
  const [bidHistoryHasMore, setBidHistoryHasMore] = useState(false);

  const [topOffer, setTopOffer] = useState<{ amount: number; currency: string } | null>(
    null
  );

  const [bidInput, setBidInput] = useState<string>("");
  const [bidMsg, setBidMsg] = useState<string | null>(null);
  const [bidBusy, setBidBusy] = useState(false);

  const [files, setFiles] = useState<ArtworkFile[]>([]);
  const [mainUrl, setMainUrl] = useState<string | null>(null);

  const [tab, setTab] = useState<"details" | "orders" | "activity">("details");

  const [owners, setOwners] = useState<
    { profile: Profile; quantity: number; updated_at: string }[]
  >([]);

  const [sales, setSales] = useState<
    (SaleRow & { buyer?: Profile | null; seller?: Profile | null })[]
  >([]);

  const [pinLoading, setPinLoading] = useState(false);
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [pinData, setPinData] = useState<PinResp | null>(null);

  const [walletOpen, setWalletOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);

  const [sellerOpen, setSellerOpen] = useState(false);

  const [myHidden, setMyHidden] = useState<boolean | null>(null);
  const [hideBusy, setHideBusy] = useState(false);

  const [showLicense, setShowLicense] = useState(false);

  const [moreFrom, setMoreFrom] = useState<SiblingArt[]>([]);
  const [moreLoading, setMoreLoading] = useState<boolean>(false);

  const [showShareQR, setShowShareQR] = useState(false);
  const [showShareDM, setShowShareDM] = useState(false);

  // ✅ Auction ended popup state
  const [auctionEndOpen, setAuctionEndOpen] = useState(false);
  const [auctionOutcome, setAuctionOutcome] = useState<null | {
    amount: number | null;
    currency: string;
    reserve: number | null;
    reserveMet: boolean;
    winner: { id: string; display_name: string | null; username: string | null } | null;
  }>(null);

  const winnerProfileRef = useRef<
    { id: string; display_name: string | null; username: string | null } | null
  >(null);

  // ✅ internal refs to avoid duplicate popups / finalize spam
  const shownForListingRef = useRef<string | null>(null);
  const finalizeStateRef = useRef<{ listingId: string; at: number } | null>(null);
  const finalizeInFlightRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setViewerId(data.session?.user?.id ?? null);
    })();
  }, []);

  async function fetchListingForPage(artworkId: string) {
    // Prefer active listing. If none, allow showing the latest AUCTION listing even if ended/paid.
    const active = await fetchActiveListingForArtwork(artworkId);
    if (active) return active as any;

    const latest = await fetchLatestListingForArtwork(artworkId);
    if (latest && String((latest as any).type) === "auction") return latest as any;

    return null;
  }

  async function refreshListingByIdSafe(listingId: string) {
    const l = await fetchListingById(listingId);
    if (l) setActiveListing(l as any);
    return l;
  }

  async function ensureWinnerProfile(userId: string | null) {
    if (!userId) {
      winnerProfileRef.current = null;
      return null;
    }
    if (winnerProfileRef.current?.id === userId) return winnerProfileRef.current;

    const { data } = await supabase
      .from("profiles")
      .select("id,display_name,username")
      .eq("id", userId)
      .maybeSingle();

    winnerProfileRef.current = (data as any) ?? null;
    return winnerProfileRef.current;
  }

  function buildOutcome(listing: any, tb: Bid | null) {
    const reserve = (listing?.reserve_price ?? null) as number | null;
    const currency = (listing?.sale_currency ?? "USD") as string;
    const reserveMet = tb ? (reserve == null ? true : tb.amount >= reserve) : false;

    const winner =
      reserveMet && tb?.bidder_id
        ? (winnerProfileRef.current &&
          winnerProfileRef.current.id === tb.bidder_id
            ? winnerProfileRef.current
            : null)
        : null;

    return {
      amount: tb?.amount ?? null,
      currency,
      reserve,
      reserveMet,
      winner,
    };
  }

  async function computeOutcome(listing: any, tbOverride?: Bid | null) {
    const tb = tbOverride !== undefined ? tbOverride : await fetchTopBid(listing.id);
    setTopBid(tb);

    const reserve = (listing?.reserve_price ?? null) as number | null;
    const reserveMet = tb ? (reserve == null ? true : tb.amount >= reserve) : false;

    if (reserveMet && tb?.bidder_id) {
      await ensureWinnerProfile(tb.bidder_id);
    } else {
      winnerProfileRef.current = null;
    }

    const outcome = buildOutcome(listing, tb);
    // if winner wasn't loaded yet, ensure it’s filled
    if (outcome.reserveMet && tb?.bidder_id) {
      outcome.winner =
        winnerProfileRef.current?.id === tb.bidder_id ? winnerProfileRef.current : null;
    }

    setAuctionOutcome(outcome);
    return outcome;
  }

  async function finalizeAuctionOnce(listing: any, reason: "elapsed" | "openAfterEnd" | "tick") {
    if (!listing?.id) return;
    const listingId = listing.id as string;
    const endAt = listing.end_at as string | null;
    if (!endAt) return;

    const endedByTime = Date.now() >= new Date(endAt).getTime();
    if (!endedByTime) return;

    // throttle attempts (idempotent rpc, but we still avoid spamming)
    const last = finalizeStateRef.current;
    if (last?.listingId === listingId && Date.now() - last.at < 8000) return;
    if (finalizeInFlightRef.current === listingId) return;

    finalizeStateRef.current = { listingId, at: Date.now() };
    finalizeInFlightRef.current = listingId;

    try {
      await endAuction(listingId);
    } catch {
      // idempotent: ignore failures like "already ended"
    } finally {
      finalizeInFlightRef.current = null;
    }

    // Refresh listing row by id (status may become ended/paid)
    let fresh: any = null;
    try {
      fresh = await refreshListingByIdSafe(listingId);
    } catch {
      fresh = null;
    }

    const useListing = fresh ?? listing;

    // Always compute outcome on finalize; show modal once.
    await computeOutcome(useListing);
    if (shownForListingRef.current !== listingId) {
      shownForListingRef.current = listingId;
      setAuctionEndOpen(true);
    }
  }

  async function loadBidHistory(listingId: string, mode: "reset" | "more" = "reset") {
    setBidHistoryBusy(true);
    try {
      const limit = 30;

      let q = supabase
        .from("bids")
        .select("id,amount,created_at,bidder_id")
        .eq("listing_id", listingId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (mode === "more" && bidHistory.length > 0) {
        const last = bidHistory[bidHistory.length - 1];
        q = q.lt("created_at", last.created_at);
      }

      const { data, error } = await q;
      if (error) throw error;

      const rows = (data ?? []) as BidHistoryRow[];
      const bidderIds = Array.from(new Set(rows.map((r) => r.bidder_id))).filter(Boolean);

      let profMap = new Map<string, Profile>();
      if (bidderIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id,username,display_name,avatar_url")
          .in("id", bidderIds);
        (profs ?? []).forEach((p: any) => profMap.set(p.id, p as Profile));
      }

      const enriched = rows.map((r) => ({
        ...r,
        bidder: profMap.get(r.bidder_id) ?? null,
      }));

      if (mode === "reset") {
        setBidHistory(enriched);
      } else {
        setBidHistory((cur) => [...cur, ...enriched]);
      }

      setBidHistoryHasMore(rows.length === limit);
    } catch (e: any) {
      console.warn("loadBidHistory failed:", e?.message ?? e);
    } finally {
      setBidHistoryBusy(false);
    }
  }

  async function refreshAuctionBits(listing: any) {
    if (!listing || listing.type !== "auction") return;
    const tb = await fetchTopBid(listing.id);
    setTopBid(tb);
    await loadBidHistory(listing.id, "reset");
  }

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
            "id,title,description,image_url,creator_id,owner_id,created_at,ipfs_image_cid,ipfs_metadata_cid,token_uri,type,physical_status,collection_id"
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

        const artworkId = (data as Artwork).id;

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
            : Promise.resolve({ data: null, error: null } as any),
          fetchListingForPage(artworkId),
          supabase
            .from("artwork_files")
            .select("id,url,kind,position")
            .eq("artwork_id", artworkId)
            .order("position", { ascending: true }),
        ]);

        if (!alive) return;
        setCreator((c.data as any) ?? null);
        setOwner((o?.data as any) ?? null);
        setActiveListing(l as any);
        setFiles(((af.data as any[]) ?? []).filter((f) => !!f?.url));

        // Collection + more from collection
        const collId = (data as Artwork).collection_id ?? null;
        if (collId) {
          const { data: collWide, error: cwErr } = await supabase
            .from("collections")
            .select("id,slug,name,logo_url,banner_url")
            .eq("id", collId)
            .maybeSingle();

          if (cwErr) {
            const { data: collMin } = await supabase
              .from("collections")
              .select("id,slug,name")
              .eq("id", collId)
              .maybeSingle();
            setCollection((collMin as any) || null);
          } else {
            setCollection((collWide as any) || null);
          }

          try {
            setMoreLoading(true);
            const { data: sibs } = await supabase
              .from("artworks")
              .select("id,title,image_url")
              .eq("collection_id", collId)
              .neq("id", artworkId)
              .order("created_at", { ascending: false })
              .limit(12);
            if (alive) setMoreFrom(((sibs as any[]) ?? []) as SiblingArt[]);
          } finally {
            if (alive) setMoreLoading(false);
          }
        } else {
          setCollection(null);
          setMoreFrom([]);
        }

        await Promise.all([loadOwners(artworkId), loadSales(artworkId)]);
        await loadTopOfferSafe(artworkId);

        if (l && String((l as any).type) === "auction") {
          await refreshAuctionBits(l as any);
          // If page loads after end time, finalize once (even if status is still "active")
          await finalizeAuctionOnce(l as any, "openAfterEnd");
        }

        if (viewerId) {
          const { data: own } = await supabase
            .from("ownerships")
            .select("hidden")
            .eq("artwork_id", artworkId)
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
  }, [id, viewerId]);

  const listingEndAt = (activeListing as any)?.end_at as string | null;
  const listingStatus = (activeListing as any)?.status ?? null;

  const isAuction = useMemo(() => isAuctionListing(activeListing), [activeListing]);
  const auctionEndedByTime = useMemo(() => {
    if (!isAuction || !listingEndAt) return false;
    return Date.now() >= new Date(listingEndAt).getTime();
  }, [isAuction, listingEndAt]);

  const auctionClosed =
    isAuction && (isClosedStatus(listingStatus) || auctionEndedByTime);

  const auctionPaid = isAuction && String(listingStatus ?? "").toLowerCase() === "paid";

  const reserveNow = isAuction ? ((activeListing as any)?.reserve_price ?? null) : null;
  const reserveMetNow =
    isAuction && topBid
      ? reserveNow == null
        ? true
        : topBid.amount >= Number(reserveNow)
      : false;

  const winnerIdNow =
    reserveMetNow && topBid?.bidder_id ? (topBid.bidder_id as string) : null;

  // ✅ Realtime: bid inserts (keeps topBid & history fresh immediately)
  useEffect(() => {
    if (!activeListing || !isAuction) return;

    const off = subscribeBids(activeListing.id, async (b) => {
      setTopBid((cur) => {
        if (!cur) return b;
        // keep correct top bid even on ties
        const better = cmpBid(cur, b) < 0; // cur is "worse" than b
        return better ? b : cur;
      });

      setBidHistory((cur) => {
        const exists = cur.some((x) => x.id === (b as any).id);
        if (exists) return cur;

        const row: any = {
          id: (b as any).id ?? `${Date.now()}`,
          amount: b.amount,
          created_at: (b as any).created_at ?? new Date().toISOString(),
          bidder_id: (b as any).bidder_id ?? "",
          bidder: null,
        };

        // If this bid is from current viewer and we already know their profile name via session,
        // we still keep bidder null and let refresh resolve. (keeps logic simple + consistent)
        return [row, ...cur].slice(0, 200);
      });

      // If auction already closed (status update lags sometimes), refresh outcome quickly
      if (auctionClosed) {
        try {
          await computeOutcome(activeListing as any, b.amount >= (topBid?.amount ?? -Infinity) ? b : undefined);
        } catch {}
      }
    });

    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeListing?.id, isAuction, auctionClosed]);

  // ✅ Realtime: listing status updates (ended/closed/paid)
  useEffect(() => {
    if (!activeListing?.id) return;
    const channel = supabase
      .channel(`listing_${activeListing.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "listings",
          filter: `id=eq.${activeListing.id}`,
        },
        async (payload) => {
          const next = payload.new as any;
          setActiveListing((cur) => (cur ? ({ ...cur, ...next } as any) : (next as any)));

          // If it flips to a closed state, compute outcome & show once
          const nextStatus = String(next?.status ?? "").toLowerCase();
          if (
            String(next?.type) === "auction" &&
            (nextStatus === "ended" || nextStatus === "closed" || nextStatus === "paid")
          ) {
            try {
              await computeOutcome(next, undefined);
            } catch {}
            if (shownForListingRef.current !== next.id) {
              shownForListingRef.current = next.id;
              setAuctionEndOpen(true);
            }
          }
        }
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [activeListing?.id]);

  // ✅ Poll fallback (keeps top bid + history consistent even if realtime drops)
  useEffect(() => {
    if (!activeListing || !isAuction) return;

    let alive = true;

    const t = setInterval(async () => {
      try {
        const tb = await fetchTopBid(activeListing.id);
        if (!alive) return;
        setTopBid(tb);
      } catch {}

      try {
        if (!alive) return;
        await loadBidHistory(activeListing.id, "reset");
      } catch {}

      // If time has passed and status hasn't flipped yet, finalize (once)
      try {
        if (!alive) return;
        await finalizeAuctionOnce(activeListing as any, "tick");
      } catch {}
    }, 6000);

    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [activeListing?.id, isAuction]);

  // ✅ When auction becomes closed, compute outcome (even if user never saw modal yet)
  useEffect(() => {
    if (!activeListing || !isAuction) return;
    if (!auctionClosed) return;

    (async () => {
      try {
        await computeOutcome(activeListing as any);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeListing?.id, auctionClosed]);

  async function loadOwners(artworkId: string) {
    const { data } = await supabase
      .from("ownerships")
      .select("owner_id, quantity, updated_at")
      .eq("artwork_id", artworkId);

    const rows = (data ?? []) as {
      owner_id: string;
      quantity: number;
      updated_at: string;
    }[];
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

  async function loadTopOfferSafe(artworkId: string) {
    try {
      const { data, error } = await supabase
        .from("offers")
        .select("*")
        .eq("artwork_id", artworkId)
        .eq("status", "open")
        .order("amount", { ascending: false, nullsFirst: false })
        .limit(1);

      if (error) throw error;
      const row = (data?.[0] || null) as OfferRow | null;
      if (row) {
        const amount = (row.amount ?? row.price ?? null) as number | null;
        const currency = (row.currency ?? "USD") as string;
        if (amount != null) setTopOffer({ amount, currency });
        else setTopOffer(null);
      } else {
        setTopOffer(null);
      }
    } catch {
      setTopOffer(null);
    }
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
          "id,title,description,image_url,creator_id,owner_id,created_at,ipfs_image_cid,ipfs_metadata_cid,token_uri,type,physical_status,collection_id"
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
    if ((e as any)?.message) return (e as any).message as string;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }

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

  /** ✅ Payment (fixed-price) */
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

  /** ✅ ETH payment (fixed-price) */
  async function onBuyWithMetaMask() {
    if (!activeListing) return;
    setPayBusy(true);
    setMsg(null);

    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) throw new Error("MetaMask not found. Please install it.");

      const accounts: string[] = await ethereum.request({
        method: "eth_requestAccounts",
      });
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
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [SEPOLIA_PARAMS],
          });
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

  /** ✅ Auction payment flow (winner only) */
  async function payForAuctionNow() {
    if (!activeListing || !isAuction) return;

    // ensure outcome is computed
    if (!auctionOutcome) {
      try {
        await computeOutcome(activeListing as any);
      } catch {}
    }

    const winnerId = winnerIdNow;
    if (!reserveMetNow || !winnerId) return;
    if (!viewerId || viewerId !== winnerId) return;
    if (auctionPaid) return;

    const currency = (activeListing.sale_currency ?? "USD").toUpperCase();
    const amount = Number(topBid?.amount ?? auctionOutcome?.amount ?? 0);
    if (!isFinite(amount) || amount <= 0) return;

    setMsg(null);

    // ETH: use MetaMask, send to seller wallet
    if (currency === "ETH") {
      setPayBusy(true);
      try {
        const ethereum = (window as any).ethereum;
        if (!ethereum) throw new Error("MetaMask not found. Please install it.");

        const accounts: string[] = await ethereum.request({
          method: "eth_requestAccounts",
        });
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
            await ethereum.request({
              method: "wallet_addEthereumChain",
              params: [SEPOLIA_PARAMS],
            });
          }
          chainId = await ethereum.request({ method: "eth_chainId" });
          if (chainId !== SEPOLIA_CHAIN_ID_HEX) {
            throw new Error("Please switch MetaMask to Sepolia.");
          }
        }

        const to = (activeListing as any).seller_wallet || FALLBACK_PAYTO || "";
        if (!to) throw new Error("No receiving wallet configured (VITE_SEPOLIA_PAYTO).");

        const value = toHex(parseEther(amount));
        const txHash: string = await ethereum.request({
          method: "eth_sendTransaction",
          params: [{ from, to, value }],
        });

        try {
          await supabase.functions.invoke("record-auction-eth-payment", {
            body: {
              listing_id: activeListing.id,
              tx_hash: txHash,
              buyer_wallet: from,
              amount_eth: amount,
              network: "sepolia",
            },
          });
        } catch (e) {
          console.warn("record-auction-eth-payment failed:", e);
        }

        setMsg("Auction payment sent ✔️");

        // refresh listing by id (status may become paid)
        try {
          await refreshListingByIdSafe(activeListing.id);
        } catch {}
      } catch (e: any) {
        setMsg(e?.message ?? "Payment failed");
      } finally {
        setPayBusy(false);
      }
      return;
    }

    // Fiat/Stripe: Edge Function creates checkout session
    setPayBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-auction-checkout", {
        body: {
          listing_id: activeListing.id,
          success_url: `${location.origin}/checkout/success`,
          cancel_url: location.href,
        },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("Checkout URL not returned");
      window.location.href = data.url;
    } catch (e: any) {
      setMsg(e?.message ?? "Payment setup failed (missing create-auction-checkout?)");
    } finally {
      setPayBusy(false);
    }
  }

  /** ✅ Contact winner (seller) */
  async function contactWinner() {
    const winId = winnerIdNow ?? auctionOutcome?.winner?.id ?? null;
    if (!winId) return;

    try {
      const tid = await dmGetOrCreateThread(winId);

      // 1) send congratulation message first (so winner sees context immediately)
      try {
        const sellerName =
          owner?.display_name || owner?.username || (owner?.id ? owner.id.slice(0, 6) : "Seller");
        const title = art?.title ?? "this artwork";
        const finalAmt = topBid?.amount ?? auctionOutcome?.amount ?? null;
        const ccy = (activeListing?.sale_currency ?? "USD").toUpperCase();
        const payHint =
          ccy === "ETH"
            ? "You can pay using MetaMask (ETH) when you open the artwork page."
            : "You can pay via Stripe (card) when you open the artwork page.";

        const text =
          `Congrats — you’re the winner of this auction for “${title}”! 🎉\n\n` +
          (finalAmt != null ? `Final price: ${finalAmt} ${ccy}\n\n` : "") +
          `${payHint}\n\n` +
          `Open the artwork here to complete payment: ${location.origin}/art/${art?.id}`;

        // if you have a plain text DM send helper, use it here.
        // Otherwise we just send the artwork card below (your current DM system).
        // (Keeping safe: no assumptions about "send text" endpoint)
        void text;
      } catch {}

      // 2) send the artwork card as the “context” message
      if (art) {
        await dmSendArtworkShare(tid, art.id, {
          title: art.title ?? "Untitled",
          image_url: art.image_url,
        });
      }

      nav(`/messages?t=${encodeURIComponent(tid)}`);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to open chat");
    }
  }

  const isOwner = !!viewerId && !!art?.owner_id && viewerId === art.owner_id;
  const isSeller = !!activeListing && !!viewerId && viewerId === (activeListing as any).seller_id;

  const isWinner = !!viewerId && !!winnerIdNow && viewerId === winnerIdNow;

  const paymentPending = isAuction && auctionClosed && reserveMetNow && !auctionPaid;

  const canBuy = !!activeListing && !!viewerId && !isSeller && !isAuction;
  const canBid =
    !!viewerId && !isSeller && isAuction && !auctionClosed && String(listingStatus ?? "") === "active";

  const minNextBid = useMemo(() => {
    if (!isAuction) return 0;
    const reserve = Number((activeListing as any)?.reserve_price ?? 0) || 0;

    if (!topBid) {
      // first bid must satisfy reserve if set, otherwise any positive
      return reserve > 0 ? reserve : 0;
    }

    const base = topBid.amount * (1 + MIN_INC_BPS / 10000);
    const min = Math.max(reserve, base);

    // avoid weird floating issues: keep up to 8 decimals for ETH (safe UI), 2 for fiat
    const ccy = String(activeListing?.sale_currency ?? "USD").toUpperCase();
    const dp = ccy === "ETH" ? 8 : 2;
    const factor = Math.pow(10, dp);
    return Math.ceil(min * factor) / factor;
  }, [topBid, activeListing, isAuction]);

  const galleryThumbs = useMemo(
    () =>
      ([{ url: art?.image_url } as any, ...(Array.isArray(files) ? files : [])] as {
        url?: string;
      }[])
        .filter((f) => !!f?.url)
        .slice(0, 10),
    [art?.image_url, files]
  );

  const displayedTopOffer = useMemo(() => {
    if (isAuction && topBid) {
      return { amount: topBid.amount, currency: activeListing?.sale_currency ?? "ETH" };
    }
    if (topOffer) return topOffer;
    if (sales?.[0]) return { amount: sales[0].price, currency: sales[0].currency };
    return null;
  }, [isAuction, topBid, activeListing?.sale_currency, topOffer, sales]);

  async function onPlaceBid() {
    if (!activeListing || !isAuction) return;

    setBidBusy(true);
    setBidMsg(null);

    try {
      if (auctionClosed) throw new Error("Auction ended");
      if (String(listingStatus ?? "") !== "active") throw new Error("Auction is not active");

      const amt = Number(bidInput || 0);
      if (!isFinite(amt) || amt <= 0) throw new Error("Enter a valid amount");

      const minNow = minNextBid || 0;
      if (minNow > 0 && amt < minNow) {
        throw new Error(`Bid must be ≥ ${minNow}`);
      }

      // fast UI: optimistic clear + message
      setBidInput("");

      const b = await placeBid(activeListing.id, amt);

      // immediate UI: update top bid & history now (before realtime arrives)
      setTopBid((cur) => {
        if (!cur) return b;
        const better = cmpBid(cur, b) < 0;
        return better ? b : cur;
      });

      setBidHistory((cur) => {
        const exists = cur.some((x) => x.id === b.id);
        if (exists) return cur;

        const row: any = {
          id: b.id,
          amount: b.amount,
          created_at: b.created_at,
          bidder_id: b.bidder_id,
          bidder: null,
        };

        return [row, ...cur].slice(0, 200);
      });

      // refresh list so names load + ordering remains correct
      await loadBidHistory(activeListing.id, "reset");

      setBidMsg("Bid placed ✅");
    } catch (e: any) {
      setBidMsg(e?.message || "Bid failed");
    } finally {
      setBidBusy(false);
    }
  }

  // ✅ Countdown finalize trigger
  useEffect(() => {
    if (!activeListing || !isAuction) return;
    if (!listingEndAt) return;
    if (auctionClosed) return;

    // If already elapsed (rare timing), finalize immediately
    if (Date.now() >= new Date(listingEndAt).getTime()) {
      void finalizeAuctionOnce(activeListing as any, "elapsed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeListing?.id, isAuction, listingEndAt, auctionClosed]);

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

  const canRequestLicense = !!viewerId && viewerId !== art.creator_id;
  const ccy = (activeListing?.sale_currency ?? "USD").toUpperCase();
  const bidStep = ccy === "ETH" ? "0.00000001" : "0.01";

  return (
    <>
      <div className="max-w-7xl mx-auto p-6 space-y-8">
        {/* Top: Image + Right panel */}
        <div className="grid gap-8 lg:grid-cols-12">
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
                <div className="aspect-square grid place-items-center text-neutral-400">
                  No image
                </div>
              )}
            </div>

            {galleryThumbs.length > 0 && (
              <div className="grid grid-cols-5 gap-2">
                {galleryThumbs.map((f, i) => (
                  <button
                    key={i}
                    onClick={() => setMainUrl(f.url || null)}
                    className={`aspect-square overflow-hidden rounded-xl border transition ${
                      mainUrl === f.url
                        ? "border-white/50"
                        : "border-white/10 hover:border-white/30"
                    } bg-neutral-900`}
                  >
                    {/* @ts-ignore */}
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
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-3xl font-semibold leading-tight truncate">
                  {art.title || "Untitled"}
                </h1>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
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
                      <Link
                        to={owner.username ? `/u/${owner.username}` : `/u/${owner.id}`}
                        className="underline"
                      >
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
                  {isAuction ? (
                    auctionPaid ? (
                      <Pill tone="success">PAID</Pill>
                    ) : paymentPending ? (
                      <Pill tone="warning">AWAITING PAYMENT</Pill>
                    ) : auctionClosed ? (
                      <Pill tone="warning">AUCTION ENDED</Pill>
                    ) : (
                      <Pill tone="warning">AUCTION</Pill>
                    )
                  ) : null}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                {isOwner && (
                  <button
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm hover:bg-white/10"
                    title="Seller tools"
                    onClick={() => setSellerOpen(true)}
                  >
                    ✏️ Tools
                  </button>
                )}

                {viewerId ? (
                  <button
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm hover:bg-white/10"
                    title="Send to DM"
                    onClick={() => setShowShareDM(true)}
                  >
                    ✉️ Send
                  </button>
                ) : null}

                <Link
                  to={`/art/${id}/ar`}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm hover:bg-white/10"
                  title="Preview on your wall (AR)"
                >
                  🧱 AR
                </Link>

                <button
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm hover:bg-white/10"
                  title="Share QR"
                  onClick={() => setShowShareQR(true)}
                >
                  ▣
                </button>

                <button
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm hover:bg-white/10"
                  title="Copy link"
                  onClick={() => navigator.clipboard?.writeText(window.location.href)}
                >
                  ⧉
                </button>

                <button
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm hover:bg-white/10"
                  title="Favorite"
                >
                  <HeartIcon />
                </button>
              </div>
            </div>

            {/* Stats */}
            <Card>
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/10 rounded-xl bg-white/[0.03]">
                <StatBox
                  label="Top offer"
                  value={
                    displayedTopOffer
                      ? fmtCurrency(displayedTopOffer.amount, displayedTopOffer.currency)
                      : "—"
                  }
                />
                <StatBox
                  label="Original price"
                  value={
                    sales.length
                      ? fmtCurrency(
                          sales[sales.length - 1].price,
                          sales[sales.length - 1].currency
                        )
                      : "—"
                  }
                />
                <StatBox label="Rarity" value={"—"} />
                <StatBox
                  label="Last sale"
                  value={sales[0] ? fmtCurrency(sales[0].price, sales[0].currency) : "—"}
                />
              </div>
            </Card>

            {/* Listing / Auction */}
            <Card
              title="Listing"
              right={
                isAuction ? (
                  auctionPaid ? (
                    <Pill tone="success">COMPLETED</Pill>
                  ) : auctionClosed ? (
                    <Pill tone="warning">ENDED</Pill>
                  ) : (
                    <Pill tone="warning">LIVE</Pill>
                  )
                ) : null
              }
            >
              {activeListing ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    {isAuction ? (
                      <div className="text-sm">
                        <div className="text-white/60">Highest bid</div>
                        <div className="text-2xl font-semibold mt-0.5">
                          {topBid ? fmtCurrency(topBid.amount, activeListing.sale_currency) : "—"}
                        </div>

                        {(activeListing as any).reserve_price != null ? (
                          <div className="text-[11px] text-white/60 mt-1">
                            Reserve:{" "}
                            {fmtCurrency(
                              (activeListing as any).reserve_price,
                              activeListing.sale_currency
                            )}{" "}
                            •{" "}
                            {!topBid ? (
                              <span className="text-amber-300">not met</span>
                            ) : reserveMetNow ? (
                              <span className="text-emerald-300">met</span>
                            ) : (
                              <span className="text-amber-300">not met</span>
                            )}
                          </div>
                        ) : null}

                        {auctionClosed && !auctionPaid ? (
                          <div className="mt-2 text-xs text-amber-300">Auction has ended.</div>
                        ) : null}
                        {auctionPaid ? (
                          <div className="mt-2 text-xs text-emerald-300">Payment received.</div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="text-3xl font-semibold">
                          {fmtCurrency(activeListing.fixed_price ?? null, activeListing.sale_currency)}
                        </div>
                      </div>
                    )}

                    {isAuction && listingEndAt && !auctionClosed ? (
                      <Countdown
                        endAt={listingEndAt}
                        onElapsed={async () => {
                          try {
                            await finalizeAuctionOnce(activeListing as any, "elapsed");
                          } catch {}
                        }}
                      />
                    ) : null}
                  </div>

                  {/* Main action area */}
                  <div className="mt-3 flex gap-2">
                    {isAuction ? (
                      canBid ? (
                        <>
                          <input
                            className="input flex-1"
                            type="number"
                            min={minNextBid || 0}
                            step={bidStep}
                            placeholder={minNextBid ? `≥ ${minNextBid}` : "Your bid"}
                            value={bidInput}
                            onChange={(e) => setBidInput(e.target.value)}
                            disabled={!canBid || bidBusy}
                          />
                          <button
                            className="btn flex-1"
                            onClick={onPlaceBid}
                            disabled={!canBid || bidBusy}
                          >
                            {bidBusy ? "Bidding…" : "Place bid"}
                          </button>
                        </>
                      ) : (
                        <div className="text-sm text-white/70">
                          {auctionPaid
                            ? "Auction completed."
                            : auctionClosed
                            ? "Auction ended."
                            : isSeller
                            ? "Sellers can’t bid on their own auction."
                            : "Sign in to bid."}
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

                  {/* Post-auction payment panel */}
                  {isAuction && auctionClosed ? (
                    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      {!reserveMetNow ? (
                        <div className="text-sm text-white/70">
                          Reserve not met — no winner. Seller can relist.
                        </div>
                      ) : auctionPaid ? (
                        <div className="text-sm text-white/80">
                          ✅ Winner has paid. Proceed with handover / shipping.
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="text-sm text-white/80">
                            {isWinner ? (
                              <span>
                                You won the auction. Please complete payment to secure the artwork.
                              </span>
                            ) : isSeller ? (
                              <span>Awaiting winner payment. You can contact the winner if needed.</span>
                            ) : (
                              <span>Auction ended. Winner is completing payment.</span>
                            )}
                          </div>

                          <div className="flex gap-2">
                            {isWinner ? (
                              <button className="btn" onClick={payForAuctionNow} disabled={payBusy}>
                                {payBusy ? "Preparing…" : "Pay now"}
                              </button>
                            ) : null}
                            {isSeller ? (
                              <button
                                className="btn bg-white/0 border border-white/20 hover:bg-white/10"
                                onClick={contactWinner}
                              >
                                Contact winner
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {canRequestLicense && (
                    <div className="mt-3">
                      <button className="btn w-full" onClick={() => setShowLicense(true)}>
                        Request license
                      </button>
                    </div>
                  )}

                  {bidMsg && <div className="text-xs text-neutral-200 mt-2">{bidMsg}</div>}

                  {/* ✅ Bid history preview (always visible for auction) */}
                  {isAuction ? (
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-sm font-semibold">Bid history</div>
                        <button
                          className="text-xs underline text-white/70 hover:text-white"
                          onClick={() => setTab("activity")}
                        >
                          View in Activity
                        </button>
                      </div>

                      <div className="max-h-[220px] overflow-auto rounded-xl border border-white/10 divide-y divide-white/10">
                        {bidHistory.length === 0 ? (
                          <div className="p-3 text-sm text-white/60">No bids yet.</div>
                        ) : (
                          bidHistory.slice(0, 12).map((b) => {
                            const nm =
                              b.bidder?.display_name ||
                              b.bidder?.username ||
                              (b.bidder_id ? b.bidder_id.slice(0, 6) : "—");
                            return (
                              <div
                                key={b.id}
                                className="p-3 flex items-center justify-between gap-3"
                              >
                                <div className="min-w-0">
                                  <div className="text-sm text-white/85 truncate">{nm}</div>
                                  <div className="text-xs text-white/55">
                                    {new Date(b.created_at).toLocaleString()}
                                  </div>
                                </div>
                                <div className="text-sm font-semibold">
                                  {fmtCurrency(b.amount, activeListing.sale_currency)}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <div className="text-[11px] text-white/55">
                          Min next bid: {minNextBid || "—"} {activeListing.sale_currency}
                          {viewerId && topBid?.bidder_id === viewerId ? " • You’re winning" : ""}
                        </div>
                        <button
                          className="text-xs underline text-white/70 hover:text-white disabled:opacity-50"
                          disabled={bidHistoryBusy}
                          onClick={() => loadBidHistory(activeListing.id, "reset")}
                        >
                          {bidHistoryBusy ? "Refreshing…" : "Refresh"}
                        </button>
                      </div>
                    </div>
                  ) : null}
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
            </Card>
          </div>
        </div>

        {/* Tabs area */}
        <div>
          <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.04]">
            <div className="flex gap-4 px-4 pt-3 border-b border-white/10">
              {(["details", "orders", "activity"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-2 pb-3 text-sm border-b-2 ${
                    tab === t
                      ? "border-white text-white"
                      : "border-transparent text-white/70 hover:text-white"
                  }`}
                >
                  {t === "details" ? "Details" : t === "orders" ? "Orders" : "Activity"}
                </button>
              ))}
            </div>

            {tab === "details" && (
              <div className="p-4 space-y-4">
                <Card title={<span className="text-base font-semibold">About</span>}>
                  <div className="text-sm text-white/80 whitespace-pre-wrap">
                    {art.description || "No description provided."}
                  </div>
                </Card>

                <Card title={<span className="text-base font-semibold">Collection</span>}>
                  <div className="text-sm text-white/80">
                    {collection ? (
                      <Link
                        to={`/collection/${encodeURIComponent(collection.slug || collection.id)}`}
                        className="underline"
                      >
                        {collection.name || collection.slug || "Untitled collection"}
                      </Link>
                    ) : (
                      <span className="text-white/60">Not part of a collection.</span>
                    )}
                  </div>

                  <div className="mt-3">
                    <div className="font-medium">More from this collection</div>
                    {collection ? (
                      <>
                        {moreLoading ? (
                          <div className="mt-2 text-sm text-white/60">Loading…</div>
                        ) : moreFrom.length > 0 ? (
                          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                            {moreFrom.map((a) => (
                              <Link key={a.id} to={`/art/${a.id}`} className="group block">
                                <div className="aspect-square rounded-xl overflow-hidden border border-white/10 bg-neutral-900">
                                  {a.image_url ? (
                                    <img
                                      src={a.image_url}
                                      alt={a.title ?? "Artwork"}
                                      className="w-full h-full object-cover group-hover:opacity-90 transition"
                                    />
                                  ) : (
                                    <div className="w-full h-full grid place-items-center text-xs text-white/50">
                                      No image
                                    </div>
                                  )}
                                </div>
                                <div className="mt-1 text-xs truncate text-white/80">
                                  {a.title || "Untitled"}
                                </div>
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-1 text-sm text-white/60">
                            No more artworks in this collection yet.
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="mt-1 text-sm text-white/60">
                        This artwork is not part of a collection.
                      </div>
                    )}
                  </div>
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
              <div className="p-4 space-y-4">
                {isAuction ? (
                  <Card title="Bid history">
                    <div className="text-xs text-white/60 mb-2">
                      All bids are recorded in real-time.
                    </div>

                    <div className="max-h-[520px] overflow-auto rounded-xl border border-white/10 divide-y divide-white/10">
                      {bidHistory.length === 0 ? (
                        <div className="p-3 text-sm text-white/60">No bids yet.</div>
                      ) : (
                        bidHistory.map((b) => {
                          const nm =
                            b.bidder?.display_name ||
                            b.bidder?.username ||
                            (b.bidder_id ? b.bidder_id.slice(0, 6) : "—");
                          return (
                            <div key={b.id} className="p-3 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm text-white/85 truncate">{nm}</div>
                                <div className="text-xs text-white/55">
                                  {new Date(b.created_at).toLocaleString()}
                                </div>
                              </div>
                              <div className="text-sm font-semibold">
                                {fmtCurrency(b.amount, activeListing?.sale_currency ?? "USD")}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <button
                        className="btn bg-white/0 border border-white/20 hover:bg-white/10"
                        onClick={() => loadBidHistory(activeListing!.id, "reset")}
                        disabled={bidHistoryBusy}
                      >
                        {bidHistoryBusy ? "Refreshing…" : "Refresh"}
                      </button>

                      <button
                        className="btn bg-white/0 border border-white/20 hover:bg-white/10"
                        onClick={() => loadBidHistory(activeListing!.id, "more")}
                        disabled={bidHistoryBusy || !bidHistoryHasMore}
                        title={!bidHistoryHasMore ? "No more bids" : ""}
                      >
                        Load more
                      </button>
                    </div>
                  </Card>
                ) : null}

                <Card title="Sales activity">
                  {sales.length === 0 ? (
                    <div className="text-sm text-white/70">No sales yet.</div>
                  ) : (
                    <ul className="space-y-3">
                      {sales.map((s) => (
                        <li
                          key={s.id}
                          className="p-3 rounded-xl bg-white/[0.04] border border-white/10"
                        >
                          <div className="text-sm">
                            Sale • <b>{fmtCurrency(s.price, s.currency)}</b> on{" "}
                            {new Date(s.sold_at).toLocaleString()}
                          </div>
                          <div className="text-xs text-white/70">
                            tx: {s.tx_hash ? <code className="break-all">{s.tx_hash}</code> : "—"}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <Link to="/" className="btn">
              Back
            </Link>
          </div>
        </div>
      </div>

      <WalletModal
        open={walletOpen}
        onClose={() => (payBusy ? null : setWalletOpen(false))}
        onMetaMask={onBuyWithMetaMask}
        disabledText="Coming soon"
      />

      <ShareQRModal open={showShareQR} onClose={() => setShowShareQR(false)} url={`${location.origin}/art/${id}`} />

      <ShareToDMModal
        open={showShareDM}
        onClose={() => setShowShareDM(false)}
        artwork={{ id: art.id, title: art.title, image_url: art.image_url }}
        onSent={(threadId) => nav(`/messages?t=${encodeURIComponent(threadId)}`)}
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
          onListingUpdated={async () => {
            const l = await fetchListingForPage(art.id);
            setActiveListing(l as any);
            if (l && String((l as any).type) === "auction") {
              await refreshAuctionBits(l as any);
            }
          }}
          postAuctionMode={isAuction && auctionClosed}
          paymentPending={paymentPending}
          onContactWinner={contactWinner}
        />
      )}

      <AuctionEndedModal
        open={auctionEndOpen}
        onClose={() => setAuctionEndOpen(false)}
        outcome={auctionOutcome}
        isWinner={isWinner}
        onPayNow={payForAuctionNow}
        payBusy={payBusy}
        paid={auctionPaid}
      />
    </>
  );
}

/* ------------------------------ Seller Console ------------------------------ */

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
    </Card>
  );
}

function SellerConsole({
  open,
  onClose,
  artworkId,
  onListingUpdated,
  postAuctionMode,
  paymentPending,
  onContactWinner,
}: {
  open: boolean;
  onClose: () => void;
  artworkId: string;
  onListingUpdated: () => Promise<void> | void;
  postAuctionMode: boolean;
  paymentPending: boolean;
  onContactWinner: () => void;
}) {
  const [tab, setTab] = useState<"price" | "auction" | "details">("price");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[520px] bg-neutral-950 border-l border-white/10 shadow-2xl p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">{postAuctionMode ? "Auction tools" : "Seller tools"}</h3>
          <button className="text-sm text-white/70 hover:text-white" onClick={onClose}>
            Close
          </button>
        </div>

        {/* Post-auction banner */}
        {postAuctionMode ? (
          <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            {paymentPending ? (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm text-white/80">
                  Awaiting winner payment. You can contact the winner.
                </div>
                <button
                  className="btn bg-white/0 border border-white/20 hover:bg-white/10"
                  onClick={onContactWinner}
                >
                  Contact winner
                </button>
              </div>
            ) : (
              <div className="text-sm text-white/70">
                Auction ended. If reserve wasn’t met, you can relist or start a new auction.
              </div>
            )}
          </div>
        ) : null}

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
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
            <div className="text-sm text-white/70">Start a new auction.</div>
            <OwnerAuctionPanel artworkId={artworkId} onCreated={onListingUpdated} />
          </div>
        )}

        {tab === "details" && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
            <div className="text-sm text-white/70">
              Update artwork metadata (title/description, tags, etc.).
            </div>
            <div className="flex gap-2">
              <a href={`/art/${artworkId}/edit`} className="btn">
                Go to edit page
              </a>
              <span className="text-xs text-white/60 self-center">
                (If you don’t have an edit route yet, we can add one.)
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
