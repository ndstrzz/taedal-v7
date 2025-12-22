// C:\Users\User\Downloads\taedal-v7\app\src\lib\mediaEdit.ts

export type TrimResult =
  | { file: File; meta?: Record<string, any> }
  | { file: File; meta: Record<string, any>; warning: string };

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export async function cropImageToFile(opts: {
  file: File;
  cropPx: { x: number; y: number; w: number; h: number }; // source image pixels
  mime?: "image/png" | "image/jpeg";
  quality?: number; // jpeg quality 0..1
  fileName?: string;
}): Promise<File> {
  const { file, cropPx, mime, quality, fileName } = opts;

  const img = document.createElement("img");
  const url = URL.createObjectURL(file);

  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = url;
    });

    const sw = img.naturalWidth;
    const sh = img.naturalHeight;

    const x = clamp(Math.round(cropPx.x), 0, sw - 1);
    const y = clamp(Math.round(cropPx.y), 0, sh - 1);
    const w = clamp(Math.round(cropPx.w), 1, sw - x);
    const h = clamp(Math.round(cropPx.h), 1, sh - y);

    const outMime =
      mime ??
      (file.type === "image/jpeg" || file.type === "image/jpg"
        ? "image/jpeg"
        : "image/png");

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");

    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Failed to export crop"))),
        outMime,
        outMime === "image/jpeg" ? quality ?? 0.9 : undefined
      );
    });

    const name =
      fileName ??
      (file.name.replace(/\.[^/.]+$/, "") +
        (outMime === "image/jpeg" ? "-cropped.jpg" : "-cropped.png"));

    return new File([blob], name, { type: outMime, lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadVideoEl(file: File): Promise<HTMLVideoElement> {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "metadata";

  const url = URL.createObjectURL(file);
  v.src = url;

  await new Promise<void>((resolve, reject) => {
    v.onloadedmetadata = () => resolve();
    v.onerror = () => reject(new Error("Failed to load video metadata"));
  });

  (v as any).__objectUrl = url;
  return v;
}

/**
 * Best-effort browser trimming:
 * - Records the playback segment via captureStream + MediaRecorder -> usually WebM
 * - If unsupported, returns the original file + trim meta (so app can still send)
 */
export async function trimVideoToFile(opts: {
  file: File;
  startSec: number;
  endSec: number;
  fileName?: string;
}): Promise<TrimResult> {
  const { file, startSec, endSec, fileName } = opts;

  const v = await loadVideoEl(file);
  const objectUrl = (v as any).__objectUrl as string;

  try {
    const duration = v.duration || 0;
    const start = clamp(startSec, 0, Math.max(0, duration - 0.05));
    const end = clamp(endSec, start + 0.05, duration || start + 0.05);

    const canCapture = typeof (v as any).captureStream === "function";
    const canRecord = typeof (window as any).MediaRecorder !== "undefined";

    if (!canCapture || !canRecord) {
      return {
        file,
        meta: { trim: { start, end }, original: true },
        warning:
          "This browser can’t trim videos in-app. Sending original video and storing trim meta only.",
      };
    }

    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mime =
      candidates.find((m) => (window as any).MediaRecorder.isTypeSupported?.(m)) ??
      "";

    const stream = (v as any).captureStream();
    const chunks: BlobPart[] = [];

    const recorder = new (window as any).MediaRecorder(
      stream,
      mime ? { mimeType: mime } : undefined
    );

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const done = new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error("MediaRecorder error"));
      recorder.onstop = () =>
        resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
    });

    v.currentTime = start;

    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        v.removeEventListener("seeked", onSeeked);
        resolve();
      };
      v.addEventListener("seeked", onSeeked);
    });

    recorder.start(200);

    // frames only flow while playing
    await v.play().catch(() => {});

    await new Promise<void>((resolve) => {
      const tick = () => {
        if (v.currentTime >= end || v.ended) return resolve();
        requestAnimationFrame(tick);
      };
      tick();
    });

    try {
      v.pause();
    } catch {}

    recorder.stop();

    const blob = await done;
    const name = fileName ?? file.name.replace(/\.[^/.]+$/, "") + "-trimmed.webm";

    const outFile = new File([blob], name, {
      type: blob.type || "video/webm",
      lastModified: Date.now(),
    });

    return { file: outFile, meta: { trim: { start, end }, reencoded: true } };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
