// app/src/lib/mint.ts
import { ethers } from "ethers";
import { ensureSepolia, requestAccounts, getSignerAsync } from "./wallet";
import { supabase } from "./supabase";
import ABI from "./abi/NFT.json";

const CONTRACT_ADDR = import.meta.env.VITE_NFT_CONTRACT as string; // e.g. 0x...

// ERC-721 Transfer(address,address,uint256)
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type MintResult = { txHash: string; tokenId?: string };

/**
 * Mint an NFT by calling the contract. Optionally persist the on-chain
 * info (contract address, token id, tx hash) back to the artworks row.
 *
 * Backwards compatible: existing callers can keep using (tokenURI) only.
 * If you pass opts.artworkId, we'll also record the mint to Supabase.
 */
export async function mintNft(
  tokenURI: string,
  opts?: { artworkId?: string }
): Promise<MintResult> {
  if (!CONTRACT_ADDR) throw new Error("VITE_NFT_CONTRACT missing");

  // 1) Wallet & network
  await requestAccounts();
  await ensureSepolia();
  const signer = await getSignerAsync();
  const caller = await signer.getAddress();

  // 2) Contract instance
  // ethers v5/v6 compatible enough for this usage
  const contract = new (ethers as any).Contract(CONTRACT_ADDR, ABI as any, signer);

  // 3) Detect functions
  const hasPublicMint = typeof (contract as any).publicMint === "function";
  const hasSafeMint   = typeof (contract as any).safeMint   === "function";

  let tx: any;

  // 4) Send tx
  if (hasPublicMint) {
    tx = await (contract as any).publicMint(tokenURI);
  } else {
    if (!hasSafeMint) throw new Error("Contract has neither publicMint nor safeMint");
    const owner: string =
      (await (contract as any).owner?.().catch(() => ethers.ZeroAddress)) || ethers.ZeroAddress;
    if (!owner || owner.toLowerCase() !== caller.toLowerCase()) {
      throw new Error("This contract allows only the owner to mint (safeMint).");
    }
    tx = await (contract as any).safeMint(caller, tokenURI);
  }

  // 5) Wait for receipt (works with our signer shim)
  const rc = await tx.wait();
  const txHash: string = rc?.transactionHash ?? rc?.hash ?? tx.hash;

  // 6) Parse tokenId from Transfer event (topic[3])
  let tokenId: string | undefined;
  try {
    const logs = (rc?.logs ?? []) as Array<any>;
    for (const log of logs) {
      if (!log?.topics || log.topics.length < 4) continue;
      if (String(log.topics[0]).toLowerCase() !== TRANSFER_TOPIC) continue;
      const hex = String(log.topics[3]);
      try {
        tokenId = BigInt(hex).toString();
      } catch {
        tokenId = undefined;
      }
      if (tokenId) break;
    }
  } catch {
    // non-fatal
  }

  // 7) Best-effort: persist to Supabase if we know which artwork this is
  if (opts?.artworkId) {
    try {
      // Prefer edge function if present
      const { error } = await supabase.functions.invoke("record-mint", {
        body: {
          artwork_id: opts.artworkId,
          contract_address: CONTRACT_ADDR,
          token_id: tokenId ?? null,
          tx_hash: txHash,
        },
      });
      if (error) throw error;
    } catch {
      // Fallback direct update (keeps existing functionality intact)
      await supabase
        .from("artworks")
        .update({
          contract_address: CONTRACT_ADDR,
          token_id: tokenId ?? null,
          tx_hash: txHash,
        })
        .eq("id", opts.artworkId);
    }
  }

  return { txHash, tokenId };
}
