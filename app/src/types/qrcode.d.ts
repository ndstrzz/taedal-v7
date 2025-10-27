// app/src/types/qrcode.d.ts

declare module "qrcode" {
  // minimal surface used by your code
  export function toDataURL(
    text: string,
    opts?: Record<string, unknown>
  ): Promise<string>;
  const _default: { toDataURL: typeof toDataURL };
  export default _default;
}
