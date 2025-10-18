// supabase/functions/cc-create-charge/index.ts
// Create a Coinbase Commerce charge and return the hosted_url

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type Body = {
  listing_id: string;
  amount: number;
  currency: string; // e.g. "ETH", "USD"
};

serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
    });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const body = (await req.json()) as Body;

    if (!body?.listing_id || !body?.amount || !body?.currency) {
      return json({ error: "listing_id, amount and currency are required" }, 400);
    }

    // Accept either secret name so you can't get stuck on naming
    const apiKey =
      Deno.env.get("COMMERCE_API_KEY") ||
      Deno.env.get("COINBASE_COMMERCE_API_KEY");

    if (!apiKey) {
      return json(
        { error: "COMMERCE_API_KEY (or COINBASE_COMMERCE_API_KEY) is not set" },
        500
      );
    }

    // Coinbase Commerce charge payload (fixed price)
    const payload = {
      name: "Artwork purchase",
      description: `Listing ${body.listing_id}`,
      pricing_type: "fixed_price",
      local_price: {
        amount: body.amount.toString(),
        currency: body.currency.toUpperCase(), // "ETH" or "USD"
      },
      metadata: {
        listing_id: body.listing_id,
      },
    };

    const res = await fetch("https://api.commerce.coinbase.com/charges", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CC-Api-Key": apiKey,             // << IMPORTANT
        "X-CC-Version": "2018-03-22",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      // Bubble up a clear error so the client shows something useful
      return json(
        { error: "Coinbase error", status: res.status, details: data },
        res.status
      );
    }

    const hostedUrl = data?.data?.hosted_url;
    if (!hostedUrl) {
      return json(
        { error: "No hosted charge URL returned", details: data },
        502
      );
    }

    return json({ hosted_url: hostedUrl }, 200);
  } catch (e) {
    // Final catch-all with details
    return json({ error: "Unhandled error", details: String(e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
