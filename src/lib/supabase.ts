import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ""; // server-side only

if (!url || !serviceKey) {
  console.warn("[supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. RPC calls will fail until set.");
}

export const sb = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
