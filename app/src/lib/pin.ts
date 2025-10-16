// app/src/lib/pin.ts
import { supabase } from "../lib/supabase";

export async function pinArtworkToIPFS(artworkId: string) {
  const { data: s } = await supabase.auth.getSession();
  const token = s?.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pin-artwork`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ artwork_id: artworkId }),
    }
  );

  if (!resp.ok) throw new Error(await resp.text());
  return resp.json() as Promise<{ imageCID: string; metadataCID: string; tokenURI: string }>;
}
