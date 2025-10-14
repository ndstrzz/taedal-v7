import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || "";
const anon = process.env.SUPABASE_ANON_KEY || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!url) {
  console.warn("[supabase] Missing SUPABASE_URL.");
}
if (!serviceKey) {
  console.warn("[supabase] Missing SUPABASE_SERVICE_ROLE_KEY (admin tasks will fail).");
}

export const sbAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Create a client that forwards the caller's JWT to Supabase. */
export function makeUserClient(token?: string) {
  if (!token) {
    if (!anon) console.warn("[supabase] Missing SUPABASE_ANON_KEY.");
    return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
