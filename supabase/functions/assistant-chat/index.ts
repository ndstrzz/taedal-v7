// supabase/functions/assistant-chat/index.ts
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

function stripJsonFences(s: string) {
  const t = s.trim();
  // ```json ... ```
  if (t.startsWith("```")) {
    const firstNewline = t.indexOf("\n");
    const lastFence = t.lastIndexOf("```");
    if (firstNewline > 0 && lastFence > firstNewline) {
      return t.slice(firstNewline + 1, lastFence).trim();
    }
  }
  return t;
}

function safeJsonParse<T>(s: string): T {
  const cleaned = stripJsonFences(s);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // fallback: extract the biggest {...} block
    const a = cleaned.indexOf("{");
    const b = cleaned.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(cleaned.slice(a, b + 1)) as T;
    throw new Error("Model did not return valid JSON.");
  }
}

function messagesToText(messages: Msg[]) {
  return messages
    .map((m) => {
      const t = (m.content ?? m.text ?? "").trim();
      if (!t) return "";
      const who =
        m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : "User";
      return `${who}: ${t}`;
    })
    .filter(Boolean)
    .join("\n");
}

function looksLikeLicensingQuestion(text: string) {
  const t = text.toLowerCase();
  return (
    t.includes("license") ||
    t.includes("licensing") ||
    t.includes("contract") ||
    t.includes("agreement") ||
    t.includes("terms") ||
    t.includes("exclusive") ||
    t.includes("non-exclusive") ||
    t.includes("royalties") ||
    t.includes("indemn") ||
    t.includes("termination")
  );
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

    const body = (await req.json().catch(() => ({}))) as Body;

    // Accept either `messages[]` or `message`
    const hasMessages = Array.isArray(body.messages) && body.messages.length > 0;
    const textFromMessages = hasMessages ? messagesToText(body.messages!) : "";
    const userText = (body.message || "").trim();

    const finalText = (textFromMessages || userText).trim();
    if (!finalText) {
      throw new Error("Missing message in request. Provide `message` or `messages[]`.");
    }

    const image_b64 =
      typeof body.image_b64 === "string" && body.image_b64.length > 0
        ? body.image_b64
        : undefined;

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

    const baseSystem = `
You are 쿠로 (Kuro), the Taedal assistant inside an art provenance + licensing marketplace.

Core capabilities:
- image critique / style analysis
- composition, lighting, color, values, edge control
- improvement tips (actionable, numbered)
- licensing & contract guidance (educational only; not legal advice)

Safety & quality rules:
- Be practical and specific.
- Use concise Markdown.
- Never claim to be a lawyer. For legal topics, include: "This is not legal advice" + suggest consulting a qualified lawyer for high-stakes deals.
- Do not invent user data; if key deal facts are missing, ask 3–6 short clarifying questions.
`.trim();

    const licensingSystem = `
If the user asks about licensing/contracts:
- Provide a checklist of clauses (parties, scope, term, territory, media, exclusivity, fees/payment terms, attribution, approvals, prohibited uses, sublicensing, warranties/indemnities, limitation of liability, termination, dispute resolution, governing law, signatures).
- Call out risks and missing terms in plain language.
- Offer practical example wording (short, readable), but keep it general and educational.
- End with: "This is not legal advice."
`.trim();

    const system = looksLikeLicensingQuestion(finalText)
      ? `${baseSystem}\n\n${licensingSystem}`
      : baseSystem;

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
          maxOutputTokens: 1100,
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
