import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-goog-api-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

type ProjectionTrend = "up" | "down" | "flat";

type AiEval = {
  estimated_value_low_usd: number;
  estimated_value_high_usd: number;
  confidence_0_1: number;
  momentum_score_0_100: number;
  skyrocket_potential: boolean;
  usco_recommendation: boolean;
  usco_reason: string;
  notes: string[];
  disclaimer: string;

  // NEW projection analytics
  projection_trend: ProjectionTrend;
  projected_change_pct_30d: number;
  projected_value_low_usd_30d: number;
  projected_value_high_usd_30d: number;
  growth_confidence_0_1: number;
  projection_narrative: string;
};

function safeJsonParse<T>(s: string): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1)) as T;
    throw new Error("Model did not return valid JSON.");
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Use POST" }), {
        status: 405,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";

    if (!GEMINI_API_KEY) {
      throw new Error("Missing GEMINI_API_KEY secret in Supabase Edge Functions → Secrets.");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in function env.");
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const artwork_id = body?.artwork_id as string | undefined;
    if (!artwork_id) throw new Error("Missing artwork_id in request body.");

    const { data: art, error: artErr } = await sb
      .from("artworks")
      .select("id,title,description,image_url,medium,year_created,type,width,height,dim_unit")
      .eq("id", artwork_id)
      .single();

    if (artErr) throw artErr;
    if (!art?.image_url) throw new Error("Artwork has no image_url.");

    const imgRes = await fetch(art.image_url);
    if (!imgRes.ok) throw new Error(`Failed to fetch image_url: ${imgRes.status}`);
    const mimeType = imgRes.headers.get("content-type") || "image/jpeg";
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    const b64 = encodeBase64(buf);

    const responseSchema = {
      type: "OBJECT",
      properties: {
        estimated_value_low_usd: { type: "NUMBER" },
        estimated_value_high_usd: { type: "NUMBER" },
        confidence_0_1: { type: "NUMBER" },
        momentum_score_0_100: { type: "NUMBER" },
        skyrocket_potential: { type: "BOOLEAN" },
        usco_recommendation: { type: "BOOLEAN" },
        usco_reason: { type: "STRING" },
        notes: { type: "ARRAY", items: { type: "STRING" } },
        disclaimer: { type: "STRING" },

        // NEW
        projection_trend: { type: "STRING" }, // "up" | "down" | "flat"
        projected_change_pct_30d: { type: "NUMBER" },
        projected_value_low_usd_30d: { type: "NUMBER" },
        projected_value_high_usd_30d: { type: "NUMBER" },
        growth_confidence_0_1: { type: "NUMBER" },
        projection_narrative: { type: "STRING" },
      },
      required: [
        "estimated_value_low_usd",
        "estimated_value_high_usd",
        "confidence_0_1",
        "momentum_score_0_100",
        "skyrocket_potential",
        "usco_recommendation",
        "usco_reason",
        "notes",
        "disclaimer",

        "projection_trend",
        "projected_change_pct_30d",
        "projected_value_low_usd_30d",
        "projected_value_high_usd_30d",
        "growth_confidence_0_1",
        "projection_narrative",
      ],
    };

    const prompt = `
You are assisting an art provenance platform. Given an artwork image + minimal metadata, return a speculative estimate and signals.

Rules:
- Output MUST be valid JSON matching the provided schema.
- Be conservative with confidence.
- Momentum score: 0..100.
- Values in USD; round reasonably.
- USCO recommendation: true only if it seems commercially meaningful / at risk / worth formal registration.
- Keep notes short (max ~5).
- Add a clear disclaimer.

Projection analytics requirements:
- projection_trend must be one of: "up", "down", "flat".
- projected_change_pct_30d is the % change expected in 30 days (can be negative).
- projected_value_low_usd_30d / projected_value_high_usd_30d should be consistent with the % change and uncertainty.
- growth_confidence_0_1 is how reliable the projection is (0..1). Be conservative.
- projection_narrative: 2-4 sentences explaining why.

Metadata:
- title: ${art.title ?? ""}
- description: ${art.description ?? ""}
- medium: ${art.medium ?? ""}
- year_created: ${art.year_created ?? ""}
- type: ${art.type ?? ""}
- size: ${art.width ?? ""} x ${art.height ?? ""} ${art.dim_unit ?? ""}
`.trim();

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    const gemRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }, { inlineData: { mimeType, data: b64 } }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema,
          temperature: 0.3,
        },
      }),
    });

    const gemJson = await gemRes.json().catch(() => null);
    if (!gemRes.ok) {
      const msg = gemJson?.error?.message || `Gemini API error (${gemRes.status})`;
      throw new Error(msg);
    }

    const text = gemJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text || typeof text !== "string") throw new Error("Model did not return text content.");

    const result = safeJsonParse<AiEval>(text);

    // Save into artworks table (ONLY columns you already have)
    const nowIso = new Date().toISOString();
    const momentumSignal = Math.max(0, Math.min(1, result.momentum_score_0_100 / 100));

    const { error: upErr } = await sb
      .from("artworks")
      .update({
        ai_value_low_usd: result.estimated_value_low_usd,
        ai_value_high_usd: result.estimated_value_high_usd,
        ai_confidence: result.confidence_0_1,

        ai_momentum_score: Math.round(result.momentum_score_0_100),
        ai_momentum_signal: momentumSignal,

        ai_is_skyrocket: result.skyrocket_potential,
        ai_usco_recommendation: result.usco_recommendation,

        ai_usco_reason: result.usco_reason,
        ai_usco_reason_text: result.usco_reason,

        ai_last_evaluated_at: nowIso,
      })
      .eq("id", artwork_id);

    if (upErr) throw upErr;

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }
});
