// src/assistant/bootstrap.tsx
import React from "react";
import { createRoot } from "react-dom/client";
import AssistantDock from "./AssistantDock";

const STANDALONE_ID = "assistant-standalone-root";

function ensureContainer(): HTMLElement {
  let el = document.getElementById(STANDALONE_ID) as HTMLElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = STANDALONE_ID;
    // Keep this container inert & out of flow
    el.style.position = "fixed";
    el.style.inset = "0 auto auto 0";
    el.style.zIndex = "2147483646"; // slightly less than bubble (bubble uses 2147483647)
    el.style.pointerEvents = "none";
    el.style.width = "0";
    el.style.height = "0";
    document.body.appendChild(el);
    console.log("[assistant] standalone container created");
  }
  return el;
}

function alreadyMounted(): boolean {
  // If the portal root used by AssistantDock exists, we assume App or a previous mount created it.
  return !!document.getElementById("assistant-dock-root");
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

// Wait for the page to be interactive
if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
