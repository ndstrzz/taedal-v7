import { Link, useLocation } from "react-router-dom";
import { useMemo } from "react";

export default function CheckoutSuccess() {
  const { search } = useLocation();

  // Optional: Stripe can append ?session_id=cs_test_... if you used success_url with
  // `?session_id={CHECKOUT_SESSION_ID}`. We just show it for debugging.
  const sessionId = useMemo(() => {
    const p = new URLSearchParams(search);
    return p.get("session_id");
  }, [search]);

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-semibold">Payment successful 🎉</h1>
      <p className="mt-2 text-white/80">
        Thanks for your purchase. Your order is being recorded. You can head back
        to the artwork or your profile to see it reflected.
      </p>

      {sessionId && (
        <p className="mt-3 text-xs text-white/60">
          (Stripe session: <code className="break-all">{sessionId}</code>)
        </p>
      )}

      <div className="mt-6 flex gap-2">
        <Link to="/" className="btn">Go home</Link>
        <button onClick={() => window.history.length > 1 ? window.history.back() : null}
                className="btn bg-white/0 border border-white/20 hover:bg-white/10">
          Back to previous page
        </button>
      </div>
    </div>
  );
}
