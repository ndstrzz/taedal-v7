// app/src/routes/_auth/Callback.tsx
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";

function parseHashTokens(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const access_token = params.get("access_token") || undefined;
  const refresh_token = params.get("refresh_token") || undefined;
  return { access_token, refresh_token };
}

export default function Callback() {
  const [msg, setMsg] = useState("Completing sign-in…");
  const nav = useNavigate();
  const [sp] = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { access_token, refresh_token } = parseHashTokens(window.location.hash);
        const code = sp.get("code");

        if (access_token && refresh_token) {
          // Hash-based magic link
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
        } else if (code) {
          // PKCE / OAuth code flow
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          throw new Error("No credentials found in URL.");
        }

        // Clean the URL (remove code/hash)
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, "", cleanUrl);

        const dest = sessionStorage.getItem("returnTo") || "/account";
        sessionStorage.removeItem("returnTo");
        if (!cancelled) nav(dest, { replace: true });
      } catch (e: any) {
        if (!cancelled) setMsg("Sign-in failed: " + (e?.message || "unknown error"));
      }
    })();

    return () => { cancelled = true; };
  }, [nav, sp]);

  return (
    <div className="min-h-[100dvh] grid place-items-center p-6">
      <p className="text-neutral-300">{msg}</p>
    </div>
  );
}
