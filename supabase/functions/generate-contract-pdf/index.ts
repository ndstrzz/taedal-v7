// supabase/functions/generate-contract-pdf/index.ts
// deno.json should include: { "imports": { "pdf-lib": "https://esm.sh/pdf-lib@1.17.1" } }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type LicenseTerms = {
  purpose: string;
  term_months: number;
  territory: string | string[];
  media: string[];
  exclusivity: "exclusive" | "non-exclusive" | "category-exclusive";
  start_date?: string;
  deliverables?: string;
  credit_required?: boolean;
  usage_notes?: string;
  fee?: { amount: number; currency: string };
  sublicense?: boolean;
  derivative_edits?: string[];
};

Deno.serve(async (req) => {
  try {
    const auth = req.headers.get("Authorization")!;
    const { request_id } = await req.json();

    if (!auth || !request_id) {
      return new Response(JSON.stringify({ error: "Missing auth or request_id" }), { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // needs RLS bypass for reads+writes
      { global: { headers: { Authorization: auth } } }
    );

    // Load request + parties + artwork
    const { data: reqRow, error: e1 } = await supabase
      .from("license_requests")
      .select("*, requester:profiles!license_requests_requester_id_fkey(id,display_name,username), owner:profiles!license_requests_owner_id_fkey(id,display_name,username), artwork:artworks(id,title,image_url)")
      .eq("id", request_id)
      .maybeSingle();
    if (e1) throw e1;
    if (!reqRow) throw new Error("Request not found");

    const t: LicenseTerms = reqRow.requested;
    const requesterName = reqRow.requester?.display_name || reqRow.requester?.username || reqRow.requester?.id;
    const ownerName = reqRow.owner?.display_name || reqRow.owner?.username || reqRow.owner?.id;
    const artTitle = reqRow.artwork?.title || "Untitled";

    // Build PDF
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]); // A4 portrait
    const { width } = page.getSize();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let y = 800;
    const draw = (text: string, size = 11, f = font, color = rgb(1, 1, 1)) => {
      page.drawText(text, { x: 40, y, size, font: f, color });
      y -= size + 8;
    };
    const drawH = (text: string) => { draw(text, 16, bold); y -= 4; };
    const line = () => { page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 0.5, color: rgb(1,1,1) }); y -= 12; };

    // Header
    drawH("Artwork License Agreement");
    draw(`Artwork: ${artTitle}`);
    draw(`Parties: ${ownerName} (Licensor)  ↔  ${requesterName} (Licensee)`);
    draw(`Date: ${new Date().toLocaleDateString()}`);
    line();

    // Core terms
    drawH("Scope of Rights");
    draw(`Purpose: ${t.purpose}`);
    draw(`Media: ${(t.media || []).join(", ")}`);
    draw(`Territory: ${Array.isArray(t.territory) ? t.territory.join(", ") : t.territory}`);
    draw(`Exclusivity: ${t.exclusivity}`);
    draw(`Term: ${t.term_months} months${t.start_date ? `, start ${t.start_date}` : ""}`);
    draw(`Credit required: ${t.credit_required ? "Yes" : "No"}`);
    if (t.deliverables) draw(`Deliverables: ${t.deliverables}`);
    if (t.usage_notes) draw(`Usage notes: ${t.usage_notes}`);
    if (t.sublicense !== undefined) draw(`Sublicensing: ${t.sublicense ? "Allowed" : "Not allowed"}`);
    if (t.derivative_edits) draw(`Allowed edits: ${t.derivative_edits.join(", ")}`);
    if (t.fee) draw(`Fee: ${t.fee.amount.toLocaleString()} ${t.fee.currency}`);
    line();

    drawH("Standard Clauses");
    const clauses = [
      "Licensor represents they own or control the rights to the Artwork.",
      "Licensee shall not use the Artwork in unlawful, hateful, or defamatory contexts.",
      "No AI training, dataset inclusion, or biometric/face data extraction unless explicitly permitted.",
      "Indemnities are mutual and limited to direct damages capped at the fee paid under this Agreement.",
      "Either party may terminate for breach with 10 days to cure.",
      "Governing Law and venue as mutually agreed; disputes via good-faith negotiation first."
    ];
    clauses.forEach(c => draw("• " + c));

    line();
    drawH("Signatures");
    draw("Licensor: ____________________________   Date: __________");
    draw("Licensee: ____________________________   Date: __________");
    y -= 10;
    draw("(Sign in-app or print, sign, and upload the executed PDF.)", 10, font, rgb(0.9,0.9,0.9));

    const bytes = await pdf.save();

    // Upload to storage
    const path = `requests/${request_id}/draft.pdf`;
    const { error: e2 } = await supabase.storage.from("contracts").upload(path, bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (e2) throw e2;

    const { data: pub } = await supabase.storage.from("contracts").createSignedUrl(path, 60 * 60 * 24); // 24h link
    return new Response(JSON.stringify({ path, url: pub?.signedUrl }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
