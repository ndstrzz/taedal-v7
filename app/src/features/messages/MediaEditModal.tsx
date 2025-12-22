// C:\Users\User\Downloads\taedal-v7\app\src\components\dm\MediaEditModal.tsx

import React, { useEffect, useMemo, useRef, useState } from "react";
import { cropImageToFile, trimVideoToFile } from "../../lib/mediaEdit";

type Props = {
  open: boolean;
  file: File | null;
  onCancel: () => void;
  onConfirm: (result: { file: File; meta?: any; warning?: string }) => void;
};

function isImage(mime: string) {
  return mime.startsWith("image/");
}
function isVideo(mime: string) {
  return mime.startsWith("video/");
}

export default function MediaEditModal({ open, file, onCancel, onConfirm }: Props) {
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const url = useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    setWarning(null);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  if (!open || !file || !url) return null;

  const mime = file.type || "";

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/70" onClick={busy ? undefined : onCancel} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div>
              <div className="text-white font-semibold">Edit media</div>
              <div className="text-xs text-white/50">{file.name}</div>
            </div>
            <button
              className="px-3 py-2 rounded-xl bg-white/10 text-white hover:bg-white/15"
              onClick={busy ? undefined : onCancel}
            >
              Close
            </button>
          </div>

          <div className="p-5">
            {warning ? (
              <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-200 px-4 py-3 text-sm">
                {warning}
              </div>
            ) : null}

            {isImage(mime) ? (
              <ImageCropPanel
                url={url}
                file={file}
                busy={busy}
                setBusy={setBusy}
                setWarning={setWarning}
                onConfirm={onConfirm}
              />
            ) : isVideo(mime) ? (
              <VideoTrimPanel
                url={url}
                file={file}
                busy={busy}
                setBusy={setBusy}
                setWarning={setWarning}
                onConfirm={onConfirm}
              />
            ) : (
              <div className="text-white/70 text-sm">
                Unsupported file type: <span className="text-white">{mime || "unknown"}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Image Crop (Resizable) ---------------- */

type DragMode =
  | {
      type: "move";
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startBoxX: number;
      startBoxY: number;
    }
  | {
      type: "resize";
      handle: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startBox: { x: number; y: number; w: number; h: number };
    };

function ImageCropPanel(props: {
  url: string;
  file: File;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setWarning: (v: string | null) => void;
  onConfirm: (result: { file: File; meta?: any; warning?: string }) => void;
}) {
  const { url, file, busy, setBusy, onConfirm } = props;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const MIN_SIZE = 48;

  // crop box in WRAP-local coords (px)
  const [box, setBox] = useState({ x: 80, y: 60, w: 260, h: 260 });
  const [drag, setDrag] = useState<DragMode | null>(null);

  useEffect(() => {
    setBox({ x: 80, y: 60, w: 260, h: 260 });
    setDrag(null);
  }, [url]);

  function clampBox(next: typeof box) {
    const el = wrapRef.current;
    if (!el) return next;

    const r = el.getBoundingClientRect();
    const maxW = Math.max(1, r.width);
    const maxH = Math.max(1, r.height);

    const w = Math.max(MIN_SIZE, Math.min(next.w, maxW - 10));
    const h = Math.max(MIN_SIZE, Math.min(next.h, maxH - 10));
    const x = Math.max(5, Math.min(next.x, maxW - w - 5));
    const y = Math.max(5, Math.min(next.y, maxH - h - 5));
    return { x, y, w, h };
  }

  function startMove(e: React.PointerEvent) {
    if (busy) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    setDrag({
      type: "move",
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBoxX: box.x,
      startBoxY: box.y,
    });
  }

  function startResize(handle: DragMode extends { type: "resize" } ? never : any) {
    // this signature is just to keep TS happy below
  }

  function onResizeDown(handle: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw") {
    return (e: React.PointerEvent) => {
      if (busy) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}
      setDrag({
        type: "resize",
        handle,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startBox: { ...box },
      });
    };
  }

  function applyResize(
    start: { x: number; y: number; w: number; h: number },
    handle: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw",
    dx: number,
    dy: number
  ) {
    let x = start.x;
    let y = start.y;
    let w = start.w;
    let h = start.h;

    const right = start.x + start.w;
    const bottom = start.y + start.h;

    const affectsN = handle.includes("n") || handle === "n";
    const affectsS = handle.includes("s") || handle === "s";
    const affectsW = handle.includes("w") || handle === "w";
    const affectsE = handle.includes("e") || handle === "e";

    // Left edge moves: x changes, w changes (anchored on right)
    if (affectsW) {
      const newLeft = Math.min(right - MIN_SIZE, start.x + dx);
      x = newLeft;
      w = right - newLeft;
    }

    // Right edge moves: w changes
    if (affectsE) {
      const newRight = Math.max(x + MIN_SIZE, right + dx);
      w = newRight - x;
    }

    // Top edge moves: y changes, h changes (anchored on bottom)
    if (affectsN) {
      const newTop = Math.min(bottom - MIN_SIZE, start.y + dy);
      y = newTop;
      h = bottom - newTop;
    }

    // Bottom edge moves: h changes
    if (affectsS) {
      const newBottom = Math.max(y + MIN_SIZE, bottom + dy);
      h = newBottom - y;
    }

    return clampBox({ x, y, w, h });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    if (e.pointerId !== drag.pointerId) return;

    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;

    if (drag.type === "move") {
      setBox((b) => clampBox({ ...b, x: drag.startBoxX + dx, y: drag.startBoxY + dy }));
      return;
    }

    if (drag.type === "resize") {
      setBox(applyResize(drag.startBox, drag.handle, dx, dy));
      return;
    }
  }

  function endPointer(e: React.PointerEvent) {
    if (!drag) return;
    if (e.pointerId !== drag.pointerId) return;
    setDrag(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  }

  async function confirmCrop() {
    const img = imgRef.current;
    const wrap = wrapRef.current;
    if (!img || !wrap) return;

    setBusy(true);
    try {
      const wrapRect = wrap.getBoundingClientRect();
      const imgRect = img.getBoundingClientRect();

      const scaleX = img.naturalWidth / imgRect.width;
      const scaleY = img.naturalHeight / imgRect.height;

      // box.x/y are wrap-local coords.
      const cropLeft = box.x + wrapRect.left - imgRect.left;
      const cropTop = box.y + wrapRect.top - imgRect.top;

      const cropPx = {
        x: cropLeft * scaleX,
        y: cropTop * scaleY,
        w: box.w * scaleX,
        h: box.h * scaleY,
      };

      const out = await cropImageToFile({
        file,
        cropPx,
        mime: file.type === "image/jpeg" ? "image/jpeg" : "image/png",
        quality: 0.9,
      });

      onConfirm({
        file: out,
        meta: { crop: cropPx, originalName: file.name },
      });
    } finally {
      setBusy(false);
    }
  }

  const handleBase =
    "absolute rounded-full bg-white border border-black/40 shadow-md";
  const handleSize = 12;
  const sideHandleW = 10;
  const sideHandleH = 28;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">
      <div>
        <div
          ref={wrapRef}
          className="relative w-full aspect-video rounded-2xl overflow-hidden border border-white/10 bg-black touch-none"
        >
          <img
            ref={imgRef}
            src={url}
            alt="preview"
            className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
            draggable={false}
          />

          {/* Darken outside crop */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute bg-black/55" style={{ left: 0, top: 0, width: "100%", height: box.y }} />
            <div className="absolute bg-black/55" style={{ left: 0, top: box.y, width: box.x, height: box.h }} />
            <div
              className="absolute bg-black/55"
              style={{
                left: box.x + box.w,
                top: box.y,
                width: `calc(100% - ${box.x + box.w}px)`,
                height: box.h,
              }}
            />
            <div
              className="absolute bg-black/55"
              style={{
                left: 0,
                top: box.y + box.h,
                width: "100%",
                height: `calc(100% - ${box.y + box.h}px)`,
              }}
            />
          </div>

          {/* Crop box */}
          <div
            className="absolute border-2 border-white/90 rounded-xl"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          >
            {/* Move area */}
            <div
              className="absolute inset-0 cursor-grab active:cursor-grabbing"
              onPointerDown={startMove}
              title="Drag to move"
            />

            {/* Corner handles */}
            <div
              className={`${handleBase} cursor-nwse-resize`}
              style={{
                width: handleSize,
                height: handleSize,
                left: -handleSize / 2,
                top: -handleSize / 2,
              }}
              onPointerDown={onResizeDown("nw")}
              title="Resize"
            />
            <div
              className={`${handleBase} cursor-nesw-resize`}
              style={{
                width: handleSize,
                height: handleSize,
                right: -handleSize / 2,
                top: -handleSize / 2,
              }}
              onPointerDown={onResizeDown("ne")}
              title="Resize"
            />
            <div
              className={`${handleBase} cursor-nesw-resize`}
              style={{
                width: handleSize,
                height: handleSize,
                left: -handleSize / 2,
                bottom: -handleSize / 2,
              }}
              onPointerDown={onResizeDown("sw")}
              title="Resize"
            />
            <div
              className={`${handleBase} cursor-nwse-resize`}
              style={{
                width: handleSize,
                height: handleSize,
                right: -handleSize / 2,
                bottom: -handleSize / 2,
              }}
              onPointerDown={onResizeDown("se")}
              title="Resize"
            />

            {/* Side handles (bigger hit targets) */}
            <div
              className="absolute cursor-ew-resize"
              style={{
                left: -sideHandleW / 2,
                top: "50%",
                width: sideHandleW,
                height: sideHandleH,
                transform: "translateY(-50%)",
              }}
              onPointerDown={onResizeDown("w")}
              title="Resize"
            />
            <div
              className="absolute cursor-ew-resize"
              style={{
                right: -sideHandleW / 2,
                top: "50%",
                width: sideHandleW,
                height: sideHandleH,
                transform: "translateY(-50%)",
              }}
              onPointerDown={onResizeDown("e")}
              title="Resize"
            />
            <div
              className="absolute cursor-ns-resize"
              style={{
                top: -sideHandleW / 2,
                left: "50%",
                width: sideHandleH,
                height: sideHandleW,
                transform: "translateX(-50%)",
              }}
              onPointerDown={onResizeDown("n")}
              title="Resize"
            />
            <div
              className="absolute cursor-ns-resize"
              style={{
                bottom: -sideHandleW / 2,
                left: "50%",
                width: sideHandleH,
                height: sideHandleW,
                transform: "translateX(-50%)",
              }}
              onPointerDown={onResizeDown("s")}
              title="Resize"
            />

            {/* Label */}
            <div className="absolute -top-7 left-0 text-xs text-white/70 bg-black/40 px-2 py-1 rounded-lg pointer-events-none">
              Drag to move • Drag edges/corners to resize
            </div>
          </div>
        </div>

        <div className="mt-3 text-xs text-white/50">
          Tip: corners resize both directions; edges resize one direction.
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="text-white font-medium">Crop</div>

        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <label className="text-white/70">
            W
            <input
              type="number"
              className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-white"
              value={Math.round(box.w)}
              onChange={(e) => setBox((b) => clampBox({ ...b, w: Number(e.target.value) || b.w }))}
              disabled={busy}
            />
          </label>
          <label className="text-white/70">
            H
            <input
              type="number"
              className="mt-1 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-white"
              value={Math.round(box.h)}
              onChange={(e) => setBox((b) => clampBox({ ...b, h: Number(e.target.value) || b.h }))}
              disabled={busy}
            />
          </label>
        </div>

        <button
          className="mt-4 w-full rounded-xl bg-white text-black font-semibold py-2.5 hover:opacity-90 disabled:opacity-60"
          onClick={confirmCrop}
          disabled={busy}
        >
          {busy ? "Processing…" : "Use this crop"}
        </button>

        <button
          className="mt-2 w-full rounded-xl bg-white/10 text-white py-2.5 hover:bg-white/15 disabled:opacity-60"
          onClick={() => props.onConfirm({ file })}
          disabled={busy}
        >
          Skip crop (use original)
        </button>
      </div>
    </div>
  );
}

/* ---------------- Video Trim ---------------- */

function VideoTrimPanel(props: {
  url: string;
  file: File;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setWarning: (v: string | null) => void;
  onConfirm: (result: { file: File; meta?: any; warning?: string }) => void;
}) {
  const { url, file, busy, setBusy, setWarning, onConfirm } = props;

  const [duration, setDuration] = useState<number>(0);
  const [start, setStart] = useState<number>(0);
  const [end, setEnd] = useState<number>(0);

  useEffect(() => {
    setDuration(0);
    setStart(0);
    setEnd(0);
  }, [url]);

  function fmt(t: number) {
    if (!isFinite(t)) return "0:00";
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  async function confirmTrim() {
    setBusy(true);
    setWarning(null);

    try {
      const res = await trimVideoToFile({ file, startSec: start, endSec: end });
      if ("warning" in res && res.warning) setWarning(res.warning);
      onConfirm({ file: res.file, meta: res.meta, warning: (res as any).warning });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
      <div>
        <video
          src={url}
          className="w-full aspect-video rounded-2xl border border-white/10 bg-black"
          controls
          playsInline
          onLoadedMetadata={(e) => {
            const d = (e.currentTarget as HTMLVideoElement).duration || 0;
            setDuration(d);
            setStart(0);
            setEnd(d);
          }}
        />
        <div className="mt-3 text-xs text-white/50">
          Note: trimming exports WebM in most browsers.
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="text-white font-medium">Trim</div>

        <div className="mt-3 text-sm text-white/70">
          Start: <span className="text-white">{fmt(start)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0, duration)}
          step={0.1}
          value={start}
          onChange={(e) => setStart(Math.min(Number(e.target.value), end - 0.1))}
          disabled={busy || duration <= 0}
          className="w-full mt-2"
        />

        <div className="mt-3 text-sm text-white/70">
          End: <span className="text-white">{fmt(end)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0, duration)}
          step={0.1}
          value={end}
          onChange={(e) => setEnd(Math.max(Number(e.target.value), start + 0.1))}
          disabled={busy || duration <= 0}
          className="w-full mt-2"
        />

        <div className="mt-3 text-xs text-white/50">
          Output length: {fmt(Math.max(0, end - start))}
        </div>

        <button
          className="mt-4 w-full rounded-xl bg-white text-black font-semibold py-2.5 hover:opacity-90 disabled:opacity-60"
          onClick={confirmTrim}
          disabled={busy || duration <= 0}
        >
          {busy ? "Processing…" : "Use this trim"}
        </button>

        <button
          className="mt-2 w-full rounded-xl bg-white/10 text-white py-2.5 hover:bg-white/15 disabled:opacity-60"
          onClick={() => onConfirm({ file })}
          disabled={busy}
        >
          Skip trim (use original)
        </button>
      </div>
    </div>
  );
}
