// Deno deploy target (Supabase Edge)
// File: supabase/functions/verify-chip/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type VerifyBody = {
  a?: string;         // tag_id
  t?: string;         // public key or key id (optional)
  c?: string;         // signature/HMAC (hex)
  ctr?: string;       // monotonic counter
  page_artwork_id?: string; // artwork id from current page (for mismatch detection)
};

/* ----------------------------- CORS helpers ----------------------------- */

function getCorsHeaders(req: Request) {
  // If you want to restrict, replace "*" with your app origin(s)
  const origin = req.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(req: Request, status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      ...getCorsHeaders(req),
    },
  });
}

/* ------------------------- simple HMAC verifier ------------------------- */
// For dev/testing chips that use HMAC(secret, `${tag_id}|${ctr}`)
async function verifyHmac(secret: string, message: string, expectedHex: string) {
  const enc = new TextEncoder().encode(message);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc);
  const gotHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return gotHex.toLowerCase() === (expectedHex || "").toLowerCase();
}

/* -------------------------------- serve --------------------------------- */

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 204,
      headers: getCorsHeaders(req),
    });
  }

  try {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    // Supabase admin client
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Accept both GET (querystring) and POST (json)
    const body: VerifyBody =
      method === "GET"
        ? {
            a: url.searchParams.get("a") ?? undefined,
            t: url.searchParams.get("t") ?? undefined,
            c: url.searchParams.get("c") ?? undefined,
            ctr: url.searchParams.get("ctr") ?? undefined,
            page_artwork_id: url.searchParams.get("page_artwork_id") ?? undefined,
          }
        : await req.json().catch(() => ({}));

    const { a: tagId, t, c: sig, ctr, page_artwork_id } = body;

    if (!tagId || !sig || !ctr) {
      return json(req, 400, { ok: false, error: "missing_params" });
    }

    // 1) Find chip
    const { data: chip } = await supabase
      .from("chips")
      .select("*")
      .eq("tag_id", tagId)
      .maybeSingle();

    if (!chip) {
      if (page_artwork_id) {
        await supabase.from("chip_scan_events").insert({
          chip_id: null,
          artwork_id: page_artwork_id,
          state: "invalid",
          ip: req.headers.get("x-forwarded-for") ?? null,
          ua: req.headers.get("user-agent") ?? null,
        });
      }
      return json(req, 200, { ok: false, state: "invalid" });
    }

    // 2) Verify signature / HMAC
    let verified = false;
    if (chip.secret) {
      verified = await verifyHmac(chip.secret, `${tagId}|${ctr}`, sig);
    } else {
      // Dev bypass (optional)
      const DEV_BYPASS = Deno.env.get("DEV_CHIP_SIG");
      verified = !!DEV_BYPASS && sig === DEV_BYPASS;
    }

    if (!verified) {
      await supabase.from("chip_scan_events").insert({
        chip_id: chip.id,
        artwork_id: page_artwork_id ?? null,
        state: "invalid",
        ip: req.headers.get("x-forwarded-for") ?? null,
        ua: req.headers.get("user-agent") ?? null,
      });
      return json(req, 200, { ok: false, state: "invalid" });
    }

    // 3) Replay protection
    const nCtr = Number(ctr);
    if (!Number.isFinite(nCtr)) {
      return json(req, 400, { ok: false, error: "bad_counter" });
    }
    if (nCtr <= Number(chip.counter ?? 0)) {
      await supabase.from("chip_scan_events").insert({
        chip_id: chip.id,
        artwork_id: page_artwork_id ?? null,
        state: "cloned",
        ip: req.headers.get("x-forwarded-for") ?? null,
        ua: req.headers.get("user-agent") ?? null,
      });
      return json(req, 200, { ok: false, state: "cloned" });
    }

    // 4) Find the artwork linked to this chip
    const { data: link } = await supabase
      .from("chip_artworks")
      .select("artwork_id")
      .eq("chip_id", chip.id)
      .maybeSingle();

    let state: "authentic" | "mismatch" = "authentic";
    if (link?.artwork_id && page_artwork_id && link.artwork_id !== page_artwork_id) {
      state = "mismatch";
    }

    // 5) Current owner (nice-to-have for UI)
    let owner_handle: string | null = null;
    if (link?.artwork_id) {
      const { data: art } = await supabase
        .from("artworks")
        .select("owner_id")
        .eq("id", link.artwork_id)
        .maybeSingle();
      if (art?.owner_id) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("username, id")
          .eq("id", art.owner_id)
          .maybeSingle();
        owner_handle = prof?.username ? `@${prof.username}` : art.owner_id;
      }
    }

    // 6) Accept counter + log
    await supabase.from("chips").update({ counter: nCtr }).eq("id", chip.id);
    await supabase.from("chip_scan_events").insert({
      chip_id: chip.id,
      artwork_id: page_artwork_id ?? link?.artwork_id ?? null,
      state,
      ip: req.headers.get("x-forwarded-for") ?? null,
      ua: req.headers.get("user-agent") ?? null,
    });

    return json(req, 200, {
      ok: true,
      state,
      linked_artwork_id: link?.artwork_id ?? null,
      owner_handle,
    });
  } catch (e) {
    console.error(e);
    return json(req, 500, { ok: false, error: "server_error" });
  }
});
