// Minimal MetaMask helpers for Sepolia (chainId 11155111)
import { ethers } from "ethers";

export const SEPOLIA = {
  chainIdHex: "0xaa36a7", // 11155111
  chainIdDec: 11155111,
  rpcUrls: ["https://sepolia.infura.io/v3/"], // optional; MetaMask knows Sepolia, so "add" often not needed
  chainName: "Sepolia",
  nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

export function getEthereum(): any | null {
  return typeof window !== "undefined" ? (window as any).ethereum ?? null : null;
}

export async function requestAccounts(): Promise<string[]> {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not detected. Please install MetaMask.");
  return await eth.request({ method: "eth_requestAccounts" });
}

export async function ensureSepolia(): Promise<void> {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not detected.");

  const current = await eth.request({ method: "eth_chainId" });
  if (current?.toLowerCase() === SEPOLIA.chainIdHex) return;

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA.chainIdHex }],
    });
  } catch (err: any) {
    // If the chain isn’t added, add it.
    if (err?.code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: SEPOLIA.chainIdHex,
            chainName: SEPOLIA.chainName,
            rpcUrls: SEPOLIA.rpcUrls,
            nativeCurrency: SEPOLIA.nativeCurrency,
            blockExplorerUrls: SEPOLIA.blockExplorerUrls,
          },
        ],
      });
      // then switch
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA.chainIdHex }],
      });
    } else {
      throw err;
    }
  }
}

export function getEthersSigner(): ethers.Signer {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not detected.");
  const provider = new ethers.BrowserProvider(eth, "any"); // "any" = follow chain changes
  return new ethers.VoidSigner("0x0"); // placeholder, we return async below (see getSignerAsync)
}

export async function getSignerAsync(): Promise<ethers.Signer> {
  const eth = getEthereum();
  if (!eth) throw new Error("MetaMask not detected.");
  const provider = new ethers.BrowserProvider(eth, "any");
  return await provider.getSigner();
}
