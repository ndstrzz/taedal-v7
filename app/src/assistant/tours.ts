// app/src/assistant/tours.ts (your own file – name it as you like)
import { driver } from "driver.js";
import "driver.js/dist/driver.css";

export function runThemeTour() {
  const tour = driver({
    showProgress: true,
    steps: [
      {
        element: "#theme-toggle",
        popover: {
          title: "Switch theme",
          description: "Click here to toggle light/dark mode.",
          side: "bottom",
          align: "start",
        },
      },
    ],
  });
  tour.drive();
}

export function runAvatarTour() {
  const tour = driver({
    showProgress: true,
    steps: [
      {
        element: "#sidebar-settings",
        popover: {
          title: "Open settings",
          description: "Open your account settings.",
        },
      },
      {
        element: "#avatar-upload-button",
        popover: {
          title: "Upload avatar",
          description: "Click to choose a new avatar image.",
        },
      },
    ],
  });
  tour.drive();
}
