// app/src/assistant/intent.ts
import type { AssistantAction } from "./actions";

const contains = (s: string, ...xs: string[]) => xs.some(x => s.includes(x));

export function inferActionFromText(text: string): { reply?: string; action?: AssistantAction } {
  const m = text.toLowerCase().trim();

  // theme
  if (contains(m, "light theme", "go light", "light mode", "switch to light")) {
    return { reply: "Sure — switching to light theme.", action: { type: "toggleTheme", mode: "light" } };
  }
  if (contains(m, "dark theme", "go dark", "dark mode", "switch to dark")) {
    return { reply: "Got it — dark mode on.", action: { type: "toggleTheme", mode: "dark" } };
  }
  if (contains(m, "system theme", "follow system")) {
    return { reply: "Okay — following your system theme.", action: { type: "toggleTheme", mode: "system" } };
  }

  // navigation
  if (contains(m, "go to account", "open account", "profile settings", "edit profile")) {
    return { reply: "Taking you to your account page.", action: { type: "goTo", path: "/account" } };
  }
  if (contains(m, "go home", "go to home", "open explore", "explore")) {
    return { reply: "Heading to Explore.", action: { type: "goTo", path: "/" } };
  }
  if (contains(m, "create artwork", "new artwork", "open studio", "create page")) {
    return { reply: "Opening Create page.", action: { type: "goTo", path: "/create" } };
  }

  // tutorial
  if (contains(m, "guide", "how", "help") && contains(m, "avatar")) {
    return { reply: "I’ll guide you to upload an avatar.", action: { type: "startTour", key: "uploadAvatar" } };
  }

  return {
    reply:
      "I can change themes, navigate pages, or start an in-app tutorial. Try “switch to light theme”, “go to account”, or “guide me to upload an avatar”."
  };
}
