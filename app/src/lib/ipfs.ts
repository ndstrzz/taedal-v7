// app/src/lib/ipfs.ts

function getEnv(key: string): string | undefined {
  try {
    // @ts-ignore
    return (import.meta as any)?.env?.[key];
  } catch { return undefined; }
}

const WIN = (globalThis as any)?.window ?? {};
const CFG = WIN.__CONFIG__ ?? {};

type Gateway = { base: string, label: string };

function cleanBase(u: string) {
  return u.replace(/\/+$/,"");
}

function gateways(): Gateway[] {
  const list: string[] = [];

  // Highest priority: explicit env / runtime config
  if (CFG.PINATA_GATEWAY) list.push(CFG.PINATA_GATEWAY);
  if (getEnv("VITE_PINATA_GATEWAY")) list.push(getEnv("VITE_PINATA_GATEWAY")!);
  if (getEnv("VITE_PINATA_FALLBACK")) list.push(getEnv("VITE_PINATA_FALLBACK")!);

  // Your known custom subdomain (often best for CORS/rate limits)
  if (getEnv("VITE_MY_PINATA")) list.push(getEnv("VITE_MY_PINATA")!);

  // Last resorts
  list.push("https://cloudflare-ipfs.com");
  list.push("https://ipfs.io");
  list.push("https://gateway.pinata.cloud"); // keep last, often rate-limited/CORS

  // de-dup + clean
  const seen = new Set<string>();
  const out: Gateway[] = [];
  for (const raw of list) {
    if (!raw) continue;
    const base = cleanBase(raw);
    if (!seen.has(base)) {
      seen.add(base);
      out.push({ base, label: base });
    }
  }
  return out;
}

/** Build a gateway URL from ipfs://CID[/path] or bare CID. */
export function toGatewayURL(ipfsLike: string, fileNameHint?: string): string {
  const gws = gateways();
  const first = gws[0]?.base ?? "https://ipfs.io";

  const norm = (s: string) => s.replace(/^ipfs:\/\//, "").replace(/^ipfs\//, "");
  const body = norm(ipfsLike);

  // If already an http(s) URL, return as-is
  if (/^https?:\/\//i.test(ipfsLike)) {
    const url = new URL(ipfsLike);
    if (fileNameHint && !url.searchParams.has("filename")) {
      url.searchParams.set("filename", fileNameHint);
    }
    return url.toString();
  }

  // CID[/path]
  const url = new URL(`${first}/ipfs/${body}`);
  if (fileNameHint) url.searchParams.set("filename", fileNameHint);
  return url.toString();
}

async function quickExists(url: string): Promise<{ ok: boolean; ctype?: string }> {
  try {
    const r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } });
    const ctype = r.headers.get("content-type") ?? undefined;
    return { ok: r.ok || r.status === 206, ctype };
  } catch {
    return { ok: false };
  }
}

/** Try each gateway until one returns a likely GLB (or requested type). */
export async function resolveIpfsWithFailover(
  ipfsLike: string,
  fileNameHint?: string,
  wantStartsWith: string[] = ["model/gltf-binary", "application/octet-stream"]
): Promise<string | null> {
  const gws = gateways();
  const norm = (s: string) => s.replace(/^ipfs:\/\//, "").replace(/^ipfs\//, "");
  const body = /^https?:\/\//i.test(ipfsLike) ? ipfsLike : `${gws[0].base}/ipfs/${norm(ipfsLike)}`;

  // If already http(s) → test that first
  const firstUrl = toGatewayURL(ipfsLike, fileNameHint);
  const testList: string[] = [firstUrl];

  // Also assemble alternates using other gateways
  if (!/^https?:\/\//i.test(ipfsLike)) {
    for (let i = 1; i < gws.length; i++) {
      const alt = new URL(`${gws[i].base}/ipfs/${norm(ipfsLike)}`);
      if (fileNameHint) alt.searchParams.set("filename", fileNameHint);
      testList.push(alt.toString());
    }
  }

  for (const url of testList) {
    const res = await quickExists(url);
    if (!res.ok) continue;
    const c = (res.ctype || "").toLowerCase();
    if (wantStartsWith.some((p) => c.startsWith(p)) || c === "") {
      // some gateways don’t send ctype for range 0–0; accept it.
      return url;
    }
    // If gateway returned HTML/JSON, skip (likely error page / wrong asset)
  }
  return null;
}
