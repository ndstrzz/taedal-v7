// app/src/lib/reverseImageCheck.ts
import { supabase } from "./supabase";

const FN_NAME = "external-reverse-image-check"; // <-- rename if yours differs

export type ReverseImageResult = {
  ok: boolean;
  matches?: Array<{
    url: string;
    title?: string;
    score?: number;
    thumbnail?: string;
    source?: string;
  }>;
  error?: string;
};

export async function runReverseImageCheck(artworkId: string) {
  const { data, error } = await supabase.functions.invoke(FN_NAME, {
    body: { artwork_id: artworkId },
  });

  // If you haven't deployed this function yet, we fail gracefully in CreateArtwork.
  if (error) throw error;

  return data as ReverseImageResult;
}
