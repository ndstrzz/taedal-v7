// app/src/lib/ar.ts
export type ArSize = { label: string; width_cm: number; height_cm: number };

export const DEFAULT_SIZES: ArSize[] = [
  { label: "30 × 45 cm", width_cm: 30, height_cm: 45 },
  { label: "60 × 90 cm", width_cm: 60, height_cm: 90 },
  { label: "80 × 120 cm", width_cm: 80, height_cm: 120 },
  { label: "100 × 150 cm", width_cm: 100, height_cm: 150 },
];

export function toMetersWH(w_cm: number, h_cm: number) {
  return { w: w_cm / 100, h: h_cm / 100 };
}
