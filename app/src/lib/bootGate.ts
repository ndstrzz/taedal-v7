// app/src/lib/bootGate.ts

const KEY = "taedal_boot_seen";
const VER_KEY = "taedal_boot_version";

/**
 * Change this when you want to re-show the boot page for everyone
 * after a major update (e.g., assets changed).
 */
export const BOOT_VERSION = "v1";

/** Returns true if boot should be shown (first time / new version). */
export function shouldShowBootOnce(scope: string = "site"): boolean {
  try {
    const savedVer = localStorage.getItem(VER_KEY);
    const raw = localStorage.getItem(KEY);
    const parsed: Record<string, "1"> = raw ? JSON.parse(raw) : {};

    // If version changed, force-show again and clear old flags.
    if (savedVer !== BOOT_VERSION) {
      localStorage.setItem(VER_KEY, BOOT_VERSION);
      localStorage.removeItem(KEY);
      return true;
    }

    return parsed?.[scope] !== "1";
  } catch {
    // If storage is blocked, gracefully show once.
    return true;
  }
}

/** Mark boot as seen for a given scope ("site" recommended). */
export function markBootSeen(scope: string = "site") {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: Record<string, "1"> = raw ? JSON.parse(raw) : {};
    parsed[scope] = "1";
    localStorage.setItem(KEY, JSON.stringify(parsed));
    localStorage.setItem(VER_KEY, BOOT_VERSION);
  } catch {
    /* ignore */
  }
}
