import { useLocation, Link } from "react-router-dom";

/**
 * Simple interstitial used during deploy simulation.
 * If you wire a real wallet flow, navigate to this route while waiting for tx mining.
 */
export default function Deploying() {
  const loc = useLocation() as any;
  const preview: string | null = loc?.state?.preview ?? null;
  const name: string | null = loc?.state?.name ?? null;
  const symbol: string | null = loc?.state?.symbol ?? null;
  const chain: string | null = loc?.state?.chain ?? null;

  return (
    <div className="min-h-[calc(100vh-80px)] bg-black">
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <div className="mx-auto mb-6 h-48 w-48 rounded-2xl overflow-hidden bg-white/5 border border-white/10 grid place-items-center">
          {preview ? (
            <img src={preview} className="h-full w-full object-cover" />
          ) : (
            <div className="text-white/40 text-sm">No image</div>
          )}
        </div>
        <h1 className="text-2xl font-semibold mb-2">Deploying contract</h1>
        <p className="text-white/70 mb-6">
          Deploying your collection’s contract now. It will become public.
          After deployment, you will set up your Collection and items.
        </p>
        <div className="text-[11px] inline-flex items-center gap-2 px-2 py-1 rounded bg-white/10 border border-white/20">
          <span>STEP 1</span>
          <span>–</span>
          <span>ACCEPT WALLET PROMPT</span>
        </div>

        {/* Fallback controls if someone lands here directly */}
        <div className="mt-8 text-xs text-white/50">
          {name && <div>{name} ({symbol}) • {chain}</div>}
          <div className="mt-2">
            <Link to="/studio/create/collection" className="hover:text-white">Back</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
