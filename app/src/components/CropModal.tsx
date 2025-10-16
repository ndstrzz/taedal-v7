import { useEffect, useMemo, useState } from "react";
import Cropper from "react-easy-crop";
// IMPORTANT: include the cropper styles
import "react-easy-crop/react-easy-crop.css";

type Props = {
  file: File;
  aspect: number;                 // 1 for avatar, 16/5 for cover, etc.
  title?: string;
  onCancel: () => void;
  onDone: (blob: Blob) => void;   // returns cropped JPEG blob
};

// Convert a File to a data URL (robust across browsers)
async function fileToDataURL(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function cropToBlob(
  image: HTMLImageElement,
  areaPx: { x: number; y: number; width: number; height: number }
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width  = Math.round(areaPx.width);
  canvas.height = Math.round(areaPx.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    image,
    areaPx.x,
    areaPx.y,
    areaPx.width,
    areaPx.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.95)
  );
}

export default function CropModal({ file, aspect, title = "Crop image", onCancel, onDone }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // cropper state
  const [zoom, setZoom] = useState(1);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [areaPx, setAreaPx] =
    useState<{ width: number; height: number; x: number; y: number } | null>(null);

  // produce a data URL for the cropper
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadError(null);
        const dataUrl = await fileToDataURL(file);
        if (alive) setSrc(dataUrl);
      } catch (e: any) {
        if (alive) setLoadError(e?.message || "Failed to read image file.");
      }
    })();
    return () => { alive = false; };
  }, [file]);

  const confirm = async () => {
    if (!src || !areaPx) return;
    // Ensure the image has fully decoded before cropping
    const img = document.createElement("img");
    img.src = src;
    try {
      await (img.decode ? img.decode() : new Promise((r) => (img.onload = r)));
    } catch {
      // fallback if decode fails
      await new Promise((r) => (img.onload = r));
    }
    const blob = await cropToBlob(img, areaPx);
    onDone(blob);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4">
      <div className="w-full max-w-2xl bg-neutral-900 rounded-lg border border-neutral-700 overflow-hidden">
        <div className="p-3 border-b border-neutral-700 flex items-center justify-between">
          <h3 className="font-semibold">{title}</h3>
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>

        <div className="relative h-[60vh] bg-black">
          {loadError ? (
            <div className="h-full grid place-items-center text-sm text-red-300 px-4 text-center">
              {loadError} — try a PNG/JPG image.
            </div>
          ) : src ? (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, px) => setAreaPx(px)}
              objectFit="contain"
              // Optional: nicer cursor on dark bg
              classes={{ containerClassName: "bg-black" }}
            />
          ) : (
            <div className="h-full grid place-items-center text-neutral-400 text-sm">
              Loading image…
            </div>
          )}
        </div>

        <div className="p-3 flex items-center gap-3 border-t border-neutral-700">
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full"
          />
          <button className="btn" onClick={confirm} disabled={!src || !areaPx}>
            Use crop
          </button>
        </div>
      </div>
    </div>
  );
}
