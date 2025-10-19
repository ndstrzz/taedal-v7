// app/src/lib/ownerships.ts
import { supabase } from "../lib/supabase";

export async function setHidden(artworkId: string, hidden: boolean) {
  const { data: sess } = await supabase.auth.getUser();
  const userId = sess.user?.id;
  if (!userId) throw new Error("Not signed in");

  const { error } = await supabase
    .from("ownerships")
    .update({ hidden })
    .eq("artwork_id", artworkId)
    .eq("owner_id", userId);

  if (error) throw error;
}

export async function getMyHidden(artworkId: string) {
  const { data: sess } = await supabase.auth.getUser();
  const userId = sess.user?.id;
  if (!userId) return false;

  const { data, error } = await supabase
    .from("ownerships")
    .select("hidden")
    .eq("artwork_id", artworkId)
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.hidden);
}

/** List artworks the current user owns AND marked hidden */
export async function listHiddenOwned() {
  const { data: sess } = await supabase.auth.getUser();
  const userId = sess.user?.id;
  if (!userId) return [];

  // join ownerships(hidden=true) -> artworks
  const { data, error } = await supabase
    .from("ownerships")
    .select("updated_at, artworks:artwork_id(id,title,image_url,creator_id,created_at)")
    .eq("owner_id", userId)
    .eq("hidden", true)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((r: any) => r.artworks).filter(Boolean);
}
