// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  PDFDocument,
  PageSizes,
  StandardFonts,
  rgb,
} from "https://esm.sh/pdf-lib@1.17.1";

const allowOrigin = "*";

function corsHeaders(status = 200) {
  return {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": allowOrigin,
      "access-control-allow-headers":
        "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    },
  };
}
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), corsHeaders(status));
const fail = (msg: string, status = 500, extra?: Record<string, unknown>) =>
  new Response(JSON.stringify({ error: msg, ...(extra || {}) }), corsHeaders(status));

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, corsHeaders().headers);

  try {
    // ---------- Guard: env ----------
    const url = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRole) {
      console.error("Missing env", { hasUrl: !!url, hasKey: !!serviceRole });
      return fail("Server not configured: missing SUPABASE env", 500);
    }
    const supabase = createClient(url, serviceRole);

    // ---------- Parse body ----------
    let payload: any = {};
    try {
      payload = await req.json();
    } catch {
      return fail("Invalid JSON body", 400);
    }
    const request_id = payload?.request_id;
    if (!request_id) return fail("request_id is required", 400);

    // ---------- Fetch license_request + joins ----------
    const { data: lr, error: eReq } = await supabase
      .from("license_requests")
      .select("*")
      .eq("id", request_id)
      .maybeSingle();
    if (eReq) return fail("Failed to load license_request", 500, { detail: eReq.message });
    if (!lr) return fail("License request not found", 404);

    const [art, requester, owner] = await Promise.all([
      supabase
        .from("artworks")
        .select("title,image_url")
        .eq("id", lr.artwork_id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("display_name,username")
        .eq("id", lr.requester_id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("display_name,username")
        .eq("id", lr.owner_id)
        .maybeSingle(),
    ]);

    const aTitle = art.data?.title || "Untitled";
    const rName = requester.data?.display_name || requester.data?.username || "Requester";
    const oName = owner.data?.display_name || owner.data?.username || "Owner";

    // ---------- Build PDF ----------
    const pdf = await PDFDocument.create();
    const page = pdf.addPage(PageSizes.A4);
    const { width, height } = page.getSize();
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    const headerH = 70;
    const padX = 24;

    // Black header
    page.drawRectangle({ x: 0, y: height - headerH, width, height: headerH, color: rgb(0, 0, 0) });
    page.drawText("taedal", {
      x: padX, y: height - headerH / 2 - 7, size: 22, font: helvBold, color: rgb(1, 1, 1),
    });
    const icons = "🐺  ×  📜";
    const iconsW = helv.widthOfTextAtSize(icons, 18);
    page.drawText(icons, {
      x: width - padX - iconsW, y: height - headerH / 2 - 6, size: 18, font: helv, color: rgb(1, 1, 1),
    });
    // Divider
    page.drawLine({
      start: { x: 24, y: height - headerH - 8 },
      end: { x: width - 24, y: height - headerH - 8 },
      thickness: 1,
      color: rgb(1, 1, 1),
    });
    // Title
    const hero = "artwork license agreement";
    const heroSize = 28;
    const heroW = helvBold.widthOfTextAtSize(hero, heroSize);
    page.drawText(hero, {
      x: (width - heroW) / 2,
      y: height - headerH - 48,
      size: heroSize,
      font: helvBold,
      color: rgb(1, 1, 1),
    });

    // Body terms
    const terms = lr.accepted_terms ?? lr.requested;
    const territory = Array.isArray(terms.territory) ? terms.territory.join(", ") : terms.territory;
    const fee = terms?.fee ? `${Number(terms.fee.amount).toLocaleString()} ${terms.fee.currency}` : "—";

    let y = height - headerH - 100;
    const lh = 16;
    const item = (label: string, value: string) => {
      page.drawText(label, { x: padX, y, size: 11, font: helv, color: rgb(0.85, 0.85, 0.85) });
      y -= lh;
      page.drawText(value, { x: padX, y, size: 12, font: helvBold, color: rgb(1, 1, 1) });
      y -= lh + 6;
    };
    item("Artwork", aTitle);
    item("Parties", `${oName} (Owner)  ↔  ${rName} (Licensee)`);
    item("Purpose", terms.purpose || "—");
    item("Term", `${terms.term_months} months`);
    item("Territory", territory || "—");
    item("Media", (terms.media || []).join(", ") || "—");
    item("Exclusivity", terms.exclusivity || "—");
    item("Fee", fee);
    if (terms.deliverables) item("Deliverables", terms.deliverables);
    if (terms.usage_notes) item("Notes", terms.usage_notes);
    page.drawText(`Request ${lr.id}`, { x: padX, y: 28, size: 9, font: helv, color: rgb(0.7, 0.7, 0.7) });

    const bytes = await pdf.save();

    // ---------- Ensure bucket exists (idempotent) ----------
    const bucket = "contracts";
    try {
      const { data: buckets } = await (supabase as any).storage.listBuckets();
      const exists = (buckets || []).some((b: any) => b.name === bucket);
      if (!exists) {
        await (supabase as any).storage.createBucket(bucket, {
          public: false,
          fileSizeLimit: 50 * 1024 * 1024,
        });
      }
    } catch (e) {
      console.warn("Bucket check/create failed (continuing):", e);
    }

    // ---------- Upload + sign ----------
    const path = `requests/${lr.id}/draft-${Date.now()}.pdf`;
    const up = await supabase.storage
      .from(bucket)
      .upload(path, new Blob([bytes], { type: "application/pdf" }), {
        upsert: true,
        contentType: "application/pdf",
      });
    if (up.error) return fail("Upload failed", 500, { detail: up.error.message });

    const signed = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    if (signed.error) return fail("Signed URL failed", 500, { detail: signed.error.message });

    return ok({ path, url: signed.data.signedUrl });
  } catch (err: any) {
    console.error("generate-contract-pdf crash:", err);
    return fail(err?.message || String(err), 500);
  }
});
