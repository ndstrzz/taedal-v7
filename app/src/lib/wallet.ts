// app/src/lib/wallet.ts
import { createAppKit } from "@reown/appkit";
import { sepolia } from "@reown/appkit/networks"; // ✅ use Sepolia testnet

let appkit: ReturnType<typeof createAppKit> | null = null;

/**
 * Lazy-init Wallet modal (Reown / WalletConnect).
 * Make sure your domain is allow-listed in the Reown dashboard.
 */
export function getWalletKit() {
  if (appkit) return appkit;

  const projectId = import.meta.env.VITE_WC_PROJECT_ID as string;
  if (!projectId) {
    console.warn("VITE_WC_PROJECT_ID missing — WalletConnect modal disabled.");
    return null;
  }

  appkit = createAppKit({
    projectId,
    metadata: {
      name: "taedal",
      description: "Collect and sell digital artworks",
      url: window.location.origin, // must be in Reown Domain allow-list
      icons: [`${window.location.origin}/images/taedal-logo.svg`],
    },

    // 👇 REQUIRED in current AppKit builds
    networks: [sepolia], // use Ethereum Sepolia testnet

    // Wallet options
    enableInjected: true,      // MetaMask / injected wallets
    enableWalletConnect: true, // WalletConnect (QR / mobile wallets)
    enableEIP6963: true,       // wallet discovery

    themeMode: "dark",
  });

  return appkit;
}
