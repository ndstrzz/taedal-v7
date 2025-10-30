// Tries multiple known paths for the Scene-Graph feature across MV versions.
// Returns true if loaded; otherwise false (we'll keep running but with limited API).
export async function loadModelViewerSceneGraph(): Promise<boolean> {
  const candidates = [
    // v3.x classic:
    "@google/model-viewer/lib/experimental/scene-graph/scene-graph.js",
    "@google/model-viewer/lib/experimental/scene-graph.js",
    // v4.x path:
    "@google/model-viewer/lib/features/scene-graph.js",
  ] as const;

  for (const p of candidates) {
    try {
      // @vite-ignore lets us resolve at runtime even if the path isn't present at build.
      await import(/* @vite-ignore */ p);
      console.info("[MV] Scene-Graph feature loaded from:", p);
      return true;
    } catch {
      // try next
    }
  }
  console.warn("[MV] Scene-Graph module not found; continuing without it.");
  return false;
}
