// src/assistant/tours.ts
import { driver } from "driver.js";
import "driver.js/dist/driver.css";

export function startTour() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const d = driver({
    allowClose: true,
    animate: true,
    overlayOpacity: 0.5,
    showProgress: true,
  });

  const steps: any[] = [];

  if (document.querySelector("input[placeholder*='search the name']")) {
    steps.push({
      element: "input[placeholder*='search the name']",
      popover: {
        title: "Search",
        description: "Find artworks or users by typing here.",
        side: "bottom", // v1 uses side/align instead of position
        align: "start",
      },
    });
  }

  if (document.querySelector(".btn, button.btn")) {
    steps.push({
      element: ".btn, button.btn",
      popover: {
        title: "Primary actions",
        description: "Buttons like this perform primary actions.",
        side: "bottom",
        align: "start",
      },
    });
  }

  if (!steps.length) return;
  d.setSteps(steps);
  d.drive();
}
