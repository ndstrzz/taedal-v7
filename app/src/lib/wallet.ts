// app/src/lib/wallet.ts
import { createAppKit } from "@reown/appkit";
import { sepolia } from "@reown/appkit/networks";

/** ---------- WalletConnect / Reown (modal) ---------- */

let appkit: ReturnType<typeof createAppKit> | null = null;

/** Lazily create the Reown / WalletConnect modal */
export function getWalletKit() {
  if (appkit) return appkit;

  const projectId = import.meta.env.VITE_WC_PROJECT_ID as string | undefined;
  if (!projectId) {
    console.warn("VITE_WC_PROJECT_ID missing — WalletConnect modal disabled.");
    return null;
  }

  appkit = createAppKit({
    projectId,
    metadata: {
      name: "taedal",
      description: "Collect and sell digital artworks",
      url: window.location.origin, // must be allow-listed in Reown Dashboard → Domain
      icons: [`${window.location.origin}/images/taedal-logo.svg`],
    },
    // ✅ current AppKit requires `networks` (not `chains`)
    networks: [sepolia],

    enableInjected: true,      // MetaMask / injected wallets
    enableWalletConnect: true, // WalletConnect QR / mobile wallets
    enableEIP6963: true,       // wallet discovery
    themeMode: "dark",
  });

  return appkit;
}

/** ---------- EIP-1193 helpers (MetaMask etc.) ---------- */

// Sepolia constants for chain switching
export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111
export const SEPOLIA_PARAMS = {
  chainId: SEPOLIA_CHAIN_ID_HEX,
  chainName: "Sepolia",
  nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia.infura.io/v3/"],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

/** Get the injected provider (MetaMask). Throws if not present. */
function getEthereum() {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No injected wallet found. Please install MetaMask.");
  return eth;
}

/** Ask user to connect and return accounts (first account is the active one). */
export async function requestAccounts(): Promise<string[]> {
  const ethereum = getEthereum();
  const accounts: string[] = await ethereum.request({ method: "eth_requestAccounts" });
  return accounts;
}

/** Ensure we are on Sepolia; tries switch, then add+switch if needed. */
export async function ensureSepolia(): Promise<void> {
  const ethereum = getEthereum();
  let chainId = await ethereum.request({ method: "eth_chainId" });
  if (chainId === SEPOLIA_CHAIN_ID_HEX) return;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
    });
  } catch {
    // Not added — try to add the network, then switch
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [SEPOLIA_PARAMS],
    });
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
    });
  }
}

/**
 * Minimal signer shim so existing code like `const signer = await getSignerAsync()`
 * continues to work without ethers.js. It returns the active address and a
 * `sendTransaction` helper that calls `eth_sendTransaction`.
 */
export async function getSignerAsync(): Promise<{
  address: string;
  sendTransaction: (tx: { to: string; value: string; data?: string }) => Promise<string>;
}> {
  const ethereum = getEthereum();
  const [from] = await requestAccounts();
  if (!from) throw new Error("No authorized account.");

  return {
    address: from,
    sendTransaction: async (tx) => {
      // tx.value should be hex string (e.g. "0x..."), tx.data optional
      const hash: string = await ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from, ...tx }],
      });
      return hash;
    },
  };
}
