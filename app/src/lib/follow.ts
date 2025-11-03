// app/src/lib/follow.ts
import { supabase } from "./supabase";

/** Is the signed-in user following `targetId`? */
export async function getFollowState(targetId: string): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  const me = u.user?.id;
  if (!me || !targetId || me === targetId) return false;

  // Use head:true counting to avoid selecting rows/columns that don't exist
  const { count, error } = await supabase
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("follower_id", me)
    .eq("followee_id", targetId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/** Toggle follow; returns the new state (true = now following). */
export async function toggleFollow(targetId: string): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  const me = u.user?.id;
  if (!me) throw new Error("Not signed in");
  if (!targetId) throw new Error("Missing profile id");
  if (me === targetId) return false;

  const currently = await getFollowState(targetId);

  if (currently) {
    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("follower_id", me)
      .eq("followee_id", targetId);
    if (error) throw error;
    return false;
  } else {
    const { error } = await supabase
      .from("follows")
      .insert({ follower_id: me, followee_id: targetId });
    if (error) throw error;
    return true;
  }
}

/** Follower / following counts for a profile (numbers, never null). */
export async function getFollowCounts(
  profileId: string
): Promise<{ followers: number; following: number }> {
  const [a, b] = await Promise.all([
    supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("followee_id", profileId),
    supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("follower_id", profileId),
  ]);

  const followers = (a?.count ?? 0) as number;
  const following = (b?.count ?? 0) as number;
  return { followers, following };
}
