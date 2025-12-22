// C:\Users\User\Downloads\taedal-v7\app\src\lib\urls.ts

export function extractUrls(text: string): string[] {
  if (!text) return [];
  // Basic URL matcher; intentionally conservative
  const re = /\bhttps?:\/\/[^\s<>()"]+/gi;
  const hits = text.match(re) ?? [];
  // Normalize: strip trailing punctuation
  return hits
    .map((u) => u.replace(/[),.;!?]+$/g, ""))
    .filter((u) => isSafeHttpUrl(u));
}

export function isSafeHttpUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function shortHost(u: string): string {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return u;
  }
}
