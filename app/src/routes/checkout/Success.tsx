// C:\Users\User\Downloads\taedal-v7\app\src\routes\checkout\Success.tsx

import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type FinalizeState =
  | { status: "idle" }
  | { status: "finalizing" }
  | { status: "done"; alreadyFinalized?: boolean }
  | { status: "error"; message: string };

function cls(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function CheckoutSuccess() {
  const { search } = useLocation();
  const nav = useNavigate();

  const params = useMemo(() => new URLSearchParams(search), [search]);

  const sessionId = params.get("session_id");
  const listingId = params.get("listing_id") || params.get("listing") || null;
  const artworkId = params.get("artwork_id") || null;

  // optional: where to redirect user after success
  const returnTo = params.get("return_to") || (artworkId ? `/art/${artworkId}` : "/");

  const [state, setState] = useState<FinalizeState>({ status: "idle" });

  // ✅ If we have session_id + listing_id, finalize it (works for auctions, and also safe for fixed-price)
  useEffect(() => {
    let alive = true;

    async function run() {
      if (!sessionId || !listingId) return;

      setState({ status: "finalizing" });

      try {
        const { data, error } = await supabase.functions.invoke("finalize-checkout", {
          body: { listingId, sessionId },
        });
        if (error) throw error;

        if (!alive) return;
        setState({
          status: "done",
          alreadyFinalized: Boolean((data as any)?.alreadyFinalized),
        });
      } catch (e: any) {
        if (!alive) return;
        const msg =
          e?.context?.error?.message ||
          e?.context?.message ||
          e?.message ||
          "Failed to finalize purchase.";
        setState({ status: "error", message: String(msg) });
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [sessionId, listingId]);

  const subtitle = useMemo(() => {
    if (!sessionId) {
      return "Thanks for your purchase. If your order takes a moment to reflect, refresh the page.";
    }
    if (!listingId) {
      return "Thanks for your purchase. Your order is being recorded.";
    }
    if (state.status === "finalizing") return "Confirming payment & updating ownership…";
    if (state.status === "done") return "Payment confirmed. Your purchase is now reflected in Taedal.";
    if (state.status === "error") return "Payment received, but finalization needs attention.";
    return "Thanks for your purchase. Your order is being recorded.";
  }, [sessionId, listingId, state.status]);

  const showDebug = Boolean(sessionId || listingId);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-2xl">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] overflow-hidden shadow-2xl">
          {/* Header */}
          <div className="p-6 sm:p-8 flex gap-5 items-start">
            <div className="shrink-0">
              <div className="h-14 w-14 rounded-2xl border border-white/10 bg-neutral-950 grid place-items-center overflow-hidden">
                <img
                  src="/images/success-checkout-icon.svg"
                  alt="Payment success"
                  className="h-10 w-10"
                  onError={(e) => {
                    // fallback: hide broken icon
                    (e.currentTarget as any).style.display = "none";
                  }}
                />
              </div>
            </div>

            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-semibold">
                Payment successful <span className="ml-1">🎉</span>
              </h1>
              <p className="mt-2 text-white/70 leading-relaxed">{subtitle}</p>

              {/* Status pill */}
              <div className="mt-4 flex flex-wrap gap-2">
                {state.status === "finalizing" ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 border border-white/10">
                    <span className="h-2 w-2 rounded-full bg-white/60 animate-pulse" />
                    Finalizing
                  </span>
                ) : state.status === "done" ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-400 text-black px-3 py-1 text-xs font-medium">
                    ✅ Confirmed
                    {state.alreadyFinalized ? <span className="opacity-80">(already)</span> : null}
                  </span>
                ) : state.status === "error" ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-amber-300 text-black px-3 py-1 text-xs font-medium">
                    ⚠️ Needs review
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 border border-white/10">
                    Recorded
                  </span>
                )}
              </div>

              {/* Error text */}
              {state.status === "error" ? (
                <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-200">
                  {state.message}
                  <div className="mt-2 text-xs text-amber-200/80">
                    Tip: try refreshing once. If it still doesn’t reflect, send the session id to the
                    team.
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Debug / details */}
          {showDebug ? (
            <div className="px-6 sm:px-8 pb-4">
              <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-4">
                <div className="text-xs uppercase tracking-wide text-white/50 mb-2">
                  Receipt details
                </div>

                {sessionId ? (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2 border-b border-white/10">
                    <div className="text-xs text-white/60">Stripe session</div>
                    <div className="text-xs text-white/85 break-all font-mono">{sessionId}</div>
                  </div>
                ) : null}

                {listingId ? (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2 border-b border-white/10">
                    <div className="text-xs text-white/60">Listing</div>
                    <div className="text-xs text-white/85 break-all font-mono">{listingId}</div>
                  </div>
                ) : null}

                {artworkId ? (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2">
                    <div className="text-xs text-white/60">Artwork</div>
                    <div className="text-xs text-white/85 break-all font-mono">{artworkId}</div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Actions */}
          <div className="p-6 sm:p-8 pt-2 flex flex-col sm:flex-row gap-2">
            <Link to="/" className="btn w-full sm:w-auto">
              Go home
            </Link>

            <button
              className={cls(
                "btn w-full sm:w-auto bg-white/0 border border-white/20 hover:bg-white/10",
                state.status === "finalizing" && "opacity-60 cursor-not-allowed"
              )}
              onClick={() => nav(returnTo)}
              disabled={state.status === "finalizing"}
              title={state.status === "finalizing" ? "Finalizing… please wait" : ""}
            >
              Back to artwork
            </button>

            <button
              className="btn w-full sm:w-auto bg-white/0 border border-white/10 hover:bg-white/10"
              onClick={() => {
                if (window.history.length > 1) window.history.back();
              }}
            >
              Back to previous page
            </button>

            <button
              className="btn w-full sm:w-auto bg-white/0 border border-white/10 hover:bg-white/10"
              onClick={() => window.location.reload()}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 text-center text-xs text-white/45">
          If your purchase doesn’t reflect after refresh, share the Stripe session id with support.
        </div>
      </div>
    </div>
  );
}
