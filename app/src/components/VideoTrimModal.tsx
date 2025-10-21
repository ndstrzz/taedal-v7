// app/src/components/VideoTrimModal.tsx
import { useEffect, useMemo, useRef, useState } from "react";

// Packages:
//   npm i @ffmpeg/ffmpeg @ffmpeg/util @ffmpeg/core
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

// IMPORTANT for Vite/ESBuild: tell ffmpeg where to load its core/worker/wasm
// The `?url` suffix makes Vite give you the final asset URL at runtime.
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import workerURL from "@ffmpeg/core/worker?url";

type Props = {
  file: File;
  aspect?: number; // for preview mask only; output size is chosen by dropdown
  defaultMaxSeconds?: number;
  defaultMaxSize?: "720p" | "1080p";
  onCancel(): void;
  onDone(blob: Blob): void; // returns processed video/webm
};

/** Clone Uint8Array and wrap as Blob (keeps types simple; no ArrayBuffer unions). */
function u8ToBlob(u8: Uint8Array, mime: string) {
  const copy = u8.slice(0);
  return new Blob([copy], { type: mime });
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

    // Collect logs so we can show meaningful error text
    const logs: string[] = [];
    try {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const ffmpeg: FFmpeg = new FFmpeg();

      // Enable log output and capture it
      ffmpeg.on("log", ({ message }) => {
        if (message) logs.push(message);
      });

      // Load core files explicitly so Vite can serve them
      await ffmpeg.load({ coreURL, wasmURL, workerURL });

      // Input → WASM FS
      const data = await fetchFile(file); // Uint8Array
      await ffmpeg.writeFile("in", data);

      // Trim + scale
      const secs = Math.max(0, Math.min(end, duration) - Math.max(start, 0));
      const t = Math.max(0.1, secs); // ensure >0
      const outH = maxSize === "1080p" ? 1080 : 720;

      // Keep it simple & reliable:
      // - `-ss` before `-i` for fast seek
      // - `-t` to bound length
      // - `scale=-2:HEIGHT` preserves aspect and sets even width
      // - VP9 in webm, no audio -> autoplay-friendly and smaller
      // - `-y` overwrite "out.webm" if it exists
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
      // Surface the last few ffmpeg lines for faster debugging
      const last = logs.slice(-6).join("\n");
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
                <pre className="text-amber-300 text-xs whitespace-pre-wrap">
                  {err}
                </pre>
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
