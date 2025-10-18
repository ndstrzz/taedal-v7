// app/src/lib/cryptoPay.ts
import { supabase } from "./supabase";

export async function startCoinbaseCheckout(params: {
  amount: number;
  currency: string;         // e.g. "USD" or "EUR" (Coinbase will present crypto options)
  name?: string;
  description?: string;
  metadata?: Record<string, string>;
}) {
  const { data, error } = await supabase.functions.invoke("cc-create-charge", {
    body: {
      name: params.name,
      description: params.description,
      amount: params.amount,
      currency: params.currency,
      metadata: params.metadata,
    },
  });
  if (error) throw error;
  if (!data?.hosted_url) throw new Error("No hosted_url from Coinbase.");
  window.location.href = data.hosted_url;
}
