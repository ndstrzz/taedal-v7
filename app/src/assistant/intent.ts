// src/assistant/intent.ts
import type { AssistantAction } from "./actions";

/** very small rules-based classifier */
export function classifyIntent(text: string): AssistantAction {
  const q = (text || "").toLowerCase().trim();

  if (!q) return { type: "NONE" };

  // theme
  if (/\b(light|white)\b.*(theme|mode)|(theme|mode).*\blight\b/.test(q)) {
    return { type: "TOGGLE_THEME", mode: "light" };
  }
  if (/\b(dark|black)\b.*(theme|mode)|(theme|mode).*\bdark\b/.test(q)) {
    return { type: "TOGGLE_THEME", mode: "dark" };
  }
  if (/\bsystem\b.*(theme|mode)|(theme|mode).*\bsystem\b/.test(q)) {
    return { type: "TOGGLE_THEME", mode: "system" };
  }
  if (/toggle.*(theme|mode)|switch.*(theme|mode)|change.*(theme|mode)/.test(q)) {
    // Default toggle by asking ThemeProvider to toggle (custom event with no detail)
    window.dispatchEvent(new Event("assistant:toggleTheme"));
    return { type: "NONE" };
  }

  // tours / help
  if (/(^|\b)(tour|show me around|guide me|help me)(\b|$)/.test(q)) {
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
