// app/src/lib/mint.ts
import { ethers } from "ethers";
import { ensureSepolia, requestAccounts, getSignerAsync } from "./wallet";
import ABI from "./abi/NFT.json";

const CONTRACT_ADDR = import.meta.env.VITE_NFT_CONTRACT as string; // 0x3722...b179

type MintResult = { txHash: string };

export async function mintNft(tokenURI: string): Promise<MintResult> {
  if (!CONTRACT_ADDR) throw new Error("VITE_NFT_CONTRACT missing");

  await requestAccounts();
  await ensureSepolia();
  const signer = await getSignerAsync();
  const caller = await signer.getAddress();

  const contract = new ethers.Contract(CONTRACT_ADDR, ABI as any, signer);

  // detect functions
  const hasPublicMint = typeof (contract as any).publicMint === "function";
  const hasSafeMint   = typeof (contract as any).safeMint   === "function";

  // If contract supports publicMint, use it (user mints to self)
  if (hasPublicMint) {
    const tx = await (contract as any).publicMint(tokenURI);
    const rc = await tx.wait();
    return { txHash: rc?.hash ?? tx.hash };
  }

  // Otherwise only owner can mint via safeMint
  if (!hasSafeMint) {
    throw new Error("Contract has neither publicMint nor safeMint");
  }
  const owner: string = await (contract as any).owner?.().catch(() => ethers.ZeroAddress);
  if (!owner || owner.toLowerCase() !== caller.toLowerCase()) {
    throw new Error("This contract allows only the owner to mint (safeMint).");
  }

  const tx = await (contract as any).safeMint(caller, tokenURI);
  const rc = await tx.wait();
  return { txHash: rc?.hash ?? tx.hash };
}
