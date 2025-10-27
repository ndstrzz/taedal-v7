export type ArSize = { label: string; width_cm: number; height_cm: number };

export const DEFAULT_SIZES: ArSize[] = [
  { label: "30×45 cm", width_cm: 30, height_cm: 45 },
  { label: "60×90 cm", width_cm: 60, height_cm: 90 },
  { label: "80×120 cm", width_cm: 80, height_cm: 120 },
];

export function cmToMeters(cm: number) { return cm / 100; }

export function toMetersWH(width_cm: number, height_cm: number) {
  return { w: cmToMeters(width_cm), h: cmToMeters(height_cm) };
}
