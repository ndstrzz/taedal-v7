// C:\Users\User\Downloads\taedal-v7\app\src\routes\wallet\WalletSuccess.tsx
import { useEffect, useState } from "react";
import { useLocation, Link } from "react-router-dom";

type LocationState = {
  walletAddress?: string;
};

const WalletSuccess = () => {
  const location = useLocation();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  useEffect(() => {
    const state = (location.state || {}) as LocationState;
    if (state.walletAddress) {
      setWalletAddress(state.walletAddress);
      return;
    }

    // Fallback if user refreshes the page
    const stored = localStorage.getItem("taedal_wallet_address");
    if (stored) setWalletAddress(stored);
  }, [location.state]);

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Wallet created 🎉</h1>
        <p className="text-sm text-white/70">
          Your Taedal wallet is ready. You can now mint artworks, deploy
          collections, and receive sales into this address.
        </p>
      </header>

      <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-3">
        <p className="text-sm text-emerald-100 font-medium">
          Wallet successfully created.
        </p>
        {walletAddress && (
          <p className="text-xs text-emerald-50 break-all font-mono">
            {walletAddress}
          </p>
        )}
        {!walletAddress && (
          <p className="text-xs text-emerald-50">
            (Couldn&apos;t resolve address from state/localStorage, but the
            wallet was created on the previous step.)
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          to="/create"
          className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-white text-black text-sm font-medium"
        >
          Start minting an artwork
        </Link>
        <Link
          to="/studio"
          className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-white/20 text-sm font-medium"
        >
          Go to Studio
        </Link>
      </div>
    </div>
  );
};

export default WalletSuccess;
