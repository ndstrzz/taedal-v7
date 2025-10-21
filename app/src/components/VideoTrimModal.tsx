// app/src/components/VideoTrimModal.tsx
import { useEffect, useMemo, useRef, useState } from "react";

// deps: npm i @ffmpeg/ffmpeg @ffmpeg/util
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

/** Clone Uint8Array and wrap as Blob (keeps TS simple; no ArrayBuffer unions). */
function u8ToBlob(u8: Uint8Array, mime: string) {
  const copy = u8.slice(0);
  return new Blob([copy], { type: mime });
}

/** Try local /ffmpeg first, then CDN. Returns true if loaded. */
async function loadFfmpeg(ffmpeg: FFmpeg, logs: string[]) {
  const version = "0.12.4"; // safe tested version of @ffmpeg/core
  const localBase = `${import.meta.env.BASE_URL || "/"}ffmpeg`;

  // Helper to load with specific base
  const tryLoad = async (base: string) => {
    const coreJs = `${base}/ffmpeg-core.js`;
    const coreWasm = `${base}/ffmpeg-core.wasm`;
    const coreWorker = `${base}/ffmpeg-core.worker.js`;
    // Use blob URLs so COOP/COEP not required
    await ffmpeg.load({
      coreURL: await toBlobURL(coreJs, "text/javascript"),
      wasmURL: await toBlobURL(coreWasm, "application/wasm"),
      workerURL: await toBlobURL(coreWorker, "text/javascript"),
    });
  };

  // 1) Local self-hosted (public/ffmpeg/*)
  try {
    await tryLoad(localBase);
    logs.push("[ffmpeg] loaded from local /ffmpeg");
    return true;
  } catch (e) {
    logs.push("[ffmpeg] local load failed, falling back to CDN…");
  }

  // 2) CDN fallback (unpkg); you can swap to jsDelivr if you prefer
  const cdnBase = `https://unpkg.com/@ffmpeg/core@${version}/dist/esm`;
  try {
    await tryLoad(cdnBase);
    logs.push("[ffmpeg] loaded from CDN");
    return true;
  } catch (e) {
    logs.push("[ffmpeg] CDN load failed");
    return false;
  }
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

  // Load metadata for scrubbers
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

  // Rough output estimate for UX
  useEffect(() => {
    const secs = Math.max(0, end - start);
    const bitrateMbps = maxSize === "1080p" ? 2.0 : 1.0; // conservative
    const bytes = bitrateMbps * 125000 * secs; // Mbps -> bytes/sec
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    setEstText(`${secs.toFixed(1)}s • ~${mb} MB`);
  }, [start, end, maxSize]);

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
          "FFmpeg core failed to load (both local and CDN). Ensure /public/ffmpeg has ffmpeg-core.js/wasm/worker.js, or allow CDN."
        );
      }

      // Write input
      const data = await fetchFile(file); // Uint8Array
      await ffmpeg.writeFile("in", data);

      // Trim + scale
      const secs = Math.max(0, Math.min(end, duration) - Math.max(start, 0));
      const t = Math.max(0.1, secs);
      const outH = maxSize === "1080p" ? 1080 : 720;

      const args = [
        "-y",
        "-ss",
        `${start}`,
        "-i",
        "in",
        "-t",
        `${t}`,
        "-vf",
        `scale=-2:${outH}`,
        "-c:v",
        "libvpx-vp9",
        "-b:v",
        outH === 1080 ? "2000k" : "1000k",
        "-an",
        "-deadline",
        "good",
        "-cpu-used",
        "4",
        "out.webm",
      ];

      await ffmpeg.exec(args);

      const outU8 = (await ffmpeg.readFile("out.webm")) as unknown as Uint8Array;
      const blob = u8ToBlob(outU8, "video/webm");
      onDone(blob);
    } catch (e: any) {
      const last = logs.slice(-10).join("\n");
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
            <video
              ref={videoRef}
              src={blobUrl}
              className="w-full max-h-[50vh] object-contain"
              controls
            />
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
                    onChange={(e) =>
                      setStart(Math.min(Number(e.target.value), end - 0.1))
                    }
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
                    onChange={(e) =>
                      setEnd(Math.max(Number(e.target.value), start + 0.1))
                    }
                  />
                </label>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <label className="block">
                  <div className="text-sm mb-1">Max Size</div>
                  <select
                    className="input"
                    value={maxSize}
                    onChange={(e) => setMaxSize(e.target.value as any)}
                  >
                    <option value="720p">720p (faster, smaller)</option>
                    <option value="1080p">1080p (sharper)</option>
                  </select>
                </label>
                <div className="block">
                  <div className="text-sm mb-1">Clip length</div>
                  <div className="input">
                    {(Math.max(0, end - start)).toFixed(1)} s
                  </div>
                </div>
                <div className="block">
                  <div className="text-sm mb-1">Estimate</div>
                  <div className="input">{estText}</div>
                </div>
              </div>

              {err && (
                <pre className="text-amber-300 text-xs whitespace-pre-wrap">{err}</pre>
              )}

              <div className="flex items-center gap-2">
                <button className="btn" disabled={processing} onClick={processVideo}>
                  {processing ? "Processing…" : "Process & Use"}
                </button>
                <button className="btn bg-neutral-800" disabled={processing} onClick={onCancel}>
                  Cancel
                </button>
              </div>
              <p className="text-xs text-neutral-500">
                Output: WebM (VP9, muted). Optimized for autoplay & size.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
