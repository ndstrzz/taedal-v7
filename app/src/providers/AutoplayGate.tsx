// app/src/providers/AutoplayGate.tsx
import { useEffect } from "react";
import { hasAudioConsent, setAudioConsent, unmuteAllPlaying } from "../lib/mediaAutoplay";

export default function AutoplayGate() {
  useEffect(() => {
    if (hasAudioConsent()) return;
    const unlock = () => {
      setAudioConsent();
      unmuteAllPlaying();
      cleanup();
    };
    const cleanup = () => {
      ["pointerdown","click","keydown","touchstart","scroll"].forEach(evt =>
        window.removeEventListener(evt, unlock)
      );
    };
    ["pointerdown","click","keydown","touchstart","scroll"].forEach(evt =>
      window.addEventListener(evt, unlock, { once: true, passive: evt==="scroll"||evt==="touchstart" })
    );
    return cleanup;
  }, []);

  // Optional: resume sound after tab visibility changes (Safari/iOS)
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && hasAudioConsent()) unmuteAllPlaying(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return null;
}
