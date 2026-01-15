// app/src/routes/checkout/Success.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";

type Status =
  | { state: "loading" }
  | { state: "ok"; paid: boolean; meta: any }
  | { state: "error"; message: string; detail?: string };

export default function CheckoutSuccess() {
  const nav = useNavigate();
  const [sp] = useSearchParams();

  const sessionId = sp.get("session_id") || "";
  const listingIdFromUrl = sp.get("listing") || sp.get("listing_id") || "";
  const artworkIdFromUrl = sp.get("artwork") || sp.get("artwork_id") || "";

  const [status, setStatus] = useState<Status>({ state: "loading" });

  const effective = useMemo(() => {
    const meta = status.state === "ok" ? status.meta || {} : {};
    return {
      sessionId,
      listingId: listingIdFromUrl || meta?.listing_id || meta?.listing || "",
      artworkId: artworkIdFromUrl || meta?.artwork_id || meta?.artwork || "",
    };
  }, [sessionId, listingIdFromUrl, artworkIdFromUrl, status]);

  const run = async () => {
    if (!sessionId) {
      setStatus({ state: "error", message: "Missing session_id in URL." });
      return;
    }
    setStatus({ state: "loading" });

    try {
      // ✅ ensure we have auth (Stripe redirect sometimes lands before session restored)
      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess.session?.access_token;

      if (!accessToken) {
        setStatus({
          state: "error",
          message: "You’re not signed in, so the app can’t finalize this purchase.",
          detail: "Sign in and press Refresh.",
        });
        return;
      }

      // IMPORTANT:
      // Keep your function name the same as what you deployed.
      // You are currently calling "checkout-finalize" in your code,
      // so we keep it here.
      const { data, error } = await supabase.functions.invoke("checkout-finalize", {
        body: {
          session_id: sessionId,
          listing_id: listingIdFromUrl || undefined,
          artwork_id: artworkIdFromUrl || undefined,
        },
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (error) throw error;

      // We store the returned metadata (or whole payload) so UI can fallback to it
      const meta = data?.session?.metadata ?? data?.metadata ?? {};

      setStatus({
        state: "ok",
        paid: Boolean(data?.paid),
        meta,
      });
    } catch (e: any) {
      setStatus({
        state: "error",
        message: "Failed to send a request to the Edge Function",
        detail: e?.message ?? String(e),
      });
    }
  };

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const goArtwork = () => {
    if (effective.artworkId) nav(`/art/${effective.artworkId}`);
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
                Payment received and finalized. Your purchase should reflect now.
              </div>
            ) : (
              <div className="text-amber-300">
                Checkout exists but not marked paid yet. Try Refresh in a few seconds.
              </div>
            )}
          </div>
        )}

        {status.state === "error" && (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
            <div className="text-amber-200 font-medium">Needs review</div>
            <div className="text-amber-200/80 mt-1">{status.message}</div>
            {status.detail && (
              <div className="text-amber-200/70 text-xs mt-2 whitespace-pre-wrap">
                {status.detail}
              </div>
            )}
            <div className="text-amber-200/70 text-sm mt-2">
              Stripe succeeded — the app just couldn’t verify/finalize. You can retry.
            </div>
          </div>
        )}

        <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="text-xs tracking-wider text-white/40">RECEIPT DETAILS</div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <div className="text-white/60">Stripe session</div>
              <div className="text-white/85 break-all text-right">
                {effective.sessionId || "—"}
              </div>
            </div>
            <div className="flex justify-between gap-3">
              <div className="text-white/60">Listing</div>
              <div className="text-white/85 break-all text-right">
                {effective.listingId || "—"}
              </div>
            </div>
            <div className="flex justify-between gap-3">
              <div className="text-white/60">Artwork</div>
              <div className="text-white/85 break-all text-right">
                {effective.artworkId || "—"}
              </div>
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
          If it still doesn’t reflect, share the Stripe session id with support.
        </div>
      </div>
    </div>
  );
}
