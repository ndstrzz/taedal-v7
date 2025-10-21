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

const LEFT_BAR = "https://taedal-v7.vercel.app/images/left-contract.svg";
const KURO     = "https://taedal-v7.vercel.app/images/taedal-static.svg";

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

    const money = (f?: any) => f ? `${Number(f.amount).toLocaleString()} ${f.currency}` : "—";
    const list = (arr?: any[]) => Array.isArray(arr) && arr.length ? arr.join(", ") : "—";
    const yesno = (b?: boolean) => b ? "yes" : "no";
    const spec = (d?: any) => {
      if (!d) return "—";
      const dims = (d.width && d.height) ? `${d.width}×${d.height}` : "";
      const parts = [
        d.format || null,
        dims || null,
        d.color || null,
        d.dpi ? `${d.dpi} dpi` : null
      ].filter(Boolean);
      return parts.length ? parts.join(" · ") : "—";
    };
    const liability = (cap?: any) => {
      if (!cap) return "—";
      if (cap.type === "fees_paid") return "fees paid";
      if (cap.type === "fixed" && cap.amount != null) return `${Number(cap.amount).toLocaleString()} USD`;
      return "—";
    };
    const disputes = (d?: any) => {
      if (!d) return "—";
      if (d.mode === "courts") return `${d.law}${d.venue ? `, ${d.venue}` : ""}`;
      if (d.mode === "arbitration") return `${d.arb_rules || "Arbitration"} — seat ${d.seat || "TBD"} — law ${d.law}`;
      return "—";
    };

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
  .hdr{display:flex;align-items:center;justify-content:space-between}
  .hdr-left{width:320px;height:64px;background:url(${LEFT_BAR}) no-repeat left center/contain}
  .hdr-right{width:44px;height:44px;background:url(${KURO}) no-repeat center/contain}
  .rule{height:2px;background:var(--rule);margin:18px 0 26px}
  .title{font-size:52px;line-height:1.05;font-weight:800;text-align:center;text-transform:lowercase;letter-spacing:.3px;margin:12px 0 24px}
  .grid{display:grid;grid-template-columns:180px 1fr;gap:10px 20px;margin-top:10px}
  .lb{color:var(--muted)} .v{color:var(--fg)}
  .section{margin-top:26px}
  .section h3{margin:14px 0 10px;font-size:16px;font-weight:700;color:#fff}
  @media print { body{padding:0} .sheet{border:none} .rule{opacity:1} }
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

    <!-- Basics -->
    <div class="section grid">
      <div class="lb">Artwork</div><div class="v">${art?.title ?? "Untitled"}</div>
      <div class="lb">Requester</div><div class="v">${nameOf(rq)}</div>
      <div class="lb">Owner</div><div class="v">${nameOf(ow)}</div>
      <div class="lb">Purpose</div><div class="v">${t.purpose}</div>
      <div class="lb">Term</div><div class="v">${t.term_months} months</div>
      <div class="lb">Territory</div><div class="v">${territory}</div>
      <div class="lb">Media</div><div class="v">${media}</div>
      <div class="lb">Exclusivity</div><div class="v">${t.exclusivity}</div>
      <div class="lb">Fee</div><div class="v">${fee}</div>
      ${t.deliverables ? `<div class="lb">Deliverables</div><div class="v">${t.deliverables}</div>` : ""}
      ${t.usage_notes ? `<div class="lb">Notes</div><div class="v">${t.usage_notes}</div>` : ""}
      ${t.credit_required ? `<div class="lb">Attribution</div><div class="v">${yesno(t.credit_required)}${t.credit_line ? ` — ${t.credit_line}` : ""}</div>` : ""}
      ${t.start_date ? `<div class="lb">Start Date</div><div class="v">${t.start_date}</div>` : ""}
      ${t.effective_date ? `<div class="lb">Effective Date</div><div class="v">${t.effective_date}</div>` : ""}
    </div>

    <!-- Payment & Admin -->
    ${
      (t.payment_terms || t.tax || t.invoicing)
        ? `<div class="section"><h3>Payment & Admin</h3><div class="grid">
            ${t.payment_terms ? `<div class="lb">Payment</div><div class="v">Net ${t.payment_terms.due_days}${t.payment_terms.late_fee_pct ? ` · Late fee ${t.payment_terms.late_fee_pct}%` : ""}${t.payment_terms.method ? ` · ${t.payment_terms.method}` : ""}</div>` : ""}
            ${t.tax ? `<div class="lb">Taxes</div><div class="v">${t.tax.responsible_party} responsible${t.tax.vat_registered ? " · VAT registered" : ""}</div>` : ""}
            ${t.invoicing ? `<div class="lb">Invoicing</div><div class="v">${t.invoicing.entity_name}${t.invoicing.email ? ` · ${t.invoicing.email}` : ""}${t.invoicing.address ? ` · ${t.invoicing.address}` : ""}</div>` : ""}
          </div></div>`
        : ""
    }

    <!-- Brand & Approvals -->
    ${
      (t.brand_guidelines_url || t.preapproval_required || t.approval_sla_days || t.prohibited_uses || t.usage_restrictions || t.delivery_specs)
        ? `<div class="section"><h3>Brand & Approvals</h3><div class="grid">
            ${t.brand_guidelines_url ? `<div class="lb">Guidelines</div><div class="v">${t.brand_guidelines_url}</div>` : ""}
            ${typeof t.preapproval_required === "boolean" ? `<div class="lb">Pre-approval</div><div class="v">${yesno(t.preapproval_required)}${t.approval_sla_days ? ` · SLA ${t.approval_sla_days} days` : ""}</div>` : ""}
            ${t.prohibited_uses ? `<div class="lb">Prohibited Uses</div><div class="v">${list(t.prohibited_uses)}</div>` : ""}
            ${t.usage_restrictions ? `<div class="lb">Usage Restrictions</div><div class="v">${list(t.usage_restrictions)}</div>` : ""}
            ${t.delivery_specs ? `<div class="lb">Delivery Specs</div><div class="v">${spec(t.delivery_specs)}</div>` : ""}
          </div></div>`
        : ""
    }

    <!-- Legal Terms -->
    ${
      (t.confidentiality_term_months || t.liability_cap || t.sublicense != null || t.derivative_edits || t.injunctive_relief)
        ? `<div class="section"><h3>Legal Terms</h3><div class="grid">
            ${t.sublicense != null ? `<div class="lb">Sublicensing</div><div class="v">${yesno(t.sublicense)}</div>` : ""}
            ${t.derivative_edits ? `<div class="lb">Permitted Edits</div><div class="v">${list(t.derivative_edits)}</div>` : ""}
            ${t.confidentiality_term_months ? `<div class="lb">Confidentiality</div><div class="v">${t.confidentiality_term_months} months</div>` : ""}
            ${t.liability_cap ? `<div class="lb">Liability Cap</div><div class="v">${liability(t.liability_cap)}</div>` : ""}
            ${t.injunctive_relief ? `<div class="lb">Equitable Relief</div><div class="v">Injunctive relief available</div>` : ""}
          </div></div>`
        : ""
    }

    <!-- Termination -->
    ${
      t.termination
        ? `<div class="section"><h3>Termination</h3><div class="grid">
            ${typeof t.termination.for_convenience === "boolean" ? `<div class="lb">For Convenience</div><div class="v">${yesno(t.termination.for_convenience)}</div>` : ""}
            ${t.termination.notice_days ? `<div class="lb">Notice</div><div class="v">${t.termination.notice_days} days</div>` : ""}
            ${t.termination.breach_cure_days ? `<div class="lb">Cure Period</div><div class="v">${t.termination.breach_cure_days} days</div>` : ""}
            ${t.termination.takedown_days ? `<div class="lb">Post-Term Takedown</div><div class="v">${t.termination.takedown_days} days</div>` : ""}
          </div></div>`
        : ""
    }

    <!-- Disputes -->
    ${
      t.disputes
        ? `<div class="section"><h3>Governing Law & Disputes</h3><div class="grid">
            <div class="lb">Framework</div><div class="v">${disputes(t.disputes)}</div>
          </div></div>`
        : ""
    }

    <!-- On-chain -->
    ${
      (t.onchain || t.royalties || t.metadata)
        ? `<div class="section"><h3>On-chain</h3><div class="grid">
            ${t.onchain ? `<div class="lb">Chain</div><div class="v">${t.onchain.chain || "—"}</div>` : ""}
            ${t.onchain?.contract_address ? `<div class="lb">Contract</div><div class="v">${t.onchain.contract_address}</div>` : ""}
            ${t.onchain?.token_id ? `<div class="lb">Token ID</div><div class="v">${t.onchain.token_id}</div>` : ""}
            ${t.onchain?.pay_gas_party ? `<div class="lb">Gas</div><div class="v">${t.onchain.pay_gas_party} pays gas</div>` : ""}
            ${t.royalties ? `<div class="lb">Royalties</div><div class="v">${(t.royalties.rate_bps/100).toFixed(2)}%${t.royalties.receiver ? ` · ${t.royalties.receiver}` : ""}</div>` : ""}
            ${t.metadata ? `<div class="lb">Storage</div><div class="v">${t.metadata.image_cid ? `image ${t.metadata.image_cid}` : ""}${t.metadata.metadata_cid ? ` · meta ${t.metadata.metadata_cid}` : ""}${t.metadata.mutable != null ? ` · mutable ${yesno(t.metadata.mutable)}` : ""}</div>` : ""}
          </div></div>`
        : ""
    }

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

    // Signed URL optional (kept for history/sharing)
    const signed = await admin.storage.from("contracts").createSignedUrl(path, 60 * 60 * 24 * 7);

    return json(200, { path, url: signed.data?.signedUrl ?? null, html });
  } catch (err) {
    console.error(err);
    return json(500, { error: (err as Error).message ?? "Unknown error" });
  }
});
