// app/src/components/ArtworkGrid.tsx
import React from "react";

export type ArtworkThumb = {
  id: string;
  title: string | null;
  image_url: string | null;
  creator_id: string;
  created_at: string;
};

type Props = {
  items: ArtworkThumb[];
  emptyText?: string;
  className?: string;
};

export default function ArtworkGrid({ items, emptyText = "Nothing here yet.", className = "" }: Props) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-neutral-400">{emptyText}</p>;
  }

  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 ${className}`}>
      {items.map((a) => (
        <a key={a.id} href={`/art/${a.id}`} className="block group">
          <div className="aspect-square overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
            {a.image_url ? (
              <img
                src={a.image_url}
                alt={a.title ?? "Artwork"}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
            ) : (
              <div className="grid place-items-center h-full text-neutral-500 text-xs">
                No image
              </div>
            )}
          </div>
          <div className="mt-1 text-xs line-clamp-1 text-neutral-300">
            {a.title || "Untitled"}
          </div>
        </a>
      ))}
    </div>
  );
}
