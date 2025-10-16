// app/src/routes/create/CreateArtwork.tsx
import { useEffect, useState } from "react";
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

type DuplicateHit = {
  id: string;
  title: string | null;
  image_url: string | null;
  creator_id: string | null;
};

type PinResp = { imageCID: string; metadataCID: string; tokenURI: string };

export default function CreateArtworkWizard() {
  const nav = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);

  // Wizard step
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 (upload/dupe)
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [dupes, setDupes] = useState<DuplicateHit[] | null>(null);
  const [ackOriginal, setAckOriginal] = useState(false);
  const [checkingDupes, setCheckingDupes] = useState(false);
  const [globalMsg, setGlobalMsg] = useState<string | null>(null);

  // Step 2 (details form, LEAN)
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateArtworkInput>({
    resolver: zodResolver(CreateArtworkSchema) as any,
    defaultValues: {
      // Lean defaults
      title: "",
      description: "",
      tags: [],
      medium: "",
      year_created: "",
      width: undefined,
      height: undefined,
      depth: undefined,
      dim_unit: "",
      royalty_bps: 500,
      // Safety: preserve backend expectations; we keep these out of the UI
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
  const [showMint, setShowMint] = useState(false); // status modal

  // Gate overlays to a minimum of 5s for nicer UX
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

  // STEP 1: file → hash → duplicates
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setPickedFile(f);
    setDupes(null);
    setAckOriginal(false);
    setFileHash(null);
    setGlobalMsg(null);

    if (!f) return;

    setCheckingDupes(true);
    try {
      const hash = await sha256File(f);
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
      setCheckingDupes(false); // useMinBusy keeps the overlay visible for >= 5s
    }
  }

  // STEP 2 → 3: create artwork, then pin
  const onSubmitDetails = handleSubmit(async (values) => {
    if (!userId || !pickedFile) {
      setGlobalMsg("Please sign in and pick a file.");
      return;
    }
    setGlobalMsg(null);

    try {
      // 1) upload
      const uploaded = await uploadToArtworksBucket(pickedFile, userId);

      // 2) insert row (CONTRACT UNCHANGED; sales fields intentionally left null)
      const payload: any = {
        creator_id: userId,
        owner_id: userId, // will also be enforced by trigger
        title: values.title,
        description: values.description || null,
        image_url: uploaded.publicUrl,
        image_width: uploaded.width ?? null,
        image_height: uploaded.height ?? null,
        mime: uploaded.mime ?? "image/*",
        image_sha256: fileHash ?? null,

        // Optional artwork info
        medium: values.medium || null,
        year_created: values.year_created || null,

        // Optional dimensions
        width: values.width ?? null,
        height: values.height ?? null,
        depth: values.depth ?? null,
        dim_unit: values.dim_unit || null,

        // Keep edition simple (unique by default)
        edition_type: "unique",
        edition_size: null,
        royalty_bps: values.royalty_bps ?? 500,

        // Do NOT set list/sale fields here (belongs to Listing flow)
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

      // 3) pin
      setPinning(true);
      setPinMsg("Pinning to IPFS…");

      const { data: pin, error: pinErr } = await supabase.functions.invoke<PinResp>(
        "pin-artwork",
        { body: { artwork_id: row.id } }
      );
      if (pinErr) throw pinErr;

      setPinning(false); // useMinBusy keeps overlay up to the min duration
      setPinData(pin as PinResp);
      setPinMsg("Pinned ✔ — ready to mint");
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
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Create artwork</h1>
      {globalMsg && <div className="text-sm text-amber-300">{globalMsg}</div>}

      <div className="text-xs text-neutral-400">
        Step {step} of 3: {step === 1 ? "Upload" : step === 2 ? "Details" : "Pin & Mint"}
      </div>

      {/* STEP 1 */}
      {step === 1 && (
        <div className="card space-y-4">
          <div>
            <label className="block text-sm">Artwork image</label>
            <input type="file" accept="image/*" className="input" onChange={onPick} />
            <p className="text-xs text-neutral-400 mt-1">
              JPEG/PNG/WebP. Prefer square or 4:5; we’ll resize as needed.
            </p>
          </div>

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
              disabled={!pickedFile || checkingDupes || (dupes && dupes.length > 0 && !ackOriginal)}
              onClick={() => setStep(2)}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 — LEAN DETAILS */}
      {step === 2 && (
        <form onSubmit={onSubmitDetails} className="space-y-6">
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
                <input className="input" type="number" step="0.01" {...register("width")} />
              </div>
              <div>
                <label className="block text-sm">Height</label>
                <input className="input" type="number" step="0.01" {...register("height")} />
              </div>
              <div>
                <label className="block text-sm">Depth</label>
                <input className="input" type="number" step="0.01" {...register("depth")} />
              </div>
              <div>
                <label className="block text-sm">Unit</label>
                <select className="input" {...register("dim_unit")}>
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
              <input className="input" type="number" {...register("royalty_bps")} />
              <p className="text-xs text-neutral-400 mt-1">
                500 bps = 5%. You can change this later for future sales if your policy allows.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="btn" type="submit">Continue</button>
            <button type="button" className="btn" onClick={() => setStep(1)}>Back</button>
          </div>
        </form>
      )}

      {/* STEP 3: Pinning & Minting */}
      {step === 3 && (
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
              {/* We keep listing on the artwork page to avoid touching your listing flow */}
            </div>
          )}
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
    </div>
  );
}
