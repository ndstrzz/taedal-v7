import { supabase } from "./supabase";

export async function logArEvent(artwork_id: string, event: string, meta: any = {}) {
  await supabase.from("ar_events").insert({ artwork_id, event, meta });
}
