import { Link, useSearchParams } from "react-router-dom";

export default function CheckoutSuccess() {
  const [sp] = useSearchParams();
  const listing = sp.get("listing");

  return (
    <div className="max-w-xl mx-auto p-8 space-y-4">
      <h1 className="text-2xl font-semibold">Payment successful 🎉</h1>
      <p className="text-white/80">
        Thanks for your purchase. Your order is being finalized.
      </p>
      <div className="flex gap-2">
        <Link to="/" className="btn">Back home</Link>
        {listing && (
          <Link to={`/orders?listing=${listing}`} className="btn">View orders</Link>
        )}
      </div>
    </div>
  );
}
