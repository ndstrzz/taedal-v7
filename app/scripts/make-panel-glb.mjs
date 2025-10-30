// app/scripts/make-panel-glb.mjs
// Usage: node app/scripts/make-panel-glb.mjs 0.02
// Output: app/public/3d/panel-1m.gltf (+ versioned file)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

/* -------- minimal shims so three/examples works in Node -------- */
if (!globalThis.self) globalThis.self = globalThis;
if (!globalThis.FileReader) {
  globalThis.FileReader = class {
    constructor() { this.result = null; this.onload = null; this.onerror = null; }
    readAsDataURL(blob) {
      blob.arrayBuffer()
        .then(buf => {
          const b64 = Buffer.from(buf).toString("base64");
          const type = blob.type || "application/octet-stream";
          this.result = `data:${type};base64,${b64}`;
          this.onload?.({ target: this });
        })
        .catch(err => this.onerror?.(err));
    }
    readAsArrayBuffer(blob) {
      blob.arrayBuffer()
        .then(buf => { this.result = buf; this.onload?.({ target: this }); })
        .catch(err => this.onerror?.(err));
    }
  };
}
/* --------------------------------------------------------------- */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function exportGLTF(exporter, input) {
  return new Promise((resolve, reject) => {
    exporter.parse(
      input,
      (gltf) => resolve(gltf),
      (err) => reject(err),
      {
        binary: false,        // JSON glTF
        embedImages: false,   // avoid FileReader paths
        embedBuffers: false,
        onlyVisible: true,
        truncateDrawRange: true,
      }
    );
  });
}

async function main() {
  const thickness = Number(process.argv[2] ?? "0.01");
  if (!isFinite(thickness) || thickness <= 0) {
    console.error("❌ Thickness must be a positive number in meters.");
    process.exitCode = 1;
    return;
  }

  console.log(`➡️  Building panel: 1.000m x 1.000m x ${thickness.toFixed(3)}m …`);

  // Scene: 1m × 1m × thickness box with proper UVs
  const scene = new THREE.Scene();
  const geom  = new THREE.BoxGeometry(1.0, 1.0, thickness, 1, 1, 1);
  const mat   = new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 0.0, roughness: 0.92, side: THREE.DoubleSide,
  });
  const mesh  = new THREE.Mesh(geom, mat);
  mesh.name = "panel-1m";
  scene.add(mesh);

  // Light (silence exporter warning with a target)
  const light  = new THREE.DirectionalLight(0xffffff, 0.5);
  light.position.set(1, 1, 1);
  const target = new THREE.Object3D();
  target.position.set(0, 0, -1);
  light.add(target);
  scene.add(light);

  // Output into the path your app actually serves
  const outDir    = path.resolve(process.cwd(), "app", "public", "3d");
  fs.mkdirSync(outDir, { recursive: true });

  const versioned = `panel-1m-${thickness.toFixed(3)}m.gltf`;
  const outPath   = path.join(outDir, versioned);
  const canonical = path.join(outDir, "panel-1m.gltf");

  console.log(`➡️  Exporting (JSON glTF) to: ${outPath}`);

  try {
    const exporter = new GLTFExporter();
    const gltf = await exportGLTF(exporter, scene);
    const json = typeof gltf === "string" ? gltf : JSON.stringify(gltf, null, 2);

    fs.writeFileSync(outPath, json, "utf8");
    fs.copyFileSync(outPath, canonical);

    console.log(`✅ Wrote ${outPath}`);
    console.log(`✅ Also wrote ${canonical} (stable path)`);
    console.log(`✅ Done: 1.000m x 1.000m x ${thickness.toFixed(3)}m`);
  } catch (err) {
    console.error("❌ GLTF export error:", err);
    process.exitCode = 1;
  }
}

main().then(() => {
  // ensure Node waits for all microtasks before exiting
}).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
