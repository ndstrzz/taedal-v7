// supabase/functions/ar-marker/index.ts
// Deno deploy target
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

serve(async (req: Request) => {
  try {
    const { searchParams } = new URL(req.url);
    const artworkId = searchParams.get("artwork_id") ?? "unknown";
    const size = searchParams.get("size") ?? "60x90cm";
    // A4 points: 595 x 842 at 72dpi
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const { width, height } = page.getSize();

    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const title = `Taedal AR Marker — ${size}`;
    page.drawText(title, { x: 40, y: height - 60, size: 18, font, color: rgb(0,0,0) });

    // 100mm scale bar (at 72dpi, 1 inch=72pt. 100mm = 3.937in = 283.46pt)
    const barLen = 283.46;
    const barX = 40, barY = height - 120;
    page.drawText("This bar must measure exactly 100 mm (10 cm)", { x: barX, y: barY + 20, size: 10, font });
    page.drawRectangle({ x: barX, y: barY, width: barLen, height: 8, color: rgb(0,0,0) });

    // 4-inch bar for US reference (288pt)
    const bar4in = 288;
    const bar2Y = barY - 40;
    page.drawText("This bar must measure exactly 4 inches", { x: barX, y: bar2Y + 20, size: 10, font });
    page.drawRectangle({ x: barX, y: bar2Y, width: bar4in, height: 8, color: rgb(0,0,0) });

    // Simple instructions
    const body = [
      "1) Print this page at 100% scale (no fit-to-page).",
      "2) Tape the page to your wall at the target spot.",
      "3) Open the AR preview and choose 'Marker' mode for true scale.",
      `Artwork: ${artworkId} — Size: ${size}`,
    ];
    body.forEach((line, i) => {
      page.drawText(line, { x: 40, y: bar2Y - 80 - (i * 14), size: 11, font });
    });

    const bytes = await pdf.save();
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="taedal-ar-marker-${size}.pdf"`,
      },
    });
  } catch (e) {
    return new Response(`Error: ${e?.message ?? e}`, { status: 500 });
  }
});
