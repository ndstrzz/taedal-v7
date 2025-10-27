import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { DEFAULT_SIZES, toMetersWH, ArSize } from "../../lib/ar";

type Artwork = { id: string; title: string | null; image_url: string | null };

export default function ARPreview() {
  const { id } = useParams();
  const [art, setArt] = useState<Artwork | null>(null);
  const [sizes] = useState<ArSize[]>(DEFAULT_SIZES);
  const [size, setSize] = useState<ArSize>(DEFAULT_SIZES[1]); // default 60x90
  const [frame, setFrame] = useState<"none" | "black-thin" | "oak">("none");
  const [ios, setIos] = useState(false);

  // Custom element: keep as any for ergonomics
  const mvRef = useRef<any>(null);

  useEffect(() => {
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window));
  }, []);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const { data, error } = await supabase
        .from("artworks")
        .select("id, title, image_url")
        .eq("id", id)
        .single();
      if (!isMounted) return;
      if (!error) setArt(data as Artwork);
    })();
    return () => {
      isMounted = false;
    };
  }, [id]);

  const wmh = useMemo(() => toMetersWH(size.width_cm, size.height_cm), [size]);

  const onModelReady = async () => {
    const mv = mvRef.current as any;
    if (!mv) return;

    await mv.updateComplete;
    const scene = mv.model;
    if (!scene) return;

    const node = scene?.scene ?? scene;
    node.scale.set(wmh.w, wmh.h, 0.01);

    if (art?.image_url) {
      try {
        const tex = await mv.createTexture(art.image_url);
        const mat = scene.materials?.[0];
        if (mat && tex) {
          mat.pbrMetallicRoughness.setBaseColorTexture(tex);
          mat.pbrMetallicRoughness.setMetallicFactor(0.0);
          mat.pbrMetallicRoughness.setRoughnessFactor(0.9);
        }
      } catch {
        /* noop */
      }
    }
  };

  if (!art) {
    return (
      <div className="p-6 text-sm opacity-75">
        Loading AR preview…{" "}
        <Link to={`/art/${id}`} className="underline">
          Back
        </Link>
      </div>
    );
  }

  const markerUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ar-marker?artwork_id=${art.id}&size=${encodeURIComponent(
    size.label
  )}`;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link to={`/art/${id}`} className="text-sm opacity-70 hover:opacity-100 underline">
          ← Back to artwork
        </Link>
        <div className="text-sm opacity-50">AR Wall-Fit (MVP)</div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          {!ios && (
            <model-viewer
              ref={mvRef}
              src="/3d/plane-1m.glb"
              ar
              ar-modes="webxr scene-viewer"
              camera-controls
              exposure="0.9"
              environment-image="neutral"
              style={{ width: "100%", height: "70vh", background: "transparent" }}
              onLoad={onModelReady}
            ></model-viewer>
          )}

          {ios && (
            <div className="w-full h-[70vh] rounded-xl border border-white/10 bg-black/20 flex items-center justify-center relative overflow-hidden">
              <img
                src={art.image_url ?? ""}
                alt={art.title ?? "artwork"}
                className="max-h-full max-w-full object-contain opacity-90"
              />
              <div className="absolute bottom-3 left-3 text-xs px-2 py-1 rounded bg-black/60">
                {size.label} — true scale requires marker
              </div>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="p-3 rounded-xl border border-white/10 bg-black/20">
            <div className="text-sm mb-2 opacity-80">Select size</div>
            <div className="grid grid-cols-2 gap-2">
              {sizes.map((s) => (
                <button
                  key={s.label}
                  onClick={() => setSize(s)}
                  className={`text-sm px-3 py-2 rounded-lg border ${
                    size.label === s.label
                      ? "border-white/80 bg-white/5"
                      : "border-white/10 hover:border-white/30"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="text-sm mt-4 mb-2 opacity-80">Frame (preview)</div>
            <div className="grid grid-cols-3 gap-2">
              {["none", "black-thin", "oak"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFrame(f as any)}
                  className={`text-sm px-3 py-2 rounded-lg border ${
                    frame === f ? "border-white/80 bg-white/5" : "border-white/10 hover:border-white/30"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            <div className="mt-4 text-xs opacity-70">
              Tip: On iOS, download and tape the marker for true scale.
            </div>

            <div className="mt-3 flex flex-col gap-2">
              <a href={markerUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline">
                Download marker PDF
              </a>
              <Link
                to={`/checkout?artwork_id=${art.id}&size=${encodeURIComponent(size.label)}&frame=${frame}`}
                className="text-sm px-3 py-2 rounded-lg bg-white text-black text-center hover:opacity-90"
              >
                Buy this size
              </Link>
            </div>
          </div>

          <div className="text-xs opacity-60">
            This preview aims for true scale. Depending on device sensors, expect up to ±2% variance. Use the marker for
            accuracy.
          </div>
        </aside>
      </div>
    </div>
  );
}
