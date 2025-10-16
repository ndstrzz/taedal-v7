// app/src/components/MintModal.tsx
import { useEffect, useState } from "react";
import { BrowserProvider, Contract, ethers, Interface } from "ethers";
import { supabase } from "../lib/supabase";
import { ensureSepolia, requestAccounts } from "../lib/wallet";
import ABI from "../lib/abi/NFT.json";
import MintingOverlay from "./MintingOverlay";

type Props = {
  artworkId: string;
  tokenURI: string; // ipfs://...
  onDone: (ok: boolean) => void;
};

// Contract address comes from Vite env
const CONTRACT_ADDR = import.meta.env.VITE_NFT_CONTRACT as string;

// ERC-721 Transfer event (topic0)
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export default function MintModal({ artworkId, tokenURI, onDone }: Props) {
  const [account, setAccount] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>("Connecting wallet…");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [minting, setMinting] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      try {
        if (!CONTRACT_ADDR) {
          throw new Error("VITE_NFT_CONTRACT is not configured.");
        }

        const eth = (window as any).ethereum;
        if (!eth) throw new Error("MetaMask not found");

        // 1) User gesture: connect
        const [acc] = await requestAccounts();
        setAccount(acc);

        // 2) Chain guard
        await ensureSepolia();

        // 3) Signer + contract
        const provider = new BrowserProvider(eth);
        const signer = await provider.getSigner();
        const me = await signer.getAddress();

        const contract = new Contract(CONTRACT_ADDR, ABI as any, signer);
        const iface = contract.interface as Interface;

        // 4) Choose mint fn
        let hasPublicMint = false;
        let hasSafeMint = false;
        try {
          iface.getFunction("publicMint(string)");
          hasPublicMint = true;
        } catch {}
        try {
          iface.getFunction("safeMint(address,string)");
          hasSafeMint = true;
        } catch {}

        let tx: ethers.TransactionResponse;

        if (hasPublicMint) {
          setMsg("Sending publicMint…");
          setMinting(true);
          tx = await (contract as any).publicMint(tokenURI);
        } else if (hasSafeMint) {
          setMsg("Checking ownership for safeMint…");
          const owner =
            typeof (contract as any).owner === "function"
              ? await (contract as any).owner()
              : ethers.ZeroAddress;

          if (!owner || owner.toLowerCase() !== me.toLowerCase()) {
            throw new Error(
              "This contract only allows the owner to mint (safeMint). Use the owner wallet or deploy a build with publicMint."
            );
          }

          setMsg("Sending safeMint (owner)…");
          setMinting(true);
          tx = await (contract as any).safeMint(me, tokenURI);
        } else {
          throw new Error(
            "Contract must have publicMint(string) or safeMint(address,string)."
          );
        }

        setTxHash(tx.hash);
        setMsg("Waiting for confirmations…");

        const receipt = await tx.wait();

        // Parse tokenId from Transfer logs (topic[3])
        let tokenId: bigint | null = null;
        for (const log of receipt?.logs ?? []) {
          if (
            log.address?.toLowerCase() === CONTRACT_ADDR.toLowerCase() &&
            Array.isArray(log.topics) &&
            log.topics[0] === TRANSFER_TOPIC
          ) {
            const t = log.topics[3];
            if (t) {
              try {
                tokenId = BigInt(t);
              } catch {}
            }
            break;
          }
        }

        // 5) Record mint in DB — prefer Edge Function, fallback to direct table write
        try {
          await supabase.functions.invoke("record-mint", {
            body: {
              artwork_id: artworkId,
              tx_hash: receipt?.hash ?? tx.hash,
              token_id: tokenId ? tokenId.toString() : null,
              contract_address: CONTRACT_ADDR,
            },
          });
        } catch {
          // Fallback (if function not deployed)
          await supabase
            .from("artworks")
            .update({
              contract_address: CONTRACT_ADDR,
              tx_hash: receipt?.hash ?? tx.hash,
              token_id: tokenId ? Number(tokenId) : null,
              status: "active",
            })
            .eq("id", artworkId);
        }

        setMsg("Minted successfully ✅");
        setMinting(false);
        onDone(true);
      } catch (e: any) {
        const pretty =
          e?.info?.error?.message ||
          e?.shortMessage ||
          e?.message ||
          "Mint failed";
        setMsg(pretty);
        setMinting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* Full-screen 3D coin overlay */}
      <MintingOverlay
        open={minting}
        message={msg}
        backdropAlpha={0.92}
        spinSpeed={1.8}
      />

      {/* Modal shell (kept so user can see account + link) */}
      <div className="fixed inset-0 bg-black/60 grid place-items-center z-50">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 w-[420px] space-y-3">
          <h3 className="text-lg font-semibold">Minting on Sepolia</h3>
          {account && (
            <div className="text-xs text-neutral-400">Account: {account}</div>
          )}
          <div className="text-xs break-words whitespace-pre-wrap">{msg}</div>
          {txHash && (
            <a
              className="text-xs underline"
              href={`https://sepolia.etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction
            </a>
          )}
          <div className="flex justify-end">
            <button className="btn" onClick={() => onDone(false)}>
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
