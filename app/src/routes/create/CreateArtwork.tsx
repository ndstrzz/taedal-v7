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
// import SimilarityOverlay from "../../components/SimilarityOverlay"; // (not used now)
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
  original: File;
  current: File;
  previewUrl: string;
  // similarity metadata
  checking?: boolean;
  hash?: string | null;
  dupes?: DuplicateHit[] | null;
};

const MAX_IMAGES = 6;

/* ------------------------------ UI helpers (visual only) ------------------------------ */

function Breadcrumb({ step }: { step: 1 | 2 | 3 }) {
  const map = { 1: "Upload", 2: "Details", 3: "Preview & Mint" } as const;
  return (
    <div className="text-xs text-white/60">
      <span className="hover:text-white/80">Create</span>
      <span className="mx-2 text-white/30">›</span>
      <span className="text-white/80">{map[step]}</span>
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const steps = ["Upload", "Details", "Preview & Mint"];
  return (
    <div className="flex items-center gap-2">
      {steps.map((label, i) => {
        const idx = (i + 1) as 1 | 2 | 3;
        const active = step === idx;
        return (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 h-7 pl-1 pr-2 rounded-full border transition
                ${active ? "bg-white text-black border-white" : "bg-white/0 text-white/70 border-white/20"}`}
            >
              <span
                className={`grid place-items-center w-5 h-5 text-[11px] rounded-full
                  ${active ? "bg-black text-white" : "bg-white/15 text-white"}`}
              >
                {i + 1}
              </span>
              <span className="text-xs">{label}</span>
            </div>
            {i < steps.length - 1 && <div className="w-6 h-px bg-white/15" />}
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-3">
        <div className="text-sm font-medium">{title}</div>
        {desc && <div className="text-xs text-white/60">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function InfoBar({ tone = "default", children }: { tone?: "default" | "warning" | "success"; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    default: "bg-white/[0.03] border-white/10 text-white/80",
    warning: "bg-amber-400/10 border-amber-300/30 text-amber-200",
    success: "bg-emerald-400/10 border-emerald-300/30 text-emerald-200",
  };
  return <div className={`text-xs rounded-lg px-3 py-2 border ${tones[tone]}`}>{children}</div>;
}

/* -------- Video Overlay (new): uses your loading video + THICCCBOI font -------- */

function VideoOverlay({
  open,
  message,
}: {
  open: boolean;
  message: "scan" | "pin";
}) {
  if (!open) return null;

  // NOTE: file path contains a space; using %20 for safe URL.
  const videoSrc = "/images/laoding%20video.mp4";

  const text =
    message === "pin"
      ? "We are pinning your unique art, please wait"
      : "We are finding any possible similar artwork in our database, please wait";

  return (
    <>
      {/* Local font face just for the overlay text */}
      <style>{`
        @font-face {
          font-family: 'THICCCBOI-BOLD';
          src: url('/fonts/THICCCBOI-BOLD.TTF') format('truetype');
          font-weight: bold;
          font-style: normal;
          font-display: swap;
        }
        .thicccboi {
          font-family: 'THICCCBOI-BOLD', system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          letter-spacing: 0.2px;
        }
      `}</style>

      <div
        aria-live="polite"
        className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-sm flex items-center justify-center"
      >
        <div className="relative w-full max-w-xl aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
          <video
            src={videoSrc}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute inset-x-4 bottom-4">
            <div className="thicccboi text-base md:text-lg text-white drop-shadow-sm">
              {text}
            </div>
            <div className="text-[11px] text-white/70 mt-1">This may take a few moments.</div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------------------ */

export default function CreateArtworkWizard() {
  const nav = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);

  // Wizard step
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 (upload/dupe)
  const [images, setImages] = useState<LocalImage[]>([]);
  const [ackOriginal, setAckOriginal] = useState(false);
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

  // Step 3 (pin & mint)
  const [pinning, setPinning] = useState(false);
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [pinData, setPinData] = useState<PinResp | null>(null);
  const [artworkId, setArtworkId] = useState<string | null>(null);
  const [showMint, setShowMint] = useState(false);

  // Derived: any image still being scanned? any dupes found?
  const anyChecking = images.some((im) => im.checking);
  const allDupes = images.flatMap((im) => im.dupes ?? []);
  const anyDupes = allDupes.length > 0;

  // Gate overlays (show similarity overlay if any image is checking)
  const showDupeOverlay = useMinBusy(anyChecking, 5000);
  const showPinOverlay = useMinBusy(pinning, 5000);
  const overlayOpen = showDupeOverlay || showPinOverlay;
  // (We keep these booleans; message selection happens in our new overlay.)

  // Require login
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setUserId(data.session?.user?.id ?? null);
    })();
  }, []);

  // Cleanup URLs on unmount/change
  useEffect(() => {
    return () => {
      images.forEach((im) => {
        if (im.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(im.previewUrl);
      });
    };
  }, [images]);

  // Helper: run similarity for a single image index (sequentially)
  async function checkImageDupes(idx: number, file: File) {
    // mark checking
    setImages((arr) => {
      const next = [...arr];
      if (!next[idx]) return arr;
      next[idx] = { ...next[idx], checking: true, dupes: null, hash: null };
      return next;
    });

    try {
      const hash = await sha256File(file);
      const { data, error } = await supabase
        .from("artworks")
        .select("id,title,image_url,creator_id")
        .eq("image_sha256", hash)
        .limit(5);

      if (error) throw error;
      const dupes = (data as DuplicateHit[]) ?? [];

      setImages((arr) => {
        const next = [...arr];
        if (!next[idx]) return arr;
        next[idx] = { ...next[idx], checking: false, hash, dupes };
        return next;
      });
    } catch (e: any) {
      setGlobalMsg(e?.message ?? "Failed checking duplicates");
      setImages((arr) => {
        const next = [...arr];
        if (!next[idx]) return arr;
        next[idx] = { ...next[idx], checking: false };
        return next;
      });
    }
  }

  // Add media (append; don’t replace)
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setGlobalMsg(null);
    setAckOriginal(false);

    // Map new files to LocalImage objects
    const mapped: LocalImage[] = files.map((f) => ({
      original: f,
      current: f,
      previewUrl: URL.createObjectURL(f),
      checking: false,
      dupes: null,
      hash: null,
    }));

    // Append to existing up to MAX_IMAGES
    let startIndex = 0;
    setImages((prev) => {
      const spaceLeft = Math.max(0, MAX_IMAGES - prev.length);
      const toUse = mapped.slice(0, spaceLeft);
      startIndex = prev.length; // where the new ones start
      return [...prev, ...toUse];
    });

    // Sequentially check each new file (avoids CPU spike)
    for (let i = 0; i < mapped.length && startIndex + i < MAX_IMAGES; i++) {
      await checkImageDupes(startIndex + i, mapped[i].current);
    }

    // Allow selecting the same file(s) again
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
    if (anyChecking) {
      setGlobalMsg("Please wait for similarity scan to finish.");
      return;
    }
    if (anyDupes && !ackOriginal) {
      setGlobalMsg("Please confirm you are the original creator to continue.");
      return;
    }
    setGlobalMsg(null);

    try {
      // 1) upload cover (images[0])
      const coverUpload = await uploadToArtworksBucket(images[0].current, userId);

      // 2) insert row
      const payload: any = {
        creator_id: userId,
        owner_id: userId,
        title: values.title,
        description: values.description || null,

        image_url: coverUpload.publicUrl,
        image_width: coverUpload.width ?? null,
        image_height: coverUpload.height ?? null,
        mime: coverUpload.mime ?? "image/*",
        image_sha256: images[0].hash ?? null,

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

      const { data: row, error } = await supabase
        .from("artworks")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;

      setArtworkId(row.id);
      setStep(3);

      // 2b) upload additional images → artwork_files (best-effort)
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
          // ignore best-effort failures
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

      // publish after successful pin (best-effort)
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
    return (
      <div className="max-w-4xl mx-auto p-8">
        <Breadcrumb step={1} />
        <div className="mt-4 text-xl font-semibold">Create artwork</div>
        <InfoBar tone="warning">Sign in to create an artwork.</InfoBar>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Breadcrumb step={step} />
          <h1 className="text-2xl font-semibold">Create artwork</h1>
          <div className="text-sm text-white/60">
            Publish immediately — items show right away. Great for evolving collections.
          </div>
        </div>
        <Stepper step={step} />
      </div>

      {globalMsg && <InfoBar tone="warning">{globalMsg}</InfoBar>}

      {/* ── STEP 1: MEDIA ───────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-4">
            {/* Upload panel */}
            <Section title="Upload media" desc="Photos up to ~8 MB. JPG / PNG / WebP. Prefer square or 4:5.">
              <div className="flex flex-col items-center justify-center text-center gap-4 py-4">
                <div className="h-12 w-12 rounded-full bg-white/8 grid place-items-center border border-white/10">
                  <span className="text-xl">⤴</span>
                </div>
                <label className="btn cursor-pointer">
                  <input type="file" accept="image/*" multiple hidden onChange={onPick} />
                  Upload files
                </label>
              </div>
            </Section>

            {/* Thumbs with per-image actions + dupe badge */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-3">
              {images.map((im, i) => (
                <div
                  key={i}
                  className={`relative rounded-xl overflow-hidden border ${
                    i === 0 ? "border-white/30" : "border-white/10"
                  } bg-neutral-900`}
                >
                  <img src={im.previewUrl} className="h-40 w-full object-cover" />
                  {/* badges */}
                  {im.checking && (
                    <div className="absolute left-2 top-2 text-[11px] px-1.5 py-0.5 rounded bg-white/10 border border-white/20">
                      scanning…
                    </div>
                  )}
                  {im.dupes && im.dupes.length > 0 && !im.checking && (
                    <div
                      className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-rose-400 shadow"
                      title="Possible duplicate"
                    />
                  )}
                  {/* actions */}
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
              {/* placeholders up to MAX */}
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

            {/* Combined duplicates list (across all images) */}
            {anyDupes && (
              <Section title="Potential duplicates">
                <div className="text-sm mb-2">
                  We found artworks with the same file. Please confirm you are the original creator to continue:
                </div>
                <div className="grid gap-2">
                  {allDupes.map((d, idx) => (
                    <div
                      key={`${d.id}-${idx}`}
                      className="flex items-center gap-3 border border-neutral-800 rounded-lg p-2 bg-white/[0.03]"
                    >
                      {d.image_url && (
                        <img src={d.image_url} className="h-14 w-14 object-cover rounded" />
                      )}
                      <div className="text-sm">
                        <div className="font-medium">{d.title ?? "Untitled"}</div>
                        <div className="text-neutral-400 text-xs">id: {d.id}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <label className="inline-flex items-center gap-2 mt-3">
                  <input
                    type="checkbox"
                    checked={ackOriginal}
                    onChange={(e) => setAckOriginal(e.target.checked)}
                  />
                  <span className="text-sm">I am the original creator and have the rights to mint this artwork.</span>
                </label>
              </Section>
            )}

            <div className="flex gap-3">
              <button
                className="btn"
                disabled={images.length === 0 || anyChecking || (anyDupes && !ackOriginal)}
                onClick={() => setStep(2)}
              >
                Continue
              </button>
            </div>
          </div>

          {/* Right: live preview while uploading */}
          <div className="lg:col-span-5">
            <div className="sticky top-6 space-y-3">
              <Section title="Preview">
                <div className="aspect-square overflow-hidden rounded-xl bg-neutral-900 border border-white/10">
                  {images[0] ? (
                    <img src={images[0].previewUrl} className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-neutral-500 text-sm">No image</div>
                  )}
                </div>
                <div className="mt-3 space-y-1">
                  <div className="text-lg font-semibold truncate">{watch("title") || "Untitled"}</div>
                  <div className="text-xs text-white/60">By you • Not listed</div>
                </div>
              </Section>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: DETAILS ─────────────────────────────────────────────────── */}
      {step === 2 && (
        <form onSubmit={onSubmitDetails} className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-6">
            <Section title="Details">
              <div className="grid gap-3">
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
            </Section>

            <Section title="Artwork info (optional)">
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
            </Section>

            <Section title="Dimensions (optional)">
              <div className="grid md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-sm">Width</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    {...register("width", {
                      setValueAs: (v) => (v === "" || v === null ? undefined : Number(v)),
                    })}
                  />
                </div>
                <div>
                  <label className="block text-sm">Height</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    {...register("height", {
                      setValueAs: (v) => (v === "" || v === null ? undefined : Number(v)),
                    })}
                  />
                </div>
                <div>
                  <label className="block text-sm">Depth</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    {...register("depth", {
                      setValueAs: (v) => (v === "" || v === null ? undefined : Number(v)),
                    })}
                  />
                </div>
                <div>
                  <label className="block text-sm">Unit</label>
                  <select
                    className="input"
                    {...register("dim_unit", {
                      setValueAs: (v) => (v === "" ? undefined : v),
                    })}
                  >
                    <option value=""></option>
                    <option value="cm">cm</option>
                    <option value="in">in</option>
                    <option value="px">px</option>
                  </select>
                </div>
              </div>
            </Section>

            <Section title="Royalties (optional)">
              <div>
                <label className="block text-sm">Royalty (bps)</label>
                <input
                  className="input"
                  type="number"
                  {...register("royalty_bps", {
                    setValueAs: (v) => (v === "" || v === null ? undefined : Number(v)),
                  })}
                />
                <p className="text-xs text-white/60 mt-1">500 bps = 5%.</p>
              </div>
            </Section>

            <div className="flex items-center gap-3">
              <button className="btn" type="submit">
                Continue
              </button>
              <button type="button" className="btn" onClick={() => setStep(1)}>
                Back
              </button>
            </div>

            {anyDupes && (
              <InfoBar tone="warning">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={ackOriginal}
                    onChange={(e) => setAckOriginal(e.target.checked)}
                  />
                  <span className="text-sm">I am the original creator and have the rights to mint this artwork.</span>
                </label>
              </InfoBar>
            )}
          </div>

          {/* Live preview */}
          <div className="lg:col-span-5">
            <div className="sticky top-6 space-y-3">
              <Section title="Preview">
                <div className="aspect-square overflow-hidden rounded-xl bg-neutral-900 border border-white/10">
                  {images[0] ? (
                    <img src={images[0].previewUrl} className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-neutral-500 text-sm">No image</div>
                  )}
                </div>
                <div className="mt-3 space-y-1">
                  <div className="text-lg font-semibold truncate">{watch("title") || "Untitled"}</div>
                  <div className="text-xs text-white/60">By you • Not listed</div>
                </div>
                {images.length > 1 && (
                  <div className="grid grid-cols-5 gap-2 mt-2">
                    {images.slice(1).map((im, i) => (
                      <img
                        key={i}
                        src={im.previewUrl}
                        className="h-16 w-full rounded-md object-cover border border-white/10"
                      />
                    ))}
                  </div>
                )}
              </Section>
            </div>
          </div>
        </form>
      )}

      {/* ── STEP 3: PREVIEW & MINT ──────────────────────────────────────────── */}
      {step === 3 && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-4">
            <Section title="Preview">
              <div className="aspect-square overflow-hidden rounded-xl border border-white/10 bg-neutral-900">
                {images[0] ? <img src={images[0].previewUrl} className="h-full w-full object-cover" /> : null}
              </div>
            </Section>
          </div>

          <div className="lg:col-span-5 space-y-3">
            <Section title="Status">
              {pinning ? <InfoBar>Pinning to IPFS…</InfoBar> : <InfoBar tone="success">Ready to mint</InfoBar>}
              {pinMsg && <div className="text-xs text-neutral-200 mt-2">{pinMsg}</div>}
              {pinData && (
                <div className="text-xs space-y-1 mt-2">
                  <div>
                    Image CID: <code>{pinData.imageCID}</code>
                  </div>
                  <div>
                    Metadata CID: <code>{pinData.metadataCID}</code>
                  </div>
                  <div>
                    Token URI: <code>{pinData.tokenURI}</code>
                  </div>
                </div>
              )}
              {!pinning && artworkId && pinData?.tokenURI && (
                <div className="flex flex-wrap gap-2 mt-3">
                  <button className="btn" onClick={() => setShowMint(true)}>
                    Mint now
                  </button>
                  <button className="btn" onClick={() => nav(`/art/${artworkId}`)}>
                    Skip (view artwork)
                  </button>
                </div>
              )}
            </Section>
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

      {/* Overlays: replaced SimilarityOverlay with THICCCBOI video overlay */}
      <VideoOverlay open={overlayOpen} message={showPinOverlay ? "pin" : "scan"} />

      {/* Crop modal */}
      {cropTargetIdx != null && currentCropFile && (
        <CropModal
          file={currentCropFile}
          aspect={1}
          title="Crop image"
          onCancel={() => setCropTargetIdx(null)}
          onDone={(blob) => {
            // Create the new file first so we can pass it directly to the dupe checker
            const idx = cropTargetIdx;
            const existing = images[idx];
            if (!existing) return setCropTargetIdx(null);

            const nextFile = new File([blob], existing.original.name.replace(/\.\w+$/, "") + ".jpg", {
              type: "image/jpeg",
            });
            const nextPreview = URL.createObjectURL(nextFile);

            // Update state
            setImages((arr) => {
              const copy = [...arr];
              const old = copy[idx];
              if (old?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.previewUrl);
              copy[idx] = {
                ...old,
                current: nextFile,
                previewUrl: nextPreview,
                dupes: null,
                hash: null,
              };
              return copy;
            });

            setCropTargetIdx(null);

            // Re-run similarity scan for the freshly cropped image
            checkImageDupes(idx, nextFile);
          }}
        />
      )}
    </div>
  );
}
