// app/src/lib/collections.ts
import { supabase } from "./supabase";

export type Collection = {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  created_at: string;
  updated_at: string;
};

export async function fetchMyCollections(): Promise<Collection[]> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("collections")
    .select("*")
    .eq("owner_id", uid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Collection[];
}

export function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

export async function createCollection(payload: {
  name: string;
  description?: string;
}): Promise<Collection> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id;
  if (!uid) throw new Error("Not signed in");

  const slug = slugify(payload.name);
  const { data, error } = await supabase
    .from("collections")
    .insert({
      owner_id: uid,
      name: payload.name,
      slug,
      description: payload.description ?? null,
    })
    .select("*")
    .single<Collection>();

  if (error) throw error;
  return data!;
}
