// app/src/routes/art/ARPreview.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import ModelViewer, { type ModelViewerHandle } from "../../components/ModelViewer";

/* ---------------------------- Types & helpers ---------------------------- */

type Artwork = {
  id: string;
  title: string | null;
  image_url: string | null;
  width?: number | null;
  height?: number | null;
  dim_unit?: "cm" | "in" | "px" | null;
};

const cmToMeters = (v: number) => v / 100;
const inchToMeters = (v: number) => v * 0.0254;
const metersToCm = (v: number) => v * 100;
const metersToIn = (v: number) => v / 0.0254;

/* ------------------------------ Wall/UI config ----------------------------- */

const EYE_LEVEL_M = 1.5;
const ART_ZOFF_M = 0.02;

/* UI-only hardcoded info */
const HUMAN_HEIGHT_M = 1.73;
const ART_WALL_W = 4.0;
const ART_WALL_H = 5.0;

/* ArtQuad canvas in the GLB (keep in sync with Blender) */
const ARTQUAD_CANVAS_W = 10.0;
const ARTQUAD_CANVAS_H = 10.0;

/* Camera defaults */
const CAM_FOV_DEG = 35;
const START_THETA = 180;
const START_PHI = 90;
const START_RADIUS = 9;

/* Limits */
const MIN_RADIUS = 0.7;
const MAX_RADIUS = 11;

/* Movement speeds */
const MOVE_SPEED = 0.25;
const ZOOM_SPEED = 0.35;
const TICK_MS = 16;

/* Human identifiers (both node and material hints) */
const HUMAN_NODE_NAMES = ["rp_posed_00178_29", "Person175"];
const HUMAN_NAME_HINTS = ["rp_posed", "person", "human"];
const HUMAN_MATERIAL_HINTS = ["rp_posed_00178_29_mat_", "rp_posed", "person"];

/* ------------------------ Env + URL resolution helpers --------------------- */

/** Safe env getter that won’t cause TS errors even if ImportMetaEnv isn’t typed. */
function getEnv(key: string): string | undefined {
  try {
    // @ts-ignore - guard for Vite env
    return (import.meta as any)?.env?.[key];
  } catch {
    return undefined;
  }
}

// replace the old headOk() with this:
async function urlExists(url: string): Promise<boolean> {
  try {
    // Try a zero-byte ranged GET to avoid downloading the whole GLB.
    const r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } });
    // 200 or 206 (partial) are both fine here
    return r.ok || r.status === 206;
  } catch {
    return false;
  }
}


/** HEAD check for existence */
async function headOk(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

/** Try to produce a usable GLB URL via multiple fallbacks. */
async function resolveRoomUrl(): Promise<string | null> {
  // 1) window.__CONFIG__.ROOM_URL
  const winCfg = (globalThis as any)?.window?.__CONFIG__;
  if (winCfg?.ROOM_URL && (await urlExists(winCfg.ROOM_URL))) return winCfg.ROOM_URL as string;

  // 2) VITE_ROOM_URL
  const envUrl = getEnv("VITE_ROOM_URL");
  if (envUrl && (await urlExists(envUrl))) return envUrl;

  // 3) Local public file (served by Vercel/Vite)
  const local = "/3d/room_artquad_v3.glb";
  if (await urlExists(local)) return local;

  // 4) Supabase buckets (public/assets/rooms)
  const candidates: Array<{ bucket: string; path: string }> = [
    { bucket: "public", path: "3d/room_artquad_v3.glb" },
    { bucket: "assets", path: "3d/room_artquad_v3.glb" },
    { bucket: "rooms", path: "room_artquad_v3.glb" },
  ];
  for (const c of candidates) {
    try {
      const { data } = supabase.storage.from(c.bucket).getPublicUrl(c.path);
      if (data?.publicUrl && (await urlExists(data.publicUrl))) return data.publicUrl;
    } catch {}
  }
  return null;
}


/* ------------------------ Scene-graph helpers (safe) --------------------- */

function getRoot(el: any): any {
  if (!el) return null;
  return el.model?.scene ?? el.model ?? el.scene ?? null;
}
function walk(root: any, cb: (n: any) => void) {
  if (!root) return;
  const stack: any[] = Array.isArray(root) ? [...root] : [root];
  const seen = new Set<any>();
  while (stack.length) {
    const n = stack.pop();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    try {
      cb(n);
    } catch {}
    const kids = Array.isArray(n?.children) ? n.children : [];
    for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
  }
}
function listNames(root: any, limit = 64): string[] {
  const out: string[] = [];
  walk(root, (n) => {
    if (n?.name) out.push(n.name);
    if (out.length >= limit) return;
  });
  return out;
}
function findByName(root: any, name: string): any {
  if (!root) return null;
  const viaApi =
    typeof (root as any).getObjectByName === "function"
      ? (root as any).getObjectByName(name)
      : null;
  if (viaApi) return viaApi;
  let found: any = null;
  walk(root, (n) => {
    if (!found && n?.name === name) found = n;
  });
  if (found) return found;
  const tgt = name.toLowerCase();
  walk(root, (n) => {
    if (!found && typeof n?.name === "string" && n.name.toLowerCase() === tgt) found = n;
  });
  return found;
}
function findByPrefix(root: any, prefix: string): any {
  if (!root) return null;
  const pref = prefix.toLowerCase();
  let out: any = null;
  walk(root, (n) => {
    if (out) return;
    const nm = (n?.name || "").toString().toLowerCase();
    if (nm === pref || nm.startsWith(pref)) out = n;
  });
  return out;
}

/** collect all meshes whose name CONTAINS any hint */
function findAllByNameContains(root: any, hints: string[]): any[] {
  const res: any[] = [];
  const lowerHints = hints.map((h) => h.toLowerCase());
  walk(root, (n) => {
    const nm = (n?.name || "").toString().toLowerCase();
    if (!nm) return;
    if (lowerHints.some((h) => nm.includes(h))) res.push(n);
  });
  return res;
}

/** collect all meshes whose material name CONTAINS any hint */
function findAllByMaterialIncludes(root: any, hints: string[]): any[] {
  const res: any[] = [];
  const lowerHints = hints.map((h) => h.toLowerCase());
  walk(root, (n) => {
    try {
      const matName = (n?.material?.name || "").toString().toLowerCase();
      if (!matName) return;
      if (lowerHints.some((h) => matName.includes(h))) res.push(n);
    } catch {}
  });
  return res;
}

function findMeshByMaterialName(root: any, materialName: string): any {
  if (!root) return null;
  const target = materialName.toLowerCase();
  let out: any = null;
  walk(root, (n) => {
    if (out) return;
    try {
      const m = n?.material;
      if (m && typeof m?.name === "string" && m.name.toLowerCase() === target) out = n;
    } catch {}
  });
  return out;
}

/* -------------- Compose artwork centered on large transparent canvas -------------- */

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function composeArtworkOnLargeCanvas(
  imageUrl: string,
  canvasMeters: { w: number; h: number },
  artMeters: { w: number; h: number },
  maxPx = 4096
): Promise<{ dataUrl: string; artMeters: { w: number; h: number } }> {
  const canvasAspect = canvasMeters.w / canvasMeters.h;
  const canvasPxW = canvasAspect >= 1 ? maxPx : Math.round(maxPx * canvasAspect);
  const canvasPxH = canvasAspect >= 1 ? Math.round(maxPx / canvasAspect) : maxPx;

  const pxPerMeterX = canvasPxW / canvasMeters.w;
  const pxPerMeterY = canvasPxH / canvasMeters.h;

  const artPxW = Math.round(artMeters.w * pxPerMeterX);
  const artPxH = Math.round(artMeters.h * pxPerMeterY);

  const offsetX = Math.round((canvasPxW - artPxW) / 2);
  const offsetY = Math.round((canvasPxH - artPxH) / 2);

  const img = await loadHtmlImage(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = canvasPxW;
  canvas.height = canvasPxH;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, offsetX, offsetY, artPxW, artPxH);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    artMeters: { w: artMeters.w, h: artMeters.h },
  };
}

/* ----------------------------------------------------------------------- */

export default function ARPreview() {
  const { id } = useParams();
  const [art, setArt] = useState<Artwork | null>(null);

  const [roomSrc, setRoomSrc] = useState<string | null>(null);
  const [roomLoaded, setRoomLoaded] = useState(false);
  const [artworkApplied, setArtworkApplied] = useState(false);

  const [frameBox, setFrameBox] = useState<{ w: number; h: number } | null>(null);
  const [rendered, setRendered] = useState<{ w: number; h: number } | null>(null);
  const [wallInfo, setWallInfo] = useState<{ name: string; w: number; h: number } | null>(null);

  const [showHuman, setShowHuman] = useState(true);
  const [showDims, setShowDims] = useState(true);
  const [dimUnit] = useState<"cm" | "in" | "m">("cm");

  const [progress, setProgress] = useState<number>(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>("");

  const mvRef = useRef<ModelViewerHandle | null>(null);

  /* Movement state (WASD + QE) */
  const movementRef = useRef({
    active: false,
    keys: new Set<string>(),
    target: { x: 0, y: EYE_LEVEL_M, z: ART_ZOFF_M },
    radius: START_RADIUS,
    theta: START_THETA,
    phi: START_PHI,
    timer: 0 as any,
  });

  /* --------------------------- resolve room URL --------------------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      const url = await resolveRoomUrl();
      if (!alive) return;
      if (!url) {
        setLastError(
          "Room GLB not accessible. Tried window.__CONFIG__.ROOM_URL, VITE_ROOM_URL, /3d path, and Supabase buckets (public/assets/rooms)."
        );
      }
      setRoomSrc(url);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ----------------------------- Load artwork ---------------------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!id) return;
      const { data, error } = await supabase
        .from("artworks")
        .select("id,title,image_url,width,height,dim_unit")
        .eq("id", id)
        .single();
      if (!alive) return;
      if (!error) setArt((data || null) as any);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  /* ---------------------- Convert DB dims to meters ---------------------- */
  const dims = useMemo(() => {
    if (!art?.width || !art?.height || !art?.dim_unit) return null;
    if (art.dim_unit === "cm") return { w: cmToMeters(art.width), h: cmToMeters(art.height) };
    if (art.dim_unit === "in") return { w: inchToMeters(art.width), h: inchToMeters(art.height) };
    if (art.dim_unit === "px")
      return { w: inchToMeters(art.width / 96), h: inchToMeters(art.height / 96) };
    return null;
  }, [art]);

  /* --------- model-viewer lifecycle + progress/error listeners ---------- */
  useEffect(() => {
    const el: any = mvRef.current;
    if (!el) return;

    const onLoad = () => {
      setRoomLoaded(true);
      setLastError(null);
    };
    const onError = (e: any) => {
      const msg = e?.detail?.message || e?.detail || "Unknown model-viewer error";
      setLastError(String(msg));
    };
    const onProgress = (e: any) => {
      const p = e?.detail?.totalProgress;
      if (typeof p === "number") setProgress(p);
    };

    el.addEventListener("load", onLoad);
    el.addEventListener("error", onError);
    el.addEventListener("progress", onProgress);
    return () => {
      el.removeEventListener("load", onLoad);
      el.removeEventListener("error", onError);
      el.removeEventListener("progress", onProgress);
    };
  }, []);

  /* --------------------- Debug: list some nodes -------------------------- */
  useEffect(() => {
    if (!roomLoaded) return;
    const el: any = mvRef.current;
    const root = getRoot(el);
    if (!root) return;
    try {
      const names = listNames(root, 64);
      setDebugInfo(
        `Found ${names.length} nodes: ${names.slice(0, 10).join(", ")}${
          names.length > 10 ? "..." : ""
        }`
      );
    } catch {}
  }, [roomLoaded]);

  /* --------------------- Camera init + frame box -------------------- */
  useEffect(() => {
    if (!roomLoaded) return;
    const el: any = mvRef.current;
    if (!el) return;

    el.setAttribute("field-of-view", `${CAM_FOV_DEG}deg`);
    el.setAttribute("camera-target", `0m ${EYE_LEVEL_M}m ${ART_ZOFF_M}m`);
    el.setAttribute("camera-orbit", `${START_THETA}deg ${START_PHI}deg ${START_RADIUS}m`);
    el.setAttribute("min-camera-orbit", `${-360}deg ${70}deg ${MIN_RADIUS}m`);
    el.setAttribute("max-camera-orbit", `${360}deg ${100}deg ${MAX_RADIUS}m`);
    el.jumpCameraToGoal?.();

    movementRef.current.target = { x: 0, y: EYE_LEVEL_M, z: ART_ZOFF_M };
    movementRef.current.radius = START_RADIUS;
    movementRef.current.theta = START_THETA;
    movementRef.current.phi = START_PHI;

    const root = getRoot(el);

    // frame box read
    try {
      let fb: any = null;
      fb = findByName(root, "ArtFrameBox") || findByPrefix(root, "ArtFrameBox");
      if (fb?.scale) setFrameBox({ w: fb.scale.x, h: fb.scale.y });
      else setFrameBox(null);
    } catch {
      setFrameBox(null);
    }
  }, [roomLoaded]);

  /* --------------------- Toggle reference human visibility -------------------- */
  useEffect(() => {
    if (!roomLoaded) return;
    const el: any = mvRef.current;
    if (!el) return;
    const root = getRoot(el);
    if (!root) return;

    const candidates = new Set<any>();

    HUMAN_NODE_NAMES.forEach((nm) => {
      const n = findByName(root, nm) || findByPrefix(root, nm);
      if (n) candidates.add(n);
    });

    for (const n of findAllByNameContains(root, HUMAN_NAME_HINTS)) candidates.add(n);
    for (const n of findAllByMaterialIncludes(root, HUMAN_MATERIAL_HINTS)) candidates.add(n);

    let toggled = 0;
    candidates.forEach((node) => {
      try {
        node.visible = showHuman;
        toggled++;
      } catch {}
    });

    if (toggled > 0) {
      console.log(`[ARPreview] Toggled ${toggled} human node(s) → visible=${showHuman}`);
    } else {
      console.warn("[ARPreview] No human nodes matched. Check material/name hints.");
    }
  }, [roomLoaded, showHuman]);

  function fmtMeters(m: number) {
    return dimUnit === "cm"
      ? `${Math.round(metersToCm(m))} cm`
      : dimUnit === "in"
      ? `${Math.round(metersToIn(m))} in`
      : `${m.toFixed(2)} m`;
  }

  /* --------------------------- WASD + Q/E control --------------------------- */
  useEffect(() => {
    const el = mvRef.current as any;
    if (!el) return;

    el.setAttribute("tabindex", "0");

    const onEnter = () => {
      movementRef.current.active = true;
    };
    const onLeave = () => {
      movementRef.current.active = false;
      movementRef.current.keys.clear();
    };
    const onFocus = () => {
      movementRef.current.active = true;
    };
    const onBlur = () => {
      movementRef.current.active = false;
      movementRef.current.keys.clear();
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (!movementRef.current.active) return;
      const k = ev.key.toLowerCase();
      if (
        ["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(
          k
        )
      ) {
        ev.preventDefault();
        movementRef.current.keys.add(k);
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      const k = ev.key.toLowerCase();
      movementRef.current.keys.delete(k);
    };

    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("focus", onFocus);
    el.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const tick = () => {
      const mv = movementRef.current;
      if (mv.keys.size > 0 && mv.active) {
        let dx = 0,
          dz = 0,
          dr = 0;

        // Swapped mapping
        if (mv.keys.has("w")) dz += MOVE_SPEED;
        if (mv.keys.has("s")) dz -= MOVE_SPEED;

        if (mv.keys.has("arrowup")) dz += MOVE_SPEED;
        if (mv.keys.has("arrowdown")) dz -= MOVE_SPEED;

        if (mv.keys.has("a") || mv.keys.has("arrowleft")) dx += MOVE_SPEED;
        if (mv.keys.has("d") || mv.keys.has("arrowright")) dx -= MOVE_SPEED;

        if (mv.keys.has("q")) dr -= ZOOM_SPEED;
        if (mv.keys.has("e")) dr += ZOOM_SPEED;

        mv.target.x += dx;
        mv.target.z += dz;
        mv.radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, mv.radius + dr));

        el.setAttribute("camera-target", `${mv.target.x}m ${mv.target.y}m ${mv.target.z}m`);
        el.setAttribute("camera-orbit", `${mv.theta}deg ${mv.phi}deg ${mv.radius}m`);
        el.jumpCameraToGoal?.();
      }
      movementRef.current.timer = window.setTimeout(tick, TICK_MS);
    };
    tick();

    return () => {
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("focus", onFocus);
      el.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (movementRef.current.timer) clearTimeout(movementRef.current.timer);
    };
  }, []);

  /* -------- Apply artwork: compose on large canvas, then texture -------- */
  useEffect(() => {
    (async () => {
      if (!art?.image_url || !dims || !roomLoaded) return;
      const el: any = mvRef.current;
      if (!el) return;

      try {
        if (!el.loaded) {
          await new Promise<void>((resolve) => {
            const onLoad = () => {
              el.removeEventListener("load", onLoad);
              resolve();
            };
            el.addEventListener("load", onLoad, { once: true });
          });
        }
        await el.updateComplete;
      } catch {}

      const model = (el as any).model ?? null;
      const root = getRoot(el);

      let targetNode: any =
        model?.getNodeByName?.("artquad") ||
        findByName(root, "artquad") ||
        findByPrefix(root, "artquad") ||
        findMeshByMaterialName(root, "MatArtQuad");

      let targetPbr: any = null;
      let matObj: any = null;
      if (targetNode?.material?.pbrMetallicRoughness) {
        matObj = targetNode.material;
        targetPbr = targetNode.material.pbrMetallicRoughness;
      } else {
        const mats = Array.isArray(model?.materials) ? model.materials : [];
        matObj =
          mats.find((m: any) => (m?.name || "").toLowerCase() === "matartquad") ||
          mats.find((m: any) => (m?.name || "").toLowerCase() === "matfloor") ||
          mats.find((m: any) => (m?.name || "").toLowerCase() === "matwall") ||
          mats[0] ||
          null;
        targetPbr = matObj?.pbrMetallicRoughness ?? null;
        if (matObj && !targetNode) {
          targetNode = findMeshByMaterialName(root, matObj.name || "");
        }
      }

      if (!targetPbr) {
        setLastError("ArtQuad mesh/material not found.");
        return;
      }

      let composedDataUrl: string;
      let actualArtMeters: { w: number; h: number };
      try {
        const result = await composeArtworkOnLargeCanvas(
          art.image_url,
          { w: ARTQUAD_CANVAS_W, h: ARTQUAD_CANVAS_H },
          dims,
          4096
        );
        composedDataUrl = result.dataUrl;
        actualArtMeters = result.artMeters;
      } catch (e: any) {
        setLastError(`Failed to compose artwork: ${e?.message ?? e}`);
        return;
      }

      try {
        const tex = await el.createTexture(composedDataUrl);
        if (typeof targetPbr.setBaseColorTexture === "function") {
          await targetPbr.setBaseColorTexture(tex);
        } else if (targetPbr.baseColorTexture?.setTexture) {
          await targetPbr.baseColorTexture.setTexture(tex);
        }
        try {
          targetPbr.setMetallicFactor?.(0);
        } catch {}
        try {
          targetPbr.setRoughnessFactor?.(0.75);
        } catch {}
        if (matObj) {
          if ("alphaMode" in matObj) (matObj as any).alphaMode = "BLEND";
          if ("doubleSided" in matObj) (matObj as any).doubleSided = true;
        }

        try {
          if (targetNode?.name && targetNode?.scale) {
            setWallInfo({
              name: targetNode.name,
              w: targetNode.scale.x,
              h: targetNode.scale.y,
            });
          }
        } catch {
          setWallInfo(null);
        }

        setRendered({ w: actualArtMeters.w, h: actualArtMeters.h });
        setArtworkApplied(true);
        setLastError(null);
        setDebugInfo(
          `✓ Artwork ${actualArtMeters.w.toFixed(2)}m × ${actualArtMeters.h.toFixed(
            2
          )}m centered on ${ARTQUAD_CANVAS_W}m × ${ARTQUAD_CANVAS_H}m canvas`
        );
      } catch (e: any) {
        setLastError(`Texture apply error: ${String(e?.message || e)}`);
      }
    })();
  }, [art?.image_url, roomLoaded, dims]);

  /* -------------------------------- Render -------------------------------- */
  const originalDimsLabel =
    art?.width && art?.height && art?.dim_unit
      ? `${Math.round(art.width)} × ${Math.round(art.height)} ${art.dim_unit}`
      : "—";
  const metersDimsLabel = dims ? `${dims.w.toFixed(2)} m × ${dims.h.toFixed(2)} m` : "—";

  const hotspotWidthPos =
    rendered && `${0} ${EYE_LEVEL_M - (rendered.h ?? 0) / 2 - 0.08} ${ART_ZOFF_M + 0.001}`;
  const hotspotHeightPos =
    rendered && `${(rendered.w ?? 0) / 2 + 0.08} ${EYE_LEVEL_M} ${ART_ZOFF_M + 0.001}`;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 text-neutral-200">
      <div className="mb-4">
        <Link to={`/art/${id}`} className="text-sm text-neutral-400 hover:text-white">
          ← Back to artwork
        </Link>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-8">
          <div className="relative">
            <ModelViewer
              ref={mvRef}
              // Safe room source (may be null while resolving)
              src={roomSrc ?? ""}
              ar
              arModes="webxr scene-viewer quick-look"
              cameraControls
              autoplay
              environmentImage="neutral"
              exposure={1.2}
              shadowIntensity={0.4}
              poster="/3d/poster.jpg"
              reveal="auto"
              style={{ width: "100%", height: "70vh", background: "#0b0b0b", outline: "none" }}
            >
              {showDims && rendered && (
                <>
                  <div
                    slot="hotspot-dim-width"
                    data-position={hotspotWidthPos as string}
                    data-visibility-attribute="visible"
                    className="pointer-events-none select-none rounded bg-black/70 px-2 py-1 text-[11px] text-white shadow"
                  >
                    width: <span className="font-semibold">{fmtMeters(rendered.w)}</span>
                  </div>
                  <div
                    slot="hotspot-dim-height"
                    data-position={hotspotHeightPos as string}
                    data-visibility-attribute="visible"
                    className="pointer-events-none select-none rounded bg-black/70 px-2 py-1 text-[11px] text-white shadow"
                  >
                    height: <span className="font-semibold">{fmtMeters(rendered.h)}</span>
                  </div>
                </>
              )}
            </ModelViewer>

            <div className="absolute bottom-4 left-4 rounded bg-black/50 px-3 py-1 text-xs text-white">
              Walk: <b>S</b>=forward <b>W</b>=back • Strafe: <b>A/D</b> • Zoom: <b>Q/E</b>
            </div>

            {!roomLoaded && (
              <div className="absolute top-4 left-4 rounded bg-blue-900/50 px-3 py-1 text-xs text-white">
                Loading room… {progress > 0 && `${Math.round(progress * 100)}%`}
              </div>
            )}
            {lastError && (
              <div className="absolute top-4 left-4 mt-8 rounded bg-red-900/60 px-3 py-2 text-xs text-white max-w-md">
                <div className="font-semibold mb-1">⚠️ Error: {lastError}</div>
                {debugInfo && <div className="text-[10px] opacity-80 mt-1">{debugInfo}</div>}
              </div>
            )}
            {artworkApplied && (
              <div className="absolute top-4 left-4 rounded bg-green-900/50 px-3 py-1 text-xs text-white">
                ✓ Artwork at true size
              </div>
            )}
            {debugInfo && !lastError && (
              <div className="absolute top-4 right-4 rounded bg-neutral-900/70 px-3 py-1 text-[10px] text-neutral-300 max-w-md">
                {debugInfo}
              </div>
            )}
          </div>
        </div>

        <aside className="col-span-12 lg:col-span-4 space-y-4">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="mb-3 text-sm text-neutral-400">AR Wall Preview</div>
            {art?.title && <h3 className="mb-3 text-lg font-medium text-white">{art.title}</h3>}

            {/* Art wall (hard-coded) */}
            <div className="mb-2 text-xs text-neutral-400">
              Art wall:{" "}
              <span className="text-neutral-200">{ART_WALL_W.toFixed(2)} m</span> W ×{" "}
              <span className="text-neutral-200">{ART_WALL_H.toFixed(2)} m</span> H
            </div>

            {/* Reference human height (hard-coded) + toggle */}
            <div className="mb-3 text-xs text-neutral-400 flex items-center justify-between gap-3">
              <div>
                Reference human: <span className="text-neutral-200">{HUMAN_HEIGHT_M.toFixed(2)} m</span>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-3 w-3 accent-neutral-500"
                  checked={showHuman}
                  onChange={(e) => setShowHuman(e.target.checked)}
                />
                <span className="text-neutral-300">Show</span>
              </label>
            </div>

            {/* Size labels toggle */}
            <div className="mb-3 text-xs text-neutral-400 flex items-center justify-between gap-3">
              <div>Size labels</div>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-3 w-3 accent-neutral-500"
                  checked={showDims}
                  onChange={(e) => setShowDims(e.target.checked)}
                />
                <span className="text-neutral-300">Show</span>
              </label>
            </div>

            <div className="mb-2 text-xs text-neutral-400">
              Artwork: <span className="text-neutral-200">{originalDimsLabel}</span>
              {dims && (
                <>
                  {" "}
                  <span className="text-neutral-500"> ({metersDimsLabel})</span>
                </>
              )}
            </div>

            <div className="mb-2 text-xs text-neutral-400">
              ArtQuad canvas:{" "}
              <span className="text-neutral-200">
                {ARTQUAD_CANVAS_W.toFixed(1)}m × {ARTQUAD_CANVAS_H.toFixed(1)}m
                {wallInfo && <span className="text-neutral-500"> ({wallInfo.name})</span>}
              </span>
            </div>

            <div className="mb-2 text-xs text-neutral-400">
              Reference box (ArtFrameBox):{" "}
              <span className="text-neutral-200">
                {frameBox ? `${frameBox.w.toFixed(2)} m × ${frameBox.h.toFixed(2)} m` : "—"}
              </span>
            </div>

            {rendered && (
              <div className="mb-4 rounded-lg border border-green-900/30 bg-green-900/10 p-3 text-xs">
                <div className="text-green-400 font-semibold mb-2">✓ Rendered at True Size:</div>
                <div className="grid grid-cols-2 gap-2 text-neutral-300">
                  <div>
                    Width: <span className="text-white font-medium">{fmtMeters(rendered.w)}</span>
                  </div>
                  <div>
                    Height: <span className="text-white font-medium">{fmtMeters(rendered.h)}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2 mb-4">
              <button
                className="rounded-lg bg-neutral-800 hover:bg-neutral-700 px-3 py-1 text-xs transition-colors"
                onClick={() => {
                  const el: any = mvRef.current;
                  if (!el) return;
                  el.setAttribute("camera-target", `0m ${EYE_LEVEL_M}m ${ART_ZOFF_M}m`);
                  el.setAttribute("camera-orbit", `${START_THETA}deg ${START_PHI}deg ${START_RADIUS}m`);
                  el.jumpCameraToGoal?.();
                  movementRef.current.target = { x: 0, y: EYE_LEVEL_M, z: ART_ZOFF_M };
                  movementRef.current.radius = START_RADIUS;
                  movementRef.current.theta = START_THETA;
                  movementRef.current.phi = START_PHI;
                }}
              >
                Reset view
              </button>
              <button
                className="rounded-lg bg-neutral-800 hover:bg-neutral-700 px-3 py-1 text-xs transition-colors"
                onClick={() => {
                  const el: any = mvRef.current;
                  if (!el) return;
                  const near = Math.max(1.0, MIN_RADIUS + 0.2);
                  el.setAttribute("camera-target", `0m ${EYE_LEVEL_M}m ${ART_ZOFF_M}m`);
                  el.setAttribute("camera-orbit", `${START_THETA}deg ${START_PHI}deg ${near}m`);
                  el.jumpCameraToGoal?.();
                  movementRef.current.target = { x: 0, y: EYE_LEVEL_M, z: ART_ZOFF_M };
                  movementRef.current.radius = near;
                }}
              >
                Focus artwork
              </button>
            </div>
          </div>

          {art?.image_url && (
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
              <div className="mb-2 text-sm text-neutral-400">Original Image</div>
              <img
                src={art.image_url}
                alt={art.title || "Artwork"}
                className="w-full rounded border border-neutral-700"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
