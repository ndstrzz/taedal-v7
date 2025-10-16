// app/src/components/MintingOverlay.tsx
import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, Html, Clone } from "@react-three/drei";
import * as THREE from "three";

type Props = {
  open: boolean;
  message?: string;
  backdropAlpha?: number; // 0..1
  spinSpeed?: number;     // radians per second
};

// Preload the model (first show is faster)
useGLTF.preload("/media/taedal-coin.glb");

function Coin({ spinSpeed = 1.8 }: { spinSpeed?: number }) {
  const group = useRef<THREE.Group>(null);
  // `as any` keeps typing simple across drei/three versions
  const { scene } = useGLTF("/media/taedal-coin.glb") as any;

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += spinSpeed * delta;
  });

  return (
    <group ref={group} dispose={null} scale={1.2}>
      {/* Render the GLTF with drei's Clone (React-friendly) */}
      <Clone object={scene} />
    </group>
  );
}

export default function MintingOverlay({
  open,
  message = "Minting…",
  backdropAlpha = 0.9,
  spinSpeed = 1.8,
}: Props) {
  if (!open) return null;
  const bg = `rgba(0,0,0,${Math.min(Math.max(backdropAlpha, 0), 1)})`;

  return (
    <div
      className="fixed inset-0 z-[1100] grid place-items-center"
      style={{ backgroundColor: bg }}
      role="dialog"
      aria-modal="true"
      aria-label="Mint in progress"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="w-[420px] max-w-[85vw] aspect-square">
        <Canvas camera={{ position: [0, 0, 3], fov: 50 }} shadows gl={{ antialias: true }}>
          {/* lights */}
          <ambientLight intensity={0.6} />
          <directionalLight position={[3, 3, 3]} intensity={1.2} castShadow />
          <directionalLight position={[-3, -2, -1]} intensity={0.6} />

          <Suspense
            fallback={
              <Html center>
                <div className="text-neutral-300 text-sm">Loading 3D…</div>
              </Html>
            }
          >
            <Coin spinSpeed={spinSpeed} />
          </Suspense>
        </Canvas>
      </div>

      <div className="text-neutral-300 text-sm mt-4 text-center px-6">{message}</div>
    </div>
  );
}
