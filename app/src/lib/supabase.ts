// app/src/lib/supabase.ts
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

// Expose the client in DEV so you can run window.supabase.auth.getSession() in the console.
if (import.meta.env.DEV) {
  (window as any).supabase = supabase;
}

/** Optional helper you can import where needed */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
