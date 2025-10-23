import { startTour } from "./tours";

export type AssistantAction = {
  key: string;            // <- this fixes "Property 'key' does not exist" errors
  label: string;
  run: () => void | Promise<void>;
};

export const actions: AssistantAction[] = [
  {
    key: "toggle-theme",
    label: "Toggle light/dark theme",
    run: () => {
      // ThemeProvider listens for this event and toggles immediately
      window.dispatchEvent(new CustomEvent("assistant:toggleTheme"));
    },
  },
  {
    key: "start-tour",
    label: "Show quick tour",
    run: () => startTour(),
  },
  {
    key: "go-upload-avatar",
    label: "Go to profile to upload avatar",
    run: () => {
      // Navigate the user to Account page (where avatar upload lives)
      window.location.assign("/account");
    },
  },
];
