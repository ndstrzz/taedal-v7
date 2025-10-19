import { Link } from "react-router-dom";

/**
 * Studio dashboard (UI only)
 * - Header: "Studio"
 * - Table header row: NAME, SUPPLY, ITEMS, FLOOR, TOTAL VOLUME, SALES, OWNERS, LISTED
 * - Right-side sort dropdown (static for now)
 * - Empty-state hero in the middle ("Solana NFTs coming soon")
 * - Primary "Create" button → /studio/create
 */
export default function StudioHome() {
  return (
    <div className="min-h-[calc(100vh-80px)] bg-black">
      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Top row: title + controls */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-semibold">Studio</h1>
          <div className="flex items-center gap-3">
            <div className="relative">
              <select
                className="input pr-8"
                defaultValue="recent"
                aria-label="Sort collections"
                title="Sort collections"
              >
                <option value="recent">Recently created</option>
                <option value="name">Name (A–Z)</option>
              </select>
              <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/40">
                ▾
              </div>
            </div>
            <Link to="/studio/create" className="btn">Create</Link>
          </div>
        </div>

        {/* Columns header (table head mimic) */}
        <div className="hidden md:grid grid-cols-12 text-xs text-white/60 px-3 py-2">
          <div className="col-span-3">NAME</div>
          <div className="col-span-1">SUPPLY</div>
          <div className="col-span-1">ITEMS</div>
          <div className="col-span-1">FLOOR</div>
          <div className="col-span-2">TOTAL VOLUME</div>
          <div className="col-span-1">SALES</div>
          <div className="col-span-1">OWNERS</div>
          <div className="col-span-1 text-right">LISTED</div>
        </div>

        {/* Divider */}
        <div className="h-px bg-white/10 mb-8" />

        {/* Empty-state hero centered (like the screenshot) */}
        <div className="relative">
          {/* (Optional) faint skeleton stripes to evoke the list background */}
          <div className="space-y-3 opacity-20">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-8 rounded-md bg-white/5" />
            ))}
          </div>

          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              {/* Placeholder “cards” stack */}
              <div className="flex items-end justify-center gap-3 mb-4">
                <div className="h-28 w-20 rounded-lg bg-white/[0.06] border border-white/10 rotate-[-8deg]" />
                <div className="h-32 w-24 rounded-lg bg-white/[0.08] border border-white/10" />
                <div className="h-28 w-20 rounded-lg bg-white/[0.06] border border-white/10 rotate-[8deg]" />
              </div>
              <div className="text-lg md:text-2xl font-semibold">
                Solana NFTs coming soon
              </div>
            </div>
          </div>
        </div>

        {/* Bottom chrome bar (optional, compact) */}
        <div className="mt-10 text-[11px] text-white/50 flex flex-wrap gap-x-4 gap-y-2">
          <span>Live</span>
          <span>•</span>
          <span>Aggregating</span>
          <span>•</span>
          <span>Networks</span>
          <span>•</span>
          <Link to="/support" className="hover:text-white">Support</Link>
          <span>•</span>
          <span>USD</span>
        </div>
      </div>
    </div>
  );
}
