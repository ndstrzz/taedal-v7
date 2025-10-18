// Simple allowlists; grow these as needed.
export const FIAT = new Set([
  "USD","EUR","GBP","AUD","CAD","JPY","SGD","MYR","THB","IDR","PHP","CHF","SEK","NOK","DKK","NZD","HKD","CNY","INR","KRW","BRL","MXN","ZAR","AED","SAR"
]);

export const CRYPTO = new Set([
  "ETH","BTC","USDC","USDT","SOL","MATIC","BASEETH" // pick the ones you’ll support
]);

export function isFiat(code?: string | null) {
  return !!code && FIAT.has(code.toUpperCase());
}
export function isCrypto(code?: string | null) {
  return !!code && CRYPTO.has(code.toUpperCase());
}
