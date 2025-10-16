import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";

export default function AuthCallback() {
  const [msg, setMsg] = useState("Completing sign-in…");
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      const href = window.location.href;
      const url = new URL(href);
      const hasCode = !!url.searchParams.get("code");
      const hasHashToken = window.location.hash.includes("access_token");

      try {
        if (hasCode) {
          // PKCE-style magic link (requires same browser that started the flow)
          const { error } = await supabase.auth.exchangeCodeForSession(href);
          if (error) throw error;
          nav("/account", { replace: true });
          return;
        }

        if (hasHashToken) {
          // Hash token style (access_token in the #fragment)
          // Supabase client (detectSessionInUrl=true by default) will process
          // the hash on page load. Give it a tick, then read the session.
          // If needed, a second tick covers slower browsers/extensions.
          for (let i = 0; i < 2; i++) {
            await new Promise((r) => setTimeout(r, 50));
            const { data } = await supabase.auth.getSession();
            if (data.session) {
              nav("/account", { replace: true });
              return;
            }
          }
          throw new Error("No session found after hash parsing.");
        }

        // Neither ?code nor #access_token present
        throw new Error("No auth data found in URL.");
      } catch (e: any) {
        setMsg(`Sign-in failed: ${e.message || String(e)}`);
      }
    })();
  }, [nav]);

  return <div className="min-h-[100dvh] grid place-items-center p-6">{msg}</div>;
}
