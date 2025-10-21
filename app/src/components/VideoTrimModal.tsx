// app/src/components/VideoTrimModal.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

type Props = {
  file: File;
  aspect?: number; // preview mask only
  defaultMaxSeconds?: number;
  defaultMaxSize?: "720p" | "1080p";
  onCancel(): void;
  onDone(blob: Blob): void; // processed video/webm
};

/** Safe Uint8Array -> Blob */
function u8ToBlob(u8: Uint8Array, mime: string) {
  const copy = u8.slice(0);
  return new Blob([copy], { type: mime });
}

/** Load ffmpeg core (this build ships js+wasm only; no worker file). */
async function loadFromBase(ffmpeg: FFmpeg, base: string) {
  const coreJs = `${base}/ffmpeg-core.js`;
  const coreWasm = `${base}/ffmpeg-core.wasm`;
  const coreURL = await toBlobURL(coreJs, "text/javascript");
  const wasmURL = await toBlobURL(coreWasm, "application/wasm");
  await ffmpeg.load({ coreURL, wasmURL });
}

/** Try local /ffmpeg first, then CDNs. */
async function loadFfmpeg(ffmpeg: FFmpeg, logs: string[]) {
  const version = "0.12.4";
  const localBase = `${import.meta.env.BASE_URL || "/"}ffmpeg`;
  const cdnBases = [
    `https://unpkg.com/@ffmpeg/core@${version}/dist/esm`,
    `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${version}/dist/esm`,
  ];

  try {
    await loadFromBase(ffmpeg, localBase);
    logs.push("[ffmpeg] loaded from local /ffmpeg");
    return true;
  } catch {
    logs.push("[ffmpeg] local load failed, falling back to CDN…");
  }
  for (const base of cdnBases) {
    try {
      await loadFromBase(ffmpeg, base);
      logs.push(`[ffmpeg] loaded from CDN: ${base}`);
      return true;
    } catch {
      logs.push(`[ffmpeg] CDN load failed: ${base}`);
    }
  }
  return false;
}

export default function VideoTrimModal({
  file,
  aspect = 16 / 9,
  defaultMaxSeconds = 12,
  defaultMaxSize = "1080p",
  onCancel,
  onDone,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(defaultMaxSeconds);
  const [maxSize, setMaxSize] = useState<"720p" | "1080p">(defaultMaxSize);
  const [processing, setProcessing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [estText, setEstText] = useState<string>("");

  const blobUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(blobUrl), [blobUrl]);

  // load metadata
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoaded = () => {
      const d = v.duration || 0;
      setDuration(d);
      const capped = Math.min(defaultMaxSeconds, d || defaultMaxSeconds);
      setStart(0);
      setEnd(capped);
      setLoadingMeta(false);
    };
    v.addEventListener("loadedmetadata", onLoaded);
    return () => v.removeEventListener("loadedmetadata", onLoaded);
  }, [defaultMaxSeconds]);

  const prettyTime = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss.toString().padStart(2, "0")}`;
  };

  // estimate
  useEffect(() => {
    const secs = Math.max(0, end - start);
    const bitrateMbps = maxSize === "1080p" ? 2.0 : 1.0;
    const bytes = bitrateMbps * 125000 * secs;
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    setEstText(`${secs.toFixed(1)}s • ~${mb} MB`);
  }, [start, end, maxSize]);

  async function run(ffmpeg: FFmpeg, args: string[]) {
    await ffmpeg.exec(args);
    const outU8 = (await ffmpeg.readFile("out.webm")) as unknown as Uint8Array;
    if (!outU8 || outU8.length < 2048) {
      throw new Error("Output too small — likely no frames encoded.");
    }
    return outU8;
  }

  const processVideo = async () => {
    setProcessing(true);
    setErr(null);

    const logs: string[] = [];
    try {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const ffmpeg: FFmpeg = new FFmpeg();

      ffmpeg.on("log", ({ message }) => {
        if (message) logs.push(message);
      });

      const ok = await loadFfmpeg(ffmpeg, logs);
      if (!ok) {
        throw new Error(
          "FFmpeg core failed to load (both local and CDN). Ensure /public/ffmpeg has ffmpeg-core.js & ffmpeg-core.wasm, or allow CDN."
        );
      }

      // Give the input a proper extension so demuxer detection is reliable.
      const inputName = "input.mp4";
      const data = await fetchFile(file);
      await ffmpeg.writeFile(inputName, data);

      // Clamp times so we never exceed duration (common zero-frame cause).
      const safeStart = Math.max(0, Math.min(start, Math.max(0, duration - 0.05)));
      const safeEnd = Math.max(safeStart + 0.1, Math.min(end, duration - 0.001));
      const secs = Math.max(0.1, safeEnd - safeStart);

      // Prefer requested height, but we will downshift to 720 if OOM.
      const targetH = maxSize === "1080p" ? 1080 : 720;
      const fallbackH = 720;

      // Try a sequence of variants (seek style × codec × size) until one works.
      const variants: Array<{ desc: string; args: string[] }> = [
        {
          desc: "VP9, accurate seek, targetH",
          args: [
            "-y",
            "-i", inputName,
            "-ss", `${safeStart}`,
            "-t", `${secs}`,
            "-vf", `scale=-2:${targetH},pad=ceil(iw/2)*2:ceil(ih/2)*2`,
            "-r", "30",
            "-pix_fmt", "yuv420p",
            "-c:v", "libvpx-vp9",
            "-b:v", targetH === 1080 ? "2000k" : "1000k",
            "-row-mt", "1",
            "-deadline", "good",
            "-cpu-used", "4",
            "-an",
            "out.webm",
          ],
        },
        {
          desc: "VP9, keyframe seek, targetH",
          args: [
            "-y",
            "-ss", `${safeStart}`,
            "-i", inputName,
            "-t", `${secs}`,
            "-vf", `scale=-2:${targetH},pad=ceil(iw/2)*2:ceil(ih/2)*2`,
            "-r", "30",
            "-pix_fmt", "yuv420p",
            "-c:v", "libvpx-vp9",
            "-b:v", targetH === 1080 ? "2000k" : "1000k",
            "-row-mt", "1",
            "-deadline", "good",
            "-cpu-used", "4",
            "-an",
            "out.webm",
          ],
        },
        {
          desc: "VP8, accurate seek, targetH",
          args: [
            "-y",
            "-i", inputName,
            "-ss", `${safeStart}`,
            "-t", `${secs}`,
            "-vf", `scale=-2:${targetH},pad=ceil(iw/2)*2:ceil(ih/2)*2`,
            "-r", "30",
            "-pix_fmt", "yuv420p",
            "-c:v", "libvpx",
            "-b:v", targetH === 1080 ? "2000k" : "1000k",
            "-quality", "good",
            "-cpu-used", "4",
            "-an",
            "out.webm",
          ],
        },
        {
          desc: "VP8, accurate seek, fallbackH=720",
          args: [
            "-y",
            "-i", inputName,
            "-ss", `${safeStart}`,
            "-t", `${secs}`,
            "-vf", `scale=-2:${fallbackH},pad=ceil(iw/2)*2:ceil(ih/2)*2`,
            "-r", "30",
            "-pix_fmt", "yuv420p",
            "-c:v", "libvpx",
            "-b:v", "1000k",
            "-quality", "good",
            "-cpu-used", "4",
            "-an",
            "out.webm",
          ],
        },
      ];

      let out: Uint8Array | null = null;
      let lastErr: unknown = null;

      for (const v of variants) {
        try {
          try { await ffmpeg.deleteFile("out.webm"); } catch {}
          logs.push(`[ffmpeg] trying variant: ${v.desc}`);
          out = await run(ffmpeg, v.args);
          logs.push(`[ffmpeg] success with: ${v.desc}`);
          break;
        } catch (e) {
          lastErr = e;
          logs.push(`[ffmpeg] variant failed (${v.desc}): ${e instanceof Error ? e.message : String(e)}`);
          // If memory OOB happened, immediately drop to the 720p VP8 variant next.
        }
      }

      if (!out) {
        throw lastErr || new Error("All encoding variants failed.");
      }

      onDone(u8ToBlob(out, "video/webm"));
    } catch (e: any) {
      const last = logs.slice(-40).join("\n");
      const msg = e?.message || "Failed to process video";
      setErr(last ? `${msg}\n\n${last}` : msg);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4 bg-black/60">
      <div className="w-full max-w-3xl rounded-2xl border border-neutral-800 bg-neutral-900">
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
          <h3 className="font-semibold">Trim & Resize Cover Video</h3>
          <button className="btn" onClick={onCancel} disabled={processing}>
            Close
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="relative rounded-lg overflow-hidden bg-black">
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ boxShadow: "inset 0 0 0 9999px rgba(0,0,0,0.15)" }}
            />
            <video ref={videoRef} src={blobUrl} className="w-full max-h-[50vh] object-contain" controls />
          </div>

          {loadingMeta ? (
            <div className="text-sm text-neutral-400">Loading video metadata…</div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-sm mb-1">Start: {prettyTime(start)}</div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, duration - 0.1)}
                    step={0.1}
                    className="w-full"
                    value={start}
                    onChange={(e) => setStart(Math.min(Number(e.target.value), end - 0.1))}
                  />
                </label>
                <label className="block">
                  <div className="text-sm mb-1">End: {prettyTime(end)}</div>
                  <input
                    type="range"
                    min={0.1}
                    max={duration}
                    step={0.1}
                    className="w-full"
                    value={end}
                    onChange={(e) => setEnd(Math.max(Number(e.target.value), start + 0.1))}
                  />
                </label>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <label className="block">
                  <div className="text-sm mb-1">Max Size</div>
                  <select className="input" value={maxSize} onChange={(e) => setMaxSize(e.target.value as any)}>
                    <option value="720p">720p (faster, smaller)</option>
                    <option value="1080p">1080p (sharper)</option>
                  </select>
                </label>
                <div className="block">
                  <div className="text-sm mb-1">Clip length</div>
                  <div className="input">{(Math.max(0, end - start)).toFixed(1)} s</div>
                </div>
                <div className="block">
                  <div className="text-sm mb-1">Estimate</div>
                  <div className="input">{estText}</div>
                </div>
              </div>

              {err && <pre className="text-amber-300 text-xs whitespace-pre-wrap">{err}</pre>}

              <div className="flex items-center gap-2">
                <button className="btn" disabled={processing} onClick={processVideo}>
                  {processing ? "Processing…" : "Process & Use"}
                </button>
                <button className="btn bg-neutral-800" disabled={processing} onClick={onCancel}>
                  Cancel
                </button>
              </div>
              <p className="text-xs text-neutral-500">Output: WebM (VP9/VP8, muted). Optimized for autoplay & size.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
