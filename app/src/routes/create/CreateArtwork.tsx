// app/src/routes/create/CreateArtwork.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { supabase } from "../../lib/supabase";
import TagsInput from "../../components/TagsInput";
import { CreateArtworkSchema, type CreateArtworkInput } from "../../schemas/artwork";
import { uploadToArtworksBucket } from "../../lib/upload";
import { sha256File } from "../../lib/hashFile";
import MintModal from "../../components/MintModal";
import SimilarityOverlay from "../../components/SimilarityOverlay";
import useMinBusy from "../../hooks/useMinBusy";
import CropModal from "../../components/CropModal";

type DuplicateHit = {
  id: string;
  title: string | null;
  image_url: string | null;
  creator_id: string | null;
};

type PinResp = { imageCID: string; metadataCID: string; tokenURI: string };

// ---- local helpers ----
type LocalImage = {
  original: File;   // as picked
  current: File;    // may be replaced by cropped JPEG
  previewUrl: string; // object URL
};

const MAX_IMAGES = 6;

export default function CreateArtworkWizard() {
  const nav = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);

  // Wizard step
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 (upload/dupe)
  const [images, setImages] = useState<LocalImage[]>([]);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [dupes, setDupes] = useState<DuplicateHit[] | null>(null);
  const [ackOriginal, setAckOriginal] = useState(false);
  const [checkingDupes, setCheckingDupes] = useState(false);
  const [globalMsg, setGlobalMsg] = useState<string | null>(null);

  // Cropper
  const [cropTargetIdx, setCropTargetIdx] = useState<number | null>(null);

  // Step 2 (details form)
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateArtworkInput>({
    resolver: zodResolver(CreateArtworkSchema) as any,
    defaultValues: {
      title: "",
      description: "",
      tags: [],
      medium: "",
      year_created: "",
      width: undefined,
      height: undefined,
      depth: undefined,
      dim_unit: undefined as any, // keep undefined (not "")
      royalty_bps: 500,
      // hidden/advanced we keep stable
      edition_type: "unique",
      status: "draft",
      is_nsfw: false,
      sale_type: undefined,
      list_price: undefined,
      list_currency: undefined,
      reserve_price: undefined,
      min_offer: undefined,
    },
  });

  // Step 3 (pin & mint)
  const [pinning, setPinning] = useState(false);
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [pinData, setPinData] = useState<PinResp | null>(null);
  const [artworkId, setArtworkId] = useState<string | null>(null);
  const [showMint, setShowMint] = useState(false);

  // Gate overlays to a minimum of 5s
  const showDupeOverlay = useMinBusy(checkingDupes, 5000);
  const showPinOverlay = useMinBusy(pinning, 5000);
  const overlayOpen = showDupeOverlay || showPinOverlay;
  const overlayMessage = showPinOverlay
    ? "Pinning to IPFS…"
    : "Scanning for visually similar artworks…";

  // Require login
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setUserId(data.session?.user?.id ?? null);
    })();
  }, []);

  // Cleanup URLs on unmount
  useEffect(() => {
    return () => {
      images.forEach((im) => {
        if (im.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(im.previewUrl);
      });
    };
  }, [images]);

  // STEP 1: add media (append; don’t replace)
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setGlobalMsg(null);

    // Map new files to LocalImage objects
    const mapped = files.map((f) => ({
      original: f,
      current: f,
      previewUrl: URL.createObjectURL(f),
    }));

    // Append to existing up to MAX_IMAGES
    setImages((prev) => {
      // revoke previews for any extra we drop due to limit
      const spaceLeft = Math.max(0, MAX_IMAGES - prev.length);
      const toUse = mapped.slice(0, spaceLeft);
      return [...prev, ...toUse];
    });

    // If this is the first time adding images (no previous), do duplicate check on the first new one.
    const hadNoImages = images.length === 0;
    if (hadNoImages && mapped[0]) {
      setDupes(null);
      setAckOriginal(false);
      setFileHash(null);

      setCheckingDupes(true);
      try {
        const hash = await sha256File(mapped[0].current);
        setFileHash(hash);

        const { data, error } = await supabase
          .from("artworks")
          .select("id,title,image_url,creator_id")
          .eq("image_sha256", hash)
          .limit(5);

        if (error) throw error;
        setDupes((data as DuplicateHit[]) ?? []);
      } catch (e: any) {
        setGlobalMsg(e?.message ?? "Failed checking duplicates");
      } finally {
        setCheckingDupes(false);
      }
    }

    // Allow selecting the same input again
    e.currentTarget.value = "";
  }

  // Crop modal helpers
  const currentCropFile = useMemo(
    () => (cropTargetIdx == null ? null : images[cropTargetIdx]?.current) as File | null,
    [cropTargetIdx, images]
  );

  function setAsCover(idx: number) {
    if (idx === 0) return;
    setImages((arr) => {
      const copy = [...arr];
      const [picked] = copy.splice(idx, 1);
      copy.unshift(picked);
      return copy;
    });
  }

  function removeImage(idx: number) {
    setImages((arr) => {
      const copy = [...arr];
      const [rm] = copy.splice(idx, 1);
      if (rm?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(rm.previewUrl);
      return copy;
    });
  }

  // STEP 2 → 3: create artwork, then pin
  const onSubmitDetails = handleSubmit(async (values) => {
    if (!userId || images.length === 0) {
      setGlobalMsg("Please sign in and upload at least one image.");
      return;
    }
    setGlobalMsg(null);

    try {
      // 1) upload cover (images[0])
      const coverUpload = await uploadToArtworksBucket(images[0].current, userId);

      // 2) insert row (unchanged sale fields)
      const payload: any = {
        creator_id: userId,
        owner_id: userId, // enforced by trigger
        title: values.title,
        description: values.description || null,

        image_url: coverUpload.publicUrl,
        image_width: coverUpload.width ?? null,
        image_height: coverUpload.height ?? null,
        mime: coverUpload.mime ?? "image/*",
        image_sha256: fileHash ?? null,

        // Optional info
        medium: values.medium || null,
        year_created: values.year_created || null,

        // Optional dimensions
        width: values.width ?? null,
        height: values.height ?? null,
        depth: values.depth ?? null,
        dim_unit: values.dim_unit ?? null,

        // Editions/royalty
        edition_type: "unique",
        edition_size: null,
        royalty_bps: values.royalty_bps ?? 500,

        // Listing related — leave null here
        status: "draft",
        sale_type: null,
        list_price: null,
        list_currency: null,
        reserve_price: null,
        min_offer: null,

        tags: values.tags ?? [],
        is_nsfw: values.is_nsfw ?? false,

        pin_status: "pending",
      };

      const { data: row, error } = await supabase
        .from("artworks")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;

      setArtworkId(row.id);
      setStep(3);

      // 2b) upload additional images → artwork_files (BEST-EFFORT)
      if (images.length > 1) {
        const uploads = await Promise.all(
          images.slice(1).map((im) => uploadToArtworksBucket(im.current, userId))
        );
        const records = uploads.map((up, i) => ({
          artwork_id: row.id,
          url: up.publicUrl,
          kind: "image" as const,
          position: i + 1,
        }));
        try {
          await supabase.from("artwork_files").insert(records);
        } catch {
          // non-blocking
        }
      }

      // 3) pin
      setPinning(true);
      setPinMsg("Pinning to IPFS…");

      const { data: pin, error: pinErr } = await supabase.functions.invoke<PinResp>(
        "pin-artwork",
        { body: { artwork_id: row.id } }
      );
      if (pinErr) throw pinErr;

      setPinning(false);
      setPinData(pin as PinResp);
      setPinMsg("Pinned ✔ — ready to mint");

      // publish after successful pin (BEST-EFFORT)
      try {
        await supabase.from("artworks").update({ status: "active" }).eq("id", row.id);
      } catch {}
    } catch (e: any) {
      setPinning(false);
      setPinMsg(e?.message ?? "Failed during create/pin");
      setGlobalMsg(e?.message ?? "Failed during create/pin");
    }
  });

  if (!userId) {
    return <div className="p-6">Sign in to create an artwork.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Create artwork</h1>
      {globalMsg && <div className="text-sm text-amber-300">{globalMsg}</div>}

      <div className="text-xs text-neutral-400">
        Step {step} of 3: {step === 1 ? "Upload" : step === 2 ? "Details" : "Preview & Mint"}
      </div>

      {/* ───────────────────────────── STEP 1: MEDIA ───────────────────────────── */}
      {step === 1 && (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* left: drop/selector + grid */}
          <div className="lg:col-span-7 space-y-4">
            {/* Big upload panel (keeps our colors, inspired by your ref) */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col items-center justify-center text-center gap-3">
                <div className="h-12 w-12 rounded-full bg-white/8 grid place-items-center">
                  <span className="text-2xl">⤴</span>
                </div>
                <div className="text-sm font-medium">Upload media</div>
                <div className="text-xs text-white/60">
                  Photos up to ~8 MB. JPG / PNG / WebP. Prefer square or 4:5.
                </div>
                <label className="btn cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={onPick}
                  />
                  Upload
                </label>
              </div>
            </div>

            {/* Thumbs (keep existing; append new; per-image actions) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-3">
              {images.map((im, i) => (
                <div
                  key={i}
                  className={`relative rounded-xl overflow-hidden border ${
                    i === 0 ? "border-white/30" : "border-white/10"
                  } bg-neutral-900`}
                >
                  <img src={im.previewUrl} className="h-40 w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 p-2 flex gap-2 bg-black/40 backdrop-blur">
                    <button className="btn px-2 py-1 text-xs" onClick={() => setCropTargetIdx(i)}>
                      Crop
                    </button>
                    {i !== 0 && (
                      <button className="btn px-2 py-1 text-xs" onClick={() => setAsCover(i)}>
                        Set cover
                      </button>
                    )}
                    <button className="btn px-2 py-1 text-xs" onClick={() => removeImage(i)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {/* Placeholder slots up to MAX */}
              {Array.from({ length: Math.max(0, MAX_IMAGES - images.length) }).map((_, idx) => (
                <label
                  key={`ph-${idx}`}
                  className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] grid place-items-center h-40 cursor-pointer hover:border-white/20"
                  title="Add images"
                >
                  <input type="file" accept="image/*" multiple hidden onChange={onPick} />
                  <div className="text-xs text-white/60">Upload</div>
                </label>
              ))}
            </div>

            {/* Duplicates notice */}
            {checkingDupes && <div className="text-sm">Checking for duplicates…</div>}

            {dupes && dupes.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm">
                  We found artworks with the same file. Please confirm you are the original creator to continue:
                </div>
                <div className="grid gap-2">
                  {dupes.map((d) => (
                    <div key={d.id} className="flex items-center gap-3 border border-neutral-800 rounded-lg p-2">
                      {d.image_url && <img src={d.image_url} className="h-14 w-14 object-cover rounded" />}
                      <div className="text-sm">
                        <div className="font-medium">{d.title ?? "Untitled"}</div>
                        <div className="text-neutral-400 text-xs">id: {d.id}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <label className="inline-flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    checked={ackOriginal}
                    onChange={(e) => setAckOriginal(e.target.checked)}
                  />
                  <span className="text-sm">
                    I am the original creator and have the rights to mint this artwork.
                  </span>
                </label>
              </div>
            )}

            <div className="flex gap-3">
              <button
                className="btn"
                disabled={
                  images.length === 0 ||
                  checkingDupes ||
                  (dupes && dupes.length > 0 && !ackOriginal)
                }
                onClick={() => setStep(2)}
              >
                Continue
              </button>
            </div>
          </div>

          {/* right: live preview while uploading */}
          <div className="lg:col-span-5">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3 sticky top-6">
              <div className="text-sm font-medium">Preview</div>
              <div className="aspect-square overflow-hidden rounded-xl bg-neutral-900 border border-white/10">
                {images[0] ? (
                  <img src={images[0].previewUrl} className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center text-neutral-500 text-sm">No image</div>
                )}
              </div>
              <div className="space-y-1">
                <div className="text-lg font-semibold truncate">{watch("title") || "Untitled"}</div>
                <div className="text-xs text-white/60">By you • Not listed</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────── STEP 2: DETAILS ───────────────────────────── */}
      {step === 2 && (
        <form onSubmit={onSubmitDetails} className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-6">
            {/* Required */}
            <div className="card grid gap-3">
              <div>
                <label className="block text-sm">Title *</label>
                <input className="input" {...register("title")} />
                {errors.title && <p className="text-sm text-rose-400">{errors.title.message}</p>}
              </div>

              <div>
                <label className="block text-sm">Description</label>
                <textarea className="input min-h-[100px]" {...register("description")} />
              </div>

              <div>
                <label className="block text-sm mb-1">Tags</label>
                <TagsInput value={watch("tags") || []} onChange={(v) => setValue("tags", v)} />
              </div>
            </div>

            {/* Optional: Artwork info */}
            <div className="card grid gap-3">
              <div className="text-sm font-medium">Artwork info (optional)</div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm">Medium</label>
                  <input className="input" {...register("medium")} placeholder="Oil on canvas / Digital" />
                </div>
                <div>
                  <label className="block text-sm">Year created</label>
                  <input className="input" {...register("year_created")} placeholder="2024" />
                </div>
              </div>
            </div>

            {/* Optional: Dimensions */}
            <div className="card grid gap-3">
              <div className="text-sm font-medium">Dimensions (optional)</div>
              <div className="grid md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-sm">Width</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    {...register("width", { setValueAs: (v) => (v === "" || v === null ? undefined : Number(v)) })}
                  />
                </div>
                <div>
                  <label className="block text-sm">Height</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    {...register("height", { setValueAs: (v) => (v === "" || v === null ? undefined : Number(v)) })}
                  />
                </div>
                <div>
                  <label className="block text-sm">Depth</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    {...register("depth", { setValueAs: (v) => (v === "" || v === null ? undefined : Number(v)) })}
                  />
                </div>
                <div>
                  <label className="block text-sm">Unit</label>
                  <select
                    className="input"
                    {...register("dim_unit", { setValueAs: (v) => (v === "" ? undefined : v) })}
                  >
                    <option value=""></option>
                    <option value="cm">cm</option>
                    <option value="in">in</option>
                    <option value="px">px</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Optional: Royalties */}
            <div className="card grid gap-3">
              <div className="text-sm font-medium">Royalties (optional)</div>
              <div>
                <label className="block text-sm">Royalty (bps)</label>
                <input
                  className="input"
                  type="number"
                  {...register("royalty_bps", { setValueAs: (v) => (v === "" || v === null ? undefined : Number(v)) })}
                />
                <p className="text-xs text-neutral-400 mt-1">500 bps = 5%.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button className="btn" type="submit">Continue</button>
              <button type="button" className="btn" onClick={() => setStep(1)}>Back</button>
            </div>
          </div>

          {/* Live preview */}
          <div className="lg:col-span-5">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3 sticky top-6">
              <div className="text-sm font-medium">Preview</div>
              <div className="aspect-square overflow-hidden rounded-xl bg-neutral-900 border border-white/10">
                {images[0] ? (
                  <img src={images[0].previewUrl} className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center text-neutral-500 text-sm">No image</div>
                )}
              </div>
              <div className="space-y-1">
                <div className="text-lg font-semibold truncate">{watch("title") || "Untitled"}</div>
                <div className="text-xs text-white/60">By you • Not listed</div>
              </div>
              {images.length > 1 && (
                <div className="grid grid-cols-5 gap-2">
                  {images.slice(1).map((im, i) => (
                    <img key={i} src={im.previewUrl} className="h-16 w-full rounded-md object-cover border border-white/10" />
                  ))}
                </div>
              )}
            </div>
          </div>
        </form>
      )}

      {/* ───────────────────────────── STEP 3: PREVIEW & MINT ───────────────────────────── */}
      {step === 3 && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-medium mb-2">Preview</div>
              <div className="aspect-square overflow-hidden rounded-xl border border-white/10 bg-neutral-900">
                {images[0] ? <img src={images[0].previewUrl} className="h-full w-full object-cover" /> : null}
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 space-y-3">
            <div className="card space-y-3">
              <div className="text-sm">{pinning ? "Pinning to IPFS…" : "Ready to mint"}</div>
              {pinMsg && <div className="text-xs text-neutral-300">{pinMsg}</div>}
              {pinData && (
                <div className="text-xs space-y-1">
                  <div>Image CID: <code>{pinData.imageCID}</code></div>
                  <div>Metadata CID: <code>{pinData.metadataCID}</code></div>
                  <div>Token URI: <code>{pinData.tokenURI}</code></div>
                </div>
              )}
              {!pinning && artworkId && pinData?.tokenURI && (
                <div className="flex flex-wrap gap-2">
                  <button className="btn" onClick={() => setShowMint(true)}>Mint now</button>
                  <button className="btn" onClick={() => nav(`/art/${artworkId}`)}>Skip (view artwork)</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Status modal */}
      {showMint && artworkId && pinData?.tokenURI && (
        <MintModal
          artworkId={artworkId}
          tokenURI={pinData.tokenURI}
          onDone={(ok) => {
            setShowMint(false);
            if (ok) nav(`/art/${artworkId}`, { replace: true });
          }}
        />
      )}

      {/* FULL-SCREEN overlay with minimum 5s display */}
      <SimilarityOverlay open={overlayOpen} message={overlayMessage} />

      {/* Crop modal (per-image) */}
      {cropTargetIdx != null && currentCropFile && (
        <CropModal
          file={currentCropFile}
          aspect={1} // square default; easy to change later
          title="Crop image"
          onCancel={() => setCropTargetIdx(null)}
          onDone={(blob) => {
            setImages((arr) => {
              const copy = [...arr];
              const old = copy[cropTargetIdx];
              const nextFile = new File([blob], old.original.name.replace(/\.\w+$/, "") + ".jpg", {
                type: "image/jpeg",
              });
              if (old.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.previewUrl);
              const previewUrl = URL.createObjectURL(nextFile);
              copy[cropTargetIdx] = { ...old, current: nextFile, previewUrl };
              return copy;
            });
            setCropTargetIdx(null);
          }}
        />
      )}
    </div>
  );
}
