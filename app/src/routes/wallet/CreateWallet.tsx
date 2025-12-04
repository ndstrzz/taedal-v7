// C:\Users\User\Downloads\taedal-v7\app\src\routes\wallet\CreateWallet.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createWallet } from "../../lib/walletClient";

const CreateWallet = () => {
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setError(null);
    setIsCreating(true);
    try {
      const wallet = await createWallet();

      // Persist locally so refresh on /wallet/success still shows address
      if (wallet.address) {
        localStorage.setItem("taedal_wallet_address", wallet.address);
      }

      navigate("/wallet/success", {
        state: { walletAddress: wallet.address },
      });
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Something went wrong while creating wallet.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Create your Taedal wallet</h1>
        <p className="text-sm text-white/70 max-w-2xl">
          This non-custodial wallet will be linked to your Taedal account and
          used to sign mints, manage collections, and receive primary &amp;
          secondary sale proceeds.
        </p>
      </header>

      {error && (
        <div className="text-sm text-red-300 border border-red-500/40 bg-red-500/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">Wallet provider</h2>
          <p className="text-xs text-white/60">
            In this dev build we&apos;re calling <code>/api/wallets</code> on
            the server, which will talk to your chosen wallet provider (Privy,
            Thirdweb, custom signer, etc.) using server-side keys.
          </p>
        </div>

        <button
          onClick={handleCreate}
          disabled={isCreating}
          className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-white text-black text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isCreating ? "Creating wallet…" : "Create wallet"}
        </button>

        <p className="text-[11px] text-white/50">
          By continuing, you agree to Taedal&apos;s terms for digital ownership,
          royalties, and licensing. In production, this flow can show a
          provider-branded modal (e.g. Privy / Thirdweb).
        </p>
      </div>
    </div>
  );
};

export default CreateWallet;
