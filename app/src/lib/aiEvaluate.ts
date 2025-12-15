// app/src/lib/aiEvaluate.ts
import { supabase } from "./supabase";

export type AiEvalResult = {
  estimated_value_low_usd: number;
  estimated_value_high_usd: number;
  confidence: number;
  momentum_score_0_100: number;
  skyrocket_potential: boolean;
  usco_recommendation: boolean;
  usco_reason: string;
  notes?: string;
  disclaimer?: string;
};

export async function evaluateArtworkAI(artworkId: string) {
  const { data, error } = await supabase.functions.invoke("ai-evaluate-artwork", {
    body: { artwork_id: artworkId },
  });

  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || "AI evaluation failed");

  return data.result as AiEvalResult;
}
