import { createClient } from "@supabase/supabase-js";

/** --------------------------------------------------------------
 * Read env (Vite requires VITE_* names). Fail loudly in console.
 * -------------------------------------------------------------- */
const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // This is the #1 reason for "no data" + no network calls in prod.
  console.warn(
    "[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
      "Set them in your Vercel env and .env.local. Without them, no REST calls will be made."
  );
}

export const supabase = createClient(url ?? "", anon ?? "", {
  auth: {
    // we handle the URL on /auth/callback ourselves
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
  },
});

/**
 * Expose the client to window for debugging:
 * - Always in DEV
 * - In PROD only when the page URL has ?dbg=1
 * - Or when VITE_EXPOSE_SB=1 is set in env
 */
const shouldExpose =
  import.meta.env.DEV ||
  (typeof window !== "undefined" &&
    (new URLSearchParams(window.location.search).has("dbg") ||
      import.meta.env.VITE_EXPOSE_SB === "1"));

if (shouldExpose && typeof window !== "undefined") {
  (window as any).supabase = supabase;
  console.info("[supabase] client exposed on window.supabase");
}

/** Optional helper you can import where needed */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
