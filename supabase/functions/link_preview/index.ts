// supabase/functions/link_preview/index.ts
// Deploy as Supabase Edge Function: link_preview
// Returns: { url, finalUrl, title, description, image, siteName, favicon }

function pickMeta(html: string, prop: string): string | null {
  // Handles: <meta property="og:title" content="..."> and <meta name="description" content="...">
  const re = new RegExp(
    `<meta\\s+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const m = html.match(re);
  return m?.[1] ?? null;
}

function pickLinkRel(html: string, rel: string): string | null {
  const re = new RegExp(
    `<link\\s+[^>]*rel=["'][^"']*${rel}[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const m = html.match(re);
  return m?.[1] ?? null;
}

function absolutize(base: string, maybe: string | null): string | null {
  if (!maybe) return null;
  try {
    return new URL(maybe, base).toString();
  } catch {
    return maybe;
  }
}

Deno.serve(async (req) => {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "Missing url" }), { status: 400 });
    }

    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return new Response(JSON.stringify({ error: "Invalid protocol" }), { status: 400 });
    }

    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        // Some sites require a UA
        "user-agent": "taedal-link-preview/1.0",
        accept: "text/html,application/xhtml+xml",
      },
    });

    const finalUrl = res.url || url;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) {
      return new Response(
        JSON.stringify({ url, finalUrl, siteName: new URL(finalUrl).host }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    const html = await res.text();

    const title =
      pickMeta(html, "og:title") ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ||
      null;

    const description =
      pickMeta(html, "og:description") ||
      pickMeta(html, "description") ||
      null;

    const image = absolutize(finalUrl, pickMeta(html, "og:image"));
    const siteName = pickMeta(html, "og:site_name") || new URL(finalUrl).host;

    const favicon =
      absolutize(finalUrl, pickLinkRel(html, "icon")) ||
      absolutize(finalUrl, "/favicon.ico");

    const out = { url, finalUrl, title, description, image, siteName, favicon };

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
});
