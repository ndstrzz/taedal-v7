import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!,
  {
    auth: {
      // we handle the URL on /auth/callback ourselves
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);

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
}

/** Optional helper you can import where needed */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
