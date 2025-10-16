import { Link } from "react-router-dom";

type Props = {
  id: string;
  title: string | null;
  image_url: string | null;
  price?: number | null;
  currency?: string | null;
};

export default function ArtworkCard({ id, title, image_url, price, currency }: Props) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 hover:border-white/15 transition">
      <Link to={`/art/${id}`} className="block">
        <div className="aspect-square w-full bg-neutral-950 overflow-hidden">
          {image_url ? (
            <img
              src={image_url}
              alt={title ?? "Artwork"}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              loading="lazy"
            />
          ) : (
            <div className="grid h-full place-items-center text-neutral-500 text-sm">No image</div>
          )}
        </div>
      </Link>

      <div className="p-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/art/${id}`} className="block truncate text-sm font-medium hover:underline" title={title ?? "Untitled"}>
            {title || "Untitled"}
          </Link>
          <div className="text-xs text-neutral-400 truncate">
            {price && currency ? `Ξ ${price} ${currency}` : "Not listed"}
          </div>
        </div>
        <Link to={`/art/${id}`} className="hidden sm:inline-flex rounded-full bg-white text-black px-3 py-1 text-xs font-medium hover:bg-white/90">
          View
        </Link>
      </div>
    </div>
  );
}
