// app/src/lib/upload.ts
import { supabase } from "./supabase";

/** Read image dimensions in the browser */
async function getImageMeta(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const img = document.createElement("img");
    img.src = url;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("Invalid image"));
    });
    return { width: img.naturalWidth, height: img.naturalHeight, mime: file.type || "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Uploads to the public "artworks" bucket under /{userId}/{random}.{ext}
 * Returns a stable public URL + basic image metadata.
 */
export async function uploadToArtworksBucket(file: File, userId: string) {
  if (!file) throw new Error("No file selected");
  const { width, height, mime } = await getImageMeta(file);

  const ext = (() => {
    const t = file.type?.toLowerCase() || "";
    if (t.includes("png")) return "png";
    if (t.includes("webp")) return "webp";
    if (t.includes("gif")) return "gif";
    if (t.includes("svg")) return "svg";
    return "jpg";
  })();

  const path = `${userId}/${crypto.randomUUID()}.${ext}`;

  // NOTE: if the bucket doesn't exist, this is where the error will come from.
  // After you create the bucket, this will succeed.
  const { error } = await supabase.storage
    .from("artworks")
    .upload(path, file, { upsert: false, cacheControl: "31536000" });

  if (error) {
    // Surface a clearer message in UI
    if (error.message?.toLowerCase().includes("bucket")) {
      throw new Error('Storage bucket "artworks" not found (create it in Supabase → Storage).');
    }
    throw error;
  }

  const { data: pub } = supabase.storage.from("artworks").getPublicUrl(path);
  return {
    publicUrl: pub.publicUrl,
    width,
    height,
    mime,
    path,
  };
}
