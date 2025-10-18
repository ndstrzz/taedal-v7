// deno-lint-ignore-file no-explicit-any
/// <reference lib="deno.unstable" />
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const WEBHOOK_SECRET = Deno.env.get("COINBASE_COMMERCE_WEBHOOK_SECRET") ?? "";

function text(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Access-Control-Allow-Origin": "*"},
  });
}

async function verifySignature(rawBody: string, sigHeader: string) {
  // Coinbase Commerce uses HMAC SHA256 of the raw body with the webhook secret
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const sigBytes = Uint8Array.from(
    sigHeader.match(/[0-9a-f]{2}/gi)?.map((h) => parseInt(h, 16)) ?? []
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    enc.encode(rawBody)
  );
  return ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return text("ok");
  if (req.method !== "POST") return text("Method not allowed", 405);
  if (!WEBHOOK_SECRET) return text("Missing COINBASE_COMMERCE_WEBHOOK_SECRET", 500);

  const raw = await req.text();
  const sig = req.headers.get("X-CC-Webhook-Signature") ?? "";

  const valid = await verifySignature(raw, sig);
  if (!valid) return text("Invalid signature", 400);

  // At this point the event is authentic
  const evt = JSON.parse(raw);
  // evt.type can be "charge:pending", "charge:confirmed", "charge:failed", etc.
  // Later: update your orders table based on evt.data.code / id in metadata.

  // For now, just acknowledge
  return text("ok", 200);
});
