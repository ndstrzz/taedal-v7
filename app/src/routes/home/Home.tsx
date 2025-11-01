import { useEffect, useRef, useState } from "react";

/* ---------------- env/url resolution (same pattern as AR) ---------------- */
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
  return "/images/home-video.mp4";
}
/* ------------------------------------------------------------------------ */

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState("/images/home-video.mp4");
  const [needsUserGesture, setNeedsUserGesture] = useState(false);

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

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tryPlay = async () => {
      try {
        v.muted = false;      // we always want sound
        v.volume = 0.7;
        await v.play();       // may throw if autoplay w/ sound is blocked
        setNeedsUserGesture(false);
      } catch {
        // fall back: wait for a tap
        v.muted = true;       // allow muted motion until user taps
        try {
          await v.play();
        } catch {}
        setNeedsUserGesture(true);
      }
    };
    tryPlay();
  }, [src]);

  const enableSound = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.muted = false;
      v.volume = 0.7;
      await v.play();
      setNeedsUserGesture(false);
    } catch {
      // show native controls as last resort
      v.setAttribute("controls", "true");
    }
  };

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

        {/* one-time enable button ONLY if the browser blocked sound */}
        {needsUserGesture && (
          <div className="absolute inset-0 z-30 flex items-center justify-center">
            <button
              onClick={enableSound}
              className="rounded-2xl bg-white/90 px-4 py-2 text-sm text-black ring-1 ring-black/10 hover:bg-white"
            >
              Enable sound
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
