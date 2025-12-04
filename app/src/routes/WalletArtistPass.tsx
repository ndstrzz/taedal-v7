// C:\Users\User\Downloads\taedal-v7\app\src\routes\WalletArtistPass.tsx

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";

/**
 * Simple dev preview page for the "artist pass" / wallet card.
 * Later we can replace this with a real Apple / Google Wallet flow.
 */
export default function WalletArtistPass() {
  const [sp] = useSearchParams();
  const profile = sp.get("profile") || "";
  const nav = useNavigate();

  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const title = useMemo(
    () => (profile ? `Artist pass — ${profile}` : "Artist pass — taedal"),
    [profile]
  );

  useEffect(() => {
    document.title = title;
  }, [title]);

  // Read any wallet address that was created via /wallet/create
  useEffect(() => {
    const stored = localStorage.getItem("taedal_wallet_address");
    if (stored) {
      setWalletAddress(stored);
    }
  }, []);

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-black text-white px-4">
      <div className="max-w-md w-full rounded-2xl border border-neutral-800 bg-neutral-950/80 p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <img
              src="/images/taedal-logo.svg"
              alt="taedal"
              className="h-8 w-8 rounded-full bg-neutral-900"
            />
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-neutral-400">
                taedal artist pass
              </div>
              <div className="text-sm text-neutral-300">
                {profile ? `@${profile}` : "Unknown profile"}
              </div>
            </div>
          </div>

          <div className="text-right text-xs text-neutral-400">
            <div>beta</div>
            <div className="text-[10px]">dev preview</div>
          </div>
        </div>

        <div className="rounded-xl bg-gradient-to-br from-indigo-500/40 via-purple-500/30 to-sky-500/40 p-[1px] mb-4">
          <div className="rounded-[0.9rem] bg-neutral-950 px-4 py-5 flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">
                artist
              </div>
              <div className="mt-1 text-lg font-semibold">
                {profile || "Unknown"}
              </div>
              <div className="mt-1 text-[11px] text-neutral-400">
                Verified on taedal
              </div>
            </div>

            <div className="flex flex-col items-end gap-1 text-[10px] text-neutral-400">
              <span>Member since —</span>
              <span className="font-mono opacity-80">
                {new Date().getFullYear()}
              </span>
            </div>
          </div>
        </div>

        {/* Wallet status */}
        <div className="mb-4 rounded-lg border border-neutral-800 bg-neutral-900/70 px-3 py-2 flex items-center justify-between gap-3">
          <div className="text-xs text-neutral-300">
            <div className="font-medium">Wallet status</div>
            {walletAddress ? (
              <div className="mt-0.5 text-[11px] text-neutral-400 break-all font-mono">
                Linked: {walletAddress}
              </div>
            ) : (
              <div className="mt-0.5 text-[11px] text-neutral-400">
                No wallet linked yet.
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn whitespace-nowrap text-xs"
            onClick={() => nav("/wallet/create")}
          >
            {walletAddress ? "Replace wallet" : "Create wallet"}
          </button>
        </div>

        <p className="text-sm text-neutral-300 mb-4">
          This is a <span className="font-semibold">dev preview</span> of your
          Taedal artist pass. In the future this page will guide you to add a
          digital card to Apple&nbsp;Wallet / Google&nbsp;Wallet, and connect it
          to your on-chain wallet for mints &amp; payouts.
        </p>

        <div className="flex justify-between items-center gap-3">
          <Link
            to={profile ? `/u/${profile}` : "/"}
            className="text-xs text-neutral-400 hover:text-white underline"
          >
            Back to profile
          </Link>

          <button
            type="button"
            className="btn text-sm"
            onClick={() => {
              alert(
                "In the real version this would open your wallet app. For now this is just a preview card."
              );
            }}
          >
            Simulate “open in Wallet”
          </button>
        </div>
      </div>
    </div>
  );
}
