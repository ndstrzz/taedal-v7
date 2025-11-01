import { useEffect, useRef, useState } from "react";
import { ensureAutoplayWithSound } from "../../lib/mediaAutoplay";

/* ---------------- env/url resolution ---------------- */
function getEnv(key: string): string | undefined {
  try {
    // @ts-ignore
    return (import.meta as any)?.env?.[key];
  } catch {
    return undefined;
  }
}
async function urlExists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } });
    return r.ok || r.status === 206;
  } catch {
    return false;
  }
}
async function resolveHomeVideoUrl(): Promise<string> {
  const cfg = (globalThis as any)?.window?.__CONFIG__;
  if (cfg?.HOME_VIDEO_URL && (await urlExists(cfg.HOME_VIDEO_URL))) return cfg.HOME_VIDEO_URL;

  const envUrl = getEnv("VITE_HOME_VIDEO_URL");
  if (envUrl && (await urlExists(envUrl))) return envUrl;

  // Hard fallback to Pinata URL (your current file)
  return "https://plum-fascinating-armadillo-813.mypinata.cloud/ipfs/bafybeigtp5guwdkm52wrbapmijnlf2ezwb5mmrt7eur4cv4rghsvfik5jm";
}
/* ---------------------------------------------------- */

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string>(
    "https://plum-fascinating-armadillo-813.mypinata.cloud/ipfs/bafybeigtp5guwdkm52wrbapmijnlf2ezwb5mmrt7eur4cv4rghsvfik5jm"
  );
  const [ready, setReady] = useState(false);
  const [hasAudio, setHasAudio] = useState<boolean | null>(null);

  // Resolve final URL early (keeps __CONFIG__/env behavior)
  useEffect(() => {
    let alive = true;
    (async () => {
      const url = await resolveHomeVideoUrl();
      if (!alive) return;
      setSrc(url);
    })();
    return () => { alive = false; };
  }, []);

  // Autoplay immediately, try with sound; if blocked, play muted and bind one-tap unmute
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    v.playsInline = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    v.loop = true;

    ensureAutoplayWithSound(v, 0.9);

    const onLoadedMeta = () => {
      try {
        const anyV = v as any;
        const detected =
          (typeof anyV.audioTracks?.length === "number" && anyV.audioTracks.length > 0) ||
          !!anyV.mozHasAudio ||
          (typeof anyV.webkitAudioDecodedByteCount === "number" && anyV.webkitAudioDecodedByteCount > 0);
        setHasAudio(!!detected);
      } catch {
        setHasAudio(null);
      }
    };
    const onCanPlay = () => {
      setReady(true);
      if (v.paused) v.play().catch(() => {});
    };

    v.addEventListener("loadedmetadata", onLoadedMeta);
    v.addEventListener("canplay", onCanPlay);
    return () => {
      v.removeEventListener("loadedmetadata", onLoadedMeta);
      v.removeEventListener("canplay", onCanPlay);
    };
  }, [src]);

  return (
    <main className="min-h-[100svh]">
      <section className="relative h-[100svh] overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          src={src}
          autoPlay
          loop
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          poster="/images/taedal-poster.jpg"
          disablePictureInPicture
          controlsList="nodownload noremoteplayback"
        />

        {/* gradient & subtle dark overlay */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/55 via-black/30 to-black/55" />
        <div className="pointer-events-none absolute inset-0 z-10 bg-black/20 backdrop-blur-sm" />

        {/* center logo */}
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <img
            src="/images/taedal-home.svg"
            alt="taedal"
            draggable={false}
            className="w-[150px] sm:w-[150px] lg:w-[160px] xl:w-[180px] drop-shadow-[0_6px_40px_rgba(0,0,0,0.6)]"
          />
        </div>

        {/* small loading cue until canplay fires */}
        {!ready && (
          <div className="absolute bottom-8 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
            Loading…
          </div>
        )}

        {/* optional debug: no audio track detected */}
        {ready && hasAudio === false && (
          <div className="absolute bottom-8 right-8 z-30 rounded bg-black/60 px-3 py-1 text-[10px] text-white">
            No audio track in this video
          </div>
        )}
      </section>
    </main>
  );
}
