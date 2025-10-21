// supabase/functions/generate-contract-pdf/index.ts
// Deno Deploy / Supabase Edge Function
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type LicenseTerms = {
  purpose: string;
  term_months: number;
  territory: string | string[];
  media: string[];
  exclusivity: string;
  start_date?: string;
  deliverables?: string;
  credit_required?: boolean;
  usage_notes?: string;
  fee?: { amount: number; currency: string };
};

type LicenseRequest = {
  id: string;
  artwork_id: string;
  requester_id: string;
  owner_id: string;
  requested: LicenseTerms;
  accepted_terms: LicenseTerms | null;
  created_at: string;
  updated_at: string;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function textOrArray(val: string | string[]): string {
  return Array.isArray(val) ? val.join(", ") : val;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const { request_id } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load request + little surrounding info
    const { data: lr, error: e1 } = await supabase
      .from("license_requests")
      .select("*")
      .eq("id", request_id)
      .single<LicenseRequest>();
    if (e1) throw e1;

    const { data: art } = await supabase
      .from("artworks")
      .select("title")
      .eq("id", lr.artwork_id)
      .maybeSingle();

    const { data: reqr } = await supabase
      .from("profiles")
      .select("display_name,username")
      .eq("id", lr.requester_id)
      .maybeSingle();

    const { data: owner } = await supabase
      .from("profiles")
      .select("display_name,username")
      .eq("id", lr.owner_id)
      .maybeSingle();

    const working = lr.accepted_terms ?? lr.requested;

    // --- Build a simple PDF (via PDFKit-style minimal buffer) ---
    // For portability here, we’ll emit a very simple PDF bytes buffer.
    // In your repo you might already be using a PDF lib; plug the header
    // drawing idea into that if so.

    // Use a tiny HTML->PDF via Satori/Resvg etc. if you prefer.
    const body = `
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"; color: #fafafa; }
            .page { width: 794px; height: 1123px; background:#0b0b0b; padding: 40px 44px; }
            .hdr { display:flex; align-items:center; justify-content:space-between; padding-bottom: 16px; border-bottom: 2px solid rgba(255,255,255,.25); }
            .brand { display:flex; align-items:center; gap:14px; }
            .brand .logo { width:110px; height:22px; background:#fff; -webkit-mask:url(https://taedal-v7.vercel.app/images/taedal-static.svg) no-repeat center / contain; mask:url(https://taedal-v7.vercel.app/images/taedal-static.svg) no-repeat center / contain; }
            .brand small { color:#b8b8b8; font-size:11px; letter-spacing:.2px; }
            .xpair { display:flex; align-items:center; gap:10px; color:#fff; }
            .title { font-weight:800; font-size:36px; margin:28px 0 18px; text-transform:lowercase; letter-spacing:.5px; }
            .section { margin: 20px 0; }
            .grid { display:grid; grid-template-columns: 200px 1fr; gap: 8px 16px; }
            .lbl { color:#c9c9c9; }
            code { color:#fff; }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="hdr">
              <div class="brand">
                <div class="logo"></div>
                <small>made by artists for artists</small>
              </div>
              <div class="xpair">
                <span>🐺</span>
                <span>×</span>
                <span>📜</span>
              </div>
            </div>

            <div class="title">artwork license agreement</div>

            <div class="section grid">
              <div class="lbl">Artwork</div>
              <div><code>${(art?.title || "Untitled").replace(/</g,"&lt;")}</code></div>
              <div class="lbl">Requester</div>
              <div>${reqr?.display_name || reqr?.username || "—"}</div>
              <div class="lbl">Owner</div>
              <div>${owner?.display_name || owner?.username || "—"}</div>
            </div>

            <div class="section grid">
              <div class="lbl">Purpose</div>
              <div>${working.purpose}</div>
              <div class="lbl">Term</div>
              <div>${working.term_months} months</div>
              <div class="lbl">Territory</div>
              <div>${textOrArray(working.territory)}</div>
              <div class="lbl">Media</div>
              <div>${working.media.join(", ")}</div>
              <div class="lbl">Exclusivity</div>
              <div>${working.exclusivity}</div>
              <div class="lbl">Fee</div>
              <div>${working.fee ? `${working.fee.amount.toLocaleString()} ${working.fee.currency}` : "—"}</div>
              ${
                working.deliverables
                  ? `<div class="lbl">Deliverables</div><div>${working.deliverables}</div>`
                  : ""
              }
              ${
                working.usage_notes
                  ? `<div class="lbl">Notes</div><div>${working.usage_notes}</div>`
                  : ""
              }
            </div>

            <div class="section" style="margin-top:40px;color:#bdbdbd;font-size:12px">
              Generated ${new Date().toLocaleString()}
            </div>
          </div>
        </body>
      </html>
    `;

    // Store the HTML; if you already render PDFs elsewhere, replace with your renderer
    const path = `requests/${lr.id}/contract-${Date.now()}.html`;
    const { error: eUp } = await supabase.storage
      .from("contracts")
      .upload(path, new Blob([body], { type: "text/html" }), {
        upsert: true,
        contentType: "text/html",
      });
    if (eUp) throw eUp;

    const { data: signed } = await supabase.storage
      .from("contracts")
      .createSignedUrl(path, 60 * 60 * 24 * 7);

    return new Response(
      JSON.stringify({ path, url: signed?.signedUrl }),
      { headers: { "content-type": "application/json", ...cors } },
    );
  } catch (err) {
    const msg =
      (err as any)?.message ||
      (typeof err === "string" ? err : JSON.stringify(err));
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors },
    });
  }
});
