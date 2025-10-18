//C:\Users\User\Downloads\taedal-v7\app\src\components\PayModal.tsx

import { useEffect, useState } from "react";

const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111
const SEPOLIA_PARAMS = {
  chainId: SEPOLIA_CHAIN_ID_HEX,
  chainName: "Sepolia",
  nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia.infura.io/v3/"],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

// parse ether -> bigint (no ethers.js)
function parseEther(amount: string | number): bigint {
  const s = String(amount);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Invalid ETH amount");
  const [ints, decs = ""] = s.split(".");
  const d = (decs + "000000000000000000").slice(0, 18);
  return BigInt(ints) * 10n ** 18n + BigInt(d);
}
const toHex = (v: bigint) => "0x" + v.toString(16);

export default function PayModal({
  open,
  priceEth,
  toWallet,
  listingId,
  onClose,
  onDone,
}: {
  open: boolean;
  priceEth: number;
  toWallet: string;
  listingId: string;
  onClose: () => void;
  onDone: (ok: boolean, txHash?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setBusy(false);
      setMsg(null);
    }
  }, [open]);

  async function payWithMetaMask() {
    setBusy(true);
    setMsg("Connecting wallet…");

    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) throw new Error("MetaMask not found. Please install it.");

      const accounts: string[] = await ethereum.request({
        method: "eth_requestAccounts",
      });
      const from = accounts?.[0];
      if (!from) throw new Error("No account authorized in MetaMask.");

      setMsg("Checking network…");
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

      setMsg("Waiting for approval…");

      const value = toHex(parseEther(priceEth));
      const txHash: string = await ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from, to: toWallet, value }],
      });

      setMsg("Recording purchase…");

      // Optional: call your function to record the sale (best-effort)
      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/record-eth-purchase`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
              listing_id: listingId,
              tx_hash: txHash,
              buyer_wallet: from,
              amount_eth: priceEth,
              network: "sepolia",
            }),
          }
        );
        // ignore non-2xx for now
        await res.text().catch(() => {});
      } catch (e) {
        console.warn("record-eth-purchase failed:", e);
      }

      onDone(true, txHash);
    } catch (e: any) {
      setMsg(e?.message ?? "Payment failed");
      onDone(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm grid place-items-center">
      <div className="w-[460px] max-w-[94vw] rounded-2xl bg-neutral-900 border border-white/10 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold">Pay with MetaMask</h3>
          <button
            className="text-sm text-white/70 hover:text-white"
            onClick={() => (busy ? null : onClose())}
          >
            Close
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <div>
            You’re paying <b>{priceEth} ETH</b> on <b>Sepolia</b>.
          </div>
          <div className="text-white/70 break-all">
            Receiver: <code>{toWallet}</code>
          </div>

          {msg && <div className="text-amber-300">{msg}</div>}

          <button
            className="btn w-full disabled:opacity-60"
            onClick={payWithMetaMask}
            disabled={busy}
          >
            {busy ? "Processing…" : "Confirm in MetaMask"}
          </button>
        </div>
      </div>
    </div>
  );
}
