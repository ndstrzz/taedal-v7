// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.window" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Coinbase Commerce signs webhooks with X-CC-Webhook-Signature (HMAC SHA256)
const SECRET = (Deno.env.get("COMMERCE_WEBHOOK_SECRET") || "").trim();

function verifySignature(rawBody: string, sig: string, secret: string) {
  const key = new TextEncoder().encode(secret);
  const data = new TextEncoder().encode(rawBody);
  const cryptoKey = crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return cryptoKey.then(k => crypto.subtle.sign("HMAC", k, data)).then(sigBuf => {
    const expected = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, "0")).join("");
    // Coinbase sends the hex digest directly in the header
    return expected === sig.toLowerCase();
  });
}

export default async function handler(req: Request) {
  if (req.method === "GET") return new Response("ok");
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const sig = req.headers.get("X-CC-Webhook-Signature") || "";
  const raw = await req.text();

  if (!SECRET) return new Response("Missing COMMERCE_WEBHOOK_SECRET", { status: 500 });
  const ok = await verifySignature(raw, sig, SECRET);
  if (!ok) return new Response("Invalid signature", { status: 400 });

  const evt = JSON.parse(raw);

  // TODO: read your metadata and update DB accordingly.
  // Example: const { event: { type }, data: { metadata } } = evt;

  console.log("coinbase-commerce webhook:", evt?.event?.type, evt?.data?.metadata);
  return new Response("received");
}
