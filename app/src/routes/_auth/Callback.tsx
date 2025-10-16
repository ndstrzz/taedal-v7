import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";

function parseHashTokens(hash: string) {
  // hash starts with "#access_token=...&refresh_token=..."
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const access_token = params.get("access_token") || undefined;
  const refresh_token = params.get("refresh_token") || undefined;
  return { access_token, refresh_token };
}

export default function Callback() {
  const [msg, setMsg] = useState("Completing sign-in...");
  const nav = useNavigate();
  const [sp] = useSearchParams();

  useEffect(() => {
    let done = false;
    const failSafe = setTimeout(() => {
      if (!done) setMsg("Taking longer than expected… refresh the page if this persists.");
    }, 6000);

    (async () => {
      try {
        const hash = window.location.hash || "";
        const { access_token, refresh_token } = parseHashTokens(hash);
        const code = sp.get("code");

        if (access_token && refresh_token) {
          // Magic-link flow (tokens in hash)
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
        } else if (code) {
          // PKCE / OAuth code flow
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          throw new Error("No credentials found in URL.");
        }

        // Give onAuthStateChange a tick to propagate
        setTimeout(() => {
          done = true;
          clearTimeout(failSafe);
          const dest = sessionStorage.getItem("returnTo") || "/account";
          sessionStorage.removeItem("returnTo");
          nav(dest, { replace: true });
        }, 150);
      } catch (e: any) {
        done = true;
        clearTimeout(failSafe);
        console.error("Auth callback error:", e);
        setMsg("Sign-in failed: " + (e?.message || "unknown error"));
      }
    })();

    return () => {
      done = true;
      clearTimeout(failSafe);
    };
  }, [nav, sp]);

  return (
    <div className="min-h-[100dvh] grid place-items-center">
      <p className="text-neutral-300">{msg}</p>
    </div>
  );
}
