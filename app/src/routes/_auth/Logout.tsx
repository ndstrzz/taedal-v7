import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";

export default function Logout() {
  const nav = useNavigate();
  useEffect(() => {
    (async () => {
      try {
        await supabase.auth.signOut();
      } finally {
        sessionStorage.clear();
        localStorage.removeItem("sb-logged-in");
        nav("/signin", { replace: true });
      }
    })();
  }, [nav]);
  return <div className="p-6">Signing out…</div>;
}
