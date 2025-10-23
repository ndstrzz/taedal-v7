// src/assistant/intent.ts
import type { AssistantAction } from "./actions";

/** very small rules-based classifier */
export function classifyIntent(text: string): AssistantAction {
  const q = (text || "").toLowerCase().trim();

  if (!q) return { type: "NONE" };

  // theme
  if (/\b(light|white)\b.*theme|theme.*\blight\b/.test(q)) {
    return { type: "TOGGLE_THEME", mode: "light" };
  }
  if (/\b(dark|black)\b.*theme|theme.*\bdark\b/.test(q)) {
    return { type: "TOGGLE_THEME", mode: "dark" };
  }
  if (/\bsystem\b.*theme|theme.*\bsystem\b/.test(q)) {
    return { type: "TOGGLE_THEME", mode: "system" };
  }
  if (/toggle.*theme|switch.*theme|change.*theme/.test(q)) {
    // default toggle behavior: if body is light -> dark else light
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    return { type: "TOGGLE_THEME", mode: isLight ? "dark" : "light" };
  }

  // tours / help
  if (/tour|show me around|guide me|help me/.test(q)) {
    return { type: "START_TOUR" };
  }

  // avatar onboarding
  if (/upload.*avatar|change.*avatar|set.*avatar|profile.*picture/.test(q)) {
    return { type: "GUIDE_UPLOAD_AVATAR" };
  }

  // go to account/profile
  if (/\b(go|open|take|navigate)\b.*\b(account|profile)\b/.test(q)) {
    return { type: "NAVIGATE", to: "/account" };
  }

  return { type: "NONE" };
}
