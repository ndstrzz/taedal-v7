import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  const loc = useLocation();

  if (loading) return <div className="p-6">loading…</div>;
  if (!user) {
    // remember where to go back to
    sessionStorage.setItem("returnTo", loc.pathname + loc.search + loc.hash);
    return <Navigate to="/signin" replace />;
  }
  return <>{children}</>;
}
