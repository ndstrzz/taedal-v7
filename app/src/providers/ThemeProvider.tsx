// /api/assistant (edge or serverless; pseudo)
import type { NextRequest } from "next/server"; // adapt to your stack

export async function POST(req: NextRequest) {
  const { message } = await req.json();

  // —— simple rule-based MVP —— //
  const m = message.toLowerCase();
  if (m.includes("light theme")) {
    return Response.json({
      assistantText: "Sure — switching to light theme.",
      action: { type: "toggleTheme", mode: "light" }
    });
  }
  if (m.includes("dark theme")) {
    return Response.json({
      assistantText: "Got it — dark mode on.",
      action: { type: "toggleTheme", mode: "dark" }
    });
  }
  if (m.includes("upload") && m.includes("avatar")) {
    return Response.json({
      assistantText: "I’ll guide you through it.",
      action: { type: "startTour", key: "uploadAvatar" }
    });
  }
  if (m.includes("go to") && m.includes("profile")) {
    return Response.json({
      assistantText: "Taking you to your profile page.",
      action: { type: "goTo", path: "/account" }
    });
  }

  // —— fallback: call an LLM that can return a structured tool call —— //
  // const llm = await callLLMThatReturns({ message });
  // return Response.json(llm);

  return Response.json({ assistantText: "I can change themes, navigate, or start a tutorial. Try: “guide me to upload an avatar.”" });
}
