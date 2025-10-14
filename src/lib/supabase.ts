import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || "";
const anon = process.env.SUPABASE_ANON_KEY || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!url) console.warn("[supabase] Missing SUPABASE_URL.");
if (!serviceKey) console.warn("[supabase] Missing SUPABASE_SERVICE_ROLE_KEY (admin tasks will fail).");

export const sbAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function makeUserClient(token?: string) {
  return createClient(url, anon, {
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
