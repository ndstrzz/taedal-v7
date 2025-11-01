// app/src/routes/home/Home.tsx
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

  // Pinata hard fallback
  return "https://plum-fascinating-armadillo-813.mypinata.cloud/ipfs/bafybeigtp5guwdkm52wrbapmijnlf2ezwb5mmrt7eur4cv4rghsvfik5jm";
}

/* -------------------- page-scope media helpers -------------------- */
function pauseOtherMediaExcept(keep: HTMLMediaElement | null) {
  const nodes = Array.from(document.querySelectorAll("video, audio")) as HTMLMediaElement[];
  nodes.forEach((m) => {
    if (!keep || m !== keep) {
      try {
        m.pause();
        // keep their currentTime; just ensure they don't keep playing audio
        m.muted = true;
      } catch {}
    }
  });
}

/** Simple retry with cache-busting to avoid decoder/network hiccups */
async function retryReloadVideo(
  v: HTMLVideoElement,
  baseSrc: string,
  attempt: number,
  maxAttempts: number
) {
  if (attempt > maxAttempts) return;

  const cacheBusted = baseSrc.includes("?") ? `${baseSrc}&r=${Date.now()}` : `${baseSrc}?r=${Date.now()}`;

  try {
    v.pause();
    v.src = cacheBusted;
    // Force a reload of metadata -> canplay chain
    v.load();

    // Give the browser a moment to wire up
    await new Promise((r) => setTimeout(r, 100));

    await ensureAutoplayWithSound(v, 0.9);
  } catch {
    /* ignore */
  }
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
    return () => {
      alive = false;
    };
  }, []);

  // Autoplay + sound, loop, robustness, and "pause others"
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    // Make sure other pages' media stop
    pauseOtherMediaExcept(v);

    v.playsInline = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    v.loop = true;
    v.disablePictureInPicture = true;
    try {
      v.setAttribute("controlsList", "nodownload noremoteplayback");
    } catch {}

    let stalledTimer: number | null = null;
    let lastTime = 0;
    let retryCount = 0;
    const RETRY_MAX = 3;

    const clearStallTimer = () => {
      if (stalledTimer) {
        window.clearTimeout(stalledTimer);
        stalledTimer = null;
      }
    };

    const armStallWatch = () => {
      clearStallTimer();
      // If playback position doesn't change for 6s while not paused, try a soft reload
      stalledTimer = window.setTimeout(async () => {
        if (!v.paused) {
          const cur = v.currentTime || 0;
          if (Math.abs(cur - lastTime) < 0.05 && retryCount < RETRY_MAX) {
            retryCount += 1;
            await retryReloadVideo(v, src, retryCount, RETRY_MAX);
          }
          lastTime = cur;
        }
        armStallWatch();
      }, 6000);
    };

    const startPlayback = async () => {
      await ensureAutoplayWithSound(v, 0.9);
      // If muted due to policy, ensure one-gesture unmute is bound by the helper
      // (already handled inside ensureAutoplayWithSound)
    };

    const onLoadedMeta = () => {
      try {
        const anyV = v as any;
        const detected =
          (typeof anyV.audioTracks?.length === "number" && anyV.audioTracks.length > 0) ||
          !!anyV.mozHasAudio ||
          (typeof anyV.webkitAudioDecodedByteCount === "number" &&
            anyV.webkitAudioDecodedByteCount > 0);
        setHasAudio(!!detected);
      } catch {
        setHasAudio(null);
      }
    };

    const onCanPlay = async () => {
      setReady(true);
      try {
        if (v.paused) await v.play();
      } catch {}
      lastTime = v.currentTime || 0;
      armStallWatch();
    };

    const onTimeUpdate = () => {
      lastTime = v.currentTime || 0;
    };

    const onStalled = async () => {
      // Browser reports stalled (buffer under-run). Soft retry soon.
      if (retryCount < RETRY_MAX) {
        retryCount += 1;
        await retryReloadVideo(v, src, retryCount, RETRY_MAX);
      }
    };

    const onError = async () => {
      if (retryCount < RETRY_MAX) {
        retryCount += 1;
        await retryReloadVideo(v, src, retryCount, RETRY_MAX);
      }
    };

    const onVisibility = () => {
      // If user switched tabs, be polite: pause this page's audio.
      // When they come back, resume (autoplay helper already bound).
      if (document.hidden) {
        try {
          v.pause();
        } catch {}
      } else {
        startPlayback();
        pauseOtherMediaExcept(v); // reclaim audio focus when coming back
      }
    };

    // Kick things off
    startPlayback();

    v.addEventListener("loadedmetadata", onLoadedMeta);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("stalled", onStalled);
    v.addEventListener("error", onError);
    document.addEventListener("visibilitychange", onVisibility);

    // On route change/unmount, stop this video's audio
    const onPageHide = () => {
      try {
        v.pause();
        v.muted = true;
      } catch {}
      clearStallTimer();
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      v.removeEventListener("loadedmetadata", onLoadedMeta);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("stalled", onStalled);
      v.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      clearStallTimer();
      // Be extra sure we don't leave sound playing
      try {
        v.pause();
        v.muted = true;
      } catch {}
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
