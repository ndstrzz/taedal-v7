import { supabase } from "./supabase";

/**
 * Create a fiat checkout session (Stripe).
 * Sends success/cancel URLs based on the current origin so it works
 * on localhost, Vercel, Render, custom domains, etc.
 */
export async function createFiatCheckout(listingId: string, quantity = 1) {
  const success_url = `${window.location.origin}/checkout/success`;
  const cancel_url = `${window.location.origin}`;
  const { data, error } = await supabase.functions.invoke<{ url: string }>(
    "create-checkout",
    { body: { listing_id: listingId, quantity, success_url, cancel_url } }
  );
  if (error) throw error;
  if (!data?.url) throw new Error("No checkout URL returned");
  return data.url;
}

/**
 * Optional crypto path (if you add a Coins/on-ramp function later).
 * Not used if you're sticking to ETH MetaMask + Stripe.
 */
export async function createCryptoCharge(listingId: string, quantity = 1) {
  const { data, error } = await supabase.functions.invoke<{ hosted_url: string }>(
    "create-coinbase-charge",
    { body: { listing_id: listingId, quantity } }
  );
  if (error) throw error;
  if (!data?.hosted_url) throw new Error("No charge URL returned");
  return data.hosted_url;
}
