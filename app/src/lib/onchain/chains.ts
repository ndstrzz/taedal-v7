// Lightweight chain registry for the app.
// Add networks here (ids, names, RPC, explorers).

export type Chain = {
  id: number;
  idHex: `0x${string}`;
  name: string;
  currency: { name: string; symbol: string; decimals: number };
  rpcUrl: string;
  explorer?: string;
};

function toHex(id: number): `0x${string}` {
  return `0x${id.toString(16)}` as const;
}

// Read from Vite env when available, else fall back
const SEPOLIA_RPC =
  (import.meta as any)?.env?.VITE_SEPOLIA_RPC ??
  "https://sepolia.infura.io/v3/"; // put your key in env for perf

export const sepolia: Chain = {
  id: 11155111,
  idHex: toHex(11155111),
  name: "Sepolia",
  currency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
  rpcUrl: SEPOLIA_RPC,
  explorer: "https://sepolia.etherscan.io",
};

// Optional: mainnet placeholder so we can switch later
const MAINNET_RPC =
  (import.meta as any)?.env?.VITE_MAINNET_RPC ??
  "https://mainnet.infura.io/v3/";

export const mainnet: Chain = {
  id: 1,
  idHex: toHex(1),
  name: "Ethereum",
  currency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrl: MAINNET_RPC,
  explorer: "https://etherscan.io",
};

// Choose your default app chain here:
export const defaultChain = sepolia;

// Convenience exports
export const chainId = defaultChain.id;
export const chainIdHex = defaultChain.idHex;
export const nativeCurrency = defaultChain.currency;
export const rpcUrl = defaultChain.rpcUrl;
export const explorer = defaultChain.explorer;
