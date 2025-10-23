// src/assistant/metrics.ts

export type AssistantEvent =
  | "assistant_command"
  | "assistant_open"
  | "assistant_close"
  | (string & {}); // allow custom events

export type AssistantPayload = Record<string, unknown>;

export function track(event: AssistantEvent, data: AssistantPayload = {}): void {
  // TODO: swap this console for your analytics SDK (PostHog/Segment/etc.)
  // Example:
  // posthog.capture(event, data);
  // window.analytics?.track?.(event, data);
  // fetch("/api/analytics", { method: "POST", body: JSON.stringify({ event, data }) });

  // Dev fallback:
  // eslint-disable-next-line no-console
  console.log("[analytics]", event, data);
}
