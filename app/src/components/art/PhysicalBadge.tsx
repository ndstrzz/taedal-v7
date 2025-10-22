// app/src/components/art/PhysicalBadge.tsx
export default function PhysicalBadge(props: { status?: string | null }) {
  const s = props?.status || "with_creator";
  const label =
    s === "with_creator" ? "With Creator" :
    s === "in_transit" ? "In Transit" :
    s === "with_buyer" ? "With Buyer" :
    s === "in_gallery" ? "Gallery/Vault" :
    "Unknown";

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-white/15 bg-white/10">
      📦 Physical • {label}
    </span>
  );
}
