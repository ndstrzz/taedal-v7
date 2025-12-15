// supabase/functions/assistant-chat/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/** CORS */
function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-goog-api-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

type ChatResponse = {
  reply: string;
  suggestions: string[];
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
      throw new Error(
        "Missing GEMINI_API_KEY secret in Supabase Edge Functions → Secrets."
      );
    }

    const body = await req.json().catch(() => ({}));
    const message = (body?.message as string | undefined)?.trim();
    const imageBase64 = body?.image_base64 as string | undefined; // raw base64 (no data:)
    const mimeType = (body?.mime_type as string | undefined) || "image/jpeg";

    if (!message) throw new Error("Missing message in request body.");

    const responseSchema = {
      type: "OBJECT",
      properties: {
        reply: { type: "STRING" },
        suggestions: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["reply", "suggestions"],
    };

    const systemPrompt = `
You are "쿠로" — the Taedal Assistant inside an art provenance platform.

You help users:
- analyze an uploaded image (style, composition, issues)
- suggest improvements (concrete, actionable)
- give a *speculative* value/range if asked (NOT financial advice)

Rules:
- Output MUST be valid JSON matching the provided schema.
- Keep tone friendly, concise, helpful.
- If user asks “how much is this worth”, give a conservative range + explain assumptions briefly.
- End with 2-4 short next-step suggestions.
`.trim();

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    const parts: any[] = [{ text: `${systemPrompt}\n\nUser: ${message}` }];
    if (imageBase64) {
      parts.push({ inlineData: { mimeType, data: imageBase64 } });
    }

    const gemRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema,
          temperature: 0.4,
        },
      }),
    });

    const gemJson = await gemRes.json().catch(() => null);
    if (!gemRes.ok) {
      const msg = gemJson?.error?.message || `Gemini API error (${gemRes.status})`;
      throw new Error(msg);
    }

    const text = gemJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text || typeof text !== "string") {
      throw new Error("Model did not return text content.");
    }

    const parsed = safeJsonParse<ChatResponse>(text);

    return new Response(JSON.stringify({ ok: true, result: parsed }), {
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
