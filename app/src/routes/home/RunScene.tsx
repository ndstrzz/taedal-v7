import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

type RunSceneProps = {
  enabled: boolean;
};

export default function RunScene({ enabled }: RunSceneProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pinRef = useRef<HTMLDivElement | null>(null);

  const runnerRef = useRef<HTMLDivElement | null>(null);
  const runnerImgRef = useRef<HTMLImageElement | null>(null);

  const pathRef = useRef<SVGPathElement | null>(null);

  const flagWrapRef = useRef<HTMLDivElement | null>(null);
  const flagPoleRef = useRef<HTMLDivElement | null>(null);
  const safeGlowRef = useRef<HTMLDivElement | null>(null);

  const moonWrapRef = useRef<HTMLDivElement | null>(null);
  const moonImgRef = useRef<HTMLImageElement | null>(null);

  const starsRef = useRef<HTMLDivElement | null>(null);
  const vignetteRef = useRef<HTMLDivElement | null>(null);
  const cloudsRef = useRef<HTMLDivElement | null>(null);

  // Enhanced tuning parameters
  const SECTION_HEIGHT_VH = 800;
  const RUN_FPS = 45;

  const MOON_START_P = 0.25;
  const MOON_END_P = 0.65;

  const FLAG_START_P = 0.75;
  const FLAG_RISE_PX = 320;

  // Kuro sprite frames
  const restSrc = "/images/run/rest.svg";
  const runFrames = useMemo(
    () => [
      "/images/run/run%201.png",
      "/images/run/run%202.png",
      "/images/run/run%203.png",
      "/images/run/run%204.png",
      "/images/run/run%205.png",
      "/images/run/run%206.png",
    ],
    []
  );

  const moonSrc = "/images/interactive/moon.svg";

  // Preload images
  useEffect(() => {
    const imgs: HTMLImageElement[] = [];
    [restSrc, moonSrc, ...runFrames].forEach((src) => {
      const i = new Image();
      i.src = src;
      imgs.push(i);
    });
    return () => void imgs.length;
  }, [runFrames]);

  // Detect scrolling and direction
  const [isScrolling, setIsScrolling] = useState(false);
  const [flipX, setFlipX] = useState(false);
  const lastScrollYRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    lastScrollYRef.current = window.scrollY || 0;
    let t: number | null = null;

    const onScroll = () => {
      const y = window.scrollY || 0;
      const last = lastScrollYRef.current;
      lastScrollYRef.current = y;

      if (y < last) setFlipX(true);
      else if (y > last) setFlipX(false);

      setIsScrolling(true);
      if (t) window.clearTimeout(t);
      t = window.setTimeout(() => setIsScrolling(false), 120);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (t) window.clearTimeout(t);
    };
  }, [enabled]);

  // Sprite animation
  useEffect(() => {
    const img = runnerImgRef.current;
    if (!img) return;

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let frame = 0;
    const stepMs = 1000 / RUN_FPS;

    const tick = (now: number) => {
      const dt = now - last;
      last = now;

      if (isScrolling) {
        acc += dt;
        while (acc >= stepMs) {
          acc -= stepMs;
          frame = (frame + 1) % runFrames.length;
          img.src = runFrames[frame];
        }
      } else {
        if (img.src.indexOf(restSrc) === -1) img.src = restSrc;
        acc = 0;
        frame = 0;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [RUN_FPS, isScrolling, runFrames]);

  // Scroll-driven motion
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const pin = pinRef.current;
    const runner = runnerRef.current;
    const path = pathRef.current;

    const moonWrap = moonWrapRef.current;
    const moonImg = moonImgRef.current;

    const flagWrap = flagWrapRef.current;
    const flagPole = flagPoleRef.current;
    const safeGlow = safeGlowRef.current;

    const stars = starsRef.current;
    const vignette = vignetteRef.current;
    const clouds = cloudsRef.current;

    if (!wrap || !pin || !runner || !path) return;
    if (!enabled) return;

    const ctx = gsap.context(() => {
      ScrollTrigger.getAll().forEach((t) => {
        if ((t as any).trigger === wrap) t.kill();
      });

      const total = path.getTotalLength();

      if (moonWrap) gsap.set(moonWrap, { opacity: 0, y: 60, scale: 0.94 });
      if (flagPole) gsap.set(flagPole, { y: 40, opacity: 0.65 });
      if (safeGlow) gsap.set(safeGlow, { opacity: 0.08, scale: 0.96 });
      if (vignette) gsap.set(vignette, { opacity: 0.5 });
      if (stars) gsap.set(stars, { opacity: 0.92 });
      if (clouds) gsap.set(clouds, { opacity: 0.3 });

      const apply = (progress: number) => {
        // Runner follows path
        const len = progress * total;
        const pt = path.getPointAtLength(len);
        gsap.set(runner, { x: pt.x, y: pt.y });

        // Enhanced atmospheric effects
        const atmo = gsap.utils.clamp(0, 1, progress);
        if (vignette) gsap.set(vignette, { opacity: 0.5 + atmo * 0.35 });
        if (stars) gsap.set(stars, { opacity: 0.92 - atmo * 0.28 });
        if (clouds) gsap.set(clouds, { opacity: 0.3 + atmo * 0.25, x: -atmo * 120 });

        // Moon rise with enhanced glow
        if (moonWrap) {
          const moonT = gsap.utils.clamp(
            0,
            1,
            (progress - MOON_START_P) / (MOON_END_P - MOON_START_P)
          );

          gsap.set(moonWrap, {
            opacity: moonT,
            y: 80 - moonT * 180,
            scale: 0.93 + moonT * 0.14,
          });

          if (moonImg) {
            gsap.set(moonImg, {
              filter: `drop-shadow(0 0 ${12 + moonT * 45}px rgba(255,255,255,${
                0.18 + moonT * 0.55
              })) brightness(${1 + moonT * 0.15})`,
            });
          }
        }

        // Safe zone flag with dramatic rise
        const endT = gsap.utils.clamp(0, 1, (progress - FLAG_START_P) / 0.25);

        if (flagPole) {
          gsap.set(flagPole, {
            y: 40 - endT * FLAG_RISE_PX,
            opacity: 0.65 + endT * 0.35,
            scale: 1 + endT * 0.08,
          });
        }

        if (safeGlow) {
          gsap.set(safeGlow, {
            opacity: 0.08 + endT * 0.82,
            scale: 0.96 + endT * 0.14,
            filter: `blur(${12 - endT * 6}px)`,
          });
        }

        if (flagWrap) {
          gsap.set(flagWrap, {
            filter: `drop-shadow(0 0 ${16 + endT * 52}px rgba(255,255,255,${
              0.22 + endT * 0.68
            })) brightness(${1 + endT * 0.1})`,
            opacity: 0.8 + endT * 0.2,
          });
        }
      };

      apply(0);

      ScrollTrigger.create({
        trigger: wrap,
        start: "top top",
        end: "bottom bottom",
        scrub: 1.2,
        pin: pin,
        anticipatePin: 1,
        onUpdate: (self) => apply(self.progress),
      });

      const onResize = () => ScrollTrigger.refresh();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, wrap);

    return () => ctx.revert();
  }, [enabled, FLAG_RISE_PX]);

  return (
    <section className="relative bg-black text-white">
      <div
        ref={wrapRef}
        className="relative"
        style={{ height: `${SECTION_HEIGHT_VH}vh` }}
      >
        <div
          ref={pinRef}
          className="sticky top-0 h-[100svh] w-full overflow-hidden bg-black"
        >
          {/* Enhanced Background Layers */}
          <div className="absolute inset-0 bg-[radial-gradient(140%_110%_at_50%_0%,rgba(139,92,246,0.06),transparent_50%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,rgba(255,255,255,0.12),transparent_60%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-black via-black/80 to-black" />

          {/* Animated clouds layer */}
          <div ref={cloudsRef} className="absolute inset-0 opacity-30">
            <div className="absolute top-[15%] left-[10%] w-48 h-16 rounded-full bg-white/5 blur-2xl" />
            <div className="absolute top-[25%] right-[15%] w-64 h-20 rounded-full bg-white/4 blur-3xl" />
            <div className="absolute top-[45%] left-[20%] w-40 h-14 rounded-full bg-white/3 blur-2xl" />
          </div>

          <div ref={starsRef} className="absolute inset-0 opacity-92">
            <EnhancedStarField />
          </div>

          <div
            ref={vignetteRef}
            className="pointer-events-none absolute inset-0 shadow-[inset_0_0_320px_rgba(0,0,0,0.90)]"
          />

          {/* Header - Enhanced Typography */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30">
            <div className="mx-auto max-w-6xl px-6 pt-12 sm:pt-16">
              <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-4 py-1.5 backdrop-blur-sm">
                  <div className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
                  <div className="text-[10px] font-semibold uppercase tracking-[0.35em] text-white/70">
                    KURO GUIDE RUN
                  </div>
                </div>
                <h2 className="mt-5 text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">
                  Scroll — Kuro guides you
                  <span className="block text-white/60 mt-1">to safety.</span>
                </h2>
                <p className="mt-4 text-base leading-7 text-white/70">
                  Scroll down to run forward. Scroll up to run back.
                  <span className="block mt-1 text-white/50">Reach the flag: "You are safe here."</span>
                </p>
              </div>
            </div>
          </div>

          {/* Scene */}
          <div className="absolute inset-0 z-20">
            <div className="mx-auto max-w-6xl px-6 h-full">
              <div className="relative h-full w-full">
                {/* Moon with enhanced glow */}
                <div
                  ref={moonWrapRef}
                  className="pointer-events-none absolute left-1/2 top-[36%] -translate-x-1/2"
                  aria-hidden
                >
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full bg-white/20 blur-3xl scale-150" />
                    <img
                      ref={moonImgRef}
                      src={moonSrc}
                      alt=""
                      draggable={false}
                      className="relative h-[140px] sm:h-[160px] w-auto opacity-95"
                    />
                  </div>
                </div>

                {/* Path + runner */}
                <svg
                  className="absolute inset-0 w-full h-full"
                  viewBox="0 0 1000 700"
                  preserveAspectRatio="xMidYMid meet"
                >
                  <defs>
                    <linearGradient id="pathGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="rgba(255,255,255,0.15)" />
                      <stop offset="50%" stopColor="rgba(139,92,246,0.25)" />
                      <stop offset="100%" stopColor="rgba(255,255,255,0.15)" />
                    </linearGradient>
                  </defs>
                  
                  <g transform="translate(1000, 0) scale(-1, 1)">
                    <path
                      ref={pathRef}
                      d="M 120 90
                         C 160 120, 160 180, 180 220
                         C 210 280, 260 300, 300 340
                         C 360 400, 330 460, 380 520
                         C 430 585, 520 600, 620 600
                         C 760 600, 820 585, 875 560"
                      fill="none"
                      stroke="url(#pathGradient)"
                      strokeWidth="7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="2 16"
                    />

                    <path
                      d="M 120 90
                         C 160 120, 160 180, 180 220
                         C 210 280, 260 300, 300 340
                         C 360 400, 330 460, 380 520
                         C 430 585, 520 600, 620 600
                         C 760 600, 820 585, 875 560"
                      fill="none"
                      stroke="rgba(139,92,246,0.18)"
                      strokeWidth="22"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ filter: "blur(10px)" }}
                    />
                  </g>
                </svg>

                {/* Runner with enhanced shadow */}
                <div
                  ref={runnerRef}
                  className="absolute left-0 top-0 z-40"
                  style={{
                    transform: "translate(-50%, -65%) translate3d(0,0,0)",
                  }}
                >
                  <img
                    ref={runnerImgRef}
                    src={restSrc}
                    alt="Kuro"
                    draggable={false}
                    className={`h-[80px] sm:h-[88px] w-auto select-none drop-shadow-[0_20px_60px_rgba(0,0,0,0.75)] ${
                      flipX ? "-scale-x-100" : ""
                    }`}
                  />
                  <div className="pointer-events-none absolute -bottom-3 left-4 h-8 w-24 bg-[radial-gradient(closest-side,rgba(139,92,246,0.25),transparent_70%)] blur-sm" />
                </div>

                {/* Enhanced flag destination */}
                <div
                  ref={flagWrapRef}
                  className="absolute right-[6%] bottom-[10%] z-40"
                >
                  <div ref={safeGlowRef} className="pointer-events-none absolute -inset-12">
                    <div className="h-[130px] w-[280px] rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,0.30),transparent_65%)]" />
                  </div>

                  <div ref={flagPoleRef} className="relative flex items-center gap-4">
                    <div className="relative">
                      <div className="h-24 w-[3px] bg-gradient-to-b from-white/80 to-white/50 shadow-lg shadow-white/20" />
                      <div className="absolute left-[3px] top-2 w-[130px] rounded-xl border border-white/30 bg-gradient-to-br from-white/[0.12] to-white/[0.06] backdrop-blur-md shadow-2xl shadow-violet-500/20">
                        <div className="absolute inset-0 rounded-xl bg-[radial-gradient(130%_130%_at_0%_50%,rgba(139,92,246,0.30),transparent_65%)]" />
                        <div className="relative px-4 py-3">
                          <div className="text-[11px] font-bold tracking-[0.25em] text-white">
                            YOU ARE SAFE
                          </div>
                          <div className="mt-1 text-[9px] tracking-[0.15em] text-violet-200/80">
                            KURO ZONE
                          </div>
                        </div>
                      </div>
                      <div className="absolute -top-2 left-0 h-4 w-4 rounded-full bg-white shadow-[0_0_24px_rgba(255,255,255,0.5),0_0_12px_rgba(139,92,246,0.4)]" />
                    </div>

                    <div className="min-w-[200px] rounded-2xl border border-white/15 bg-black/40 backdrop-blur-sm p-4 shadow-2xl">
                      <div className="text-[13px] sm:text-[14px] font-bold text-white">
                        You are safe here.
                      </div>
                      <div className="mt-1 text-[11px] sm:text-[12px] text-white/65">
                        Protect your art. Keep receipts.
                      </div>
                      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-950/30 px-3 py-1.5 text-[10px] text-violet-200/90">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-300"></span>
                        </span>
                        Provenance active
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pointer-events-none absolute inset-x-0 bottom-10 text-center">
                  <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-black/40 backdrop-blur-sm px-4 py-2 text-[11px] text-white/50">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                    Scroll to run • Up to reverse
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black via-black/70 to-transparent" />
        </div>
      </div>
    </section>
  );
}

function EnhancedStarField() {
  return (
    <div className="absolute inset-0">
      {/* Multiple star layers with different sizes and opacities */}
      <div className="absolute inset-0 opacity-70 [background-image:radial-gradient(rgba(255,255,255,0.4)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(rgba(139,92,246,0.3)_1px,transparent_1px)] [background-size:56px_56px]" />
      <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(rgba(255,255,255,0.25)_1.5px,transparent_1.5px)] [background-size:88px_88px]" />
      <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(rgba(255,255,255,0.2)_1px,transparent_1px)] [background-size:140px_140px]" />
      
      {/* Twinkling stars */}
      <div className="absolute top-[15%] left-[12%] w-1 h-1 rounded-full bg-white animate-pulse" />
      <div className="absolute top-[25%] right-[20%] w-1 h-1 rounded-full bg-violet-300 animate-pulse" style={{ animationDelay: '0.3s' }} />
      <div className="absolute top-[45%] left-[30%] w-0.5 h-0.5 rounded-full bg-white animate-pulse" style={{ animationDelay: '0.6s' }} />
      <div className="absolute top-[60%] right-[35%] w-1 h-1 rounded-full bg-white animate-pulse" style={{ animationDelay: '0.9s' }} />
      <div className="absolute top-[70%] left-[65%] w-0.5 h-0.5 rounded-full bg-violet-300 animate-pulse" style={{ animationDelay: '1.2s' }} />
    </div>
  );
}