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
export async function tryPlayWithSound(
  el: HTMLMediaElement,
  volume = 0.85
): Promise<"playing-with-sound" | "playing-muted" | "failed"> {
  if (!el) return "failed";

  const vid = el as HTMLVideoElement;
  try {
    vid.playsInline = true;
    vid.autoplay = true;
    vid.preload = "auto";
  } catch {}

  if (hasAudioConsent()) {
    try {
      el.muted = false;
      el.volume = volume;
      await el.play();
      return "playing-with-sound";
    } catch {}
  }

  try {
    el.muted = false;
    el.volume = volume;
    await el.play();
    setAudioConsent();
    return "playing-with-sound";
  } catch {
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
 * One-shot listeners to unmute/resume on first user gesture.
 */
export function bindUnmuteOnFirstGesture(el: HTMLMediaElement, volume = 0.85) {
  if (!el) return;
  if (hasAudioConsent()) return;

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
    } catch {}
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
 * Try play with sound; if blocked, start muted and bind gesture.
 */
export async function ensureAutoplayWithSound(
  el: HTMLMediaElement,
  volume = 0.85
): Promise<"playing-with-sound" | "playing-muted" | "failed"> {
  const res = await tryPlayWithSound(el, volume);
  if (res !== "playing-with-sound") bindUnmuteOnFirstGesture(el, volume);
  return res;
}

/** After consent, unmute + resume all media on the page. */
export function unmuteAllPlaying(volume = 0.85) {
  const nodes = Array.from(document.querySelectorAll("video, audio")) as HTMLMediaElement[];
  nodes.forEach(async (m) => {
    try {
      m.muted = false;
      m.volume = volume;
      await m.play().catch(() => {});
    } catch {}
  });
}

/**
 * Pause/mute every <video>/<audio> in the document except the ones provided.
 * Useful when switching routes or showing intro overlays.
 */
export function pauseAllExcept(except: HTMLMediaElement[] = []) {
  const keep = new Set(except.filter(Boolean));
  const nodes = Array.from(document.querySelectorAll("video, audio")) as HTMLMediaElement[];
  nodes.forEach((m) => {
    if (!keep.has(m)) {
      try {
        m.pause();
        m.muted = true;
      } catch {}
    }
  });
}
