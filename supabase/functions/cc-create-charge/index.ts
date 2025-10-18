// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.unstable" />

// Minimal CORS
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Body = {
  listing_id: string;
  amount: number;         // Listing amount as shown in UI
  currency: string;       // "ETH" in your case
  title?: string;
  description?: string;
  success_url?: string;
  cancel_url?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("COMMERCE_API_KEY")?.trim();
    if (!apiKey) {
      throw new Error("COMMERCE_API_KEY not set");
    }

    const body = (await req.json()) as Body;
    if (!body?.listing_id || !isFinite(Number(body?.amount))) {
      throw new Error("listing_id and amount are required");
    }

    const title = body.title || "Artwork purchase";
    const description =
      body.description || `Listing ${body.listing_id} via Taedal`;

    // ── Convert ETH amount to USD for a fixed-price charge ───────────
    let usdAmount = body.amount;

    if (String(body.currency).toUpperCase() !== "USD") {
      // Fetch ETH→USD rate from Coinbase public API
      const rateRes = await fetch(
        "https://api.coinbase.com/v2/exchange-rates?currency=ETH",
      );
      if (!rateRes.ok) {
        throw new Error(`Failed to fetch exchange rate (${rateRes.status})`);
      }
      const rateJson = await rateRes.json();
      const usdRate = Number(rateJson?.data?.rates?.USD);
      if (!isFinite(usdRate) || usdRate <= 0) {
        throw new Error("Invalid USD rate");
      }

      // amount is in ETH; convert to USD
      usdAmount = Number(body.amount) * usdRate;
    }

    // Coinbase Commerce: create a FIXED price charge in USD
    const payload = {
      name: title,
      description,
      pricing_type: "fixed_price",
      local_price: {
        amount: usdAmount.toFixed(2), // cents are handled as decimal string
        currency: "USD",
      },
      metadata: {
        listing_id: body.listing_id,
        asked_currency: body.currency,
        asked_amount: body.amount,
      },
      redirect_url: body.success_url || undefined,
      cancel_url: body.cancel_url || undefined,
    };

    const ccRes = await fetch("https://api.commerce.coinbase.com/charges", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CC-Api-Key": apiKey,
        "X-CC-Version": "2018-03-22",
      },
      body: JSON.stringify(payload),
    });

    const ccJson = await ccRes.json();
    if (!ccRes.ok) {
      // Bubble up Coinbase error detail if present
      const errMsg =
        ccJson?.error?.message ||
        ccJson?.message ||
        `Coinbase error ${ccRes.status}`;
      throw new Error(errMsg);
    }

    const hosted = ccJson?.data?.hosted_url as string | undefined;
    if (!hosted) {
      throw new Error("No hosted_url in Coinbase response");
    }

    return new Response(JSON.stringify({ hosted_url: hosted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err?.message ?? "Server error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
