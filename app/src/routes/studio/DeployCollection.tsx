import { useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";

/**
 * Studio → Create → Deploy Contract (UI only)
 * - Collection Image upload (square)
 * - Name (immutable on-chain)
 * - Token Symbol (immutable on-chain)
 * - Chain selector
 * - "Publish Contract" → shows a "Deploying..." interstitial, then routes to /create
 *
 * NOTE: This page does not call a wallet. Replace the simulateDeploy() with your real deploy flow.
 */

type ChainOption = { id: string; label: string };

const CHAINS: ChainOption[] = [
  { id: "ethereum", label: "Ethereum" },
  // You can add Sepolia/Testnets or other EVMs here later
];

export default function DeployCollection() {
  const nav = useNavigate();

  // form state
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [chain, setChain] = useState<ChainOption>(CHAINS[0]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const canPublish = useMemo(() => {
    return !!imgUrl && name.trim().length >= 2 && /^[A-Z]{2,10}$/.test(symbol) && !!chain?.id && !busy;
  }, [imgUrl, name, symbol, chain, busy]);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    // cleanup previous
    if (imgUrl?.startsWith("blob:")) URL.revokeObjectURL(imgUrl);
    setImgUrl(url);
    setImgFile(f);
    e.currentTarget.value = "";
  }

  function clearImage() {
    if (imgUrl?.startsWith("blob:")) URL.revokeObjectURL(imgUrl);
    setImgUrl(null);
    setImgFile(null);
  }

  // Simulated deploy → replace with actual wallet interaction later
  async function simulateDeploy() {
    setBusy(true);
    setErr(null);
    try {
      // show interstitial screen first
      nav("/studio/create/collection/deploying", {
        state: {
          preview: imgUrl,
          name,
          symbol,
          chain: chain.label,
        },
      });
      // simulate network/mining delay
      await new Promise((r) => setTimeout(r, 2200));
      // after "success", route user into your existing mint flow
      nav("/create", { replace: true });
    } catch (e: any) {
      setErr(e?.message ?? "Failed to deploy");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-80px)] bg-black">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* crumb */}
        <div className="text-xs text-white/60 mb-3">
          <Link to="/studio" className="hover:text-white/80">Studio</Link>
          <span className="mx-2 text-white/30">›</span>
          <Link to="/studio/create" className="hover:text-white/80">Create</Link>
          <span className="mx-2 text-white/30">›</span>
          <span className="text-white/80">Deploy Smart Contract</span>
        </div>

        <h1 className="text-2xl font-semibold mb-6">Deploy Smart Contract</h1>

        <div className="grid lg:grid-cols-12 gap-6">
          {/* Left: image */}
          <div className="lg:col-span-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-sm font-medium mb-2">Collection Image</div>
              <div className="aspect-square rounded-xl overflow-hidden bg-neutral-900 border border-white/10 grid place-items-center relative">
                {imgUrl ? (
                  <>
                    <img src={imgUrl} className="h-full w-full object-cover" />
                    <div className="absolute top-2 right-2 flex gap-2">
                      <button className="btn px-2 py-1 text-xs" onClick={() => inputRef.current?.click()}>
                        Edit
                      </button>
                      <button className="btn px-2 py-1 text-xs" onClick={clearImage}>
                        Delete
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xs text-white/60 text-center px-6">
                      Click to upload or drag and drop<br />
                      <span className="text-white/40">1000 × 1000 • GIF, JPG, PNG, SVG • max 50 MB</span>
                    </div>
                    <input
                      ref={inputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={onPickFile}
                    />
                    <button className="btn absolute bottom-3" onClick={() => inputRef.current?.click()}>
                      Upload
                    </button>
                  </>
                )}
                <input ref={inputRef} type="file" accept="image/*" hidden onChange={onPickFile} />
              </div>

              <div className="flex gap-2 mt-3">
                <span className="text-[11px] px-2 py-0.5 rounded bg-white/10 border border-white/20">ETHEREUM</span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-white/10 border border-white/20">ERC1155</span>
              </div>
            </div>
          </div>

          {/* Right: form */}
          <div className="lg:col-span-7">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 space-y-4">
              <div className="text-sm font-medium">Start with your Collection Contract</div>
              <div className="text-xs text-white/60">
                Every NFT collection lives on its own smart contract. We’ll deploy one for you now — it enables you to create NFTs.
              </div>

              <div>
                <label className="block text-sm mb-1">Name</label>
                <input
                  className="input"
                  placeholder="Add Contract Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <div className="text-xs text-white/50 mt-1">
                  Your contract name is the same as your collection name. You won’t be able to update later.
                </div>
              </div>

              <div>
                <label className="block text-sm mb-1">Token Symbol</label>
                <input
                  className="input"
                  placeholder="Add Collection Symbol (A–Z, 2–10)"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                />
                <div className="text-xs text-white/50 mt-1">Can’t be changed after your contract is deployed.</div>
              </div>

              <div>
                <label className="block text-sm mb-1">Chain</label>
                <select
                  className="input"
                  value={chain.id}
                  onChange={(e) => {
                    const next = CHAINS.find((c) => c.id === e.target.value)!;
                    setChain(next);
                  }}
                >
                  {CHAINS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
                <div className="text-xs text-white/50 mt-1">
                  This is the blockchain your collection will live on. You won’t be able to switch it later.
                </div>
              </div>

              {err && <div className="text-sm text-rose-300">{err}</div>}

              <div className="flex gap-3 pt-2">
                <button
                  className="btn"
                  disabled={!canPublish}
                  onClick={simulateDeploy}
                >
                  Publish Contract
                </button>
                <Link to="/studio/create" className="btn">Cancel</Link>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
