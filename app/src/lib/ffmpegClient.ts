// app/src/lib/ffmpegClient.ts
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

// Cache blob URLs so we don't refetch core files
const blobCache = new Map<string, string>();

async function toBlobCached(url: string, type: string): Promise<string> {
  const key = `${type}|${url}`;
  const cached = blobCache.get(key);
  if (cached) return cached;
  const blobUrl = await toBlobURL(url, type);
  blobCache.set(key, blobUrl);
  return blobUrl;
}

async function loadFromBase(ffmpeg: FFmpeg, base: string): Promise<void> {
  const coreJs = `${base}/ffmpeg-core.js`;
  const coreWasm = `${base}/ffmpeg-core.wasm`;
  const coreURL = await toBlobCached(coreJs, "text/javascript");
  const wasmURL = await toBlobCached(coreWasm, "application/wasm");
  // This build ships js+wasm only; no worker file needed
  await ffmpeg.load({ coreURL, wasmURL });
}

async function ensureLoadedInner(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;

  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const ffmpeg: FFmpeg = new FFmpeg();

  const version = "0.12.4";
  const localBase = `${import.meta.env.BASE_URL || "/"}ffmpeg`;
  const cdnBases = [
    `https://unpkg.com/@ffmpeg/core@${version}/dist/esm`,
    `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${version}/dist/esm`,
  ];

  try {
    await loadFromBase(ffmpeg, localBase);
  } catch {
    let ok = false;
    for (const base of cdnBases) {
      try {
        await loadFromBase(ffmpeg, base);
        ok = true;
        break;
      } catch {
        // keep trying next CDN
      }
    }
    if (!ok) {
      throw new Error("FFmpeg core failed to load from /ffmpeg and CDN.");
    }
  }

  ffmpegInstance = ffmpeg;
  return ffmpegInstance;
}

/** Get a ready-to-use FFmpeg instance (loads once and reuses). */
export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (!loadPromise) {
    loadPromise = ensureLoadedInner();
  }
  return loadPromise;
}

/** Warm FFmpeg in the background without changing the promise type. */
export function warmUpFFmpeg(): void {
  if (ffmpegInstance || loadPromise) return;
  loadPromise = ensureLoadedInner();
  // Don't change the promise type; just reset the handle if it fails.
  loadPromise.catch(() => {
    loadPromise = null;
  });
}
