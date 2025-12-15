// app/src/routes/home/Home.tsx
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
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
      if (document.hidden) {
        try {
          v.pause();
        } catch {}
      } else {
        startPlayback();
        pauseOtherMediaExcept(v);
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
      try {
        v.pause();
        v.muted = true;
      } catch {}
    };
  }, [src]);

  return (
    <main className="min-h-[100svh] bg-slate-950 text-white">
      {/* -------- HERO: video + intro ---------- */}
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
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/65 via-black/45 to-black/65" />
        <div className="pointer-events-none absolute inset-0 z-10 bg-black/20 backdrop-blur-sm" />

        {/* center content */}
        <div className="absolute inset-0 z-20 flex items-center justify-center px-6">
          <div className="mx-auto flex max-w-4xl flex-col items-center text-center space-y-6">
            <motion.img
              src="/images/taedal-home.svg"
              alt="taedal"
              draggable={false}
              className="w-[150px] sm:w-[150px] lg:w-[160px] xl:w-[180px] drop-shadow-[0_6px_40px_rgba(0,0,0,0.6)]"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
            />

            <motion.p
              className="text-[10px] font-semibold uppercase tracking-[0.35em] text-slate-300/80"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.05 }}
            >
              Provenance for emerging artists
            </motion.p>

            <motion.h1
              className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-white"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
            >
              Turn every upload into
              <span className="block text-indigo-200">
                verifiable, tamper-proof ownership.
              </span>
            </motion.h1>

            <motion.p
              className="max-w-[34rem] text-sm sm:text-base text-slate-200/85"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15 }}
            >
              Taedal helps you upload, check, mint and license your physical &amp; digital artworks,
              so you can prove “I made this first” without digging through old screenshots.
            </motion.p>

            <motion.div
              className="flex flex-wrap items-center justify-center gap-3 pt-2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
            >
              <a
                href="/create"
                className="rounded-full bg-white px-6 py-2 text-sm font-medium text-slate-950 shadow-lg shadow-black/40 hover:bg-slate-100 transition"
              >
                Start with your first artwork
              </a>
              <a
                href="#how-it-works"
                className="rounded-full border border-slate-500/70 bg-black/20 px-6 py-2 text-sm font-medium text-slate-100 hover:border-slate-300/80 hover:bg-white/5 transition"
              >
                How Taedal works
              </a>
            </motion.div>
          </div>
        </div>

        {/* small loading cue until canplay fires */}
        {!ready && (
          <div className="absolute bottom-8 left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
            Loading…
          </div>
        )}

        {/* optional debug: no audio track detected */}
        {ready && hasAudio === false && (
          <div className="absolute bottom-8 right-8 z-30 rounded bg-black/60 px-3 py-1 text-[10px] text-white">
            No audio track in this video
          </div>
        )}

        {/* scroll hint */}
        <motion.div
          className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-1 text-[11px] text-slate-200/80"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.4 }}
        >
          <span>Scroll to see how it works</span>
          <motion.div
            className="h-6 w-[1px] bg-slate-400/70"
            animate={{ y: [0, 8, 0] }}
            transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
          />
        </motion.div>
      </section>

      {/* -------- SCROLL SECTIONS BELOW VIDEO ---------- */}
      <IntroSection />
      <HowItWorksSection />
      <FeaturesSection />
      <StatsSection />
      <CallToActionSection />
    </main>
  );
}

/* -------------- SECTIONS -------------- */

function IntroSection() {
  const introVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = introVideoRef.current;
    if (!v) return;

    v.muted = true;
    v.loop = true;
    v.playsInline = true;

    const tryPlay = () => {
      v.play().catch(() => {
        // ignore autoplay errors
      });
    };

    // try immediately and when ready
    tryPlay();
    v.addEventListener("canplay", tryPlay);

    return () => {
      v.removeEventListener("canplay", tryPlay);
      try {
        v.pause();
      } catch {}
    };
  }, []);

  return (
    <section className="relative bg-slate-950 py-20 sm:py-24 overflow-hidden">
      {/* Background video */}
      <video
        ref={introVideoRef}
        className="absolute inset-0 h-full w-full object-cover"
        src="/images/break free.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      />

      {/* same colour & opacity stack as hero */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/65 via-black/45 to-black/65" />
      <div className="pointer-events-none absolute inset-0 z-10 bg-black/20 backdrop-blur-sm" />

      {/* Content */}
      <div className="relative z-20 mx-auto max-w-5xl px-6">
        <motion.div
          className="space-y-4 max-w-3xl"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.6 }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-300">
            What is Taedal?
          </p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-white">
            A provenance layer for artists who ship both physical and digital art.
          </h2>
          <p className="text-sm sm:text-base text-slate-100/90">
            Today, most collabs, commissions and print runs live in DMs, screenshots and random
            cloud folders. Taedal gives you a single place to upload your work, lock in the
            fingerprint, check for copycats and mint or license it with a traceable record.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const steps = [
    {
      step: "01",
      title: "Upload once, fingerprint forever.",
      body: "Drag in your artwork file. Taedal hashes it, stores it safely and pins it to IPFS so the core fingerprint can’t be quietly changed later.",
    },
    {
      step: "02",
      title: "Check for lookalikes and red flags.",
      body: "We compare against Taedal’s database and an external reverse image check to highlight suspiciously similar works before you mint or send files to anyone.",
    },
    {
      step: "03",
      title: "Mint & license with a clear record.",
      body: "When you’re ready, mint the piece as an NFT and attach licensing terms so future collectors and clients can see exactly what they’re allowed to do.",
    },
  ];

  return (
    <section id="how-it-works" className="bg-slate-950 pb-20 sm:pb-24">
      <div className="mx-auto max-w-6xl px-6 grid gap-12 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* Left: sticky explainer */}
        <div className="md:sticky md:top-24 self-start space-y-4">
          <motion.p
            className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.5 }}
          >
            How it works
          </motion.p>
          <motion.h2
            className="text-2xl sm:text-3xl font-semibold text-white"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.6, delay: 0.05 }}
          >
            From “new file” to{" "}
            <span className="text-indigo-200">“I can prove this is mine”.</span>
          </motion.h2>
          <motion.p
            className="text-sm text-slate-300 max-w-md"
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            Every upload goes through the same flow, whether it becomes a 1/1 digital piece, a
            physical print run or a commercial collab.
          </motion.p>
        </div>

        {/* Right: scrollable steps */}
        <div className="space-y-8">
          {steps.map((s, idx) => (
            <motion.div
              key={s.step}
              className="relative rounded-3xl border border-slate-800 bg-slate-900/70 p-6 sm:p-7"
              initial={{ opacity: 0, y: 26 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.6, delay: idx * 0.08 }}
            >
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500">
                {s.step}
              </div>
              <h3 className="mb-2 text-sm sm:text-base font-semibold text-white">{s.title}</h3>
              <p className="text-xs sm:text-sm text-slate-300">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const features = [
    {
      tag: "Similarity & reverse checks",
      title: "Spot copycats early.",
      body: "Check your piece against Taedal’s index plus an external internet image search to catch suspicious overlaps before sending layered files.",
    },
    {
      tag: "Physical + digital",
      title: "Bridge canvases, prints & NFTs.",
      body: "Attach on-chain provenance to both the digital file and the physical edition so collectors know what they’re buying.",
    },
    {
      tag: "Licensing & contracts",
      title: "Turn DMs into real terms.",
      body: "Standard templates for collabs and brand work, with milestone-based payouts and a record both sides can refer back to.",
    },
  ];

  return (
    <section className="bg-slate-950 py-20 sm:py-24">
      <div className="mx-auto max-w-5xl px-6 space-y-10">
        <motion.div
          className="space-y-3 max-w-3xl"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.6 }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
            What you can do here
          </p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-white">
            Everything around your artwork, in one place.
          </h2>
          <p className="text-sm sm:text-base text-slate-300">
            Taedal isn’t just a marketplace. It’s the place where you prepare your work, lock in
            ownership, and ship it out with clear terms.
          </p>
        </motion.div>

        <div className="grid gap-6 md:grid-cols-3">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/70 p-5"
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 mb-2">
                {f.tag}
              </p>
              <h3 className="mb-2 text-sm sm:text-base font-semibold text-white">{f.title}</h3>
              <p className="text-xs sm:text-sm text-slate-300">{f.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatsSection() {
  const stats = [
    { label: "artworks fingerprinted", value: "12,430+" },
    { label: "creators protected", value: "980+" },
    { label: "countries represented", value: "34" },
  ];

  return (
    <section className="bg-slate-950 pb-20 sm:pb-24">
      <div className="mx-auto max-w-5xl px-6">
        <motion.div
          className="rounded-3xl border border-slate-800 bg-slate-900/80 px-6 py-8 sm:px-10 sm:py-10"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.6 }}
        >
          <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
                Taedal by the numbers
              </p>
              <h2 className="text-xl sm:text-2xl font-semibold text-white">
                Early artists are already shipping with provenance.
              </h2>
            </div>
            <p className="max-w-md text-xs sm:text-sm text-slate-300">
              These numbers are placeholders while Taedal is in development, but this is the scale
              we’re building towards.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                className="space-y-1"
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
              >
                <div className="text-2xl sm:text-3xl font-semibold text-white">{s.value}</div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                  {s.label}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function CallToActionSection() {
  return (
    <section className="bg-slate-950 pb-24">
      <div className="mx-auto max-w-4xl px-6">
        <motion.div
          className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900/95 to-slate-950 px-6 py-10 sm:px-10 sm:py-12 text-center"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.6 }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-400">
            Ready to try it?
          </p>
          <h2 className="mt-3 text-2xl sm:text-3xl font-semibold text-white">
            Upload one artwork and see what Taedal does with it.
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-300 max-w-xl mx-auto">
            Start with a single piece — a canvas, a print or a digital illustration. We&apos;ll
            fingerprint it, check for lookalikes and help you prepare it for collectors.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/create"
              className="rounded-full bg-white px-6 py-2 text-sm font-medium text-slate-950 shadow-lg shadow-black/40 hover:bg-slate-100 transition"
            >
              Upload an artwork
            </a>
            <a
              href="/art"
              className="rounded-full border border-slate-500/70 bg-black/20 px-6 py-2 text-sm font-medium text-slate-100 hover:border-slate-300/80 hover:bg-white/5 transition"
            >
              Explore sample pieces
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
