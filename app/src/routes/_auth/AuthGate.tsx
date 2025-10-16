import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useNavigate } from "react-router-dom";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setAuthed(!!data.session);
      setReady(true);
      if (!data.session) {
        sessionStorage.setItem("returnTo", window.location.pathname + window.location.search);
        nav("/signin", { replace: true });
      }
    };
    run();

    const sub = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session);
      if (!session) {
        sessionStorage.setItem("returnTo", window.location.pathname + window.location.search);
        nav("/signin", { replace: true });
      }
    });

    return () => {
      mounted = false;
      sub.data.subscription.unsubscribe();
    };
  }, [nav]);

  if (!ready) return <div className="p-6">loading…</div>;
  if (!authed) return null;
  return <>{children}</>;
}
