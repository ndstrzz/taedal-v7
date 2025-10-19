import { supabase } from "./supabase";

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


// Optional crypto charge (Coinbase Commerce)
export async function createCryptoCharge(listingId: string, quantity = 1) {
  const { data, error } = await supabase.functions.invoke<{
    hosted_url: string;
  }>("create-coinbase-charge", { body: { listing_id: listingId, quantity } });
  if (error) throw error;
  if (!data?.hosted_url) throw new Error("No charge URL returned");
  return data.hosted_url;
}
