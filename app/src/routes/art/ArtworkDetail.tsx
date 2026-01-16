// app/src/routes/art/ArtworkDetail.tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import QRCode from "qrcode";

import { supabase } from "../../lib/supabase";
import {
  createOrUpdateFixedPriceListing,
  fetchActiveListingForArtwork,
  fetchLatestListingForArtwork,
  fetchListingById,
  type Listing,
} from "../../lib/listings";
import { fetchTopBid, placeBid, subscribeBids, endAuction, type Bid } from "../../lib/bids";

import RequestLicenseModal from "../../components/RequestLicenseModal";
import PhysicalBadge from "../../components/art/PhysicalBadge";
import OwnerAuctionPanel from "../../components/OwnerAuctionPanel";

/** ✅ DM helpers */
import { dmGetOrCreateThread, dmListFriends, dmSendArtworkShare, dmSendText } from "../../features/messages/api";

/** ✅ Notification helper */
import { createNotification } from "../../lib/notifications.ts";

/* ------------------------------ Helper Functions ------------------------------ */

function buildWinnerCongratsMessage(params: {
  artworkTitle?: string | null;
  artworkId: string;
  stripeUrl?: string | null;
}) {
  const title = params.artworkTitle || "your artwork";
  const artLink = `${window.location.origin}/art/${params.artworkId}`;

  return [
    `🎉 Congratulations! You’re the winning bidder for **${title}**.`,
    `To complete your purchase, please choose a payment method below:`,
    `1) **Card / Stripe** ${params.stripeUrl ? `-> ${params.stripeUrl}` : "(owner will provide checkout link shortly)"}`,
    `2) **Crypto / MetaMask** -> open the artwork page and use the crypto checkout option (if available)`,
    `Artwork link: ${artLink}`,
    `If you need help, just reply here — I’ll assist you with the next step.`,
  ].join("\n");
}

function fmtCurrency(n: number | null | undefined, code?: string | null) {
  if (n == null || !isFinite(Number(n))) return "—";
  const c = (code ?? "USD").toUpperCase();
  if (c === "ETH") return `${Number(n).toString()} ETH`;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(Number(n));
  } catch {
    return `${Number(n)} ${c}`;
  }
}

function isAuctionListing(l: any): boolean {
  return !!l && String(l.type) === "auction" && !!l.end_at;
}
function isClosedStatus(status: any): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === "ended" || s === "closed" || s === "paid" || s === "canceled";
}
function parseInvokeError(err: any): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err?.context) {
    const c = err.context;
    const msg = c?.error?.message || c?.error || c?.message || (typeof c === "string" ? c : null);
    if (msg) return String(msg);
    try {
      return JSON.stringify(c);
    } catch {}
  }
  if (err?.message) return String(err.message);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/* ------------------------------ Config / Metamask ------------------------------ */

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

/* ------------------------------ Types ------------------------------ */

type Artwork = {
  id: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  author_id: string;
  owner_id: string | null;
  created_at: string;
  ipfs_image_cid?: string | null;
  ipfs_metadata_cid?: string | null;
  token_uri?: string | null;
  type?: "digital" | "physical" | null;
  physical_status?: "with_creator" | "in_transit" | "with_buyer" | "in_gallery" | "unknown" | null;
  collection_id?: string | null;
};

type ArtworkFile = { id: string; url: string; kind: string | null; position: number | null };

type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type SaleRow = {
  id: string;
  buyer_id: string | null;
  seller_id: string | null;
  price: number;
  currency: string;
  sold_at: string;
  tx_hash: string | null;
};

type OfferRow = { amount?: number | null; price?: number | null; currency?: string | null; status?: string | null };

type BidHistoryRow = { id: string; amount: number; created_at: string; bidder_id: string };

type PriceHistoryRow = {
  artwork_id: string;
  ts: string;
  kind: "bid" | "sale";
  amount: number;
  currency: string;
  listing_id: string | null;
  ref_id: string | null;
  actor_id: string | null;
};

type CommentRow = {
  id: string;
  artwork_id: string;
  parent_id: string | null;
  content: string;
  created_at: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

/* ------------------------------ Small UI helpers ------------------------------ */

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
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${toneCls} ${className}`}>{children}</span>;
}

function StatBox({ label, value }: { label: string; value: ReactNode }) {
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
  title?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${className}`}>
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

function Avatar({
  url,
  name,
  size = 28,
  className = "",
}: {
  url?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  if (!url) {
    return (
      <div
        className={`rounded-full bg-white/5 border border-white/10 ${className}`}
        style={{ width: size, height: size }}
        title={name}
      />
    );
  }
  return (
    <img
      src={url}
      alt={name}
      title={name}
      className={`rounded-full object-cover border border-white/10 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/* ------------------------------ Countdown ------------------------------ */

function Countdown({ endAt, onElapsed }: { endAt: string; onElapsed?: () => void }) {
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

/* ------------------------------ Wallet Modal ------------------------------ */

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
          <button className="btn w-full flex items-center justify-center gap-2" onClick={onMetaMask}>
            <span>MetaMask</span>
          </button>
          {disabledText && <p className="text-xs text-white/60 text-center">{disabledText}</p>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Share QR ------------------------------ */

function ShareQRModal({ open, onClose, url, title = "Share QR" }: { open: boolean; onClose: () => void; url: string; title?: string }) {
  const [img, setImg] = useState<string>("");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!open) return;
      const data = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", scale: 6 });
      if (alive) setImg(data);
    })();
    return () => {
      alive = false;
    };
  }, [open, url]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-neutral-950 border border-white/10 rounded-2xl p-4 w-full max-w-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button className="text-sm text-white/70 hover:text-white" onClick={onClose}>
            Close
          </button>
        </div>

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

/* ------------------------------ Share to DM Modal ------------------------------ */

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
      await dmSendArtworkShare(tid, artwork.id, { title: artwork.title ?? "Untitled", image_url: artwork.image_url });
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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-950 p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">Send artwork</div>
          <button className="text-sm text-white/70 hover:text-white" onClick={onClose}>
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
            <div className="text-sm font-medium text-white/90 truncate">{artwork.title ?? "Untitled"}</div>
            <div className="text-xs text-white/60 truncate">/art/${artwork.id}</div>
          </div>
        </div>

        {err ? <div className="mb-2 text-sm text-red-300">{err}</div> : null}
        {busy ? <div className="text-sm text-white/60 p-2">Loading…</div> : null}

        <div className="max-h-[52vh] overflow-auto divide-y divide-white/10 rounded-xl border border-white/10">
          {friends.length === 0 && !busy ? (
            <div className="p-3 text-sm text-white/60">No mutual-follow friends yet.</div>
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
                    <Avatar url={f.other_avatar_url} name={name} size={36} />
                    <div className="min-w-0">
                      <div className="truncate text-sm text-white/90 font-medium">{name}</div>
                      <div className="truncate text-xs text-white/60">Send via DM</div>
                    </div>
                  </div>

                  <span className="text-xs rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-white/80">Send</span>
                </button>
              );
            })
          )}
        </div>

        <div className="mt-3 text-[11px] text-white/50">Tip: after sending, we’ll open Messages on that thread.</div>
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
  onPayStripe,
  onPayMetaMask,
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
  onPayStripe: () => void;
  onPayMetaMask: () => void;
  payBusy: boolean;
  paid: boolean;
}) {
  if (!open) return null;

  const winnerName =
    outcome?.winner?.display_name || outcome?.winner?.username || (outcome?.winner?.id ? outcome.winner.id.slice(0, 6) : null);

  const ccy = (outcome?.currency ?? "USD").toUpperCase();
  const canStripe = ccy !== "ETH";
  const canMeta = ccy === "ETH";

  const showPay = !paid && !!outcome?.reserveMet && isWinner && outcome?.amount != null;

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
              {outcome.amount} {ccy}
            </div>

            {outcome.reserve != null ? (
              <div className="text-xs text-white/60">
                Reserve: {outcome.reserve} {ccy} •{" "}
                {outcome.reserveMet ? <span className="text-emerald-300">met</span> : <span className="text-amber-300">not met</span>}
              </div>
            ) : null}

            {outcome.reserveMet ? (
              <div className="text-sm text-white/80">
                Winner: <span className="font-semibold">{winnerName ?? "—"}</span>
              </div>
            ) : (
              <div className="text-sm text-white/80">No winner (reserve not met).</div>
            )}

            {paid ? <div className="text-sm text-emerald-300">✅ Payment received.</div> : null}
          </div>
        ) : (
          <div className="mt-3 text-sm text-white/70">No bids were placed.</div>
        )}

        <div className="mt-4 space-y-2">
          {showPay ? (
            <>
              <button className="btn w-full" onClick={onPayStripe} disabled={payBusy || !canStripe} title={!canStripe ? "Stripe is only for non-ETH auctions" : ""}>
                {payBusy ? "Preparing payment…" : "Pay with Stripe"}
              </button>

              <button
                className="btn w-full bg-white/0 border border-white/20 hover:bg-white/10"
                onClick={onPayMetaMask}
                disabled={payBusy || !canMeta}
                title={!canMeta ? "MetaMask is only for ETH auctions" : ""}
              >
                {payBusy ? "Preparing payment…" : "Pay with MetaMask"}
              </button>

              {!canStripe && !canMeta ? (
                <div className="text-xs text-amber-300">This auction currency is not supported for payment yet.</div>
              ) : null}
            </>
          ) : null}

          <button className="btn w-full bg-white/0 border border-white/20 hover:bg-white/10" onClick={onClose}>
            Okay
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Comments Thread ------------------------------ */

function nameOf(c: Pick<CommentRow, "display_name" | "username" | "user_id">) {
  return c.display_name || c.username || (c.user_id ? c.user_id.slice(0, 6) : "—");
}

function CommentsThread({
  artworkId,
  viewerId,
}: {
  artworkId: string;
  viewerId: string | null;
}) {
  const [rows, setRows] = useState<CommentRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [sendBusy, setSendBusy] = useState(false);

  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("artwork_comments")
        .select("id,artwork_id,parent_id,content,created_at,user_id, profiles:profiles ( username, display_name, avatar_url )")
        .eq("artwork_id", artworkId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (error) throw error;

      const mapped: CommentRow[] = (data ?? []).map((r: any) => ({
        id: r.id,
        artwork_id: r.artwork_id,
        parent_id: r.parent_id,
        content: r.content,
        created_at: r.created_at,
        user_id: r.user_id,
        username: r.profiles?.username ?? null,
        display_name: r.profiles?.display_name ?? null,
        avatar_url: r.profiles?.avatar_url ?? null,
      }));

      setRows(mapped);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load comments");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artworkId]);

  const roots = useMemo(() => rows.filter((r) => !r.parent_id), [rows]);
  const repliesByParent = useMemo(() => {
    const m = new Map<string, CommentRow[]>();
    rows
      .filter((r) => !!r.parent_id)
      .forEach((r) => {
        const pid = r.parent_id!;
        const arr = m.get(pid) ?? [];
        arr.push(r);
        m.set(pid, arr);
      });
    return m;
  }, [rows]);

  async function ensureViewerProfileExists() {
    if (!viewerId) throw new Error("Please sign in to comment.");
    const { data } = await supabase.from("profiles").select("id").eq("id", viewerId).maybeSingle();
    if (!data?.id) {
      throw new Error("Your profile row is missing. Go to Profile and save your profile once, then try again.");
    }
  }

  async function sendRoot() {
    setErr(null);
    setSendBusy(true);
    try {
      await ensureViewerProfileExists();
      const content = text.trim();
      if (!content) throw new Error("Write something first.");

      const { error } = await supabase.from("artwork_comments").insert({
        artwork_id: artworkId,
        user_id: viewerId,
        parent_id: null,
        content,
      });

      if (error) throw error;

      setText("");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to post");
    } finally {
      setSendBusy(false);
    }
  }

  async function sendReply() {
    if (!replyTo) return;
    setErr(null);
    setReplyBusy(true);
    try {
      await ensureViewerProfileExists();
      const content = replyText.trim();
      if (!content) throw new Error("Write a reply first.");

      const { error } = await supabase.from("artwork_comments").insert({
        artwork_id: artworkId,
        user_id: viewerId,
        parent_id: replyTo.id,
        content,
      });
      if (error) throw error;

      setReplyText("");
      setReplyTo(null);
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to reply");
    } finally {
      setReplyBusy(false);
    }
  }

  return (
    <Card
      title="Comments"
      right={
        <button className="text-xs underline text-white/70 hover:text-white" onClick={load} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      {err ? <div className="mb-2 text-sm text-red-300">{err}</div> : null}

      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder={viewerId ? "Leave a comment…" : "Sign in to comment"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!viewerId || sendBusy}
        />
        <button className="btn" onClick={sendRoot} disabled={!viewerId || sendBusy}>
          {sendBusy ? "Posting…" : "Post"}
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-white/10 divide-y divide-white/10">
        {roots.length === 0 ? (
          <div className="p-3 text-sm text-white/60">No comments yet.</div>
        ) : (
          roots.map((c) => {
            const replies = repliesByParent.get(c.id) ?? [];
            const nm = nameOf(c);
            return (
              <div key={c.id} className="p-3">
                <div className="flex items-start gap-3">
                  <Avatar url={c.avatar_url} name={nm} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-white/90 truncate">{nm}</div>
                      <div className="text-[11px] text-white/50">{new Date(c.created_at).toLocaleString()}</div>
                    </div>
                    <div className="mt-1 text-sm text-white/80 whitespace-pre-wrap">{c.content}</div>

                    <div className="mt-2 flex items-center gap-3">
                      <button
                        className="text-xs underline text-white/70 hover:text-white"
                        onClick={() => {
                          setReplyTo(c);
                          setReplyText("");
                        }}
                      >
                        Reply
                      </button>
                      <span className="text-[11px] text-white/50">
                        {replies.length ? `${replies.length} reply${replies.length > 1 ? "ies" : ""}` : ""}
                      </span>
                    </div>

                    {replyTo?.id === c.id ? (
                      <div className="mt-3 flex gap-2">
                        <input
                          className="input flex-1"
                          placeholder={viewerId ? `Reply to ${nm}…` : "Sign in to reply"}
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          disabled={!viewerId || replyBusy}
                        />
                        <button className="btn" onClick={sendReply} disabled={!viewerId || replyBusy}>
                          {replyBusy ? "Sending…" : "Send"}
                        </button>
                        <button
                          className="btn bg-white/0 border border-white/20 hover:bg-white/10"
                          onClick={() => setReplyTo(null)}
                          disabled={replyBusy}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : null}

                    {replies.length ? (
                      <div className="mt-3 pl-4 border-l border-white/10 space-y-3">
                        {replies.map((r) => {
                          const rn = nameOf(r);
                          return (
                            <div key={r.id} className="flex items-start gap-3">
                              <Avatar url={r.avatar_url} name={rn} size={28} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-sm text-white/85 truncate">{rn}</div>
                                  <div className="text-[11px] text-white/50">{new Date(r.created_at).toLocaleString()}</div>
                                </div>
                                <div className="mt-1 text-sm text-white/75 whitespace-pre-wrap">{r.content}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

/* ------------------------------ Price history mini chart ------------------------------ */

function PriceHistoryChart({ rows }: { rows: PriceHistoryRow[] }) {
  const W = 560;
  const H = 180;
  const P = 18;

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
        No price history yet.
      </div>
    );
  }

  const points = rows
    .slice()
    .reverse()
    .map((r, i) => ({ x: i, y: Number(r.amount) }));

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const yPad = (maxY - minY) * 0.12 || 1;

  const xTo = (x: number) =>
    P + ((x - minX) / Math.max(1, maxX - minX)) * (W - P * 2);
  const yTo = (y: number) =>
    H -
    P -
    ((y - (minY - yPad)) / Math.max(1, (maxY + yPad) - (minY - yPad))) *
      (H - P * 2);

  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xTo(p.x).toFixed(2)} ${yTo(p.y).toFixed(2)}`)
    .join(" ");

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Price market</div>
        <div className="text-xs text-white/50">
          Range: {minY.toLocaleString()} → {maxY.toLocaleString()}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="h-[180px] w-full">
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2} opacity={0.9} />
        {points.map((p, i) => (
          <circle key={p.x + "-" + i} cx={xTo(p.x)} cy={yTo(p.y)} r={3} fill="currentColor" opacity={0.85} />
        ))}
      </svg>

      <div className="mt-2 text-xs text-white/50">
        Latest:{" "}
        <span className="text-white/80">
          {points[points.length - 1].y.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------ Main Page ------------------------------ */

export default function ArtworkDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();

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
        status?: string | null;
        seller_id?: string | null;
      })
    | null
  >(null);

  const MIN_INC_BPS = 500;
  const [topBid, setTopBid] = useState<Bid | null>(null);

  // bid history
  const [bidHistory, setBidHistory] = useState<(BidHistoryRow & { bidder?: Profile | null })[]>([]);
  const [bidHistoryBusy, setBidHistoryBusy] = useState(false);

  // owners / sales / price history
  const [owners, setOwners] = useState<{ profile: Profile; quantity: number; updated_at: string }[]>([]);
  const [sales, setSales] = useState<(SaleRow & { buyer?: Profile | null; seller?: Profile | null })[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryRow[]>([]);
  const [priceHistoryBusy, setPriceHistoryBusy] = useState(false);

  const [topOffer, setTopOffer] = useState<{ amount: number; currency: string } | null>(null);

  // gallery
  const [files, setFiles] = useState<ArtworkFile[]>([]);
  const [mainUrl, setMainUrl] = useState<string | null>(null);

  // tabs
  const [tab, setTab] = useState<"details" | "orders" | "activity">("details");
  const [activityView, setActivityView] = useState<"bids" | "price">("bids");

  // UI modals
  const [walletOpen, setWalletOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [sellerOpen, setSellerOpen] = useState(false);
  const [showLicense, setShowLicense] = useState(false);
  const [showShareQR, setShowShareQR] = useState(false);
  const [showShareDM, setShowShareDM] = useState(false);

  // bid input
  const [bidInput, setBidInput] = useState<string>("");
  const [bidMsg, setBidMsg] = useState<string | null>(null);
  const [bidBusy, setBidBusy] = useState(false);

  // ✅ auction ended popup state
  const [auctionEndOpen, setAuctionEndOpen] = useState(false);
  const [auctionOutcome, setAuctionOutcome] = useState<null | {
    amount: number | null;
    currency: string;
    reserve: number | null;
    reserveMet: boolean;
    winner: { id: string; display_name: string | null; username: string | null } | null;
  }>(null);

  const winnerProfileRef = useRef<{ id: string; display_name: string | null; username: string | null } | null>(null);

  // ✅ internal refs
  const shownForListingRef = useRef<string | null>(null);
  const finalizeStateRef = useRef<{ listingId: string; at: number } | null>(null);
  const finalizeInFlightRef = useRef<string | null>(null);
  const autoPayRef = useRef<string | null>(null);
  const refreshInFlight = useRef(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setViewerId(data.session?.user?.id ?? null);
    })();
  }, []);

  async function fetchListingForPage(artworkId: string) {
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

    const { data } = await supabase.from("profiles").select("id,display_name,username").eq("id", userId).maybeSingle();
    winnerProfileRef.current = (data as any) ?? null;
    return winnerProfileRef.current;
  }

  function buildOutcome(listing: any, tb: Bid | null) {
    const reserve = (listing?.reserve_price ?? null) as number | null;
    const currency = (listing?.sale_currency ?? "USD") as string;
    const reserveMet = tb ? (reserve == null ? true : tb.amount >= reserve) : false;

    const winner =
      reserveMet && tb?.bidder_id
        ? winnerProfileRef.current && winnerProfileRef.current.id === tb.bidder_id
          ? winnerProfileRef.current
          : null
        : null;

    return { amount: tb?.amount ?? null, currency, reserve, reserveMet, winner };
  }

  async function computeOutcome(listing: any, tbOverride?: Bid | null) {
    const tb = tbOverride !== undefined ? tbOverride : await fetchTopBid(listing.id);
    setTopBid(tb);

    const reserve = (listing?.reserve_price ?? null) as number | null;
    const reserveMet = tb ? (reserve == null ? true : tb.amount >= reserve) : false;

    if (reserveMet && tb?.bidder_id) await ensureWinnerProfile(tb.bidder_id);
    else winnerProfileRef.current = null;

    const outcome = buildOutcome(listing, tb);
    if (outcome.reserveMet && tb?.bidder_id) {
      outcome.winner = winnerProfileRef.current?.id === tb.bidder_id ? winnerProfileRef.current : null;
    }

    setAuctionOutcome(outcome);
    return outcome;
  }

  async function finalizeAuctionOnce(listing: any) {
    if (!listing?.id) return;
    const listingId = listing.id as string;
    const endAt = listing.end_at as string | null;
    if (!endAt) return;

    const endedByTime = Date.now() >= new Date(endAt).getTime();
    if (!endedByTime) return;

    const last = finalizeStateRef.current;
    if (last?.listingId === listingId && Date.now() - last.at < 8000) return;
    if (finalizeInFlightRef.current === listingId) return;

    finalizeStateRef.current = { listingId, at: Date.now() };
    finalizeInFlightRef.current = listingId;

    try {
      await endAuction(listingId);
    } catch {
      // idempotent
    } finally {
      finalizeInFlightRef.current = null;
    }

    let fresh: any = null;
    try {
      fresh = await refreshListingByIdSafe(listingId);
    } catch {
      fresh = null;
    }

    const useListing = fresh ?? listing;
    await computeOutcome(useListing);

    if (shownForListingRef.current !== listingId) {
      shownForListingRef.current = listingId;
      setAuctionEndOpen(true);
    }
  }

  async function loadBidHistory(listingId: string) {
    setBidHistoryBusy(true);
    try {
      const limit = 40;
      const { data, error } = await supabase
        .from("bids")
        .select("id,amount,created_at,bidder_id")
        .eq("listing_id", listingId)
        .order("created_at", { ascending: false })
        .limit(limit);

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

      setBidHistory(
        rows.map((r) => ({
          ...r,
          bidder: profMap.get(r.bidder_id) ?? null,
        }))
      );
    } catch (e: any) {
      console.warn("loadBidHistory failed:", e?.message ?? e);
    } finally {
      setBidHistoryBusy(false);
    }
  }

  async function loadOwners(artworkId: string) {
    const { data } = await supabase
      .from("ownerships")
      .select("owner_id, quantity, updated_at")
      .eq("artwork_id", artworkId);
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
    const { data } = await supabase
      .from("sales")
      .select("id,buyer_id,seller_id,price,currency,sold_at,tx_hash")
      .eq("artwork_id", artworkId)
      .order("sold_at", {
        ascending: false,
      });

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

  async function loadPriceHistory(artworkId: string) {
    setPriceHistoryBusy(true);
    try {
      const { data, error } = await supabase
        .from("artwork_price_history")
        .select("*")
        .eq("artwork_id", artworkId)
        .order("ts", { ascending: false })
        .limit(200);

      if (error) throw error;
      setPriceHistory((data ?? []) as PriceHistoryRow[]);
    } catch (e: any) {
      console.warn("loadPriceHistory failed:", e?.message ?? e);
      setPriceHistory([]);
    } finally {
      setPriceHistoryBusy(false);
    }
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
      } else setTopOffer(null);
    } catch {
      setTopOffer(null);
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

  async function refreshAuctionBits(listing: any) {
    if (!listing || listing.type !== "auction") return;
    const tb = await fetchTopBid(listing.id);
    setTopBid(tb);
    await loadBidHistory(listing.id);
  }

  /* ------------------------------ Load page (initial) ------------------------------ */

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
            "id,title,description,image_url,author_id,owner_id,created_at,ipfs_image_cid,ipfs_metadata_cid,token_uri,type,physical_status,collection_id"
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

        const artwork = data as Artwork;
        setArt(artwork);
        setMainUrl(artwork.image_url || null);

        const artworkId = artwork.id;

        const [c, o, l, af] = await Promise.all([
          supabase
            .from("profiles")
            .select("id,username,display_name,avatar_url")
            .eq("id", artwork.author_id)
            .maybeSingle(),
          artwork.owner_id
            ? supabase
                .from("profiles")
                .select("id,username,display_name,avatar_url")
                .eq("id", artwork.owner_id as string)
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

        await Promise.all([
          loadOwners(artworkId),
          loadSales(artworkId),
          loadTopOfferSafe(artworkId),
          loadPriceHistory(artworkId),
        ]);

        if (l && String((l as any).type) === "auction") {
          await refreshAuctionBits(l as any);
          await finalizeAuctionOnce(l as any);
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
  }, [id]);

  /* ------------------------------ Global 1s refresher ------------------------------ */

  async function refreshAll() {
    if (!id) return;
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;

    try {
      // 1) lightweight artwork + owner/creator refresh
      const { data: artData, error: artErr } = await supabase
        .from("artworks")
        .select(
          "id,title,description,image_url,author_id,owner_id,created_at,ipfs_image_cid,ipfs_metadata_cid,token_uri,type,physical_status,collection_id"
        )
        .eq("id", id)
        .maybeSingle();

      if (!artErr && artData) {
        const artwork = artData as Artwork;
        setArt(artwork);
        if (!mainUrl) setMainUrl(artwork.image_url || null);

        // creator
        if (!creator || creator.id !== artwork.author_id) {
          const { data: c } = await supabase
            .from("profiles")
            .select("id,username,display_name,avatar_url")
            .eq("id", artwork.author_id)
            .maybeSingle();
          setCreator((c as any) ?? null);
        }

        // owner
        if (!owner || owner.id !== artwork.owner_id) {
          if (artwork.owner_id) {
            const { data: o } = await supabase
              .from("profiles")
              .select("id,username,display_name,avatar_url")
              .eq("id", artwork.owner_id)
              .maybeSingle();
            setOwner((o as any) ?? null);
          }
        }

        // 2) listing refresh
        if (activeListing?.id) {
          const l = await fetchListingById(activeListing.id);
          if (l) {
            setActiveListing(l as any);
            if (String((l as any).type) === "auction") {
              await refreshAuctionBits(l as any);
              await finalizeAuctionOnce(l as any);
            }
          }
        } else {
          const l2 = await fetchListingForPage(artwork.id);
          setActiveListing(l2 as any);
          if (l2 && String((l2 as any).type) === "auction") {
            await refreshAuctionBits(l2 as any);
            await finalizeAuctionOnce(l2 as any);
          }
        }

        // 3) other dynamic data
        await Promise.all([
          loadOwners(artwork.id),
          loadSales(artwork.id),
          loadTopOfferSafe(artwork.id),
          loadPriceHistory(artwork.id),
        ]);
      }
    } catch {
      // swallow – refresh is best-effort
    } finally {
      refreshInFlight.current = false;
    }
  }

  useEffect(() => {
    if (!id) return;
    void refreshAll();

    const idInterval = window.setInterval(() => {
      if (document.hidden) return;
      void refreshAll();
    }, 1000);

    return () => window.clearInterval(idInterval);
    // only depend on id; internals read latest state via closures
  }, [id]);

  /* ------------------------------ Derived state ------------------------------ */

  const listingEndAt = (activeListing as any)?.end_at as string | null;
  const listingStatus = (activeListing as any)?.status ?? null;

  const isAuction = useMemo(() => isAuctionListing(activeListing), [activeListing]);
  const auctionEndedByTime = useMemo(() => {
    if (!isAuction || !listingEndAt) return false;
    return Date.now() >= new Date(listingEndAt).getTime();
  }, [isAuction, listingEndAt]);

  const auctionClosed = isAuction && (isClosedStatus(listingStatus) || auctionEndedByTime);
  const auctionPaid = isAuction && String(listingStatus ?? "").toLowerCase() === "paid";

  const reserveNow = isAuction ? ((activeListing as any)?.reserve_price ?? null) : null;
  const reserveMetNow =
    isAuction && topBid
      ? reserveNow == null
        ? true
        : topBid.amount >= Number(reserveNow)
      : false;

  const winnerIdNow = reserveMetNow && topBid?.bidder_id ? (topBid.bidder_id as string) : null;

  const isOwner = !!viewerId && !!art?.owner_id && viewerId === art.owner_id;
  const isSeller = !!activeListing && !!viewerId && viewerId === (activeListing as any).seller_id;
  const isWinner = !!viewerId && !!winnerIdNow && viewerId === winnerIdNow;

  const paymentPending = isAuction && auctionClosed && reserveMetNow && !auctionPaid;

  const canBuy = !!activeListing && !!viewerId && !isSeller && !isAuction;
  const canBid = !!viewerId && !isSeller && isAuction && !auctionClosed && String(listingStatus ?? "") === "active";

  const displayedTopOffer = useMemo(() => {
    if (isAuction && topBid) return { amount: topBid.amount, currency: activeListing?.sale_currency ?? "ETH" };
    if (topOffer) return topOffer;
    if (sales?.[0]) return { amount: sales[0].price, currency: sales[0].currency };
    return null;
  }, [isAuction, topBid, activeListing?.sale_currency, topOffer, sales]);

  const minNextBid = useMemo(() => {
    if (!isAuction) return 0;
    const reserve = Number((activeListing as any)?.reserve_price ?? 0) || 0;

    if (!topBid) return reserve > 0 ? reserve : 0;

    const base = topBid.amount * (1 + MIN_INC_BPS / 10000);
    const min = Math.max(reserve, base);

    const ccy = String(activeListing?.sale_currency ?? "USD").toUpperCase();
    const dp = ccy === "ETH" ? 8 : 2;
    const factor = Math.pow(10, dp);
    return Math.ceil(min * factor) / factor;
  }, [topBid, activeListing, isAuction]);

  const ccy = (activeListing?.sale_currency ?? "USD").toUpperCase();
  const bidStep = ccy === "ETH" ? "0.00000001" : "0.01";

  const galleryThumbs = useMemo(
    () =>
      ([{ url: art?.image_url } as any, ...(Array.isArray(files) ? files : [])] as { url?: string }[])
        .filter((f) => !!f?.url)
        .slice(0, 10),
    [art?.image_url, files]
  );

  const currentOwnerId = art?.owner_id ?? null;

  /* ------------------------------ Realtime: bids ------------------------------ */

  useEffect(() => {
    if (!activeListing || !isAuction) return;

    const off = subscribeBids(activeListing.id, async (b) => {
      setTopBid((cur) => {
        if (!cur) return b;
        const better = cmpBid(cur, b) < 0;
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

        return [row, ...cur].slice(0, 200);
      });

      if (auctionClosed) {
        try {
          await computeOutcome(activeListing as any);
        } catch {}
      }
    });

    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeListing?.id, isAuction, auctionClosed]);

  /* ------------------------------ Realtime: listing updates ------------------------------ */

  useEffect(() => {
    if (!activeListing?.id) return;

    const channel = supabase
      .channel(`listing_${activeListing.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "listings", filter: `id=eq.${activeListing.id}` },
        async (payload) => {
          const next = payload.new as any;
          setActiveListing((cur) => (cur ? ({ ...cur, ...next } as any) : (next as any)));

          const nextStatus = String(next?.status ?? "").toLowerCase();
          if (String(next?.type) === "auction" && (nextStatus === "ended" || nextStatus === "closed" || nextStatus === "paid")) {
            try {
              await computeOutcome(next);
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

  /* ------------------------------ Auto pay trigger (?pay=1...) ------------------------------ */

  useEffect(() => {
    if (!isAuction) return;
    if (!activeListing?.id) return;
    if (!auctionClosed || auctionPaid) return;
    if (!reserveMetNow || !winnerIdNow) return;
    if (!viewerId || viewerId !== winnerIdNow) return;

    const qs = new URLSearchParams(loc.search);
    if (qs.get("pay") !== "1") return;

    const method = String(qs.get("method") ?? "").toLowerCase();
    const listingId = String(qs.get("listing") ?? "");
    if (listingId && listingId !== activeListing.id) return;

    const key = `${activeListing.id}:${method}`;
    if (autoPayRef.current === key) return;
    autoPayRef.current = key;

    try {
      nav(`/art/${id}`, { replace: true });
    } catch {}

    if (method === "stripe") void payForAuctionStripe();
    else if (method === "metamask") void payForAuctionMetaMask();
    else setMsg("Unknown pay method.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.search, isAuction, activeListing?.id, auctionClosed, auctionPaid, reserveMetNow, winnerIdNow, viewerId]);

  /* ------------------------------ Actions ------------------------------ */

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
      if (minNow > 0 && amt < minNow) throw new Error(`Bid must be ≥ ${minNow}`);

      setBidInput("");

      const b = await placeBid(activeListing.id, amt);

      setTopBid((cur) => {
        if (!cur) return b;
        const better = cmpBid(cur, b) < 0;
        return better ? b : cur;
      });

      await loadBidHistory(activeListing.id);
      await loadPriceHistory(art!.id);

      setBidMsg("Bid placed ✅");
    } catch (e: any) {
      setBidMsg(e?.message || "Bid failed");
    } finally {
      setBidBusy(false);
    }
  }

  /** ✅ Payment (fixed-price) */
  async function onBuy() {
    if (!activeListing || !art) return;

    const ccy2 = (activeListing.sale_currency || "").toUpperCase();
    if (ccy2 === "ETH") {
      setMsg(null);
      setWalletOpen(true);
      return;
    }

    try {
      setMsg("Redirecting to Stripe…");
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: {
          listing_id: activeListing.id,
          quantity: 1,

          listing_type: String((activeListing as any)?.type ?? "fixed"),
          artwork_id: art.id,
          seller_id: (activeListing as any)?.seller_id ?? art.owner_id ?? null,
          buyer_id: viewerId,

          success_url: `${location.origin}/checkout/success?listing_id=${encodeURIComponent(
            activeListing.id
          )}&artwork_id=${encodeURIComponent(
            art.id
          )}&session_id={CHECKOUT_SESSION_ID}&return_to=${encodeURIComponent(`/art/${art.id}`)}`,
          cancel_url: location.href,
        },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("Stripe session URL not returned");
      window.location.href = data.url;
    } catch (e: any) {
      setMsg(parseInvokeError(e));
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

      const accounts: string[] = await ethereum.request({ method: "eth_requestAccounts" });
      const from = accounts?.[0];
      if (!from) throw new Error("No account authorized in MetaMask.");

      let chainId = await ethereum.request({ method: "eth_chainId" });
      if (chainId !== SEPOLIA_CHAIN_ID_HEX) {
        try {
          await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }] });
        } catch {
          await ethereum.request({ method: "wallet_addEthereumChain", params: [SEPOLIA_PARAMS] });
        }
        chainId = await ethereum.request({ method: "eth_chainId" });
        if (chainId !== SEPOLIA_CHAIN_ID_HEX) throw new Error("Please switch MetaMask to Sepolia.");
      }

      const priceEth = Number((activeListing as any).fixed_price || 0);
      if (!isFinite(priceEth) || priceEth <= 0) throw new Error("Invalid price for listing.");

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
    } catch (e: any) {
      setMsg(e?.message ?? "Payment failed");
    } finally {
      setPayBusy(false);
    }
  }

  /** ✅ Auction payment (Stripe) — winner only */
  async function payForAuctionStripe() {
    if (!activeListing || !isAuction || !art) return;

    const winnerId = winnerIdNow;
    if (!reserveMetNow || !winnerId) return;
    if (!viewerId || viewerId !== winnerId) {
      setMsg("Only the auction winner can pay.");
      return;
    }
    if (auctionPaid) return;

    const currency = (activeListing.sale_currency ?? "USD").toUpperCase();
    if (currency === "ETH") {
      setMsg("This auction is in ETH. Please pay with MetaMask.");
      return;
    }

    const finalAmt = Number(topBid?.amount ?? auctionOutcome?.amount ?? 0);

    setPayBusy(true);
    setMsg(null);

    try {
      const successUrl = `${location.origin}/checkout/success?listing_id=${encodeURIComponent(
        activeListing.id
      )}&artwork_id=${encodeURIComponent(
        art.id
      )}&session_id={CHECKOUT_SESSION_ID}&return_to=${encodeURIComponent(`/art/${art.id}`)}`;
      const cancelUrl = `${location.origin}/art/${art.id}?cancelled=1&listing=${encodeURIComponent(activeListing.id)}`;

      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: {
          listing_id: activeListing.id,
          quantity: 1,
          listing_type: "auction",
          artwork_id: art.id,
          seller_id: (activeListing as any)?.seller_id ?? art.owner_id ?? null,
          buyer_id: viewerId,
          currency,
          auction_amount: isFinite(finalAmt) && finalAmt > 0 ? finalAmt : null,
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
      });

      if (error) throw error;
      if (!data?.url) throw new Error("Checkout URL not returned");
      window.location.href = data.url;
    } catch (e: any) {
      setMsg(parseInvokeError(e));
    } finally {
      setPayBusy(false);
    }
  }

  /** ✅ Auction payment (MetaMask) — winner only */
  async function payForAuctionMetaMask() {
    if (!activeListing || !isAuction) return;

    const winnerId = winnerIdNow;
    if (!reserveMetNow || !winnerId) return;
    if (!viewerId || viewerId !== winnerId) {
      setMsg("Only the auction winner can pay.");
      return;
    }
    if (auctionPaid) return;

    const currency = (activeListing.sale_currency ?? "USD").toUpperCase();
    if (currency !== "ETH") {
      setMsg("This auction is not in ETH. Please pay with Stripe.");
      return;
    }

    const amount = Number(topBid?.amount ?? auctionOutcome?.amount ?? 0);
    if (!isFinite(amount) || amount <= 0) {
      setMsg("Invalid auction amount.");
      return;
    }

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
          await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }] });
        } catch {
          await ethereum.request({ method: "wallet_addEthereumChain", params: [SEPOLIA_PARAMS] });
        }
        chainId = await ethereum.request({ method: "eth_chainId" });
        if (chainId !== SEPOLIA_CHAIN_ID_HEX) throw new Error("Please switch MetaMask to Sepolia.");
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
          body: { listing_id: activeListing.id, tx_hash: txHash, buyer_wallet: from, amount_eth: amount, network: "sepolia" },
        });
      } catch (e) {
        console.warn("record-auction-eth-payment failed:", e);
      }

      setMsg("Auction payment sent ✔️");
      await refreshListingByIdSafe(activeListing.id);
      await loadPriceHistory(art!.id);
    } catch (e: any) {
      setMsg(e?.message ?? "Payment failed");
    } finally {
      setPayBusy(false);
    }
  }

  /** ✅ Contact winner (seller) */
  async function contactWinner() {
    const winId = winnerIdNow ?? auctionOutcome?.winner?.id ?? null;
    const winningBidId = topBid?.id ?? null;
    if (!winId || !activeListing || !art) return;

    try {
      const { data: sess } = await supabase.auth.getSession();
      const actorId = sess.session?.user?.id;
      if (!actorId) throw new Error("Not signed in.");

      const tid = await dmGetOrCreateThread(winId);

      const base = location.origin;
      const listingId = activeListing.id;
      const ccy2 = (activeListing.sale_currency ?? "USD").toUpperCase();

      const stripeLink =
        ccy2 === "ETH"
          ? null
          : `${base}/art/${art.id}?pay=1&method=stripe&listing=${encodeURIComponent(listingId)}`;

      const dmMsg = buildWinnerCongratsMessage({
        artworkTitle: art.title,
        artworkId: art.id,
        stripeUrl: stripeLink,
      });

      await dmSendText(tid, dmMsg);
      await dmSendArtworkShare(tid, art.id, { title: art.title ?? "Untitled", image_url: art.image_url });

      await createNotification({
        user_id: winId,
        actor_id: actorId,
        type: "auction_win",
        title: "Congratulations! You won the auction 🥳",
        body: `You won "${art.title ?? "this artwork"}". Please complete your purchase via Stripe or MetaMask on the artwork page.`,
        href: `/art/${art.id}`,
        metadata: { listing_id: listingId, artwork_id: art.id, winning_bid_id: winningBidId },
      });

      nav(`/messages?t=${encodeURIComponent(tid)}`);
    } catch (e: any) {
      setMsg(e?.message ?? "Failed to open chat or notify winner");
    }
  }

  /* ------------------------------ Render ------------------------------ */

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

  const canRequestLicense = !!viewerId && viewerId !== art.author_id && viewerId !== art.owner_id;

  return (
    <>
      <div className="max-w-7xl mx-auto p-6 space-y-8">
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
                    <img src={f.url} className="h-full w-full object-cover" alt="gallery item" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right */}
          <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-6 self-start">
            {msg && <p className="text-xs text-amber-300">{msg}</p>}

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-3xl font-semibold leading-tight truncate">{art.title || "Untitled"}</h1>

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
                      ? fmtCurrency(sales[sales.length - 1].price, sales[sales.length - 1].currency)
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
                          {fmtCurrency(
                            (activeListing as any).fixed_price ?? null,
                            activeListing.sale_currency
                          )}
                        </div>
                      </div>
                    )}

                    {isAuction && listingEndAt && !auctionClosed ? (
                      <Countdown
                        endAt={listingEndAt}
                        onElapsed={async () => {
                          try {
                            await finalizeAuctionOnce(activeListing as any);
                          } catch {}
                        }}
                      />
                    ) : null}
                  </div>

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
                                You won the auction. Choose a payment method to secure the artwork.
                              </span>
                            ) : isSeller ? (
                              <span>
                                Awaiting winner payment. You can contact the winner if needed.
                              </span>
                            ) : (
                              <span>Auction ended. Winner is completing payment.</span>
                            )}
                          </div>

                          <div className="flex gap-2 flex-wrap">
                            {isWinner ? (
                              <>
                                <button
                                  className="btn"
                                  onClick={payForAuctionStripe}
                                  disabled={payBusy || ccy === "ETH"}
                                >
                                  {payBusy ? "Preparing…" : "Stripe"}
                                </button>
                                <button
                                  className="btn bg-white/0 border border-white/20 hover:bg-white/10"
                                  onClick={payForAuctionMetaMask}
                                  disabled={payBusy || ccy !== "ETH"}
                                >
                                  {payBusy ? "Preparing…" : "MetaMask"}
                                </button>
                              </>
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

                  {canRequestLicense ? (
                    <div className="mt-3">
                      <button className="btn w-full" onClick={() => setShowLicense(true)}>
                        Request license
                      </button>
                    </div>
                  ) : isOwner && isClosedStatus(listingStatus) ? (
                    <div className="mt-3">
                      <button className="btn w-full" onClick={() => setSellerOpen(true)}>
                        List this artwork
                      </button>
                    </div>
                  ) : null}

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

            {/* Tabs */}
            <div className="flex gap-2">
              {(["details", "orders", "activity"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition ${
                    tab === t
                      ? "bg-white text-black font-medium"
                      : "bg-white/0 text-white/80 hover:bg-white/10 border border-white/10"
                  }`}
                >
                  {t === "details" ? "Details" : t === "orders" ? "Orders" : "Activity"}
                </button>
              ))}
            </div>

            {tab === "details" ? (
              <div className="space-y-4">
                <Card title="About">
                  <div className="text-sm text-white/80 whitespace-pre-wrap">
                    {art.description || "—"}
                  </div>
                  <div className="mt-3 text-xs text-white/60">
                    Minted: {new Date(art.created_at).toLocaleString()} • Token URI:{" "}
                    <span className="text-white/70">{art.token_uri ? "set" : "—"}</span>
                  </div>
                </Card>

                <CommentsThread artworkId={art.id} viewerId={viewerId} />
              </div>
            ) : null}

            {tab === "orders" ? (
              <div className="space-y-4">
                <Card
                  title="Owners"
                  right={
                    <span className="text-[11px] text-white/50">
                      {owners.length
                        ? `${owners.length} holder${owners.length > 1 ? "s" : ""}`
                        : "—"}
                    </span>
                  }
                >
                  <div className="rounded-xl border border-white/10 divide-y divide-white/10 overflow-hidden">
                    {owners.length === 0 ? (
                      <div className="p-3 text-sm text-white/60">No ownership records.</div>
                    ) : (
                      owners.map((o) => {
                        const nm =
                          o.profile.display_name ||
                          o.profile.username ||
                          o.profile.id.slice(0, 6);
                        const isCurrent =
                          !!currentOwnerId && o.profile.id === currentOwnerId;

                        return (
                          <div
                            key={o.profile.id}
                            className="p-3 flex items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <Avatar url={o.profile.avatar_url} name={nm} size={34} />
                              <div className="min-w-0">
                                <div className="text-sm text-white/90 truncate">{nm}</div>
                                <div className="text-[11px] text-white/50">
                                  Updated: {new Date(o.updated_at).toLocaleString()}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isCurrent && (
                                <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                                  CURRENT
                                </span>
                              )}
                              <div className="text-sm font-semibold">x{o.quantity}</div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </Card>

                <Card
                  title="Sales"
                  right={
                    <button
                      className="text-xs underline text-white/70 hover:text-white"
                      onClick={() => loadSales(art.id)}
                    >
                      Refresh
                    </button>
                  }
                >
                  <div className="rounded-xl border border-white/10 divide-y divide-white/10 overflow-hidden">
                    {sales.length === 0 ? (
                      <div className="p-3 text-sm text-white/60">No sales yet.</div>
                    ) : (
                      sales.map((s) => (
                        <div
                          key={s.id}
                          className="p-3 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="text-sm text-white/90">
                              {fmtCurrency(s.price, s.currency)} •{" "}
                              <span className="text-white/60">
                                {new Date(s.sold_at).toLocaleString()}
                              </span>
                            </div>
                            <div className="text-[11px] text-white/55 truncate">
                              Buyer:{" "}
                              {s.buyer?.display_name ||
                                s.buyer?.username ||
                                s.buyer_id?.slice(0, 6) ||
                                "—"}{" "}
                              • Seller:{" "}
                              {s.seller?.display_name ||
                                s.seller?.username ||
                                s.seller_id?.slice(0, 6) ||
                                "—"}
                            </div>
                          </div>
                          <div className="text-[11px] text-white/60">
                            {s.tx_hash ? "On-chain" : "Stripe"}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>

                <Card
                  title="Price history"
                  right={
                    <button
                      className="text-xs underline text-white/70 hover:text-white"
                      onClick={() => loadPriceHistory(art.id)}
                      disabled={priceHistoryBusy}
                    >
                      {priceHistoryBusy ? "Loading…" : "Refresh"}
                    </button>
                  }
                >
                  <div className="rounded-xl border border-white/10 divide-y divide-white/10 overflow-hidden">
                    {priceHistory.length === 0 ? (
                      <div className="p-3 text-sm text-white/60">No price history yet.</div>
                    ) : (
                      priceHistory.slice(0, 30).map((r, idx) => (
                        <div
                          key={`${r.ts}-${idx}`}
                          className="p-3 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="text-sm text-white/90">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[11px] ${
                                  r.kind === "sale"
                                    ? "bg-emerald-400 text-black"
                                    : "bg-white/10 text-white"
                                }`}
                              >
                                {r.kind.toUpperCase()}
                              </span>{" "}
                              <span className="ml-2 font-semibold">
                                {fmtCurrency(r.amount, r.currency)}
                              </span>
                            </div>
                            <div className="text-[11px] text-white/55">
                              {new Date(r.ts).toLocaleString()}
                            </div>
                          </div>
                          <div className="text-[11px] text-white/50 truncate">
                            {r.actor_id ? r.actor_id.slice(0, 6) : "—"}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              </div>
            ) : null}

            {tab === "activity" ? (
              <div className="space-y-4">
                <Card
                  title={
                    <div className="flex items-center gap-2">
                      <span>Activity</span>
                      <span className="text-[11px] text-white/50">
                        {activityView === "bids" ? "Bid history" : "Price market"}
                      </span>
                    </div>
                  }
                  right={
                    <div className="flex items-center gap-2">
                      <button
                        className={`px-3 py-1.5 rounded-lg text-xs ${
                          activityView === "bids"
                            ? "bg-white text-black"
                            : "bg-white/5 text-white/80"
                        }`}
                        onClick={() => setActivityView("bids")}
                      >
                        Bids
                      </button>
                      <button
                        className={`px-3 py-1.5 rounded-lg text-xs ${
                          activityView === "price"
                            ? "bg-white text-black"
                            : "bg-white/5 text-white/80"
                        }`}
                        onClick={() => setActivityView("price")}
                      >
                        Price market
                      </button>
                    </div>
                  }
                >
                  {activityView === "bids" ? (
                    <>
                      <div className="rounded-xl border border-white/10 divide-y divide-white/10 overflow-hidden">
                        {!isAuction ? (
                          <div className="p-3 text-sm text-white/60">
                            Not an auction listing.
                          </div>
                        ) : bidHistory.length === 0 ? (
                          <div className="p-3 text-sm text-white/60">No bids yet.</div>
                        ) : (
                          bidHistory.map((b) => {
                            const nm =
                              b.bidder?.display_name ||
                              b.bidder?.username ||
                              b.bidder_id.slice(0, 6);
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
                                  {fmtCurrency(b.amount, activeListing?.sale_currency)}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      {isAuction ? (
                        <div className="mt-2 text-[11px] text-white/55">
                          Min next bid: {minNextBid || "—"} {activeListing?.sale_currency}{" "}
                          {viewerId && topBid?.bidder_id === viewerId
                            ? " • You’re winning"
                            : ""}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="space-y-4">
                      <PriceHistoryChart rows={priceHistory} />
                      <div className="rounded-xl border border-white/10 divide-y divide-white/10 overflow-hidden">
                        {priceHistory.length === 0 ? (
                          <div className="p-3 text-sm text-white/60">
                            No price history yet.
                          </div>
                        ) : (
                          priceHistory
                            .slice()
                            .reverse()
                            .slice(0, 30)
                            .map((r, idx) => (
                              <div
                                key={`${r.ts}-pm-${idx}`}
                                className="p-3 flex items-center justify-between gap-3"
                              >
                                <div className="min-w-0">
                                  <div className="text-sm text-white/90">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[11px] ${
                                        r.kind === "sale"
                                          ? "bg-emerald-400 text-black"
                                          : "bg-white/10 text-white"
                                      }`}
                                    >
                                      {r.kind.toUpperCase()}
                                    </span>{" "}
                                    <span className="ml-2 font-semibold">
                                      {fmtCurrency(r.amount, r.currency)}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-white/55">
                                    {new Date(r.ts).toLocaleString()}
                                  </div>
                                </div>
                                <div className="text-[11px] text-white/50 truncate">
                                  {r.actor_id ? r.actor_id.slice(0, 6) : "—"}
                                </div>
                              </div>
                            ))
                        )}
                      </div>
                    </div>
                  )}
                </Card>

                <CommentsThread artworkId={art.id} viewerId={viewerId} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <Link to="/" className="btn">
            Back
          </Link>
        </div>
      </div>

      {/* Modals */}
      <WalletModal
        open={walletOpen}
        onClose={() => (payBusy ? null : setWalletOpen(false))}
        onMetaMask={onBuyWithMetaMask}
      />

      <ShareQRModal
        open={showShareQR}
        onClose={() => setShowShareQR(false)}
        url={`${location.origin}/art/${id}`}
      />

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
          ownerId={art.author_id}
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
            await Promise.all([
              loadOwners(art.id),
              loadSales(art.id),
              loadPriceHistory(art.id),
            ]);
            if (l && String((l as any).type) === "auction") await refreshAuctionBits(l as any);
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
        onPayStripe={payForAuctionStripe}
        onPayMetaMask={payForAuctionMetaMask}
        payBusy={payBusy}
        paid={auctionPaid}
      />
    </>
  );
}

/* ------------------------------ Seller Console ------------------------------ */

function OwnerListPanel({ artworkId, onUpdated }: { artworkId: string; onUpdated: () => Promise<void> | void }) {
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
        <select
          className="input w-28"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
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
          <h3 className="text-lg font-semibold">
            {postAuctionMode ? "Auction tools" : "Seller tools"}
          </h3>
          <button className="text-sm text-white/70 hover:text-white" onClick={onClose}>
            Close
          </button>
        </div>

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
            <div className="text-sm text-white/70">
              Create or update a fixed-price listing.
            </div>
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
