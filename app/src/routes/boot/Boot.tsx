import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { markBootSeen } from "../../lib/bootGate";

/* ---------- env helpers ---------- */
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
    const a = document.createElement("link");
    a.rel = "preconnect";
    a.href = origin;
    a.crossOrigin = "";
    document.head.appendChild(a);
    const b = document.createElement("link");
    b.rel = "dns-prefetch";
    b.href = origin;
    document.head.appendChild(b);
  } catch {}
}

/* ---------- preload list ---------- */
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
  if (extra) extra.split(",").map((s) => s.trim()).filter(Boolean).forEach((u) => cands.push(u));
  const seen = new Set<string>();
  for (const u of cands) if (!seen.has(u)) { seen.add(u); list.push(u); }
  return list;
}

/* ---------- warm remote video ---------- */
function preloadVideo(url: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    v.src = url;

    const done = () => { cleanup(); resolve(); };
    const tid = window.setTimeout(done, timeoutMs);
    const ok = () => done();
    const err = () => done();

    function cleanup() {
      v.removeEventListener("canplaythrough", ok);
      v.removeEventListener("error", err);
      window.clearTimeout(tid);
    }

    v.addEventListener("canplaythrough", ok, { once: true });
    v.addEventListener("error", err, { once: true });
    v.load();
  });
}

export default function Boot() {
  const navigate = useNavigate();
  const overlayVid = useRef<HTMLVideoElement | null>(null);

  const targets = useMemo(resolvePreloadList, []);
  const [warmPercent, setWarmPercent] = useState(0);
  const [allWarmed, setAllWarmed] = useState(false);

  /* ---- 15s minimum time ---- */
  const MIN_BOOT_MS = 15_000;
  const [elapsedMs, setElapsedMs] = useState(0);
  const minElapsed = elapsedMs >= MIN_BOOT_MS;

  /* ---- ring ---- */
  const SIZE = 240;
  const R = 110;
  const STROKE = 12;
  const C = 2 * Math.PI * R;
  const timePct = Math.min(1, elapsedMs / MIN_BOOT_MS);
  const strokeDashoffset = C * (1 - timePct);

  const canStart = allWarmed && minElapsed;

  useEffect(() => {
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

  /* ---- local video (slightly zoomed out) ---- */
  useEffect(() => {
    const v = overlayVid.current;
    if (!v) return;
    const tryPlayUnmuted = async () => {
      try {
        v.muted = false;
        v.volume = 0.9;
        await v.play();
        localStorage.setItem("taedal_audio_ok", "1");
      } catch {
        v.muted = true;
        v.play().catch(() => {});
        const unmuteOnce = async () => {
          try {
            v.muted = false;
            v.volume = 0.9;
            await v.play();
          } catch {}
          localStorage.setItem("taedal_audio_ok", "1");
          ["pointerdown", "click", "keydown", "touchstart", "scroll"].forEach((evt) =>
            window.removeEventListener(evt, unmuteOnce)
          );
        };
        ["pointerdown", "click", "keydown", "touchstart", "scroll"].forEach((evt) =>
          window.addEventListener(evt, unmuteOnce, {
            once: true,
            passive: evt === "scroll" || evt === "touchstart",
          })
        );
      }
    };
    v.src = "/images/unpacking.mp4?v=1";
    v.playsInline = true;
    v.loop = true;
    v.preload = "auto";
    tryPlayUnmuted();
  }, []);

  /* ---- 15s countdown driver ---- */
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const d = t - last;
      last = t;
      setElapsedMs((p) => Math.min(MIN_BOOT_MS + 100, p + d));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ---- warm remote videos ---- */
  useEffect(() => {
    (async () => {
      let done = 0;
      await Promise.all(
        targets.map(async (u) => {
          await preloadVideo(u);
          done += 1;
          setWarmPercent(Math.round((done / Math.max(1, targets.length)) * 100));
        })
      );
      setAllWarmed(true);
    })();
  }, [targets]);

  const onStart = () => {
    try {
      localStorage.setItem("taedal_audio_ok", "1");
      markBootSeen("site"); // durable across tabs for this BOOT_VERSION
    } catch {}
    navigate("/home");
  };

  return (
    <main className="fixed inset-0 z-[9999]">
      {/* Background local video (scaled smaller to “zoom out”) */}
      <video
        ref={overlayVid}
        className="absolute inset-0 h-full w-full object-cover bg-black will-change-transform"
        style={{ transform: "scale(0.93)", transformOrigin: "50% 50%" }}
        autoPlay
        loop
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        disablePictureInPicture
        controlsList="nodownload noremoteplayback"
      >
        <source src="/images/unpacking.mp4?v=1" type="video/mp4" />
      </video>

      {/* Vignette */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/55 via-black/25 to-black/55" />

      {/* Centered ring + copy */}
      <div className="absolute inset-0 grid place-items-center px-6">
        <div className="relative">
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="block mx-auto drop-shadow-[0_8px_32px_rgba(0,0,0,0.55)]"
          >
            <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={STROKE} />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke="white"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={strokeDashoffset}
              style={{ transition: "stroke-dashoffset 120ms linear" }}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          </svg>

          {/* Text inside */}
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center leading-tight px-2">
              <div style={{ fontSize: "clamp(10px, 1.8vw, 14px)", letterSpacing: "0.22em" }} className="uppercase text-white/85">
                unpacking our
              </div>
              <div style={{ fontSize: "clamp(22px, 3.4vw, 32px)" }} className="font-semibold">
                taedal box
              </div>
              {!canStart && (
                <div className="mt-1 text-[10px] sm:text[11px] text-white/60">
                  {Math.max(0, Math.ceil((15_000 - elapsedMs) / 1000))}s remaining
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Start button */}
      <button
        onClick={onStart}
        className={`absolute bottom-12 left-1/2 -translate-x-1/2 transition-opacity duration-300 ${
          canStart ? "opacity-100" : "opacity-0 pointer-events-none"
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
