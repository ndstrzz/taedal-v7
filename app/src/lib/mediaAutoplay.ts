// app/src/lib/mediaAutoplay.ts

export const AUDIO_FLAG = "taedal_audio_ok";

/* ----------------------- consent flag helpers ----------------------- */
export function hasAudioConsent(): boolean {
  try {
    return localStorage.getItem(AUDIO_FLAG) === "1";
  } catch {
    return false;
  }
}

export function setAudioConsent() {
  try {
    localStorage.setItem(AUDIO_FLAG, "1");
  } catch {}
}

/* -------------------- core autoplay + sound logic ------------------- */
/**
 * Tries to autoplay a media element with sound.
 * If blocked, plays it muted.
 *
 * Returns:
 *  - "playing-with-sound": audio is on
 *  - "playing-muted": played muted due to autoplay policy
 *  - "failed": couldn't start at all
 */
export async function tryPlayWithSound(
  el: HTMLMediaElement,
  volume = 0.85
): Promise<"playing-with-sound" | "playing-muted" | "failed"> {
  if (!el) return "failed";

  // Best-effort hints (videos only)
  const vid = el as HTMLVideoElement;
  try {
    vid.playsInline = true;
    vid.autoplay = true;
    vid.preload = "auto";
  } catch {}

  // If we already unlocked audio before, go straight to sound
  if (hasAudioConsent()) {
    try {
      el.muted = false;
      el.volume = volume;
      await el.play();
      return "playing-with-sound";
    } catch {
      /* fall through to normal attempts */
    }
  }

  // 1) Try with sound
  try {
    el.muted = false;
    el.volume = volume;
    await el.play();
    setAudioConsent();
    return "playing-with-sound";
  } catch {
    // 2) Fallback: muted
    try {
      el.muted = true;
      el.volume = 0;
      await el.play();
      return "playing-muted";
    } catch {
      return "failed";
    }
  }
}

/**
 * Attaches one-shot listeners to unmute and resume playback
 * on the first user gesture (click/touch/keydown/scroll).
 */
export function bindUnmuteOnFirstGesture(el: HTMLMediaElement, volume = 0.85) {
  if (!el) return;
  if (hasAudioConsent()) return; // nothing to do, already unlocked

  function remove() {
    ["pointerdown", "click", "keydown", "touchstart", "scroll"].forEach((evt) =>
      window.removeEventListener(evt, unlock as any)
    );
  }

  async function unlock() {
    try {
      el.muted = false;
      el.volume = volume;
      await el.play().catch(() => {});
      setAudioConsent();
    } catch {
      /* ignore */
    }
    remove();
  }

  ["pointerdown", "click", "keydown", "touchstart", "scroll"].forEach((evt) =>
    window.addEventListener(evt, unlock as any, {
      once: true,
      passive: evt === "touchstart" || evt === "scroll",
    })
  );
}

/**
 * Convenience: try to play with sound; if policy blocks it,
 * start muted and wire a one-gesture unmute.
 */
export async function ensureAutoplayWithSound(
  el: HTMLMediaElement,
  volume = 0.85
): Promise<"playing-with-sound" | "playing-muted" | "failed"> {
  const res = await tryPlayWithSound(el, volume);
  if (res !== "playing-with-sound") {
    bindUnmuteOnFirstGesture(el, volume);
  }
  return res;
}

/** After consent, unmute + resume all media on the page. */
export function unmuteAllPlaying(volume = 0.85) {
  const nodes = Array.from(
    document.querySelectorAll("video, audio")
  ) as HTMLMediaElement[];
  nodes.forEach(async (m) => {
    try {
      m.muted = false;
      m.volume = volume;
      await m.play().catch(() => {});
    } catch {}
  });
}
