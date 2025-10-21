// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

/* ---------- Supabase (service role) ---------- */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

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
type RequestRow = {
  id: string;
  artwork_id: string;
  requester_id: string;
  owner_id: string;
  requested: LicenseTerms;
  accepted_terms: LicenseTerms | null;
  status: string;
  created_at: string;
  updated_at: string;
};

/* ---------- helpers ---------- */
const asStr = (t: LicenseTerms["territory"]) => Array.isArray(t) ? t.join(", ") : (t ?? "");
const money = (f?: { amount: number; currency: string } | null) =>
  f ? `${f.amount?.toLocaleString()} ${f.currency}` : "—";

/** build a simple one-page PDF with the terms */
async function buildPdf(req: RequestRow) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US Letter
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // dark background
  page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.06, 0.06, 0.08) });

  const m = 54;
  let y = 740;
  const move = (dy: number) => (y -= dy);
  const draw = (text: string, opts: any = {}) => {
    page.drawText(text, { x: m, y, size: opts.size ?? 12, font: opts.font ?? font, color: rgb(1, 1, 1) });
    if (!opts.noAdvance) move(opts.advance ?? 18);
  };

  draw("Artwork License Agreement", { font: bold, size: 20, advance: 30 });

  const t = req.accepted_terms ?? req.requested;

  draw("1) Parties", { font: bold });
  draw(`Owner (Licensor): ${req.owner_id}`);
  draw(`Requester (Licensee): ${req.requester_id}`);
  move(6);

  draw("2) Scope", { font: bold });
  draw(`Purpose: ${t.purpose}`);
  draw(`Term: ${t.term_months} months`);
  draw(`Territory: ${asStr(t.territory)}`);
  draw(`Media: ${t.media.join(", ")}`);
  draw(`Exclusivity: ${t.exclusivity}`);
  draw(`Fee: ${money(t.fee)}`);
  if (t.start_date) draw(`Start date: ${t.start_date}`);
  if (t.deliverables) draw(`Deliverables: ${t.deliverables}`);
  if (t.credit_required != null) draw(`Credit required: ${t.credit_required ? "Yes" : "No"}`);
  if (t.usage_notes) draw(`Notes: ${t.usage_notes}`);
  if (t.sublicense != null) draw(`Sublicense: ${t.sublicense ? "Allowed" : "Not allowed"}`);
  if (t.derivative_edits?.length) draw(`Allowed edits: ${t.derivative_edits.join(", ")}`);
  move(6);

  draw("3) Standard Terms (short)", { font: bold });
  draw("• Licensee may use the Artwork only as described above.");
  draw("• No transfer of copyright; all rights reserved by Licensor.");
  draw("• No harmful/illegal use; no trademark use unless expressly stated.");
  draw("• Liability limited to the license fee paid.");
  draw("• Governed by Licensor’s locale unless otherwise agreed.");
  move(12);

  draw("Signatures (to be executed separately):", { font: bold });
  draw("Licensor: __________________________   Date: ___________", { noAdvance: true });
  page.drawText("Licensee: __________________________   Date: ___________", { x: m, y: y - 22, size: 12, font });

  return await doc.save();
}

/* ---------- CORS helpers ---------- */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

/* ---------- server ---------- */
Deno.serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const { request_id } = await req.json().catch(() => ({}));
    if (!request_id) return json({ error: "request_id required" }, 400);

    const { data, error } = await supabase
      .from("license_requests")
      .select("*")
      .eq("id", request_id)
      .single<RequestRow>();
    if (error || !data) return json({ error: error?.message || "Not found" }, 404);

    const pdfBytes = await buildPdf(data);
    const path = `requests/${request_id}/draft-${Date.now()}.pdf`;

    const { error: upErr } = await supabase
      .storage
      .from("contracts")
      .upload(path, new Blob([pdfBytes], { type: "application/pdf" }), { upsert: true });
    if (upErr) return json({ error: upErr.message }, 500);

    const { data: signed, error: signErr } =
      await supabase.storage.from("contracts").createSignedUrl(path, 60 * 60 * 24 * 7);
    if (signErr) return json({ error: signErr.message }, 500);

    return json({ path, url: signed?.signedUrl });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
