// src/assistant/actions.ts
import { startTour } from "./tours";

/** All actions the assistant can trigger */
export type AssistantAction =
  | { type: "START_TOUR" }
  | { type: "TOGGLE_THEME"; mode: "light" | "dark" | "system" }
  | { type: "GUIDE_UPLOAD_AVATAR" }
  | { type: "NAVIGATE"; to: string }
  | { type: "NONE" };

/** Side-effects for each action (DOM-only; no global state required) */
export async function runAction(action: AssistantAction) {
  switch (action.type) {
    case "START_TOUR": {
      startTour();
      return;
    }

    case "TOGGLE_THEME": {
      // Prefer going through ThemeProvider so React state stays consistent
      const mode = action.mode;
      const ev = new CustomEvent("assistant:setTheme", { detail: mode });
      window.dispatchEvent(ev);
      return;
    }

    case "GUIDE_UPLOAD_AVATAR": {
      // 1) navigate to /account
      if (window.location.pathname !== "/account") {
        window.history.pushState({}, "", "/account");
        window.dispatchEvent(new PopStateEvent("popstate"));
      }

      // 2) Wait for DOM and highlight the avatar "Change" label
      const wait = (sel: string, timeout = 8000) =>
        new Promise<HTMLElement | null>((resolve) => {
          const t0 = performance.now();
          const id = window.setInterval(() => {
            const el = document.querySelector<HTMLElement>(sel);
            if (el) {
              clearInterval(id);
              resolve(el);
            }
            if (performance.now() - t0 > timeout) {
              clearInterval(id);
              resolve(null);
            }
          }, 120);
        });

      const { driver } = await import("driver.js");
      await import("driver.js/dist/driver.css");

      const d = driver({
        allowClose: true,
        overlayOpacity: 0.5,
        showProgress: true,
      });

      const changeAvatarLabel = await wait('label:has(input[type="file"][accept^="image/"])');

      const steps: any[] = [
        {
          element: 'img[alt="avatar"]',
          popover: {
            title: "Your avatar",
            description: "Click the Change button to select a new image.",
            side: "bottom",
            align: "start",
          },
        },
      ];

      if (changeAvatarLabel) {
        steps.push({
          element: changeAvatarLabel,
          popover: {
            title: "Change avatar",
            description: "Click here, choose an image, crop, then Save.",
            side: "top",
            align: "start",
          },
        });
      }

      d.setSteps(steps);
      d.drive();
      return;
    }

    case "NAVIGATE": {
      if (window.location.pathname !== action.to) {
        window.history.pushState({}, "", action.to);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
      return;
    }

    case "NONE":
    default:
      return;
  }
}
