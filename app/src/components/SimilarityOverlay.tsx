import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  message?: string;
  backdropAlpha?: number; // 0..1 (default 0.9)
};

export default function SimilarityOverlay({
  open,
  message = "Scanning for similar artworks…",
  backdropAlpha = 0.9,
}: Props) {
  const vidRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;

    if (open) {
      try { v.currentTime = 0; } catch {}
      const play = async () => {
        try { await v.play(); } catch {}
      };
      if (v.readyState >= 2) play();
      else v.onloadeddata = play;
    } else {
      try { v.pause(); } catch {}
    }

    return () => { try { v?.pause(); } catch {} };
  }, [open]);

  if (!open) return null;

  const bg = `rgba(0,0,0,${Math.min(Math.max(backdropAlpha, 0), 1)})`;

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center"
      style={{ backgroundColor: bg }}
      role="dialog"
      aria-modal="true"
      aria-label="Checking for similar artworks"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex flex-col items-center gap-4 px-6">
        <video
          ref={vidRef}
          src="/media/similarity.webm"
          className="w-[420px] max-w-[80vw] rounded-xl shadow-lg"
          muted
          playsInline
          loop
          autoPlay
          preload="auto"
        />
        <div className="text-neutral-300 text-sm text-center">{message}</div>
      </div>
    </div>
  );
}
