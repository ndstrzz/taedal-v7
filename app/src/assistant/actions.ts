// app/src/assistant/actions.ts
export type AssistantAction =
  | { type: "toggleTheme"; mode: "light" | "dark" | "system" }
  | { type: "goTo"; path: string }
  | { type: "startTour"; key: "uploadAvatar" | "createListing" };

type Env = {
  navigate: (path: string) => void;
  setTheme: (mode: "light" | "dark" | "system") => void;
  startTour: (key: AssistantAction["key"]) => void;
};

export async function runAssistantAction(a: AssistantAction, env: Env) {
  switch (a.type) {
    case "toggleTheme":
      env.setTheme(a.mode);
      return { ok: true, message: `Theme set to ${a.mode}.` };
    case "goTo":
      env.navigate(a.path);
      return { ok: true, message: `Navigated to ${a.path}.` };
    case "startTour":
      env.startTour(a.key);
      return { ok: true, message: `Starting ${a.key} tutorial…` };
    default:
      return { ok: false, message: "Unknown action." };
  }
}
