import "jsr:@supabase/functions-js/edge-runtime.d.ts";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-goog-api-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

type Msg = {
  role: "system" | "user" | "assistant";
  content?: string;
  text?: string;
};

type Body = {
  // your current frontend payload
  message?: string;
  image_b64?: string;
  image_mime?: string;

  // support older/alternate payloads too
  messages?: Msg[];
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

function messagesToText(messages: Msg[]) {
  return messages
    .map((m) => {
      const t = (m.content ?? m.text ?? "").trim();
      if (!t) return "";
      const who = m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : "User";
      return `${who}: ${t}`;
    })
    .filter(Boolean)
    .join("\n");
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

    const body = (await req.json().catch(() => ({}))) as Body;

    // Accept either `messages[]` or `message`
    const hasMessages = Array.isArray(body.messages) && body.messages.length > 0;
    const textFromMessages = hasMessages ? messagesToText(body.messages!) : "";
    const userText = (body.message || "").trim();

    const finalText = (textFromMessages || userText).trim();
    if (!finalText) {
      throw new Error("Missing message in request. Provide `message` or `messages[]`.");
    }

    const image_b64 = typeof body.image_b64 === "string" && body.image_b64.length > 0 ? body.image_b64 : undefined;
    const image_mime =
      (typeof body.image_mime === "string" && body.image_mime) || "image/jpeg";

    // Schema to force clean output
    const responseSchema = {
      type: "OBJECT",
      properties: {
        reply: { type: "STRING" },
      },
      required: ["reply"],
    };

    const system = `
You are 쿠로 (Kuro), the Taedal assistant inside an art provenance platform.

You help with:
- image critique / style analysis
- composition, lighting, color, values, edge control
- improvement tips (actionable, numbered)
- rough pricing advice ONLY if the user asks (include disclaimer)

Output rules:
- Reply in concise Markdown.
- If an image is provided: describe what you see briefly, then give critique + improvements.
- If no image is provided: answer based on the user's text only.
- Keep it practical and specific.
`.trim();

    const prompt = `${system}\n\nUser request:\n${finalText}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    const parts: any[] = [{ text: prompt }];
    if (image_b64) {
      parts.push({ inlineData: { mimeType: image_mime, data: image_b64 } });
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
          temperature: 0.35,
          maxOutputTokens: 900,
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

    const parsed = safeJsonParse<{ reply: string }>(text);
    const reply = (parsed.reply || "").trim();
    if (!reply) throw new Error("Empty reply from model.");

    return new Response(JSON.stringify({ ok: true, reply }), {
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
