// app/scripts/make-unit-panel.mjs
// Creates a 1m x 1m UV-mapped panel centered on origin, exports JSON glTF.
// Requires: three, three-stdlib
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "three";
import { GLTFExporter } from "three-stdlib/exporters/GLTFExporter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.resolve(__dirname, "../public/3d");
const OUT_FILE = path.join(OUT_DIR, "panel-1m.gltf");

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const scene = new THREE.Scene();

  // Unit plane in meters, centered (-0.5..+0.5). PlaneGeometry has UVs by default.
  const geom = new THREE.PlaneGeometry(1, 1, 1, 1);
  // Flip to face +Z so normals are (0,0,1)
  geom.rotateX(-Math.PI * 0.0); // keep as is; default faces +Z

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.0,
    roughness: 0.92,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geom, mat);
  scene.add(mesh);

  // A little light so viewers that respect lights won’t go black
  const light = new THREE.DirectionalLight(0xffffff, 0.6);
  light.position.set(0, 0, 1);
  light.target = mesh;
  scene.add(light);

  const exporter = new GLTFExporter();
  const gltf = await new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (res) => resolve(res),
      (err) => reject(err),
      { binary: false } // JSON glTF
    );
  });

  const json = typeof gltf === "string" ? gltf : JSON.stringify(gltf);
  await fs.writeFile(OUT_FILE, json);
  console.log("✅ Wrote", OUT_FILE);
}

main().catch((e) => {
  console.error("❌ Export failed:", e);
  process.exit(1);
});
