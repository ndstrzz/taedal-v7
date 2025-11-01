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

  // Hard fallback to Pinata URL so prod never blocks on env/config
  return "https://plum-fascinating-armadillo-813.mypinata.cloud/ipfs/bafybeigtp5guwdkm52wrbapmijnlf2ezwb5mmrt7eur4cv4rghsvfik5jm";
}
/* ---------------------------------------------------- */

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string>(
    "https://plum-fascinating-armadillo-813.mypinata.cloud/ipfs/bafybeigtp5guwdkm52wrbapmijnlf2ezwb5mmrt7eur4cv4rghsvfik5jm"
  );
  const [ready, setReady] = useState(false);

  // Resolve final URL early (keeps __CONFIG__/env behavior)
  useEffect(() => {
    let alive = true;
    (async () => {
      const url = await resolveHomeVideoUrl();
      if (!alive) return;
      setSrc(url);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Autoplay immediately (muted to satisfy policy), then unmute on first gesture
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    v.muted = true;          // guarantees autoplay
    v.playsInline = true;
    v.autoplay = true;
    v.preload = "auto";      // fetch ASAP
    v.crossOrigin = "anonymous";

    // Kick off playback as soon as possible
    v.play().catch(() => { /* ignore; we'll retry after canplay */ });

    const onCanPlay = () => {
      setReady(true);
      if (v.paused) v.play().catch(() => {});
    };
    v.addEventListener("canplay", onCanPlay);

    // First interaction anywhere -> unmute + keep playing
    const unmuteOnce = async () => {
      try {
        v.muted = false;
        v.volume = 0.8;
        await v.play();
      } finally {
        window.removeEventListener("pointerdown", unmuteOnce);
        window.removeEventListener("touchstart", unmuteOnce);
        window.removeEventListener("keydown", unmuteOnce);
      }
    };
    window.addEventListener("pointerdown", unmuteOnce, { once: true });
    window.addEventListener("touchstart", unmuteOnce, { once: true });
    window.addEventListener("keydown", unmuteOnce, { once: true });

    return () => {
      v.removeEventListener("canplay", onCanPlay);
      window.removeEventListener("pointerdown", unmuteOnce);
      window.removeEventListener("touchstart", unmuteOnce);
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
          muted           /* starts instantly; we unmute on first interaction */
          preload="auto"
          crossOrigin="anonymous"
          poster="/images/taedal-poster.jpg"  /* optional: add this file for instant first paint */
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
      </section>
    </main>
  );
}
