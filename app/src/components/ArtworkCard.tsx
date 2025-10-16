import { Link } from "react-router-dom";

type Props = {
  id: string;                // artwork id
  title: string | null;
  image_url: string | null;
  price?: number | null;
  currency?: string | null;
};

export default function ArtworkCard({
  id,
  title,
  image_url,
  price,
  currency,
}: Props) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
      <Link to={`/art/${id}`} className="block">
        <div className="aspect-square w-full bg-neutral-950">
          {image_url ? (
            <img
              src={image_url}
              alt={title ?? "Artwork"}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              loading="lazy"
            />
          ) : (
            <div className="grid h-full place-items-center text-neutral-500 text-sm">
              No image
            </div>
          )}
        </div>
      </Link>

      <div className="p-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/art/${id}`}
            className="block truncate text-sm font-medium hover:underline"
            title={title ?? "Untitled"}
          >
            {title || "Untitled"}
          </Link>
          <div className="text-xs text-neutral-400 truncate">
            {price && currency ? `${price} ${currency}` : "Not listed"}
          </div>
        </div>

        {/* Placeholder for future “Buy now” */}
        <Link
          to={`/art/${id}`}
          className="hidden sm:inline-flex rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
        >
          View
        </Link>
      </div>
    </div>
  );
}
