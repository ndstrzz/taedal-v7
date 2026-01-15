// app/src/routes/checkout/Success.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";

type Status =
  | { state: "loading" }
  | { state: "ok"; paid: boolean; meta: any }
  | { state: "error"; message: string };

export default function CheckoutSuccess() {
  const nav = useNavigate();
  const [sp] = useSearchParams();

  const sessionId = sp.get("session_id") || "";
  const listingId = sp.get("listing") || sp.get("listing_id") || "";
  const artworkId = sp.get("artwork") || sp.get("artwork_id") || "";

  const [status, setStatus] = useState<Status>({ state: "loading" });

  const receipt = useMemo(
    () => ({
      sessionId,
      listingId,
      artworkId,
    }),
    [sessionId, listingId, artworkId]
  );

  const run = async () => {
    if (!sessionId) {
      setStatus({ state: "error", message: "Missing session_id in URL." });
      return;
    }
    setStatus({ state: "loading" });

    try {
      const { data, error } = await supabase.functions.invoke("checkout-finalize", {
        body: { session_id: sessionId },
      });
      if (error) throw error;

      setStatus({
        state: "ok",
        paid: Boolean(data?.paid),
        meta: data?.session?.metadata ?? {},
      });
    } catch (e: any) {
      setStatus({
        state: "error",
        message:
          e?.message ??
          "Failed to verify checkout (network/CORS/env).",
      });
    }
  };

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const goArtwork = () => {
    if (artworkId) nav(`/art/${artworkId}`);
    else nav("/home");
  };

  return (
    <div className="max-w-3xl mx-auto px-8 py-12">
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-7">
        <div className="text-3xl font-semibold">
          Payment successful <span className="ml-2">🎉</span>
        </div>

        {status.state === "loading" && (
          <div className="mt-3 text-white/70">Verifying checkout…</div>
        )}

        {status.state === "ok" && (
          <div className="mt-3">
            {status.paid ? (
              <div className="text-white/80">
                Payment received. If your purchase doesn’t reflect immediately,
                hit refresh once.
              </div>
            ) : (
              <div className="text-amber-300">
                Checkout exists but not marked paid yet.
              </div>
            )}
          </div>
        )}

        {status.state === "error" && (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="text-amber-200 font-medium">Needs review</div>
            <div className="text-amber-200/80 mt-1">{status.message}</div>
            <div className="text-amber-200/70 text-sm mt-2">
              This does NOT mean Stripe failed — it means the app couldn’t verify/finalize.
            </div>
          </div>
        )}

        <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs tracking-wider text-white/40">RECEIPT DETAILS</div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <div className="text-white/60">Stripe session</div>
              <div className="text-white/85 break-all text-right">{receipt.sessionId || "—"}</div>
            </div>
            <div className="flex justify-between gap-3">
              <div className="text-white/60">Listing</div>
              <div className="text-white/85 break-all text-right">{receipt.listingId || "—"}</div>
            </div>
            <div className="flex justify-between gap-3">
              <div className="text-white/60">Artwork</div>
              <div className="text-white/85 break-all text-right">{receipt.artworkId || "—"}</div>
            </div>
          </div>
        </div>

        <div className="mt-7 flex flex-wrap gap-2">
          <button className="btn" onClick={() => nav("/home")}>Go home</button>
          <button className="btn" onClick={goArtwork}>Back to artwork</button>
          <button className="btn" onClick={() => nav(-1)}>Back to previous page</button>
          <button className="btn" onClick={run}>Refresh</button>
        </div>

        <div className="mt-4 text-xs text-white/45">
          If your purchase doesn’t reflect after refresh, share the Stripe session id with support.
        </div>
      </div>
    </div>
  );
}
