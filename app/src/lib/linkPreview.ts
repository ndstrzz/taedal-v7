// C:\Users\User\Downloads\taedal-v7\app\src\lib\linkPreview.ts

import { supabase } from "./supabase";

export type LinkPreview = {
  url: string;
  finalUrl?: string | null;

  title?: string | null;
  description?: string | null;
  siteName?: string | null;

  image?: string | null;   // og:image / oEmbed thumbnail_url
  favicon?: string | null; // best effort

  fetchedAt?: string | null;
};

const memCache = new Map<string, { at: number; v: LinkPreview }>();
const TTL_MS = 5 * 60 * 1000; // 5 min

function norm(u: string) {
  return (u || "").trim();
}

export async function getLinkPreview(url: string): Promise<LinkPreview> {
  const u = norm(url);
  if (!u) throw new Error("Missing url");

  const now = Date.now();
  const hit = memCache.get(u);
  if (hit && now - hit.at < TTL_MS) return hit.v;

  const { data, error } = await supabase.functions.invoke("link-preview", {
    body: { url: u },
  });

  if (error) {
    // fallback: return minimal preview so UI can still render a card
    const v: LinkPreview = { url: u, finalUrl: u, siteName: safeHost(u), fetchedAt: new Date().toISOString() };
    memCache.set(u, { at: now, v });
    return v;
  }

  const v = (data || {}) as LinkPreview;
  if (!v.url) v.url = u;
  if (!v.finalUrl) v.finalUrl = v.url;

  memCache.set(u, { at: now, v });
  return v;
}

function safeHost(u: string) {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
