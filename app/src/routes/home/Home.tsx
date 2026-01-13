// app/src/routes/home/Home.tsx
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { motion, AnimatePresence } from "framer-motion";

/* Scrollytelling deps */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import * as THREE from "three";

/* NEW: Kuro runner section */
import RunScene from "./RunScene";

gsap.registerPlugin(ScrollTrigger);

/* =========================================================
   Rolling brand word (odometer-style)
========================================================= */

const DEFAULT_ROLL_CHARSET =
  "- 0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ태달";

function padToLen(str: string, len: number) {
  if (str.length >= len) return str;
  return str + " ".repeat(len - str.length);
}

function buildRollSeq(fromCh: string, toCh: string) {
  if (fromCh === toCh) return [fromCh];

  const chars = Array.from(DEFAULT_ROLL_CHARSET);
  const L = chars.length;

  const fromIdx = chars.indexOf(fromCh);
  const toIdx = chars.indexOf(toCh);

  if (fromIdx < 0 || toIdx < 0) return [fromCh, ...chars, toCh];

  const delta = (toIdx - fromIdx + L) % L;

  const MIN_FRAMES = 14;
  const baseLen = delta + 1;
  const extraLoops =
    baseLen >= MIN_FRAMES ? 0 : Math.ceil((MIN_FRAMES - baseLen) / L);
  const totalSteps = extraLoops * L + delta;

  const seq: string[] = [];
  for (let s = 0; s <= totalSteps; s++) seq.push(chars[(fromIdx + s) % L]);
  return seq;
}

function RollingWord({
  from,
  to,
  start,
  className = "",
  colDelay = 0.085,
  duration = 1.25,
}: {
  from: string;
  to: string;
  start: boolean;
  className?: string;
  colDelay?: number;
  duration?: number;
}) {
  const cols = useMemo(() => {
    const L = Math.max(from.length, to.length);
    const a = padToLen(from, L);
    const b = padToLen(to, L);

    return Array.from({ length: L }, (_, i) => {
      const fromCh = a[i] ?? " ";
      const toCh = b[i] ?? " ";
      return buildRollSeq(fromCh, toCh);
    });
  }, [from, to]);

  return (
    <span className={`inline-flex items-center gap-[0.42em] ${className}`}>
      {cols.map((seq, i) => {
        const shiftPct = -((seq.length - 1) / seq.length) * 100;

        return (
          <span
            key={i}
            className="relative inline-block overflow-hidden align-baseline"
            style={{ height: "1em" }}
          >
            <motion.span
              className="block"
              initial={{ y: "0%" }}
              animate={{ y: start ? `${shiftPct}%` : "0%" }}
              transition={{
                duration,
                delay: i * colDelay,
                ease: [0.2, 0.8, 0.2, 1],
              }}
            >
              {seq.map((ch, j) => (
                <span key={j} className="block h-[1em] leading-none">
                  {ch === " " ? "\u00A0" : ch}
                </span>
              ))}
            </motion.span>
          </span>
        );
      })}
    </span>
  );
}

function BrandNameLockup() {
  const KO = "--태달--";
  const EN = "taedal";

  const [dir, setDir] = useState<"toEn" | "toKo">("toEn");
  const [startRoll, setStartRoll] = useState(false);
  const [cycleKey, setCycleKey] = useState(0);

  const colDelay = 0.085;
  const duration = 1.25;

  useEffect(() => {
    let alive = true;
    const timers: number[] = [];

    const START_DELAY = 650;
    const HOLD_AFTER = 900;
    const HOLD_KO = 700;

    const colDelayMs = Math.round(colDelay * 1000);
    const durationMs = Math.round(duration * 1000);
    const lastColDelayMs = 5 * colDelayMs;

    const rollTotalMs = START_DELAY + durationMs + lastColDelayMs;

    const schedule = () => {
      if (!alive) return;

      setStartRoll(false);

      timers.push(
        window.setTimeout(() => {
          if (!alive) return;
          setStartRoll(true);
        }, START_DELAY)
      );

      timers.push(
        window.setTimeout(() => {
          if (!alive) return;

          setStartRoll(false);
          setDir((d) => (d === "toEn" ? "toKo" : "toEn"));
          setCycleKey((k) => k + 1);

          const extraHold = dir === "toKo" ? HOLD_KO : 0;

          timers.push(
            window.setTimeout(() => {
              if (!alive) return;
              schedule();
            }, HOLD_AFTER + extraHold)
          );
        }, rollTotalMs + HOLD_AFTER)
      );
    };

    schedule();

    return () => {
      alive = false;
      timers.forEach((t) => window.clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const from = dir === "toEn" ? KO : EN;
  const to = dir === "toEn" ? EN : KO;

  return (
    <div className="flex flex-col items-center text-center">
      <div className="text-white font-semibold leading-none tracking-[0.18em] text-[40px] sm:text-[54px] lg:text-[64px]">
        <RollingWord
          key={cycleKey}
          from={from}
          to={to}
          start={startRoll}
          colDelay={colDelay}
          duration={duration}
        />
      </div>

      <div className="mt-6 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.35em] text-white/70">
        MADE BY ARTIST FOR ARTISTS
      </div>
    </div>
  );
}

/* =========================================================
   Looping MP4
========================================================= */
function LoopingMp4({
  src,
  className,
  ...motionProps
}: {
  src: string;
  className?: string;
  [key: string]: any;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;

    v.muted = true;
    v.loop = true;
    v.playsInline = true;

    const tryPlay = () => {
      try {
        const p = v.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {}
    };

    const onEnded = () => {
      try {
        v.currentTime = 0;
      } catch {}
      tryPlay();
    };

    tryPlay();
    v.addEventListener("canplay", tryPlay);
    v.addEventListener("ended", onEnded);

    return () => {
      v.removeEventListener("canplay", tryPlay);
      v.removeEventListener("ended", onEnded);
      try {
        v.pause();
      } catch {}
    };
  }, [src]);

  return (
    <motion.video
      ref={ref}
      src={src}
      autoPlay
      muted
      playsInline
      loop
      preload="auto"
      className={className}
      {...motionProps}
    />
  );
}

/* =========================================================
   Reduced motion helper
========================================================= */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;

    const set = () => setReduced(!!mq.matches);
    set();

    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", set);
      return () => mq.removeEventListener("change", set);
    } else {
      // @ts-expect-error old safari
      mq.addListener(set);
      // @ts-expect-error old safari
      return () => mq.removeListener(set);
    }
  }, []);

  return reduced;
}

/* =========================================================
   Press & Hold Gate
========================================================= */
function PressHoldGate({
  onComplete,
  onSetHolding,
}: {
  onComplete: () => void;
  onSetHolding?: (holding: boolean) => void;
}) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const doneRef = useRef(false);

  const HOLD_MS = 900;

  const stop = () => {
    setHolding(false);
    onSetHolding?.(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = 0;
    doneRef.current = false;
    setProgress(0);
  };

  const tick = (ts: number) => {
    if (!startRef.current) startRef.current = ts;
    const elapsed = ts - startRef.current;
    const p = Math.min(1, elapsed / HOLD_MS);
    setProgress(p);

    if (p >= 1 && !doneRef.current) {
      doneRef.current = true;
      setHolding(false);
      onSetHolding?.(false);
      onComplete();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  };

  const begin = () => {
    if (holding) return;
    setHolding(true);
    onSetHolding?.(true);
    doneRef.current = false;
    startRef.current = 0;
    setProgress(0);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const C = 2 * Math.PI * 18;
  const dashOffset = C * (1 - progress);

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onPointerDown={begin}
        onPointerUp={stop}
        onPointerCancel={stop}
        onPointerLeave={stop}
        className="group relative select-none rounded-full border border-white/20 bg-white/[0.05] px-5 py-3 backdrop-blur hover:border-white/35 hover:bg-white/[0.07] transition active:scale-[0.99]"
        aria-label="Press and hold to enter"
      >
        <div className="flex items-center gap-3">
          <span className="relative h-10 w-10">
            <svg viewBox="0 0 44 44" className="absolute inset-0">
              <circle
                cx="22"
                cy="22"
                r="18"
                fill="none"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="3"
              />
              <circle
                cx="22"
                cy="22"
                r="18"
                fill="none"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 22 22)"
              />
            </svg>
            <span className="absolute inset-0 grid place-items-center text-[11px] text-white/75">
              {Math.round(progress * 100)}%
            </span>
          </span>

          <div className="text-left">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/55">
              INTERACTIVE MODE
            </div>
            <div className="text-sm font-semibold text-white">
              Press & hold to enter the vault
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition">
          <div className="absolute inset-0 rounded-full bg-[radial-gradient(120%_120%_at_50%_0%,rgba(255,255,255,0.10),transparent_60%)]" />
        </div>
      </button>

      <button
        type="button"
        onClick={onComplete}
        className="text-[11px] text-white/55 hover:text-white/80 transition"
      >
        Skip (enter instantly)
      </button>
    </div>
  );
}

/* =========================================================
   INTERACTIVE TRIPLE VIDEO SECTION (3 panels + thunder dividers)
========================================================= */

function LightningDivider({
  orientation,
  reducedMotion,
}: {
  orientation: "vertical" | "horizontal";
  reducedMotion: boolean;
}) {
  const isV = orientation === "vertical";
  const w = isV ? 56 : 260;
  const h = isV ? 540 : 56;

  const pathD = isV
    ? "M28 10 L20 64 L34 88 L18 148 L40 192 L22 246 L38 288 L18 348 L36 392 L22 452 L32 520"
    : "M10 28 L64 20 L88 34 L148 18 L192 40 L246 22 L288 38 L348 18 L392 36 L452 22 L520 32";

  return (
    <div
      className={`relative ${
        isV ? "h-full w-[56px]" : "w-full h-[56px]"
      } flex items-center justify-center`}
      aria-hidden
    >
      <motion.div
        className={`absolute inset-0 ${
          isV
            ? "bg-[linear-gradient(to_right,transparent,rgba(255,255,255,0.08),transparent)]"
            : "bg-[linear-gradient(to_bottom,transparent,rgba(255,255,255,0.08),transparent)]"
        }`}
        animate={
          reducedMotion
            ? undefined
            : {
                opacity: [0.35, 0.85, 0.45, 0.75, 0.4],
              }
        }
        transition={
          reducedMotion
            ? undefined
            : { duration: 2.2, repeat: Infinity, ease: "easeInOut" }
        }
      />

      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${isV ? 56 : 540} ${isV ? 540 : 56}`}
        className="relative z-10"
      >
        <motion.path
          d={pathD}
          fill="none"
          stroke="rgba(255,255,255,0.42)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: "blur(4px)" }}
          animate={
            reducedMotion
              ? undefined
              : {
                  opacity: [0.25, 0.75, 0.35, 0.9, 0.3],
                }
          }
          transition={
            reducedMotion
              ? undefined
              : { duration: 1.7, repeat: Infinity, ease: "easeInOut" }
          }
        />
        <motion.path
          d={pathD}
          fill="none"
          stroke="rgba(255,255,255,0.90)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="12 10"
          animate={
            reducedMotion
              ? undefined
              : {
                  strokeDashoffset: [0, -44],
                  opacity: [0.7, 1, 0.85, 1, 0.75],
                }
          }
          transition={
            reducedMotion
              ? undefined
              : { duration: 1.25, repeat: Infinity, ease: "linear" }
          }
        />
      </svg>
    </div>
  );
}

type TriplePanel = {
  id: "explore" | "what" | "create";
  title: string;
  subtitle: string;
  src: string;
};

function InteractiveTripleVideos({ enabled }: { enabled: boolean }) {
  const reducedMotion = usePrefersReducedMotion();
  const [active, setActive] = useState<TriplePanel | null>(null);

  const panels = useMemo<TriplePanel[]>(
    () => [
      {
        id: "explore",
        title: "Explore",
        subtitle: "Discover verified works",
        src: "/images/interactive/explore%20video.mp4",
      },
      {
        id: "what",
        title: "What are we",
        subtitle: "A cinematic vault for provenance",
        src: "/images/interactive/what%20are%20we%20video.mp4",
      },
      {
        id: "create",
        title: "Create",
        subtitle: "Upload → verify → mint",
        src: "/images/interactive/create-artwork-vid.mp4",
      },
    ],
    []
  );

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const locked = !enabled;

  return (
    <section className="relative bg-black text-white">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <div className="flex items-end justify-between gap-6">
          <div className="max-w-2xl">
            <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/55">
              INTERACTIVE PORTALS
            </div>
            <h2 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight">
              Three ways in,
              <span className="text-white/70"> separated by thunder.</span>
            </h2>
            <p className="mt-3 text-sm leading-6 text-white/65">
              Hover a panel to expand it into a full-screen cinematic preview.
            </p>
          </div>

          <div className="hidden md:block text-[11px] text-white/45">
            Tip: press <span className="text-white/70">Esc</span> to exit.
          </div>
        </div>

        <div className="mt-10">
          <div className="hidden md:flex items-stretch">
            {panels.map((p, idx) => (
              <div key={p.id} className="flex items-stretch">
                <TripleVideoPanel
                  panel={p}
                  disabled={locked}
                  reducedMotion={reducedMotion}
                  onHover={() => {
                    if (locked) return;
                    if (reducedMotion) return;
                    setActive(p);
                  }}
                />
                {idx < panels.length - 1 && (
                  <LightningDivider
                    orientation="vertical"
                    reducedMotion={reducedMotion}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="md:hidden grid gap-6">
            {panels.map((p, idx) => (
              <div key={p.id} className="relative">
                <TripleVideoPanel
                  panel={p}
                  disabled={locked}
                  reducedMotion={reducedMotion}
                  onHover={() => {}}
                />
                {idx < panels.length - 1 && (
                  <div className="mt-4">
                    <LightningDivider
                      orientation="horizontal"
                      reducedMotion={reducedMotion}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {locked && (
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/55">
                LOCKED
              </div>
              <div className="mt-2 text-sm text-white/70">
                Enter interactive mode to unlock the portals.
              </div>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {active && !reducedMotion && (
          <motion.div
            className="fixed inset-0 z-[70] bg-black"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseLeave={() => setActive(null)}
          >
            <LoopingMp4
              src={active.src}
              className="absolute inset-0 h-full w-full object-cover"
              initial={{ scale: 1.03, opacity: 0 }}
              animate={{ scale: 1.0, opacity: 1 }}
              exit={{ scale: 1.02, opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
            />

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/25 via-black/20 to-black/80" />
            <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_240px_rgba(0,0,0,0.90)]" />

            <div className="absolute inset-x-0 top-0 z-10">
              <div className="mx-auto max-w-6xl px-6 pt-10 sm:pt-12">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/55">
                      {active.id.toUpperCase()}
                    </div>
                    <div className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight">
                      {active.title}
                    </div>
                    <div className="mt-2 text-sm text-white/65">
                      {active.subtitle}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActive(null)}
                    className="rounded-full border border-white/20 bg-white/[0.06] px-4 py-2 text-[12px] font-semibold text-white/85 backdrop-blur hover:border-white/40 hover:bg-white/[0.08] transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>

            <div className="absolute inset-x-0 bottom-0 z-10">
              <div className="mx-auto max-w-6xl px-6 pb-10 sm:pb-12">
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={
                      active.id === "explore"
                        ? "/explore"
                        : active.id === "create"
                        ? "/create"
                        : "/discover"
                    }
                    className="rounded-full bg-white px-6 py-2 text-sm font-medium text-slate-950 shadow-lg shadow-black/40 hover:bg-slate-100 transition"
                  >
                    Enter {active.title}
                  </a>
                  <div className="text-[11px] text-white/55">
                    Move your cursor off the screen to exit.
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function TripleVideoPanel({
  panel,
  onHover,
  reducedMotion,
  disabled,
}: {
  panel: TriplePanel;
  onHover: () => void;
  reducedMotion: boolean;
  disabled: boolean;
}) {
  return (
    <div
      className={`relative h-[420px] lg:h-[520px] w-[280px] lg:w-[340px] overflow-hidden bg-black ${
        disabled ? "opacity-70" : "opacity-100"
      }`}
      onMouseEnter={() => {
        if (disabled) return;
        onHover();
      }}
    >
      <LoopingMp4
        src={panel.src}
        className="absolute inset-0 h-full w-full object-cover"
        initial={false}
        animate={reducedMotion ? { scale: 1 } : { scale: disabled ? 1 : 1.04 }}
        transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
      />

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/25 via-black/15 to-black/70" />
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_160px_rgba(0,0,0,0.75)]" />

      <div className="absolute inset-x-0 bottom-0 p-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/55">
          {panel.id.toUpperCase()}
        </div>
        <div className="mt-2 text-xl font-semibold tracking-tight">
          {panel.title}
        </div>
        <div className="mt-1 text-[12px] text-white/65">{panel.subtitle}</div>

        {!disabled && !reducedMotion && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-[11px] font-semibold text-white/75 backdrop-blur">
            Hover to expand
            <span className="text-white/45">—</span>
            Fullscreen
          </div>
        )}
      </div>

      <motion.div
        className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(120%_120%_at_50%_0%,rgba(255,255,255,0.14),transparent_70%)]"
        animate={
          reducedMotion
            ? undefined
            : { opacity: disabled ? 0.35 : [0.35, 0.65, 0.4] }
        }
        transition={
          reducedMotion
            ? undefined
            : { duration: 2.6, repeat: Infinity, ease: "easeInOut" }
        }
      />
    </div>
  );
}

/* =========================================================
   VAULT: Layer-by-layer stack reveal (3D coin)
   (UPDATED: removed License + Mint layers)
========================================================= */

type VaultLayer = {
  id: string;
  kicker: string;
  title: string;
  body: string;
  ui: { label: string; value: string; mono?: boolean }[];
};

function ScrollyVaultLayers({ enabled }: { enabled: boolean }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pinRef = useRef<HTMLDivElement | null>(null);

  const layerRefs = useRef<HTMLDivElement[]>([]);
  layerRefs.current = [];
  const setLayerRef = (el: HTMLDivElement | null) => {
    if (!el) return;
    if (!layerRefs.current.includes(el)) layerRefs.current.push(el);
  };

  const anim = useRef({
    camX: 0,
    camY: 0.65,
    camZ: 3.6,
    lookY: 0.12,
    rotY: 0,
    explode: 0,
    light: 1.15,
    pulse: 0,
  });

  const layers: VaultLayer[] = useMemo(
    () => [
      {
        id: "l0",
        kicker: "LAYER 00 / ENTRY",
        title: "A vault, not a feed.",
        body:
          "Scroll to progressively “build” the provenance stack. Each layer stays visible, so the system feels tangible.",
        ui: [
          { label: "Mode", value: "Vault Build" },
          { label: "State", value: "Locked → Traceable" },
          { label: "Trust", value: "Layered Evidence" },
        ],
      },
      {
        id: "l1",
        kicker: "LAYER 01 / FINGERPRINT",
        title: "Fingerprint locked.",
        body:
          "We compute a stable identity for your file so you can always prove “this exact work” later.",
        ui: [
          { label: "SHA-256", value: "9f2a…c71b", mono: true },
          { label: "Timestamp", value: "2026-01-02 11:04", mono: true },
          { label: "Integrity", value: "Verified" },
        ],
      },
      {
        id: "l2",
        kicker: "LAYER 02 / IPFS",
        title: "Pinned & immutable.",
        body:
          "The core file is pinned so the fingerprint can’t be swapped quietly behind your back.",
        ui: [
          { label: "CID", value: "bafy…p8x2", mono: true },
          { label: "Pin", value: "Confirmed" },
          { label: "Availability", value: "Distributed" },
        ],
      },
      {
        id: "l3",
        kicker: "LAYER 03 / SIMILARITY",
        title: "Lookalikes flagged.",
        body:
          "We surface suspicious overlaps early, before you publish or share layered source files to anyone.",
        ui: [
          { label: "Matches", value: "3 flagged" },
          { label: "Top overlap", value: "86%" },
          { label: "Action", value: "Review required" },
        ],
      },
    ],
    []
  );

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const pin = pinRef.current;
    if (!wrap || !pin) return;
    if (!enabled) return;

    const cards = layerRefs.current;

    const ctx = gsap.context(() => {
      gsap.set(cards, {
        opacity: 0,
        y: 26,
        scale: 0.98,
        rotateX: 6,
        transformOrigin: "50% 100%",
      });

      if (cards[0])
        gsap.set(cards[0], { opacity: 1, y: 0, scale: 1, rotateX: 0 });

      ScrollTrigger.getAll().forEach((t) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((t as any).trigger === wrap) t.kill();
      });

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: wrap,
          start: "top top",
          end: "bottom bottom",
          scrub: 1,
          pin: pin,
          anticipatePin: 1,
          snap: {
            snapTo: "labels",
            duration: { min: 0.15, max: 0.55 },
            delay: 0.02,
            ease: "power2.out",
          },
        },
      });

      const restack = (activeIndex: number) => {
        cards.forEach((el, i) => {
          const behind = activeIndex - i;
          if (behind < 0) {
            gsap.to(el, {
              opacity: 0,
              y: 26,
              scale: 0.985,
              rotateX: 6,
              duration: 0.35,
              ease: "power2.out",
            });
            return;
          }

          const y = -behind * 16;
          const scale = Math.pow(0.965, behind);
          const opacity = Math.max(0.34, 1 - behind * 0.18);

          gsap.to(el, {
            opacity,
            y,
            scale,
            rotateX: behind === 0 ? 0 : 4,
            duration: 0.45,
            ease: "power2.out",
          });
        });
      };

      tl.addLabel("s0", 0).to(anim.current, {
        rotY: Math.PI * 0.12,
        camZ: 3.25,
        pulse: 0.25,
        duration: 1,
      });

      const steps = [
        {
          label: "s1",
          idx: 1,
          three: { camX: -0.55, camY: 0.78, rotY: Math.PI * 0.45, pulse: 0.6 },
        },
        {
          label: "s2",
          idx: 2,
          three: {
            camX: 0.35,
            camY: 0.7,
            camZ: 3.05,
            rotY: Math.PI * 0.78,
            pulse: 0.85,
          },
        },
        {
          label: "s3",
          idx: 3,
          three: {
            camX: 0.95,
            camY: 0.68,
            camZ: 3.0,
            rotY: Math.PI * 1.05,
            pulse: 1.0,
          },
        },
      ] as const;

      steps.forEach((s) => {
        tl.addLabel(s.label)
          .to(anim.current, { ...s.three, duration: 1 }, "<")
          .call(() => {
            const el = cards[s.idx];
            if (el) gsap.set(el, { opacity: 1 });
            restack(s.idx);
          }, undefined, "<");
      });

      tl.addLabel("end").call(() => restack(cards.length - 1), undefined, "<");

      ScrollTrigger.refresh();
    }, wrap);

    return () => ctx.revert();
  }, [enabled]);

  return (
    <section className="relative bg-black text-white">
      <div ref={wrapRef} className="relative h-[420vh]">
        <div
          ref={pinRef}
          className="sticky top-0 h-[100svh] w-full overflow-hidden"
        >
          <div className="absolute inset-0">
            <Canvas
              camera={{ position: [0, 0.65, 3.6], fov: 42 }}
              dpr={[1, 1.75]}
              gl={{ antialias: true, powerPreference: "high-performance" }}
            >
              <TaedalScene anim={anim} />
            </Canvas>
          </div>

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/85" />
          <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_160px_rgba(0,0,0,0.78)]" />

          <div className="absolute inset-0 z-20">
            <div className="mx-auto max-w-6xl px-6 h-full">
              <div className="grid h-full items-center gap-10 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <div className="pointer-events-none self-center">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/55">
                    TAEDAL VAULT
                  </div>
                  <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight">
                    Build provenance,
                    <span className="text-white/70"> layer by layer.</span>
                  </h2>
                  <p className="mt-4 text-sm leading-6 text-white/65 max-w-md">
                    Each scroll adds a new proof layer. The stack stays visible
                    so it feels real — like you’re assembling a record, not
                    reading a page.
                  </p>
                </div>

                <div className="relative h-[520px] sm:h-[560px] md:h-[600px]">
                  {layers.map((l) => (
                    <div
                      key={l.id}
                      ref={setLayerRef}
                      className="absolute inset-0 will-change-transform"
                      style={{ perspective: "1200px" }}
                    >
                      <div className="h-full rounded-3xl border border-white/10 bg-white/[0.045] backdrop-blur-xl shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
                        <div className="p-6 sm:p-7">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/55">
                              {l.kicker}
                            </div>
                            <div className="text-[10px] text-white/45">
                              vault layer
                            </div>
                          </div>

                          <h3 className="mt-3 text-xl sm:text-2xl font-semibold tracking-tight">
                            {l.title}
                          </h3>
                          <p className="mt-3 text-sm leading-6 text-white/65">
                            {l.body}
                          </p>

                          <div className="mt-6 grid gap-3">
                            {l.ui.map((row, idx) => (
                              <div
                                key={idx}
                                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3"
                              >
                                <div className="flex items-center justify-between gap-4">
                                  <div className="text-[11px] font-semibold text-white/70">
                                    {row.label}
                                  </div>
                                  <div
                                    className={`text-[11px] ${
                                      row.mono ? "font-mono" : "font-semibold"
                                    } text-white/75`}
                                  >
                                    {row.value}
                                  </div>
                                </div>
                                <div className="mt-2 h-[1px] w-full bg-white/10" />
                                <div className="mt-2 text-[10px] text-white/45">
                                  Recorded in the provenance trail.
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 rounded-b-3xl bg-[radial-gradient(70%_70%_at_50%_100%,rgba(255,255,255,0.12),transparent_65%)]" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-6 left-1/2 z-30 -translate-x-1/2 text-[11px] text-white/55">
            Keep scrolling — layers will stack
          </div>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   R3F Scene (coin + particles)
   (UPDATED: coin moved RIGHT a bit on desktop)
========================================================= */

function TaedalScene({
  anim,
}: {
  anim: MutableRefObject<{
    camX: number;
    camY: number;
    camZ: number;
    lookY: number;
    rotY: number;
    explode: number;
    light: number;
    pulse: number;
  }>;
}) {
  const { size } = useThree();
  const isDesktop = size.width >= 1024;

  const COIN_X = isDesktop ? -0.75 : -0.35;
  const COIN_Y = isDesktop ? 0.12 : 0.0;

  const keyLight = useRef<THREE.DirectionalLight>(null);
  const rimLight = useRef<THREE.DirectionalLight>(null);
  const group = useRef<THREE.Group>(null);

  useFrame(({ camera, clock }) => {
    const t = clock.getElapsedTime();

    const targetPos = new THREE.Vector3(
      COIN_X + anim.current.camX,
      COIN_Y + anim.current.camY,
      anim.current.camZ
    );
    camera.position.lerp(targetPos, 0.08);

    camera.lookAt(COIN_X, COIN_Y + anim.current.lookY, 0);

    if (group.current) {
      group.current.rotation.y = THREE.MathUtils.lerp(
        group.current.rotation.y,
        anim.current.rotY,
        0.1
      );
      group.current.rotation.x = 0.08 + Math.sin(t * 0.45) * 0.02;
    }

    if (keyLight.current) {
      keyLight.current.intensity = THREE.MathUtils.lerp(
        keyLight.current.intensity,
        anim.current.light,
        0.08
      );
    }
    if (rimLight.current) {
      rimLight.current.intensity = THREE.MathUtils.lerp(
        rimLight.current.intensity,
        anim.current.light * 0.75,
        0.08
      );
    }
  });

  return (
    <>
      <color attach="background" args={["#000000"]} />
      <fog attach="fog" args={["#000000", 7, 14]} />

      <ambientLight intensity={0.22} />
      <directionalLight
        ref={keyLight}
        position={[3.5, 4.5, 2.5]}
        intensity={1.15}
      />
      <directionalLight
        ref={rimLight}
        position={[-5, 2.0, -2.5]}
        intensity={0.9}
      />
      <pointLight position={[-2.5, 1.2, 2.0]} intensity={0.7} />

      <Particles />

      <group ref={group} position={[COIN_X, COIN_Y, 0]}>
        <Suspense fallback={<FallbackCoin />}>
          <TaedalCoin url="/media/taedal-coin.glb" explodeRef={anim} />
        </Suspense>
      </group>

      <Environment preset="city" />
    </>
  );
}

function Particles() {
  const points = useRef<THREE.Points>(null);

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const N = 900;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 6 + Math.random() * 10;
      const theta = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * 4;
      pos[i * 3 + 0] = Math.cos(theta) * r;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(theta) * r;
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (points.current) {
      points.current.rotation.y = t * 0.02;
      points.current.rotation.x = Math.sin(t * 0.1) * 0.02;
    }
  });

  return (
    <points ref={points} geometry={geom}>
      <pointsMaterial
        size={0.03}
        color="#ffffff"
        transparent
        opacity={0.35}
        sizeAttenuation
      />
    </points>
  );
}

function TaedalCoin({
  explodeRef,
  url,
}: {
  explodeRef: MutableRefObject<{ explode: number; pulse: number }>;
  url: string;
}) {
  const root = useRef<THREE.Group>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gltf = useGLTF(url) as any;
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  const parts = useRef<{
    coin?: THREE.Object3D;
    ring?: THREE.Object3D;
    m1?: THREE.Object3D;
    m2?: THREE.Object3D;
    m3?: THREE.Object3D;
    m4?: THREE.Object3D;
  }>({});

  useEffect(() => {
    const HIDE_NAME_RE =
      /(back|bg|background|plate|panel|card|shadow|plane|ground)/i;

    scene.traverse((obj: any) => {
      if (obj?.isMesh) {
        if (HIDE_NAME_RE.test(obj.name || "")) {
          obj.visible = false;
          return;
        }

        const g = obj.geometry as THREE.BufferGeometry | undefined;
        if (g) {
          if (!g.boundingBox) g.computeBoundingBox();
          const bb = g.boundingBox;
          if (bb) {
            const size = new THREE.Vector3();
            bb.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim > 6) {
              obj.visible = false;
              return;
            }
          }
        }

        const mat = obj.material;
        if (mat) {
          mat.metalness = Math.max(0.6, mat.metalness ?? 0.85);
          mat.roughness = Math.min(0.35, mat.roughness ?? 0.25);
          mat.needsUpdate = true;
        }
      }
    });

    parts.current.coin = scene.getObjectByName("Coin") ?? undefined;
    parts.current.ring = scene.getObjectByName("Ring") ?? undefined;
    parts.current.m1 = scene.getObjectByName("Module1") ?? undefined;
    parts.current.m2 = scene.getObjectByName("Module2") ?? undefined;
    parts.current.m3 = scene.getObjectByName("Module3") ?? undefined;
    parts.current.m4 = scene.getObjectByName("Module4") ?? undefined;
  }, [scene]);

  useFrame(({ clock }) => {
    const e = explodeRef.current.explode;
    const p = explodeRef.current.pulse;
    const t = clock.getElapsedTime();

    const pulse = 1 + Math.sin(t * 2.2) * 0.018 * p;
    if (root.current) root.current.scale.setScalar(pulse);

    const { coin, ring, m1, m2, m3, m4 } = parts.current;

    if (m1 || m2 || m3 || m4 || ring) {
      if (ring) ring.position.set(0, 0, 0.06 + 0.25 * e);

      if (m1) m1.position.set(-0.2 - 0.9 * e, 0.15 + 0.35 * e, 0.12);
      if (m2) m2.position.set(0.2 + 0.9 * e, 0.15 + 0.25 * e, 0.02);
      if (m3) m3.position.set(-0.12 - 0.6 * e, -0.18 - 0.55 * e, -0.08);
      if (m4) m4.position.set(0.12 + 0.6 * e, -0.18 - 0.65 * e, 0.06);

      if (coin) coin.position.set(0, 0, 0);
    } else {
      if (root.current) {
        root.current.position.z = 0.02 + 0.08 * e;
        root.current.scale.setScalar(pulse * (1 + 0.04 * e));
      }
    }
  });

  return (
    <group ref={root} rotation={[0, Math.PI, 0]} position={[0, 0, 0]}>
      <primitive object={scene} scale={1.15} />
    </group>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(useGLTF as any).preload?.("/media/taedal-coin.glb");

function FallbackCoin() {
  return (
    <mesh>
      <cylinderGeometry args={[0.55, 0.55, 0.12, 64]} />
      <meshStandardMaterial color="#e5e7eb" roughness={0.25} metalness={0.85} />
    </mesh>
  );
}

/* =========================================================
   FINAL PORTION:
   cloudy_mountain.glb + 3 main points pinned to 3D axis points
========================================================= */

type MountainAnim = {
  camX: number;
  camY: number;
  camZ: number;
  lookX: number;
  lookY: number;
  lookZ: number;
};

function CloudyMountainModel({ url }: { url: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gltf = useGLTF(url) as any;
  return <primitive object={gltf.scene} />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(useGLTF as any).preload?.("/images/interactive/cloudy_mountain.glb");

function MountainScene({
  anim,
  points,
  activeRef,
}: {
  anim: MutableRefObject<MountainAnim>;
  points: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  activeRef: MutableRefObject<number>;
}) {
  const m1 = useRef<THREE.Mesh>(null);
  const m2 = useRef<THREE.Mesh>(null);
  const m3 = useRef<THREE.Mesh>(null);

  useFrame(({ camera, clock }) => {
    const t = clock.getElapsedTime();

    const targetPos = new THREE.Vector3(
      anim.current.camX,
      anim.current.camY,
      anim.current.camZ
    );
    camera.position.lerp(targetPos, 0.08);

    const look = new THREE.Vector3(
      anim.current.lookX,
      anim.current.lookY,
      anim.current.lookZ
    );
    camera.lookAt(look);

    const a = activeRef.current;
    const pulse = 0.55 + Math.sin(t * 3.2) * 0.15;

    const mats = [m1.current, m2.current, m3.current];
    mats.forEach((mm, idx) => {
      if (!mm) return;
      const on = idx === a;
      mm.scale.setScalar(on ? 1.0 + pulse * 0.2 : 0.9);
      const mat = mm.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = on ? 1.6 : 0.4;
      mat.opacity = on ? 0.95 : 0.55;
      mat.needsUpdate = true;
    });
  });

  return (
    <>
      <color attach="background" args={["#000000"]} />
      <fog attach="fog" args={["#000000", 6, 16]} />

      <ambientLight intensity={0.35} />
      <directionalLight position={[3.5, 5, 2.5]} intensity={1.2} />
      <directionalLight position={[-5, 2, -2]} intensity={0.6} />
      <pointLight position={[0, 2.2, 2.8]} intensity={0.8} />

      <Suspense fallback={null}>
        <group position={[0, -0.55, 0]}>
          <group scale={1.35} rotation={[0, Math.PI, 0]}>
            <CloudyMountainModel url="/images/interactive/cloudy_mountain.glb" />
          </group>

          <mesh ref={m1} position={points[0].toArray()}>
            <sphereGeometry args={[0.055, 22, 22]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#ffffff"
              emissiveIntensity={0.7}
              transparent
              opacity={0.65}
              roughness={0.35}
              metalness={0.2}
            />
          </mesh>

          <mesh ref={m2} position={points[1].toArray()}>
            <sphereGeometry args={[0.055, 22, 22]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#ffffff"
              emissiveIntensity={0.7}
              transparent
              opacity={0.65}
              roughness={0.35}
              metalness={0.2}
            />
          </mesh>

          <mesh ref={m3} position={points[2].toArray()}>
            <sphereGeometry args={[0.055, 22, 22]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#ffffff"
              emissiveIntensity={0.7}
              transparent
              opacity={0.65}
              roughness={0.35}
              metalness={0.2}
            />
          </mesh>
        </group>

        <Environment preset="city" />
      </Suspense>

      <mesh position={[0, 0.35, -0.8]}>
        <planeGeometry args={[3.2, 3.2]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.06}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

function ScrollyMountainShowcase({ enabled }: { enabled: boolean }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pinRef = useRef<HTMLDivElement | null>(null);

  const c1 = useRef<HTMLDivElement | null>(null);
  const c2 = useRef<HTMLDivElement | null>(null);
  const c3 = useRef<HTMLDivElement | null>(null);

  const activeRef = useRef(0);

  const points = useMemo(() => {
    return [
      new THREE.Vector3(-0.85, 0.55, 0.25),
      new THREE.Vector3(0.15, 0.92, -0.15),
      new THREE.Vector3(0.88, 0.38, 0.35),
    ] as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  }, []);

  const anim = useRef<MountainAnim>({
    camX: -1.8,
    camY: 1.25,
    camZ: 3.6,
    lookX: points[0].x,
    lookY: points[0].y,
    lookZ: points[0].z,
  });

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const pin = pinRef.current;
    if (!wrap || !pin) return;
    if (!enabled) return;

    const ctx = gsap.context(() => {
      const cards = [c1.current!, c2.current!, c3.current!];

      gsap.set(cards, { opacity: 0, y: 18, scale: 0.985 });
      gsap.set(cards[0], { opacity: 1, y: 0, scale: 1 });

      ScrollTrigger.getAll().forEach((t) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((t as any).trigger === wrap) t.kill();
      });

      const showCard = (cardIdx: number, pointIdx: number) => {
        activeRef.current = pointIdx;

        cards.forEach((el, i) => {
          gsap.to(el, {
            opacity: i === cardIdx ? 1 : 0,
            y: i === cardIdx ? 0 : 18,
            scale: i === cardIdx ? 1 : 0.985,
            duration: 0.35,
            ease: "power2.out",
          });
        });
      };

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: wrap,
          start: "top top",
          end: "bottom bottom",
          scrub: 1,
          pin: pin,
          anticipatePin: 1,
          snap: {
            snapTo: "labels",
            duration: { min: 0.15, max: 0.55 },
            delay: 0.02,
            ease: "power2.out",
          },
        },
      });

      tl.addLabel("p1", 0)
        .to(anim.current, {
          camX: 0.15,
          camY: 1.62,
          camZ: 2.25,
          lookX: points[1].x,
          lookY: points[1].y,
          lookZ: points[1].z,
          duration: 1,
          ease: "power2.out",
        })
        .call(() => showCard(0, 1), undefined, "<");

      tl.addLabel("p2")
        .to(anim.current, {
          camX: -1.95,
          camY: 1.18,
          camZ: 2.85,
          lookX: points[0].x,
          lookY: points[0].y,
          lookZ: points[0].z,
          duration: 1,
          ease: "power2.out",
        })
        .call(() => showCard(1, 0), undefined, "<");

      tl.addLabel("p3")
        .to(anim.current, {
          camX: 1.95,
          camY: 1.18,
          camZ: 2.75,
          lookX: points[2].x,
          lookY: points[2].y,
          lookZ: points[2].z,
          duration: 1,
          ease: "power2.out",
        })
        .call(() => showCard(2, 2), undefined, "<");

      ScrollTrigger.refresh();
    }, wrap);

    return () => ctx.revert();
  }, [enabled, points]);

  return (
    <section className="relative bg-black text-white">
      <div ref={wrapRef} className="relative h-[360vh]">
        <div
          ref={pinRef}
          className="sticky top-0 h-[100svh] w-full overflow-hidden"
        >
          <div className="absolute inset-0">
            <Canvas
              camera={{ position: [-1.8, 1.25, 2.8], fov: 42 }}
              dpr={[1, 1.75]}
              gl={{ antialias: true, powerPreference: "high-performance" }}
            >
              <MountainScene anim={anim} points={points} activeRef={activeRef} />
            </Canvas>
          </div>

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/80" />
          <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_220px_rgba(0,0,0,0.85)]" />

          <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
            <div className="mx-auto max-w-6xl px-6 pt-10 sm:pt-12">
              <div className="max-w-2xl">
                <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/55">
                  TAEDAL FOUNDATION
                </div>
                <h2 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight">
                  The 3 pillars,
                  <span className="text-white/70">
                    {" "}
                    anchored onto the terrain.
                  </span>
                </h2>
                <p className="mt-3 text-sm leading-6 text-white/65">
                  As you scroll, we “travel” to each axis point on the mountain
                  and reveal one core promise.
                </p>
              </div>
            </div>
          </div>

          <div className="absolute inset-0 z-30">
            <div className="mx-auto max-w-6xl px-6 h-full">
              <div className="h-full grid items-end pb-12 sm:pb-14 md:items-center md:grid-cols-2">
                <div className="hidden md:block" />

                <div className="relative">
                  <div
                    ref={c1}
                    className="rounded-3xl border border-white/10 bg-white/[0.05] backdrop-blur-xl shadow-[0_30px_80px_rgba(0,0,0,0.50)] p-6 sm:p-7"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/55">
                      PILLAR 01
                    </div>
                    <h3 className="mt-3 text-xl sm:text-2xl font-semibold tracking-tight">
                      Fingerprint & lock ownership.
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-white/65">
                      Upload once. Taedal computes a stable identity so you can
                      prove “this exact work” later — without depending on
                      screenshots or DMs.
                    </p>
                    <div className="mt-5 grid gap-2">
                      <Row label="Proof" value="Hash + Timestamp" />
                      <Row label="Integrity" value="Tamper-resistant" />
                    </div>
                  </div>

                  <div
                    ref={c2}
                    className="rounded-3xl border border-white/10 bg-white/[0.05] backdrop-blur-xl shadow-[0_30px_80px_rgba(0,0,0,0.50)] p-6 sm:p-7"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/55">
                      PILLAR 02
                    </div>
                    <h3 className="mt-3 text-xl sm:text-2xl font-semibold tracking-tight">
                      Detect copycats early.
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-white/65">
                      Similarity checks flag suspicious overlaps before you
                      mint, publish, or share layered source files.
                    </p>
                    <div className="mt-5 grid gap-2">
                      <Row label="Scan" value="Internal + external checks" />
                      <Row label="Result" value="Review before mint" />
                    </div>
                  </div>

                  <div
                    ref={c3}
                    className="rounded-3xl border border-white/10 bg-white/[0.05] backdrop-blur-xl shadow-[0_30px_80px_rgba(0,0,0,0.50)] p-6 sm:p-7"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/55">
                      PILLAR 03
                    </div>
                    <h3 className="mt-3 text-xl sm:text-2xl font-semibold tracking-tight">
                      Mint & license with clarity.
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-white/65">
                      Publish a record that’s readable years later — including
                      licensing terms, usage rights, and provenance.
                    </p>
                    <div className="mt-5 grid gap-2">
                      <Row label="Terms" value="Explicit & traceable" />
                      <Row label="Ship" value="Mint-ready record" />
                    </div>
                  </div>

                  <div className="mt-4 text-[11px] text-white/50">
                    Pillar 01 now anchors at the peak point.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* no bottom hint */}
        </div>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="text-[11px] font-semibold text-white/70">{label}</div>
        <div className="text-[11px] font-semibold text-white/75">{value}</div>
      </div>
    </div>
  );
}

/* =========================================================
   Home
========================================================= */

export default function Home() {
  const reducedMotion = usePrefersReducedMotion();

  // NEW: scroll target right after the hero (since STAGE is removed)
  const firstContentRef = useRef<HTMLDivElement | null>(null);

  const [entered, setEntered] = useState(false);
  const [holdingGate, setHoldingGate] = useState(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    if (!entered) document.body.style.overflow = "hidden";
    else document.body.style.overflow = prev || "";
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [entered]);

  useEffect(() => {
    if (!entered) return;
    window.setTimeout(() => {
      firstContentRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 60);
  }, [entered]);

  return (
    <main className="min-h-[100svh] bg-black text-white">
      {/* HERO */}
      <section className="relative h-[100svh] overflow-hidden bg-black">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_80%_at_50%_20%,rgba(255,255,255,0.10),transparent_60%)]" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black via-black/80 to-black" />
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_160px_rgba(0,0,0,0.75)]" />

        <div className="absolute inset-0 z-20 flex items-center justify-center px-6">
          <div className="mx-auto flex max-w-6xl flex-col items-center text-center space-y-10">
            {/* taedal-wink */}
            <LoopingMp4
              src="/images/taedal-wink.mp4"
              className={`h-auto w-[56vw] max-w-[300px] sm:w-[60vw] sm:max-w-[340px] lg:w-[360px] ${
                holdingGate ? "opacity-95" : "opacity-100"
              } drop-shadow-[0_28px_90px_rgba(0,0,0,0.55)]`}
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.75 }}
            />

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.75, delay: 0.06 }}
            >
              <BrandNameLockup />
            </motion.div>

            <motion.p
              className="max-w-xl text-sm text-white/60"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.12 }}
            >
              A cinematic vault for provenance — now revealed as a stack you
              build.
            </motion.p>

            {!entered ? (
              <PressHoldGate
                onComplete={() => setEntered(true)}
                onSetHolding={setHoldingGate}
              />
            ) : (
              <motion.div
                className="text-[11px] text-white/55"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
              >
                Entered.
              </motion.div>
            )}
          </div>
        </div>
      </section>

      {/* REMOVED: STAGE (moon/guards/mascot scroll reveal) */}
      <div ref={firstContentRef} />

      {/* KURO RUNNER SCENE */}
      <RunScene enabled={entered} />

      {/* VAULT */}
      {reducedMotion ? (
        <section className="bg-black py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-7 sm:p-10">
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/55">
                VAULT (REDUCED MOTION)
              </div>
              <h2 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight">
                Provenance, layer by layer.
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/70">
                Reduced motion is enabled, so interactive scroll-tied animations
                are disabled.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <ScrollyVaultLayers enabled={entered} />
      )}

      {/* MOUNTAIN FINAL */}
      {reducedMotion ? (
        <section className="bg-black py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-7 sm:p-10">
              <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/55">
                FOUNDATIONAL PILLARS (REDUCED MOTION)
              </div>
              <h2 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight">
                Three pillars of Taedal
              </h2>
              <p className="mt-3 text-sm leading-6 text-white/70">
                1) Fingerprint & lock ownership 2) Detect copycats early 3) Mint
                & license with clarity
              </p>
            </div>
          </div>
        </section>
      ) : (
        <ScrollyMountainShowcase enabled={entered} />
      )}

      {/* TRIPLE VIDEO SECTION */}
      <InteractiveTripleVideos enabled={entered} />

      {/* CTA */}
      <section className="bg-black pb-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-7 sm:p-10">
            <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-white/55">
              NEXT
            </div>
            <h3 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight">
              Ready to fingerprint your first piece?
            </h3>
            <p className="mt-3 text-sm text-white/65 max-w-2xl">
              Start with one upload — a digital illustration, a print edition,
              or a physical piece. Taedal turns it into a traceable record you
              can confidently share.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a
                href="/create"
                className="rounded-full bg-white px-6 py-2 text-sm font-medium text-slate-950 shadow-lg shadow-black/40 hover:bg-slate-100 transition"
              >
                Upload an artwork
              </a>
              <a
                href="/art"
                className="rounded-full border border-white/25 bg-black/30 px-6 py-2 text-sm font-medium text-white/90 hover:border-white/45 hover:bg-white/5 transition"
              >
                Explore sample pieces
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
