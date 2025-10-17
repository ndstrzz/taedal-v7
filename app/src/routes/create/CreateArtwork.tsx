import { useEffect, useMemo, useRef, useState } from "react";
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

type LocalImage = {
  original: File;     // the file user picked (for name)
  current: File;      // current working file (cropped/replaced)
  previewUrl: string; // object URL for display
};

const MAX_IMAGES = 6;

export default function CreateArtworkWizard() {
  const nav = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);

  // Wizard step
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Upload state
  const [images, setImages] = useState<LocalImage[]>([]);
  const [fileHash, setFileHash] = useState<string | null>(null); // hash of cover (images[0])
  const [dupes, setDupes] = useState<DuplicateHit[] | null>(null);
  const [ackOriginal, setAckOriginal] = useState(false);
  const [checkingDupes, setCheckingDupes] = useState(false);
  const [globalMsg, setGlobalMsg] = useState<string | null>(null);

  // Cropper and replace
  const [cropTargetIdx, setCropTargetIdx] = useState<number | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceIdx, setReplaceIdx] = useState<number | null>(null);

  // Form (details)
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
      dim_unit: undefined as any,
      royalty_bps: 500,
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

  // Pin & mint
  const [pinning, setPinning] = useState(false);
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [pinData, setPinData] = useState<PinResp | null>(null);
  const [artworkId, setArtworkId] = useState<string | null>(null);
  const [showMint, setShowMint] = useState(false);

  // overlays
  const showDupeOverlay = useMinBusy(checkingDupes, 5000);
  const showPinOverlay = useMinBusy(pinning, 5000);
  const overlayOpen = showDupeOverlay || showPinOverlay;
  const overlayMessage = showPinOverlay
    ? "Pinning to IPFS…"
    : "Scanning for visually similar artworks…";

  // session
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setUserId(data.session?.user?.id ?? null);
    })();
  }, []);

  // cleanup object URLs
  useEffect(() => {
    return () => {
      images.forEach((im) => {
        if (im.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(im.previewUrl);
      });
    };
  }, [images]);

  /* ─────────────────────────── upload helpers ─────────────────────────── */

  function fileToLocal(f: File): LocalImage {
    return { original: f, current: f, previewUrl: URL.createObjectURL(f) };
  }

  async function runDupeCheckAgainstCover(local: LocalImage[]) {
    // cover is the first image after any appends/reorders
    const cover = (local.length > 0 ? local[0] : images[0])?.current;
    if (!cover) return;
    setCheckingDupes(true);
    try {
      const hash = await sha256File(cover);
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

  // Main "Upload" (adds/appends; does NOT replace)
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    // how many can we still accept?
    const remaining = Math.max(0, MAX_IMAGES - images.length);
    const toAdd = files.slice(0, remaining).map(fileToLocal);

    if (toAdd.length === 0) {
      setGlobalMsg(`You can upload up to ${MAX_IMAGES} images.`);
      e.target.value = "";
      return;
    }

    setDupes(null);
    setAckOriginal(false);
    setGlobalMsg(null);

    const next = [...images, ...toAdd];
    setImages(next);
    await runDupeCheckAgainstCover(toAdd); // will check current cover (which may be the old one)
    e.target.value = "";
  }

  // Replace a specific tile
  async function onReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || replaceIdx == null) return;
    setImages((arr) => {
      const copy = [...arr];
      const prev = copy[replaceIdx];
      if (prev?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(prev.previewUrl);
      copy[replaceIdx] = fileToLocal(f);
      return copy;
    });
    // If we replaced the cover, redo dupe check
    if (replaceIdx === 0) {
      await runDupeCheckAgainstCover([]);
    }
    setReplaceIdx(null);
  }

  function setAsCover(idx: number) {
    if (idx === 0) return;
    setImages((arr) => {
      const copy = [...arr];
      const [picked] = copy.splice(idx, 1);
      copy.unshift(picked);
      return copy;
    });
    // after reorder, no need to re-hash; cover file didn't change
  }

  function removeImage(idx: number) {
    setImages((arr) => {
      const copy = [...arr];
      const [rm] = copy.splice(idx, 1);
      if (rm?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(rm.previewUrl);
      return copy;
    });
    // If we deleted the cover, re-run dupe check on the new cover (if any)
    if (idx === 0 && images.length > 1) {
      // run on next tick after state updates
      setTimeout(() => runDupeCheckAgainstCover([]), 0);
    }
  }

  const currentCropFile = useMemo(
    () => (cropTargetIdx == null ? null : images[cropTargetIdx]?.current) as File | null,
    [cropTargetIdx, images]
  );

  /* ───────────────────────── create → pin → mint ───────────────────────── */

  const onSubmitDetails = handleSubmit(async (values) => {
    if (!userId || images.length === 0) {
      setGlobalMsg("Please sign in and upload at least one image.");
      return;
    }
    setGlobalMsg(null);

    try {
      // 1) upload cover
      const coverUpload = await uploadToArtworksBucket(images[0].current, userId);

      // 2) create artwork row
      const payload: any = {
        creator_id: userId,
        owner_id: userId,
        title: values.title,
        description: values.description || null,

        image_url: coverUpload.publicUrl,
        image_width: coverUpload.width ?? null,
        image_height: coverUpload.height ?? null,
        mime: coverUpload.mime ?? "image/*",
        image_sha256: fileHash ?? null,

        medium: values.medium || null,
        year_created: values.year_created || null,

        width: values.width ?? null,
        height: values.height ?? null,
        depth: values.depth ?? null,
        dim_unit: values.dim_unit ?? null,

        edition_type: "unique",
        edition_size: null,
        royalty_bps: values.royalty_bps ?? 500,

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

      const { data: row, error } = await supabase.from("artworks").insert(payload).select("id").single();
      if (error) throw error;

      setArtworkId(row.id);
      setStep(3);

      // 2b) upload additional images → artwork_files
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
        await supabase.from("artwork_files").insert(records).catch(() => {});
      }

      // 3) pin
      setPinning(true);
      setPinMsg("Pinning to IPFS…");

      const { data: pin, error: pinErr } = await supabase.functions.invoke<PinResp>("pin-artwork", {
        body: { artwork_id: row.id },
      });
      if (pinErr) throw pinErr;

      setPinning(false);
      setPinData(pin as PinResp);
      setPinMsg("Pinned ✔ — ready to mint");

      // publish (best-effort)
      await supabase.from("artworks").update({ status: "active" }).eq("id", row.id).catch(() => {});
    } catch (e: any) {
      setPinning(false);
      setPinMsg(e?.message ?? "Failed during create/pin");
      setGlobalMsg(e?.message ?? "Failed during create/pin");
    }
  });

  if (!userId) return <div className="p-6">Sign in to create an artwork.</div>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Create artwork</h1>
      {globalMsg && <div className="text-sm text-amber-300">{globalMsg}</div>}

      <div className="text-xs text-neutral-400">
        Step {step} of 3: {step === 1 ? "Upload" : step === 2 ? "Details" : "Preview & Mint"}
      </div>

      {/* STEP 1: media uploader */}
      {step === 1 && (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left: upload box + rail */}
          <div className="lg:col-span-8 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="grid place-items-center gap-2 py-6">
                <div className="rounded-full h-10 w-10 grid place-items-center bg-white/10">⤴</div>
                <div className="text-sm font-medium">Upload media</div>
                <div className="text-xs text-white/60">
                  Photos up to ~8 MB, JPG / PNG / WebP. Prefer square or 4:5.
                </div>
                <label className="btn mt-2 cursor-pointer">
                  <input type="file" accept="image/*" multiple className="hidden" onChange={onPick} />
                  Upload
                </label>
              </div>
            </div>

            {/* Rail of tiles (always shows crop / replace / set cover / remove) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {[...images, ...Array(Math.max(0, MAX_IMAGES - images.length)).fill(null)].map(
                (im, idx) =>
                  im ? (
                    <div
                      key={`im-${idx}`}
                      className={`relative rounded-xl overflow-hidden border ${
                        idx === 0 ? "border-white/40" : "border-white/10"
                      } bg-neutral-900 group`}
                    >
                      <img src={im.previewUrl} className="h-24 w-full object-cover" />
                      <div className="absolute inset-x-0 bottom-0 p-1.5 flex flex-wrap gap-1 bg-black/45 backdrop-blur">
                        <button className="btn px-2 py-1 text-xs" onClick={() => setCropTargetIdx(idx)}>
                          Crop
                        </button>
                        <button
                          className="btn px-2 py-1 text-xs"
                          onClick={() => {
                            setReplaceIdx(idx);
                            replaceInputRef.current?.click();
                          }}
                        >
                          Replace
                        </button>
                        {idx !== 0 && (
                          <button className="btn px-2 py-1 text-xs" onClick={() => setAsCover(idx)}>
                            Set cover
                          </button>
                        )}
                        <button className="btn px-2 py-1 text-xs" onClick={() => removeImage(idx)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label
                      key={`slot-${idx}`}
                      className="rounded-xl border border-white/10 bg-neutral-900/40 grid place-items-center h-24 cursor-pointer hover:bg-white/5"
                      title="Add image"
                    >
                      <input type="file" accept="image/*" className="hidden" onChange={onPick} />
                      <span className="text-xl opacity-70">＋</span>
                    </label>
                  )
              )}
            </div>

            {/* Hidden replace input */}
            <input
              ref={replaceInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onReplaceFile}
            />

            {/* Duplicate hits */}
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

          {/* Right: live preview card */}
          <div className="lg:col-span-4">
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
        </div>
      )}

      {/* STEP 2 — details */}
      {step === 2 && (
        <form onSubmit={onSubmitDetails} className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-6">
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

          {/* Live preview during details */}
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

      {/* STEP 3: final preview & mint */}
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

      {/* modal + overlays */}
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

      <SimilarityOverlay open={overlayOpen} message={overlayMessage} />

      {/* Crop modal per image */}
      {cropTargetIdx != null && currentCropFile && (
        <CropModal
          file={currentCropFile}
          aspect={1}
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
            // If cropping cover, no need to redo dupe check (hash is from pre-crop);
            // but if you want to be strict, uncomment:
            // if (cropTargetIdx === 0) runDupeCheckAgainstCover([]);
            setCropTargetIdx(null);
          }}
        />
      )}
    </div>
  );
}
