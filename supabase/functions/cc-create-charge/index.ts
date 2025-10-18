// supabase/functions/cc-create-charge/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

Deno.serve(async (req) => {
  // Handle preflight cleanly so the browser never shows “Failed to fetch”
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const {
      listing_id,
      amount,
      currency = "ETH",
      title = "Artwork purchase",
      description = "",
      success_url,
      cancel_url,
    } = body as Record<string, unknown>;

    const API_KEY = Deno.env.get("COINBASE_COMMERCE_API_KEY");
    if (!API_KEY) return json({ error: "Missing COINBASE_COMMERCE_API_KEY" }, 500);

    // Coinbase Commerce — fixed price charge
    const resp = await fetch("https://api.commerce.coinbase.com/charges", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CC-Api-Key": API_KEY,
        "X-CC-Version": "2018-03-22",
      },
      body: JSON.stringify({
        name: String(title),
        description: String(description),
        pricing_type: "fixed_price",
        local_price: { amount: String(Number(amount || 0)), currency: String(currency) },
        metadata: { listing_id },
        redirect_url: success_url,
        cancel_url,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      // Surface Coinbase’s error to the UI instead of a network error
      return json({ error: data?.error ?? data ?? "Coinbase error" }, resp.status);
    }

    const hosted_url = data?.data?.hosted_url;
    if (!hosted_url) return json({ error: "No hosted_url from Coinbase" }, 500);

    return json({ hosted_url });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
