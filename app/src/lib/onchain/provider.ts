// app/src/lib/onchain/provider.ts
// Browser/provider helpers (no ethers dependency required)

import { defaultChain } from "./chains";

/** Narrow "get the provider" and cast, so we don't fight other libs' typings */
export function getEip1193Provider() {
  const eth = (window as any)?.ethereum;
  if (!eth) throw new Error("No wallet found. Please install MetaMask.");
  return eth as any; // keep it permissive to avoid global Window augmentation clashes
}

export async function requestAccounts(): Promise<string[]> {
  const eth = getEip1193Provider();
  return (await eth.request({ method: "eth_requestAccounts" })) as string[];
}

export async function getChainIdHex(): Promise<string> {
  const eth = getEip1193Provider();
  return (await eth.request({ method: "eth_chainId" })) as string;
}

export async function ensureChain(target = defaultChain) {
  const eth = getEip1193Provider();

  let cid = (await eth.request({ method: "eth_chainId" })) as string;
  if (cid === target.idHex) return;

  try {
    // Try switching first
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target.idHex }],
    });
  } catch {
    // If it’s unknown to the wallet, add it
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: target.idHex,
          chainName: target.name,
          nativeCurrency: target.currency,
          rpcUrls: [target.rpcUrl],
          blockExplorerUrls: target.explorer ? [target.explorer] : [],
        },
      ],
    });
    // and try switching again (some wallets need this)
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target.idHex }],
    });
  }

  cid = (await eth.request({ method: "eth_chainId" })) as string;
  if (cid !== target.idHex) throw new Error(`Please switch wallet to ${target.name}.`);
}

export async function sendEthTx(params: {
  from: string;
  to: string;
  valueHex: `0x${string}`;
}) {
  const eth = getEip1193Provider();
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from: params.from, to: params.to, value: params.valueHex }],
  })) as string; // returns tx hash
}
