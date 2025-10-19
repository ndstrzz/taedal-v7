import { Link } from "react-router-dom";

/**
 * Studio → Create chooser
 * Mirrors OpenSea's two-card layout: Scheduled Drop (ERC-721) vs Open Collection (ERC-1155)
 * Pure UI; no changes to your mint/pin logic. Buttons just route to your flows.
 */
export default function CreateChooser() {
  return (
    <div className="min-h-[calc(100vh-80px)] bg-black">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* header row */}
        <div className="flex items-center justify-between mb-10">
          <div className="text-left">
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
              What do you want to create?
            </h1>
          </div>
          {/* Close X (optional) */}
          <Link
            to="/"
            className="h-9 w-9 grid place-items-center rounded-full border border-white/10 text-white/70 hover:text-white hover:border-white/30"
            aria-label="Close"
            title="Close"
          >
            ×
          </Link>
        </div>

        {/* helper box */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <div className="text-sm text-white/80">
              View our guide to help decide between a Scheduled Drop and an Instant Collection
            </div>
            <a
              href="#"
              className="btn text-sm"
              onClick={(e) => {
                e.preventDefault();
                // replace with your docs link when ready
                alert("Hook this to your guide URL");
              }}
            >
              View Guide
            </a>
          </div>
        </div>

        {/* cards row */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Scheduled Drop (ERC-721) */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8">
            {/* Icon placeholder */}
            <div className="mb-6">
              <div className="h-16 w-16 rounded-xl bg-white/[0.08] border border-white/10" />
            </div>

            <h2 className="text-2xl font-semibold mb-3">Scheduled Drop</h2>

            <Link to="/studio/create/drop" className="btn w-full mb-5">
              Create Drop
            </Link>

            <p className="text-sm text-white/70 mb-5">
              Build anticipation with timed launches, gated access, and reveal after mint. Great for 1/1s or curated editions.
            </p>

            <ul className="text-sm text-white/80 space-y-2">
              <li className="flex items-start gap-2">
                <span className="mt-[2px]">⌘</span>
                <span>ERC-721 contract</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-[2px]">🗓</span>
                <span>Scheduled launch</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-[2px]">#</span>
                <span>Fixed number of items — set how many will ever be available</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-[2px]">🕵️</span>
                <span>Post-mint reveal</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-[2px]">🔒</span>
                <span>Gated access</span>
              </li>
            </ul>
          </div>

          {/* Open Collection (ERC-1155) */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8">
            {/* Icon grid placeholder */}
            <div className="mb-6 flex gap-2">
              <div className="h-10 w-10 rounded-lg bg-white/[0.08] border border-white/10" />
              <div className="h-10 w-10 rounded-lg bg-white/[0.08] border border-white/10" />
              <div className="h-10 w-10 rounded-lg bg-white/[0.08] border border-white/10" />
              <div className="h-10 w-10 rounded-lg bg-white/[0.08] border border-white/10 grid place-items-center text-white/60">
                +
              </div>
            </div>

            <h2 className="text-2xl font-semibold mb-3">Open Collection</h2>

            {/* IMPORTANT: point this to your current CreateArtwork route */}
            <Link to="/create" className="btn w-full mb-5">
              Create Collection
            </Link>

            <p className="text-sm text-white/70 mb-5">
              Publish immediately, ideal for ongoing series or iterative works. Best for Editions or mixed-format collections.
            </p>

            <ul className="text-sm text-white/80 space-y-2">
              <li className="flex items-start gap-2">
                <span className="mt-[2px]">⌘</span>
                <span>ERC-1155 contract</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-[2px]">⚡</span>
                <span>Launch instantly</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-[2px]">➕</span>
                <span>Add new items anytime — no fixed supply, supports ongoing creativity</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-[2px]">🖼</span>
                <span>Items show right away</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-[2px]">✨</span>
                <span>Great for evolving collections</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
