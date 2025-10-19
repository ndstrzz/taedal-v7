// app/src/lib/wallet.ts
import { createAppKit } from "@reown/appkit";
import { sepolia } from "@reown/appkit/networks";

/** ---------- WalletConnect / Reown (modal) ---------- */

let appkit: ReturnType<typeof createAppKit> | null = null;

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
    // NOTE: new AppKit uses `networks`, not `chains`
    networks: [sepolia],
    enableInjected: true,
    enableWalletConnect: true,
    enableEIP6963: true,
    themeMode: "dark",
  });

  return appkit;
}

/** ---------- EIP-1193 helpers (MetaMask etc.) ---------- */

export const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"; // 11155111
export const SEPOLIA_PARAMS = {
  chainId: SEPOLIA_CHAIN_ID_HEX,
  chainName: "Sepolia",
  nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://sepolia.infura.io/v3/"],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

function getEthereum() {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No injected wallet found. Please install MetaMask.");
  return eth;
}

export async function requestAccounts(): Promise<string[]> {
  const ethereum = getEthereum();
  return ethereum.request({ method: "eth_requestAccounts" });
}

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
    await ethereum.request({ method: "wallet_addEthereumChain", params: [SEPOLIA_PARAMS] });
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
    });
  }
}

/**
 * Minimal ethers-like signer shim:
 *  - getAddress(): Promise<string>
 *  - provider: EIP-1193 provider
 *  - sendTransaction(tx): Promise<{ hash: string }>
 */
export async function getSignerAsync(): Promise<{
  address: string;
  getAddress: () => Promise<string>;
  provider: any;
  sendTransaction: (tx: { to: string; value: string; data?: string }) => Promise<{ hash: string }>;
}> {
  const ethereum = getEthereum();
  const [from] = await requestAccounts();
  if (!from) throw new Error("No authorized account.");

  return {
    address: from,
    getAddress: async () => from,
    provider: ethereum,
    sendTransaction: async (tx) => {
      const hash: string = await ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from, ...tx }],
      });
      // ethers v5 returns a TransactionResponse that has `.hash`
      return { hash };
    },
  };
}
