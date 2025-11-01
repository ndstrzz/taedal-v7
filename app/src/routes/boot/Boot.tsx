import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/* ---------------- env helpers ---------------- */
function getEnv(key: string): string | undefined {
  try {
    // @ts-ignore
    return (import.meta as any)?.env?.[key];
  } catch {
    return undefined;
  }
}

function preconnect(origin: string) {
  try {
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    link.crossOrigin = "";
    document.head.appendChild(link);

    const dns = document.createElement("link");
    dns.rel = "dns-prefetch";
    dns.href = origin;
    document.head.appendChild(dns);
  } catch {}
}

/* remote video list we want warmed before entering app */
function resolvePreloadList(): string[] {
  const cfg: any = (globalThis as any)?.window?.__CONFIG__ ?? {};
  const list: string[] = [];

  const cands = [
    cfg.HOME_VIDEO_URL,
    cfg.AR_INTRO_URL,
    getEnv("VITE_HOME_VIDEO_URL"),
    getEnv("VITE_AR_INTRO_URL"),
  ].filter(Boolean) as string[];

  const extra = getEnv("VITE_BOOT_PRELOAD_URLS");
  if (extra) {
    extra
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((u) => cands.push(u));
  }

  const seen = new Set<string>();
  for (const u of cands) {
    if (!seen.has(u)) {
      list.push(u);
      seen.add(u);
    }
  }
  return list;
}

/* preload a video off-DOM up to canplaythrough (with timeout; never block) */
function preloadVideo(url: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    v.src = url;

    const done = () => {
      cleanup();
      resolve();
    };
    const onCanPlay = () => done();
    const onErr = () => done();
    const tid = window.setTimeout(done, timeoutMs);

    function cleanup() {
      v.removeEventListener("canplaythrough", onCanPlay);
      v.removeEventListener("error", onErr);
      window.clearTimeout(tid);
      // leave v in memory cache (do not null src)
    }

    v.addEventListener("canplaythrough", onCanPlay, { once: true });
    v.addEventListener("error", onErr, { once: true });
    v.load();
  });
}

export default function Boot() {
  const navigate = useNavigate();
  const overlayVid = useRef<HTMLVideoElement | null>(null);

  const targets = useMemo(resolvePreloadList, []);
  const [percent, setPercent] = useState(0);
  const [allWarmed, setAllWarmed] = useState(false);

  useEffect(() => {
    // Preconnect to all remote origins right away
    const origins = Array.from(
      new Set(
        targets
          .map((u) => {
            try {
              return new URL(u).origin;
            } catch {
              return "";
            }
          })
          .filter(Boolean)
      )
    );
    origins.forEach(preconnect);
  }, [targets]);

  useEffect(() => {
    const v = overlayVid.current;
    if (!v) return;

    // We *try* to autoplay with sound (policy may block).
    const tryPlayUnmuted = async () => {
      try {
        v.muted = false;
        v.volume = 0.9;
        await v.play();
        try {
          localStorage.setItem("taedal_audio_ok", "1");
        } catch {}
      } catch {
        // If blocked, fall back to muted autoplay and unmute on first gesture.
        v.muted = true;
        v.play().catch(() => {});
        const unmuteOnce = async () => {
          try {
            v.muted = false;
            v.volume = 0.9;
            await v.play();
          } catch {}
          try {
            localStorage.setItem("taedal_audio_ok", "1");
          } catch {}
          ["pointerdown", "click", "keydown", "touchstart", "scroll"].forEach((evt) =>
            window.removeEventListener(evt, unmuteOnce)
          );
        };
        ["pointerdown", "click", "keydown", "touchstart", "scroll"].forEach((evt) =>
          window.addEventListener(evt, unmuteOnce, { once: true, passive: evt === "scroll" || evt === "touchstart" })
        );
      }
    };

    v.playsInline = true;
    v.loop = true;
    v.preload = "auto";
    v.src = "/images/unpacking.mp4"; // local, instant
    tryPlayUnmuted();
  }, []);

  useEffect(() => {
    (async () => {
      let done = 0;
      await Promise.all(
        targets.map(async (u) => {
          await preloadVideo(u);
          done += 1;
          setPercent(Math.round((done / Math.max(1, targets.length)) * 100));
        })
      );
      setAllWarmed(true);
    })();
  }, [targets]);

  const onStart = () => {
    // User explicitly starts → guaranteed gesture for future autoplay unmuted
    try {
      localStorage.setItem("taedal_audio_ok", "1");
    } catch {}
    navigate("/home");
  };

  return (
    <main className="fixed inset-0 z-[9999]">
      {/* Background local video (fast) */}
      <video
        ref={overlayVid}
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        loop
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        disablePictureInPicture
        controlsList="nodownload noremoteplayback"
      />
      {/* subtle vignette */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/55 via-black/25 to-black/55" />

      {/* progress pill (center-top) */}
      {!allWarmed && (
        <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded bg-white/10 px-3 py-1 text-xs text-white backdrop-blur">
          Preparing media… {percent}%
        </div>
      )}

      {/* Start button (appears after warmup) */}
      <button
        onClick={onStart}
        className={`absolute bottom-12 left-1/2 -translate-x-1/2 transition-opacity duration-300 ${
          allWarmed ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-label="Start"
      >
        <img
          src="/images/start-button.svg"
          alt="Start"
          className="h-14 w-auto drop-shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
          draggable={false}
        />
      </button>
    </main>
  );
}
