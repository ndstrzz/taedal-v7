// supabase/functions/generate-contract-pdf/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    const { request_id } = await req.json().catch(() => ({}));
    if (!request_id) return json(400, { error: "Missing request_id" });

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json(500, { error: "Missing Supabase env" });

    const admin = createClient(url, serviceKey);

    // Load request + participants
    const { data: reqRow, error: reqErr } = await admin
      .from("license_requests")
      .select("id, requested, requester_id, owner_id, artwork_id")
      .eq("id", request_id)
      .single();
    if (reqErr) return json(404, { error: reqErr.message });

    const [{ data: art }, { data: rq }, { data: ow }] = await Promise.all([
      admin.from("artworks").select("title, image_url").eq("id", reqRow.artwork_id).maybeSingle(),
      admin.from("profiles").select("display_name, username, avatar_url").eq("id", reqRow.requester_id).maybeSingle(),
      admin.from("profiles").select("display_name, username, avatar_url").eq("id", reqRow.owner_id).maybeSingle(),
    ]);

    const nameOf = (p: any) => p?.display_name || p?.username || "—";
    const t = reqRow.requested as any;

    const territory = Array.isArray(t.territory) ? t.territory.join(", ") : (t.territory ?? "");
    const media = (t.media || []).join(", ");
    const fee = t.fee ? `${Number(t.fee.amount).toLocaleString()} ${t.fee.currency}` : "—";

    // Absolute image URLs so they resolve in the blob preview
    const LEFT_BAR = "https://taedal-v7.vercel.app/images/left-contract.svg";
    const KURO     = "https://taedal-v7.vercel.app/images/taedal-static.svg";

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Artwork License Agreement</title>
<style>
  :root{
    --bg:#0b0b0b; --fg:#fafafa; --muted:#d8d8d8; --rule:rgba(255,255,255,.8);
  }
  *{box-sizing:border-box}
  html,body{margin:0;background:var(--bg);color:var(--fg)}
  body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",Inter,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji";padding:40px}
  .sheet{max-width:1120px;margin:0 auto;background:var(--bg);padding:32px 40px 48px;border-bottom:2px solid rgba(255,255,255,.25)}
  /* ---------- header ---------- */
  .hdr{display:flex;align-items:center;justify-content:space-between}
  .hdr-left{
    width:320px; height:64px; background:url(${LEFT_BAR}) no-repeat left center / contain;
  }
  .hdr-right{
    width:44px; height:44px; background:url(${KURO}) no-repeat center / contain;
  }
  .rule{height:2px;background:var(--rule);margin:18px 0 26px 0}
  /* ---------- title ---------- */
  .title{font-size:52px;line-height:1.05;font-weight:800;text-align:center;text-transform:lowercase;letter-spacing:.3px;margin:12px 0 24px}
  /* ---------- grid ---------- */
  .grid{display:grid;grid-template-columns:180px 1fr;gap:10px 20px;margin-top:10px}
  .lb{color:var(--muted)} .v{color:var(--fg)}
  .section{margin-top:26px}
  /* Print */
  @media print {
    body{padding:0}
    .sheet{border:none}
    .rule{opacity:1}
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="hdr">
      <div class="hdr-left" aria-label="taedal brand"></div>
      <div class="hdr-right" aria-label="kuro logo"></div>
    </div>
    <div class="rule"></div>

    <div class="title">artwork license agreement</div>

    <div class="section grid">
      <div class="lb">Artwork</div><div class="v">${art?.title ?? "Untitled"}</div>
      <div class="lb">Requester</div><div class="v">${nameOf(rq)}</div>
      <div class="lb">Owner</div><div class="v">${nameOf(ow)}</div>
    </div>

    <div class="section grid">
      <div class="lb">Purpose</div><div class="v">${t.purpose}</div>
      <div class="lb">Term</div><div class="v">${t.term_months} months</div>
      <div class="lb">Territory</div><div class="v">${territory}</div>
      <div class="lb">Media</div><div class="v">${media}</div>
      <div class="lb">Exclusivity</div><div class="v">${t.exclusivity}</div>
      <div class="lb">Fee</div><div class="v">${fee}</div>
      ${t.deliverables ? `<div class="lb">Deliverables</div><div class="v">${t.deliverables}</div>` : ""}
      ${t.usage_notes ? `<div class="lb">Notes</div><div class="v">${t.usage_notes}</div>` : ""}
    </div>

    <div class="section" style="margin-top:40px;opacity:.6;font-size:12px">
      generated ${new Date().toLocaleString()}
    </div>
  </div>
</body>
</html>`;

    // Upload to private bucket (audit trail)
    const path = `requests/${request_id}/contract.html`;
    const body = new TextEncoder().encode(html);
    const up = await admin.storage.from("contracts").upload(path, body, {
      upsert: true,
      cacheControl: "public, max-age=31536000",
      contentType: "text/html; charset=utf-8",
    });
    if (up.error) return json(500, { error: up.error.message });

    // Optional: signed URL (not used for the blob preview, but handy to store/share)
    const signed = await admin.storage.from("contracts").createSignedUrl(path, 60 * 60 * 24 * 7);

    return json(200, { path, url: signed.data?.signedUrl ?? null, html });
  } catch (err) {
    console.error(err);
    return json(500, { error: (err as Error).message ?? "Unknown error" });
  }
});
