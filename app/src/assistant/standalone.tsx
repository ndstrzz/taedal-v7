// src/assistant/standalone.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import AssistantDock from "./AssistantDock";

/**
 * Standalone mount so the assistant appears even if App fails to render for any reason.
 * It NOOPs if the normal portal root already exists (i.e., App mounted it).
 */

const STANDALONE_ID = "assistant-standalone-root";
const PORTAL_ID = "assistant-dock-root";

function ensureContainer(): HTMLElement {
  let el = document.getElementById(STANDALONE_ID) as HTMLElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = STANDALONE_ID;
    // inert, out-of-flow container
    el.style.position = "fixed";
    el.style.inset = "0 auto auto 0";
    el.style.zIndex = "2147483646";
    el.style.pointerEvents = "none";
    el.style.width = "0";
    el.style.height = "0";
    document.body.appendChild(el);
    console.log("[assistant] standalone container created");
  }
  return el;
}

function alreadyMounted(): boolean {
  return !!document.getElementById(PORTAL_ID);
}

function mount() {
  if (alreadyMounted()) {
    console.log("[assistant] portal root already present; standalone mount skipped");
    return;
  }
  const container = ensureContainer();
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <AssistantDock />
    </React.StrictMode>
  );
  console.log("[assistant] standalone AssistantDock mounted");
}

// Mount after DOM is ready
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
