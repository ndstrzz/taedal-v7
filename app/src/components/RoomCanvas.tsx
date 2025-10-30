import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, Html } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  TextureLoader,
  Texture,
  SRGBColorSpace,
  Mesh,
  MeshStandardMaterial,
  DoubleSide,
  Vector3,
  Group,
  Object3D,
} from "three";

/* ---------------- robust texture loader (unchanged) ---------------- */
async function loadTextureRobust(url: string, timeoutMs = 10000): Promise<Texture> {
  const withTimeout = <T,>(p: Promise<T>, label: string) =>
    new Promise<T>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
      p.then((v) => { clearTimeout(to); resolve(v); })
       .catch((e) => { clearTimeout(to); reject(e); });
    });

  try {
    const loader = new TextureLoader();
    loader.setCrossOrigin("anonymous");
    const tex = await withTimeout(loader.loadAsync(url), "TextureLoader.loadAsync");
    tex.colorSpace = SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true;
    console.info("[AR] Texture loaded via TextureLoader");
    return tex;
  } catch (e) { console.warn("[AR] TextureLoader.loadAsync failed:", e); }

  try {
    const tex = await withTimeout(new Promise<Texture>((res, rej) => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => { try { const t = new Texture(img); t.colorSpace = SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; res(t); } catch (err) { rej(err); } };
      img.onerror = () => rej(new Error("HTMLImage failed to load")); img.src = url;
    }), "HTMLImage->Texture");
    console.info("[AR] Texture loaded via HTMLImage pathway"); return tex;
  } catch (e) { console.warn("[AR] HTMLImage pathway failed:", e); }

  try {
    const r = await withTimeout(fetch(url, { mode: "cors", cache: "no-store" }), "fetch(blob)");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob(); const objUrl = URL.createObjectURL(blob);
    try {
      const loader = new TextureLoader(); loader.setCrossOrigin("anonymous");
      const tex = await withTimeout(loader.loadAsync(objUrl), "TextureLoader(load blob)");
      tex.colorSpace = SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true;
      console.info("[AR] Texture loaded via fetch→blob"); return tex;
    } finally { URL.revokeObjectURL(objUrl); }
  } catch (e) { console.warn("[AR] fetch→blob pathway failed:", e); }

  const busted = url.includes("?") ? `${url}&_=${Date.now()}` : `${url}?_=${Date.now()}`;
  const loader = new TextureLoader(); loader.setCrossOrigin("anonymous");
  const tex = await withTimeout(loader.loadAsync(busted), "TextureLoader(retry)");
  tex.colorSpace = SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true;
  console.info("[AR] Texture loaded via final retry (cache-busted)"); return tex;
}

/* ---------------- helper: find a drawable Mesh ---------------- */
function firstMeshUnder(node: Object3D | null | undefined): Mesh | null {
  if (!node) return null;
  if ((node as any).isMesh) return node as Mesh;
  let found: Mesh | null = null;
  node.traverse((o) => { if (!found && (o as any).isMesh) found = o as Mesh; });
  return found;
}
function findDrawableMesh(scene: Object3D): { mesh: Mesh | null; usedName: string | null } {
  const names = ["artquad","ArtQuad","Artquad","ARTQUAD","ArtworkPlane","Artwork","ArtPlane","Picture","Canvas","Quad","Plane"];
  for (const n of names) {
    const cand = scene.getObjectByName(n);
    const mesh = firstMeshUnder(cand || undefined);
    if (mesh) return { mesh, usedName: n };
  }
  const frame = scene.getObjectByName("ArtFrameBox");
  const frameMesh = firstMeshUnder(frame || undefined);
  if (frameMesh) return { mesh: frameMesh, usedName: "ArtFrameBox" };
  let any: Mesh | null = null; scene.traverse((o) => { if (!any && (o as any).isMesh) any = o as Mesh; });
  return { mesh: any, usedName: any?.name || null };
}

/* --------------------------------- viewer ---------------------------------- */
export function RoomCanvas({
  roomUrl = "/3d/room_min.glb?v=1",
  imageUrl,
  dimsMeters,
  onReady,
  onApplied,
  showFurniture = true,
  showPerson = true,
  showRuler = true,
}: {
  roomUrl?: string;
  imageUrl?: string | null;
  dimsMeters?: { w: number; h: number } | null;
  onReady?: (frameBox: { w: number; h: number } | null) => void;
  onApplied?: (rendered: { w: number; h: number }) => void;
  showFurniture?: boolean; showPerson?: boolean; showRuler?: boolean;
}) {
  const { scene } = useGLTF(roomUrl) as any;
  const [status, setStatus] = useState<"loading" | "ready" | "applying" | "done" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const EYE_LEVEL = 1.5, ART_Z = 0.02;

  // toggles
  useEffect(() => {
    if (!scene) return;
    const setVis = (n: string, v: boolean) => { const obj = scene.getObjectByName(n) as any; if (obj) obj.visible = v; };
    setVis("Person175", showPerson); setVis("Ruler1m", showRuler);
    for (const n of ["Bench","Pedestal","InfoPlaque","Plant","PlantPot"]) setVis(n, showFurniture);
  }, [scene, showFurniture, showPerson, showRuler]);

  // get ArtFrameBox size once
  const frameBoxMeters = useMemo(() => {
    if (!scene) return null;
    const box = scene.getObjectByName("ArtFrameBox") as any;
    return box?.scale ? { w: box.scale.x, h: box.scale.y } : null;
  }, [scene]);

  // ✅ mark ready ONCE (avoid resetting back to "ready")
  const readyOnce = useRef(false);
  useEffect(() => {
    if (!scene || readyOnce.current) return;
    readyOnce.current = true;
    setStatus("ready");
    onReady?.(frameBoxMeters);
  }, [scene, frameBoxMeters, onReady]);

  // apply texture once per imageUrl change
  useEffect(() => {
  if (!scene || status !== "ready" || !imageUrl) return;

  let cancelled = false;

  (async () => {
    setStatus("applying");
    try {
      const { mesh: targetMesh, usedName } = findDrawableMesh(scene);
      if (!targetMesh) throw new Error("No drawable Mesh in scene.");

      console.log("[AR] Using drawable node:", usedName, "(mesh:", targetMesh.name, ")");

      // Hide frame guide if painting a different node
      if (usedName !== "ArtFrameBox") {
        const frame = scene.getObjectByName("ArtFrameBox") as any;
        if (frame) frame.visible = false;
      }

      const tex = await loadTextureRobust(imageUrl);
      if (cancelled) return;

      // Compute target size in meters (true size, then clamp to frame if present)
      let w = 1, h = 1;
      if (dimsMeters) { w = dimsMeters.w; h = dimsMeters.h; }
      if (frameBoxMeters) {
        const s = Math.min(frameBoxMeters.w / w, frameBoxMeters.h / h, 1);
        w *= s; h *= s;
      }

      // ---- Apply onto existing material if possible (safer in many glTFs) ----
      const existing = (targetMesh.material as any) || null;
      if (existing && typeof existing === "object") {
        // Try to use existing material
        (existing as any).map = tex;
        (existing as any).roughness = 0.75;
        (existing as any).metalness = 0.0;
        (existing as any).side = DoubleSide;
        (existing as any).needsUpdate = true;
      } else {
        // Fallback: create a new standard material
        const mat = new MeshStandardMaterial({
          map: tex, roughness: 0.75, metalness: 0, side: DoubleSide,
        });
        mat.needsUpdate = true;
        targetMesh.material = mat;
      }

      // Orient and scale the drawable plane
      targetMesh.rotation.set(Math.PI / 2, 0, 0);
      targetMesh.scale.set(w, h, 1);
      targetMesh.matrixWorldNeedsUpdate = true;
      targetMesh.updateMatrix(); targetMesh.updateMatrixWorld(true);

      // Force renderer to see the changes
      tex.needsUpdate = true;
      (scene as any).traverse?.((o: any) => { if (o.material?.needsUpdate !== undefined) o.material.needsUpdate = true; });

      console.log("[AR] ✅ Artwork applied:", { node: usedName, mesh: targetMesh.name, w, h });
      onApplied?.({ w, h });
    } catch (e: any) {
      if (!cancelled) {
        console.error("[AR] ❌ Apply failed:", e);
        setError(e?.message || "Apply failed");
        setStatus("error");
      }
      return; // let finally run
    } finally {
      if (!cancelled) {
        // Safety: ensure the overlay cannot get stuck
        setStatus("done");
        setTimeout(() => setStatus((s) => (s === "applying" ? "done" : s)), 150);
      }
    }
  })();

  return () => { cancelled = true; };
}, [scene, status, imageUrl, dimsMeters, frameBoxMeters, onApplied]);

  // initial camera target
  const controls = useRef<any>(null);
  useFrame((_, i) => { if (controls.current && i < 10) { controls.current.target.set(0, EYE_LEVEL, ART_Z); controls.current.update(); } });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[0, 5, 2]} intensity={1.0} />
      <primitive object={scene} />

      <OrbitControls
        ref={controls} makeDefault enablePan enableZoom
        minDistance={0.7} maxDistance={11}
        minPolarAngle={(70 * Math.PI) / 180} maxPolarAngle={(100 * Math.PI) / 180}
      />

      {(status === "loading" || status === "ready" || status === "applying") && (
        <Html position={[0, 3.2, 0]} center>
          <div style={{ fontSize: 12, color: "#eee", background: "rgba(0,0,0,.55)", padding: "6px 10px", borderRadius: 8 }}>
            {status === "loading" && "Loading room…"}
            {status === "ready" && "Applying artwork…"}
            {status === "applying" && "Applying…"}
          </div>
        </Html>
      )}
      {status === "done" && null}
      {status === "error" && (
        <Html position={[0, 3.2, 0]} center>
          <div style={{ fontSize: 12, color: "#fff", background: "rgba(128,0,0,.7)", padding: "6px 10px", borderRadius: 8 }}>
            Error: {error}
          </div>
        </Html>
      )}
    </>
  );
}

export default function RoomViewerCanvas(props: React.ComponentProps<typeof RoomCanvas>) {
  return (
    <Canvas
      camera={{ position: new Vector3(0, 1.5, 9), fov: 35 }}
      shadows gl={{ antialias: true }}
      style={{ width: "100%", height: "70vh", background: "#0b0b0b", borderRadius: "12px" }}
    >
      <RoomCanvas {...props} />
    </Canvas>
  );
}

useGLTF.preload("/3d/room_v19.glb?v=19");
