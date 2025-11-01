import { useEffect, useRef, useState } from "react";

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

  // Autoplay immediately (muted to satisfy policy), then unmute on first gesture
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    // Start muted to guarantee autoplay
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";

    // Try to play immediately (muted)
    v.play().catch(() => {});

    const onLoadedMeta = () => {
  try {
    const anyV = v as any;
    // consider multiple browser hints; none of these expressions are “nullish”
    const has =
      (typeof anyV.audioTracks?.length === "number" && anyV.audioTracks.length > 0) ||
      !!anyV.mozHasAudio ||
      (typeof anyV.webkitAudioDecodedByteCount === "number" && anyV.webkitAudioDecodedByteCount > 0);

    setHasAudio(has);
  } catch {
    setHasAudio(null);
  }
};

    v.addEventListener("loadedmetadata", onLoadedMeta);

    const onCanPlay = () => {
      setReady(true);
      if (v.paused) v.play().catch(() => {});
    };
    v.addEventListener("canplay", onCanPlay);

    // First interaction anywhere -> unmute + keep playing
    const unmuteOnce = async () => {
      try {
        v.muted = false;
        v.volume = 0.85;
        await v.play();
      } catch {}
      window.removeEventListener("pointerdown", unmuteOnce);
      window.removeEventListener("touchstart", unmuteOnce);
      window.removeEventListener("click", unmuteOnce);
      window.removeEventListener("keydown", unmuteOnce);
    };
    window.addEventListener("pointerdown", unmuteOnce, { once: true });
    window.addEventListener("touchstart", unmuteOnce, { once: true, passive: true });
    window.addEventListener("click", unmuteOnce, { once: true });
    window.addEventListener("keydown", unmuteOnce, { once: true });

    return () => {
      v.removeEventListener("loadedmetadata", onLoadedMeta);
      v.removeEventListener("canplay", onCanPlay);
      window.removeEventListener("pointerdown", unmuteOnce);
      window.removeEventListener("touchstart", unmuteOnce);
      window.removeEventListener("click", unmuteOnce);
      window.removeEventListener("keydown", unmuteOnce);
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
