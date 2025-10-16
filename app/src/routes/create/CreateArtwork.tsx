// app/src/routes/create/CreateArtwork.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFieldArray } from "react-hook-form";
import { supabase } from "../../lib/supabase";
import TagsInput from "../../components/TagsInput";
import {
  CreateArtworkSchema,
  type CreateArtworkInput,
} from "../../schemas/artwork";
import { uploadToArtworksBucket } from "../../lib/upload";
import { sha256File } from "../../lib/hashFile";
import MintModal from "../../components/MintModal";
import SimilarityOverlay from "../../components/SimilarityOverlay";
import useMinBusy from "../../hooks/useMinBusy";

// ---------------------------
// Types
// ---------------------------
type DuplicateHit = {
  id: string;
  title: string | null;
  image_url: string | null;
  creator_id: string | null;
};

type PinResp = { imageCID: string; metadataCID: string; tokenURI: string };

// Optional UI-only listing state (we won’t auto-list to keep current flow intact)
type ListType = "" | "fixed_price" | "auction";

// ---------------------------
// Component
// ---------------------------
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

  // Step 2 (details form)
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    control,
    formState: { errors },
  } = useForm<CreateArtworkInput>({
    resolver: zodResolver(CreateArtworkSchema) as any,
    defaultValues: {
      // Keep your existing defaults so nothing downstream breaks
      royalty_bps: 500,
      edition_type: "unique",
      status: "draft",
      tags: [],
      is_nsfw: false,
    },
  });

  // Minimal client-side attributes editor (key/value)
  const { fields: attrFields, append: addAttr, remove: removeAttr } = useFieldArray({
    control,
    // We’ll store attributes separately after insert; not part of CreateArtworkSchema
    name: "attributes" as any,
  });

  // Local UI state for progressive disclosure
  const editionType = watch("edition_type");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [listingOpen, setListingOpen] = useState(false);
  const [listNow, setListNow] = useState(false);
  const [listType, setListType] = useState<ListType>("");

  // Listing UI-only values
  const [fixedPrice, setFixedPrice] = useState<string>("");
  const [listCurrency, setListCurrency] = useState<string>("ETH");
  const [reservePrice, setReservePrice] = useState<string>("");
  const [auctionDuration, setAuctionDuration] = useState<string>("3d");

  // Step 3 (pin & mint)
  const [pinning, setPinning] = useState(false);
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [pinData, setPinData] = useState<PinResp | null>(null);
  const [artworkId, setArtworkId] = useState<string | null>(null);
  const [showMint, setShowMint] = useState(false);

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
      setCheckingDupes(false); // overlay kept min 5s by useMinBusy
    }
  }

  // Helper: insert attributes after artwork insert (best-effort, won’t break if table missing)
  async function insertAttributes(artId: string) {
    const attrs = (attrFields as Array<{ key?: string; value?: string }>).filter(
      (a) => (a.key ?? "").trim() !== ""
    );
    if (attrs.length === 0) return;

    try {
      const payload = attrs.map((a) => ({
        artwork_id: artId,
        trait_type: a.key?.trim() ?? "",
        value: (a.value ?? "").trim(),
      }));
      const { error } = await supabase.from("artwork_attributes").insert(payload);
      if (error) {
        // If table doesn’t exist or any other issue, swallow to avoid breaking flow
        // console.warn("attributes insert error", error);
      }
    } catch {
      /* ignore */
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

      // 2) insert row (keeps your existing payload shape so nothing else breaks)
      const payload: any = {
        creator_id: userId,
        owner_id: userId,
        title: values.title,
        description: values.description ?? null,
        image_url: uploaded.publicUrl,
        image_width: uploaded.width ?? null,
        image_height: uploaded.height ?? null,
        mime: uploaded.mime ?? "image/*",
        image_sha256: fileHash ?? null,

        // Edition
        edition_type: values.edition_type,
        edition_size:
          values.edition_type === "limited" ? values.edition_size ?? null : null,

        // Royalty
        royalty_bps: values.royalty_bps ?? 500,

        // Meta (advanced)
        medium: values.medium ?? null,
        year_created: values.year_created ?? null,
        width: values.width ?? null,
        height: values.height ?? null,
        depth: values.depth ?? null,
        dim_unit: values.dim_unit ?? null,

        // We still set your status field here so downstream isn’t surprised
        status: values.status,

        // Keep these fields so schema / code paths stay identical
        sale_type: values.sale_type ?? null,
        list_price: values.list_price ?? null,
        list_currency: values.list_currency ?? null,
        reserve_price: values.reserve_price ?? null,
        min_offer: values.min_offer ?? null,

        // Misc
        tags: values.tags ?? [],
        is_nsfw: values.is_nsfw ?? false,

        // Pin flow
        pin_status: "pending",
      };

      const { data: row, error } = await supabase
        .from("artworks")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;

      // 2b) Best-effort: insert attributes (if table exists)
      await insertAttributes(row.id);

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

      setPinning(false); // useMinBusy keeps overlay up briefly
      setPinData(pin as PinResp);
      setPinMsg("Pinned ✔ — ready to mint");

      // NOTE: We are *not* auto-listing here to avoid touching your working flow.
      // If you later want one-click listing at creation, we can call your RPC here.
    } catch (e: any) {
      setPinning(false);
      setPinMsg(e?.message ?? "Failed during create/pin");
      setGlobalMsg(e?.message ?? "Failed during create/pin");
    }
  });

  const canContinueFromStep1 = useMemo(() => {
    if (!pickedFile || checkingDupes) return false;
    if (!dupes) return true;
    if (dupes.length === 0) return true;
    return ackOriginal; // must confirm originality when dupes were found
  }, [pickedFile, checkingDupes, dupes, ackOriginal]);

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
                We found artworks with the same file. Please confirm you are the original
                creator to continue:
              </div>
              <div className="grid gap-2">
                {dupes.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-3 border border-neutral-800 rounded-lg p-2"
                  >
                    {d.image_url && (
                      <img
                        src={d.image_url}
                        className="h-14 w-14 object-cover rounded"
                        alt=""
                      />
                    )}
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
              disabled={!canContinueFromStep1}
              onClick={() => setStep(2)}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <form onSubmit={onSubmitDetails} className="space-y-6">
          {/* Artwork details */}
          <div className="card grid gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Artwork details</h2>
            </div>

            <div>
              <label className="block text-sm">Title</label>
              <input className="input" {...register("title")} />
              {errors.title && (
                <p className="text-sm text-rose-400">{errors.title.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm">Description</label>
              <textarea className="input min-h-[100px]" {...register("description")} />
            </div>

            {/* Attributes editor */}
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm">Attributes (optional)</label>
                <button
                  type="button"
                  className="btn"
                  onClick={() => addAttr({ key: "", value: "" } as any)}
                >
                  Add property
                </button>
              </div>
              {attrFields.length > 0 && (
                <div className="mt-2 grid gap-2">
                  {attrFields.map((f, i) => (
                    <div key={f.id} className="grid grid-cols-12 gap-2">
                      <input
                        className="input col-span-5"
                        placeholder="Key (e.g., Style)"
                        {...register(`attributes.${i}.key` as any)}
                      />
                      <input
                        className="input col-span-6"
                        placeholder="Value (e.g., Cubism)"
                        {...register(`attributes.${i}.value` as any)}
                      />
                      <button
                        type="button"
                        className="btn col-span-1"
                        onClick={() => removeAttr(i)}
                        aria-label="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Edition & royalty */}
            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm">Edition type</label>
                <select className="input" {...register("edition_type")}>
                  <option value="unique">Unique</option>
                  <option value="limited">Edition</option>
                  <option value="open">Open Edition</option>
                </select>
              </div>
              <div>
                <label className="block text-sm">Edition size (for Edition)</label>
                <input
                  className="input"
                  type="number"
                  {...register("edition_size")}
                  disabled={editionType !== "limited"}
                />
              </div>
              <div>
                <label className="block text-sm">Royalty (bps)</label>
                <input className="input" type="number" {...register("royalty_bps")} />
              </div>
            </div>

            {/* Advanced accordion */}
            <div className="border border-neutral-800 rounded-lg">
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm flex items-center justify-between"
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                Advanced (optional)
                <span className="text-xs">{advancedOpen ? "▲" : "▼"}</span>
              </button>
              {advancedOpen && (
                <div className="p-3 grid gap-3">
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm">Medium</label>
                      <input
                        className="input"
                        {...register("medium")}
                        placeholder="Oil on canvas / Digital"
                      />
                    </div>
                    <div>
                      <label className="block text-sm">Year created</label>
                      <input
                        className="input"
                        {...register("year_created")}
                        placeholder="2024"
                      />
                    </div>
                  </div>

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

                  <div>
                    <label className="block text-sm mb-1">Tags</label>
                    <TagsInput value={watch("tags") || []} onChange={(v) => setValue("tags", v)} />
                  </div>

                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" {...register("is_nsfw")} />
                    <span className="text-sm">Sensitive content</span>
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* Listing (optional) */}
          <div className="card grid gap-4">
            <button
              type="button"
              className="w-full text-left text-sm flex items-center justify-between"
              onClick={() => setListingOpen((v) => !v)}
            >
              Listing (optional)
              <span className="text-xs">{listingOpen ? "▲" : "▼"}</span>
            </button>

            {listingOpen && (
              <>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={listNow}
                    onChange={(e) => {
                      setListNow(e.target.checked);
                      if (!e.target.checked) setListType("");
                    }}
                  />
                  <span className="text-sm">List this immediately after creation</span>
                </label>

                {listNow && (
                  <>
                    <div className="grid md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-sm">List type</label>
                        <select
                          className="input"
                          value={listType}
                          onChange={(e) => setListType(e.target.value as ListType)}
                        >
                          <option value="">— Select —</option>
                          <option value="fixed_price">Fixed price</option>
                          <option value="auction">Auction</option>
                        </select>
                      </div>

                      {/* Fixed price */}
                      {listType === "fixed_price" && (
                        <>
                          <div>
                            <label className="block text-sm">Price</label>
                            <input
                              className="input"
                              type="number"
                              step="0.00000001"
                              value={fixedPrice}
                              onChange={(e) => setFixedPrice(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="block text-sm">Currency</label>
                            <input
                              className="input"
                              value={listCurrency}
                              onChange={(e) => setListCurrency(e.target.value)}
                              placeholder="ETH / MATIC / USD"
                            />
                          </div>
                        </>
                      )}

                      {/* Auction */}
                      {listType === "auction" && (
                        <>
                          <div>
                            <label className="block text-sm">Reserve price</label>
                            <input
                              className="input"
                              type="number"
                              step="0.00000001"
                              value={reservePrice}
                              onChange={(e) => setReservePrice(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="block text-sm">Currency</label>
                            <input
                              className="input"
                              value={listCurrency}
                              onChange={(e) => setListCurrency(e.target.value)}
                              placeholder="ETH / MATIC / USD"
                            />
                          </div>
                          <div>
                            <label className="block text-sm">Duration</label>
                            <select
                              className="input"
                              value={auctionDuration}
                              onChange={(e) => setAuctionDuration(e.target.value)}
                            >
                              <option value="24h">24 hours</option>
                              <option value="3d">3 days</option>
                              <option value="7d">7 days</option>
                            </select>
                          </div>
                        </>
                      )}
                    </div>

                    <p className="text-xs text-neutral-400">
                      We’ll finish the listing on the artwork page after creation (no change
                      to your current flow).
                    </p>
                  </>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button className="btn" type="submit">
              Continue
            </button>
            <button type="button" className="btn" onClick={() => setStep(1)}>
              Back
            </button>
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
            <div className="flex gap-2">
              <button className="btn" onClick={() => setShowMint(true)}>
                Mint now
              </button>
              <button className="btn" onClick={() => nav(`/art/${artworkId}`)}>
                Skip
              </button>
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
