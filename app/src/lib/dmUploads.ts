import { supabase } from "./supabase";

const DM_BUCKET = "dm-media";

function extFromMime(mime: string | null | undefined) {
  const m = (mime ?? "").toLowerCase();
  if (!m) return null;
  if (m.includes("jpeg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("quicktime")) return "mov";
  if (m.includes("webm")) return "webm";
  if (m.includes("mpeg")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("ogg")) return "ogg";
  return null;
}

function isFile(x: any): x is File {
  return typeof File !== "undefined" && x instanceof File;
}

function friendlyStorageError(e: any) {
  const msg = String(e?.message ?? e ?? "");
  // Common Supabase Storage bucket errors
  if (/bucket.*not.*found/i.test(msg) || /The resource was not found/i.test(msg)) {
    return `Storage bucket "${DM_BUCKET}" not found. Make sure the bucket id is exactly "${DM_BUCKET}" (Storage → Buckets) and your client is pointing to the correct Supabase project.`;
  }
  if (/new row violates row-level security/i.test(msg) || /permission denied/i.test(msg)) {
    return `Upload blocked by Storage RLS. Ensure you have an INSERT policy on storage.objects for bucket_id="${DM_BUCKET}" for authenticated users.`;
  }
  return msg || "Upload failed";
}

async function getBestUrl(bucket: string, path: string): Promise<string> {
  // If bucket is public, this works.
  const pub = supabase.storage.from(bucket).getPublicUrl(path);
  const publicUrl = pub?.data?.publicUrl;

  if (publicUrl) return publicUrl;

  // Fallback for private bucket
  const signed = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days
  if (signed.error) throw signed.error;
  const signedUrl = signed.data?.signedUrl;
  if (!signedUrl) throw new Error("Failed to create signed URL");
  return signedUrl;
}

export async function uploadDmFile(opts: {
  threadId: string;
  file: File | Blob;

  // optional: we’ll auto-derive if not provided
  ext?: string; // "png", "jpg", "webm", ...
  contentType?: string; // "image/png", "audio/webm", ...

  // optional: if you want deterministic naming
  filename?: string;

  // optional: override bucket for testing
  bucket?: string;
}) {
  const { threadId } = opts;
  const bucket = opts.bucket ?? DM_BUCKET;

  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Not signed in");

  const file = opts.file;

  const inferredType =
    opts.contentType ??
    (isFile(file) ? file.type : "") ??
    "";

  const inferredExt = opts.ext ?? extFromMime(inferredType) ?? "bin";

  const filename =
    opts.filename ??
    `${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(16).slice(2)}.${inferredExt}`;

  // Keep paths tidy and unique per thread + user
  const yyyy = new Date().getFullYear();
  const mm = String(new Date().getMonth() + 1).padStart(2, "0");
  const path = `dm/${threadId}/${uid}/${yyyy}-${mm}/${filename}`;

  const up = await supabase.storage.from(bucket).upload(path, file, {
    contentType: inferredType || undefined,
    upsert: false,
    cacheControl: "3600",
  });

  if (up.error) {
    throw new Error(friendlyStorageError(up.error));
  }

  const url = await getBestUrl(bucket, path);

  return {
    bucket,
    path,
    publicUrl: url,
    contentType: inferredType || null,
  };
}

export { DM_BUCKET };
