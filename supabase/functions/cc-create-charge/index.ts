// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.unstable" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const API_KEY = Deno.env.get("COINBASE_COMMERCE_API_KEY") ?? "";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
function text(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return text("ok");

  try {
    if (!API_KEY) return text("Missing COINBASE_COMMERCE_API_KEY", 500);
    if (req.method !== "POST") return text("Method not allowed", 405);

    const { name, description, amount, currency, metadata } = await req.json();

    if (!amount || !currency) {
      return text("amount and currency are required", 400);
    }

    const payload = {
      name: name ?? "Artwork purchase",
      description: description ?? "",
      pricing_type: "fixed_price",
      local_price: { amount: String(amount), currency },
      metadata: metadata ?? {},
    };

    const res = await fetch("https://api.commerce.coinbase.com/charges", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CC-Api-Key": API_KEY,
        "X-CC-Version": "2018-03-22",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      return text(`Coinbase error: ${err}`, 502);
    }

    const data = await res.json();
    // Most useful fields:
    // data.data.hosted_url, data.data.id, data.data.code
    return json(
      {
        id: data?.data?.id,
        code: data?.data?.code,
        hosted_url: data?.data?.hosted_url,
      },
      200
    );
  } catch (e: any) {
    return json({ error: e?.message ?? "Server error" }, 500);
  }
});
