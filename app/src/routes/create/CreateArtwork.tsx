// C:\Users\User\Downloads\taedal-v7\app\src\routes\create\CreateArtwork.tsx
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { supabase } from "../../lib/supabase";
import TagsInput from "../../components/TagsInput";
import { CreateArtworkSchema, type CreateArtworkInput } from "../../schemas/artwork";
import { uploadToArtworksBucket } from "../../lib/upload";
import { sha256File } from "../../lib/hashFile";
import MintModal from "../../components/MintModal";
import useMinBusy from "../../hooks/useMinBusy";
import CropModal from "../../components/CropModal";
import { createCollection, fetchMyCollections, slugify, type Collection } from "../../lib/collections";
import SimilarityOverlay from "../../components/SimilarityOverlay";
import AiEvaluationCard from "../../components/AIEvaluationCard";

/* ------------------------------------------------------------------------------------ */

type Step = 0 | 1 | 2 | 3 | 4; // step 3 = AI eval, step 4 = Preview & Mint
type ArtworkType = "digital" | "physical";

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
  checking?: boolean;
  hash?: string | null;
  dupes?: DuplicateHit[] | null;
};

type ProjectionTrend = "up" | "down" | "flat";

type AiEval = {
  estimated_value_low_usd: number;
  estimated_value_high_usd: number;
  confidence_0_1: number;
  momentum_score_0_100: number;
  skyrocket_potential: boolean;
  usco_recommendation: boolean;
  usco_reason: string;
  notes: string[];
  disclaimer: string;

  projection_trend: ProjectionTrend;
  projected_change_pct_30d: number;
  projected_value_low_usd_30d: number;
  projected_value_high_usd_30d: number;
  growth_confidence_0_1: number;
  projection_narrative: string;
};

const MAX_IMAGES = 6;

/* ------------------------------ Draft autosave (local + indexeddb) ------------------------------ */

const DRAFT_KEY = "taedal:create_draft:v1";
const DRAFT_DB = "taedal_create_draft_db";
const DRAFT_STORE = "kv";

type DraftPayload = {
  v: 1;
  step: Step;
  artType: ArtworkType | null;
  collectionId: string | "";
  ackOriginal: boolean;
  coverUrl: string | null;
  values: Partial<CreateArtworkInput>;
  updatedAt: string;
};

function openDraftDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DRAFT_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, val: any) {
  const db = await openDraftDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, "readwrite");
    tx.objectStore(DRAFT_STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGet<T = any>(key: string): Promise<T | null> {
  const db = await openDraftDB();
  const out = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, "readonly");
    const req = tx.objectStore(DRAFT_STORE).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out;
}

async function idbDel(key: string) {
  const db = await openDraftDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, "readwrite");
    tx.objectStore(DRAFT_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function clearDraftStorage() {
  localStorage.removeItem(DRAFT_KEY);
  for (let i = 0; i < MAX_IMAGES; i++) {
    await idbDel(`img:${i}`);
  }
}

/* ------------------------------ UI helpers ------------------------------ */

function Breadcrumb({ step }: { step: 1 | 2 | 3 | 4 }) {
  const map = { 1: "Upload", 2: "Details", 3: "AI Evaluation", 4: "Preview & Mint" } as const;
  return (
    <div className="text-xs text-white/60">
      <span className="hover:text-white/80">Create</span>
      <span className="mx-2 text-white/30">›</span>
      <span className="text-white/80">{map[step]}</span>
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  const steps = ["Upload", "Details", "AI Evaluation", "Preview & Mint"];
  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {steps.map((label, i) => {
        const idx = (i + 1) as 1 | 2 | 3 | 4;
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
            {i < steps.length - 1 && <div className="w-6 h-px bg-white/15 hidden md:block" />}
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
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

function InfoBar({
  tone = "default",
  children,
}: {
  tone?: "default" | "warning" | "success";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    default: "bg-white/[0.03] border-white/10 text-white/80",
    warning: "bg-amber-400/10 border-amber-300/30 text-amber-200",
    success: "bg-emerald-400/10 border-emerald-300/30 text-emerald-200",
  };
  return <div className={`text-xs rounded-lg px-3 py-2 border ${tones[tone]}`}>{children}</div>;
}

/* -------- overlays -------- */

function VideoOverlay({ open, message }: { open: boolean; message: "scan" | "pin" | "ai" }) {
  if (!open) return null;
  const videoSrc = "/images/laoding%20video.mp4";
  const text =
    message === "pin"
      ? "We are pinning your unique art, please wait"
      : message === "ai"
      ? "We are analysing your artwork with AI, please wait"
      : "We are finding any possible similar artwork in our database, please wait";

  return (
    <>
      <style>{`
        @font-face { font-family: 'THICCCBOI-BOLD'; src: url('/fonts/THICCCBOI-BOLD.TTF') format('truetype'); font-weight: bold; font-style: normal; font-display: swap; }
        .thicccboi { font-family: 'THICCCBOI-BOLD', system-ui, -apple-system, Segoe UI, Roboto, sans-serif; letter-spacing: 0.2px; }
      `}</style>
      <div className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-sm flex items-center justify-center">
        <div className="relative w-full max-w-xl aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
          <video src={videoSrc} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute inset-x-4 bottom-4">
            <div className="thicccboi text-base md:text-lg text-white drop-shadow-sm">{text}</div>
            <div className="text-[11px] text-white/70 mt-1">This may take a few moments.</div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------ New Collection Modal ------------------------------ */

function NewCollectionModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (c: Collection) => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md rounded-2xl border border-white/10 bg-neutral-950 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">New collection</div>
          <button className="text-sm text-white/70 hover:text-white" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Name *</label>
            <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="text-[11px] text-white/50 mt-1">
              Slug: <code>{slugify(name) || "—"}</code>
            </div>
          </div>
          <div>
            <label className="block text-sm mb-1">Description (optional)</label>
            <textarea className="input w-full min-h-[80px]" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          {err && <div className="text-xs text-rose-400">{err}</div>}
          <div className="flex gap-2">
            <button
              className="btn"
              disabled={!name.trim() || busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  const c = await createCollection({ name: name.trim(), description: desc.trim() || undefined });
                  onCreated(c);
                  onClose();
                } catch (e: any) {
                  setErr(e?.message ?? "Failed to create collection");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Creating…" : "Create"}
            </button>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------ */

export default function CreateArtworkWizard() {
  const nav = useNavigate();

  const [userId, setUserId] = useState<string | null>(null);

  // pre-step
  const [artType, setArtType] = useState<ArtworkType | null>(null);
  const [step, setStep] = useState<Step>(0);

  // collections
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState<string | "">("");
  const [collModalOpen, setCollModalOpen] = useState(false);

  // Step 1 media
  const [images, setImages] = useState<LocalImage[]>([]);
  const [ackOriginal, setAckOriginal] = useState(false);
  const [globalMsg, setGlobalMsg] = useState<string | null>(null);

  // Cropper
  const [cropTargetIdx, setCropTargetIdx] = useState<number | null>(null);

  // Step 2 form
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
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

  // Step 3 AI
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [aiData, setAiData] = useState<AiEval | null>(null);

  // Step 4 pin & mint
  const [pinning, setPinning] = useState(false);
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [pinData, setPinData] = useState<PinResp | null>(null);
  const [artworkId, setArtworkId] = useState<string | null>(null);
  const [showMint, setShowMint] = useState(false);

  // cover URL (persistable)
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  const anyChecking = images.some((im) => im.checking);
  const allDupes = images.flatMap((im) => im.dupes ?? []);
  const anyDupes = allDupes.length > 0;

  const showDupeOverlay = useMinBusy(anyChecking, 5000);
  const showPinOverlay = useMinBusy(pinning, 5000);
  const showAiOverlay = useMinBusy(aiBusy, 5000);

  const coverPreviewSrc = coverUrl ?? images[0]?.previewUrl ?? null;

  // draft save debounce
  const saveTimer = useRef<number | null>(null);

  function scheduleSaveDraft() {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const payload: DraftPayload = {
          v: 1,
          step,
          artType,
          collectionId,
          ackOriginal,
          coverUrl,
          values: {
            title: watch("title"),
            description: watch("description"),
            tags: watch("tags"),
            medium: watch("medium"),
            year_created: watch("year_created"),
            width: watch("width"),
            height: watch("height"),
            depth: watch("depth"),
            dim_unit: watch("dim_unit"),
            royalty_bps: watch("royalty_bps"),
            is_nsfw: watch("is_nsfw"),
          },
          updatedAt: new Date().toISOString(),
        };

        localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));

        for (let i = 0; i < Math.min(images.length, MAX_IMAGES); i++) {
          await idbSet(`img:${i}`, images[i].current);
        }
        for (let i = images.length; i < MAX_IMAGES; i++) {
          await idbDel(`img:${i}`);
        }
      } catch {}
    }, 500);
  }

  // ✅ FIX: keep auth state synced (prod can load session slightly later)
  useEffect(() => {
    let alive = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setUserId(data.session?.user?.id ?? null);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // load my collections when user is known
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const rows = await fetchMyCollections();
        setCollections(rows);
      } catch {
        setCollections([]);
      }
    })();
  }, [userId]);

  // try resume draft on mount
  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const d = JSON.parse(raw) as DraftPayload;
        if (!d || d.v !== 1) return;

        setStep(d.step ?? 0);
        setArtType(d.artType ?? null);
        setCollectionId(d.collectionId ?? "");
        setAckOriginal(!!d.ackOriginal);
        setCoverUrl(d.coverUrl ?? null);

        reset({
          ...watch(),
          ...(d.values ?? {}),
        } as any);

        const restored: LocalImage[] = [];
        for (let i = 0; i < MAX_IMAGES; i++) {
          const f = await idbGet<File>(`img:${i}`);
          if (!f) break;
          restored.push({
            original: f,
            current: f,
            previewUrl: URL.createObjectURL(f),
            checking: false,
            dupes: null,
            hash: null,
          });
        }
        if (restored.length) setImages(restored);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // autosave whenever important state changes
  useEffect(() => {
    scheduleSaveDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    step,
    artType,
    collectionId,
    ackOriginal,
    coverUrl,
    images.length,
    watch("title"),
    watch("description"),
    watch("tags"),
    watch("medium"),
    watch("year_created"),
    watch("width"),
    watch("height"),
    watch("depth"),
    watch("dim_unit"),
    watch("royalty_bps"),
    watch("is_nsfw"),
  ]);

  useEffect(() => {
    const fn = () => scheduleSaveDraft();
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      images.forEach((im) => {
        if (im.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(im.previewUrl);
      });
    };
  }, [images]);

  async function checkImageDupes(idx: number, file: File) {
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

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setGlobalMsg(null);
    setAckOriginal(false);
    setCoverUrl(null);
    setAiData(null);
    setAiErr(null);

    const mapped: LocalImage[] = files.map((f) => ({
      original: f,
      current: f,
      previewUrl: URL.createObjectURL(f),
      checking: false,
      dupes: null,
      hash: null,
    }));

    let startIndex = 0;
    setImages((prev) => {
      const spaceLeft = Math.max(0, MAX_IMAGES - prev.length);
      const toUse = mapped.slice(0, spaceLeft);
      startIndex = prev.length;
      return [...prev, ...toUse];
    });

    for (let i = 0; i < mapped.length && startIndex + i < MAX_IMAGES; i++) {
      await checkImageDupes(startIndex + i, mapped[i].current);
    }

    e.currentTarget.value = "";
  }

  const currentCropFile = useMemo(
    () => (cropTargetIdx == null ? null : images[cropTargetIdx]?.current) as File | null,
    [cropTargetIdx, images],
  );

  function setAsCover(idx: number) {
    if (idx === 0) return;
    setImages((arr) => {
      const copy = [...arr];
      const [picked] = copy.splice(idx, 1);
      copy.unshift(picked);
      return copy;
    });
    setCoverUrl(null);
    setAiData(null);
    setAiErr(null);
  }

  function removeImage(idx: number) {
    setImages((arr) => {
      const copy = [...arr];
      const [rm] = copy.splice(idx, 1);
      if (rm?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(rm.previewUrl);
      return copy;
    });
    if (idx === 0) setCoverUrl(null);
    setAiData(null);
    setAiErr(null);
  }

  // ✅ FIX: use fresh uid (not state) for any upload/insert actions
  async function getFreshUid(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  }

  async function ensureCoverUploadedForExternalCheck(): Promise<string | null> {
    const uid = await getFreshUid(); // ✅ FIX
    if (!uid || !images[0]) {
      setGlobalMsg("Please sign in and upload at least one image first.");
      return null;
    }
    if (coverUrl) return coverUrl;

    try {
      const upload = await uploadToArtworksBucket(images[0].current, uid);
      setCoverUrl(upload.publicUrl);
      return upload.publicUrl;
    } catch (e: any) {
      setGlobalMsg(e?.message ?? "Failed uploading cover for external check.");
      return null;
    }
  }

  async function handleExternalSearch(target: "google" | "bing" | "tineye" | "yandex") {
    const url = await ensureCoverUploadedForExternalCheck();
    if (!url) return;

    const u = encodeURIComponent(url);
    let href = "";

    switch (target) {
      case "google":
        href = `https://www.google.com/searchbyimage?image_url=${u}`;
        break;
      case "bing":
        href = `https://www.bing.com/images/searchbyimage?cbir=sbi&imgurl=${u}`;
        break;
      case "tineye":
        href = `https://tineye.com/search?url=${u}`;
        break;
      case "yandex":
        href = `https://yandex.com/images/search?rpt=imageview&url=${u}`;
        break;
    }

    window.open(href, "_blank", "noreferrer");
  }

  async function runAiEvaluation(id: string) {
    setAiBusy(true);
    setAiErr(null);
    setAiData(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-evaluate-artwork", {
        body: { artwork_id: id },
      });
      if (error) throw error;
      if (!data?.ok || !data?.result) throw new Error("AI evaluation returned no result.");
      setAiData(data.result as AiEval);
    } catch (e: any) {
      setAiErr(e?.message ?? "AI evaluation failed.");
    } finally {
      setAiBusy(false);
    }
  }

  async function pinAndReadyToMint(id: string) {
    setPinning(true);
    setPinMsg("Pinning to IPFS…");
    setPinData(null);
    try {
      const { data: pin, error: pinErr } = await supabase.functions.invoke<PinResp>("pin-artwork", {
        body: { artwork_id: id },
      });
      if (pinErr) throw pinErr;

      setPinning(false);
      setPinData(pin as PinResp);
      setPinMsg("Pinned ✔ — ready to mint");

      try {
        await supabase.from("artworks").update({ status: "active" }).eq("id", id);
      } catch {}
    } catch (e: any) {
      setPinning(false);
      setPinMsg(e?.message ?? "Failed during pin");
      setGlobalMsg(e?.message ?? "Failed during pin");
    }
  }

  const onSubmitDetails = handleSubmit(async (values) => {
    // ✅ FIX: always fetch fresh uid right before insert
    const uid = await getFreshUid();
    if (!uid) {
      setGlobalMsg("Your session is not ready (auth uid is missing). Please refresh and sign in again.");
      return;
    }
    setUserId(uid);

    if (images.length === 0) {
      setGlobalMsg("Please upload at least one image.");
      return;
    }
    if (!artType) {
      setGlobalMsg("Please choose Digital or Physical.");
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
      const coverUpload = await uploadToArtworksBucket(images[0].current, uid);
      setCoverUrl(coverUpload.publicUrl);

      const payload: any = {
        creator_id: uid, // ✅ FIX: never null now
        owner_id: uid,

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

        type: artType,
        physical_status: artType === "physical" ? "with_creator" : null,

        pin_status: "pending",
        collection_id: collectionId || null,
      };

      const { data: row, error } = await supabase.from("artworks").insert(payload).select("id").single();
      if (error) throw error;

      setArtworkId(row.id);

      if (images.length > 1) {
        const uploads = await Promise.all(images.slice(1).map((im) => uploadToArtworksBucket(im.current, uid)));
        const records = uploads.map((up, i) => ({
          artwork_id: row.id,
          url: up.publicUrl,
          kind: "image" as const,
          position: i + 1,
        }));
        try {
          await supabase.from("artwork_files").insert(records);
        } catch {}
      }

      setStep(3);
      await runAiEvaluation(row.id);
    } catch (e: any) {
      setGlobalMsg(e?.message ?? "Failed during create");
    }
  });

  /* ------------------------------ RENDER ------------------------------ */

  if (!userId) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <div className="mt-4 text-xl font-semibold">Create artwork</div>
        <InfoBar tone="warning">Sign in to create an artwork.</InfoBar>
      </div>
    );
  }

  if (step === 0) {
    const hasDraft = !!localStorage.getItem(DRAFT_KEY);

    return (
      <div className="max-w-4xl mx-auto p-8">
        <h1 className="text-3xl font-semibold">What are you creating?</h1>
        <p className="text-white/70 mt-1">Pick the format first — you can still add listing details later.</p>

        {hasDraft && (
          <div className="mt-4">
            <InfoBar tone="warning">
              You have a saved draft.{" "}
              <button className="underline ml-1" onClick={() => setStep(1)}>
                Resume
              </button>{" "}
              •{" "}
              <button
                className="underline ml-1"
                onClick={async () => {
                  await clearDraftStorage();
                  setGlobalMsg("Draft cleared.");
                }}
              >
                Clear draft
              </button>
            </InfoBar>
          </div>
        )}

        <div className="mt-6 grid sm:grid-cols-2 gap-4">
          <button
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left hover:border-white/30 transition"
            onClick={() => {
              setArtType("digital");
              setStep(1);
            }}
            aria-label="Create digital artwork"
          >
            <img src="/images/digital-icon.svg" alt="" width={160} height={160} className="h-10 w-10 mb-3" loading="eager" />
            <div className="text-lg font-semibold">Digital Artwork</div>
            <ul className="text-sm text-white/70 mt-2 list-disc pl-5 space-y-1">
              <li>On-chain token only</li>
              <li>Best for images, videos, or generative pieces</li>
              <li>No shipping management</li>
            </ul>
          </button>

          <button
            className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left hover:border-white/30 transition"
            onClick={() => {
              setArtType("physical");
              setStep(1);
            }}
            aria-label="Create physical artwork"
          >
            <img src="/images/physical-icon.svg" alt="" width={160} height={160} className="h-10 w-10 mb-3" loading="eager" />
            <div className="text-lg font-semibold">Physical Artwork</div>
            <ul className="text-sm text-white/70 mt-2 list-disc pl-5 space-y-1">
              <li>Includes shipping &amp; scan events</li>
              <li>Track status (with creator / in transit / with buyer)</li>
              <li>Great for paintings, prints, sculptures</li>
            </ul>
          </button>
        </div>

        <div className="mt-6 flex gap-2">
          <button className="btn" onClick={() => nav(-1 as any)}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const TypeChip = () => (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/10 border border-white/10">
      {artType === "physical" ? "PHYSICAL" : "DIGITAL"}
    </span>
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Breadcrumb step={step as 1 | 2 | 3 | 4} />
            <TypeChip />
          </div>
          <h1 className="text-2xl font-semibold">Create artwork</h1>
          <div className="text-sm text-white/60">Publish immediately — items show right away. Great for evolving collections.</div>
        </div>
        <Stepper step={step as 1 | 2 | 3 | 4} />
      </div>

      {globalMsg && <InfoBar tone="warning">{globalMsg}</InfoBar>}

      {/* STEP 1 */}
      {step === 1 && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-4">
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

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-3">
              {images.map((im, i) => (
                <div
                  key={i}
                  className={`relative rounded-xl overflow-hidden border ${i === 0 ? "border-white/30" : "border-white/10"} bg-neutral-900`}
                >
                  <img src={im.previewUrl} className="h-40 w-full object-cover" />
                  {im.checking && (
                    <div className="absolute left-2 top-2 text-[11px] px-1.5 py-0.5 rounded bg-white/10 border border-white/20">
                      scanning…
                    </div>
                  )}
                  {im.dupes && im.dupes.length > 0 && !im.checking && (
                    <div className="absolute left-2 top-2 h-2.5 w-2.5 rounded-full bg-rose-400 shadow" title="Possible duplicate" />
                  )}
                  <div className="absolute inset-x-0 bottom-0 p-2 flex gap-2 bg-black/40 backdrop-blur">
                    <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setCropTargetIdx(i)}>
                      Crop
                    </button>
                    {i !== 0 && (
                      <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setAsCover(i)}>
                        Set cover
                      </button>
                    )}
                    <button type="button" className="btn px-2 py-1 text-xs" onClick={() => removeImage(i)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
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

            {anyDupes && (
              <Section title="Potential duplicates">
                <div className="text-sm mb-2">
                  We found artworks with the same file in Taedal. Please confirm you are the original creator to continue:
                </div>
                <div className="grid gap-2">
                  {allDupes.map((d, idx) => (
                    <div key={`${d.id}-${idx}`} className="flex items-center gap-3 border border-neutral-800 rounded-lg p-2 bg-white/[0.03]">
                      {d.image_url && <img src={d.image_url} className="h-14 w-14 object-cover rounded" />}
                      <div className="text-sm">
                        <div className="font-medium">{d.title ?? "Untitled"}</div>
                        <div className="text-neutral-400 text-xs">id: {d.id}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <label className="inline-flex items-center gap-2 mt-3">
                  <input type="checkbox" checked={ackOriginal} onChange={(e) => setAckOriginal(e.target.checked)} />
                  <span className="text-sm">I am the original creator and have the rights to mint this artwork.</span>
                </label>
              </Section>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                className="btn"
                disabled={images.length === 0 || anyChecking || (anyDupes && !ackOriginal)}
                onClick={() => setStep(2)}
              >
                Continue
              </button>

              <button type="button" className="btn" onClick={() => setStep(0)}>
                Change type
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 space-y-3">
            <div className="sticky top-6 space-y-3">
              <Section title="Preview">
                <div className="aspect-square overflow-hidden rounded-xl bg-neutral-900 border border-white/10">
                  {coverPreviewSrc ? (
                    <img key={coverPreviewSrc} src={coverPreviewSrc} className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-neutral-500 text-sm">No image</div>
                  )}
                </div>
                <div className="mt-3 space-y-1">
                  <div className="text-lg font-semibold truncate">{watch("title") || "Untitled"}</div>
                  <div className="text-xs text-white/60">By you • Not listed</div>
                </div>
              </Section>

              {images[0] && (
                <Section
                  title="External reverse-image check"
                  desc="Open this artwork in popular reverse-image engines to see if it already exists elsewhere on the web."
                >
                  <div className="flex flex-wrap gap-2 text-sm">
                    <button type="button" className="btn px-3 py-1 text-xs" onClick={() => handleExternalSearch("google")}>
                      Google Images
                    </button>
                    <button type="button" className="btn px-3 py-1 text-xs" onClick={() => handleExternalSearch("bing")}>
                      Bing Images
                    </button>
                    <button type="button" className="btn px-3 py-1 text-xs" onClick={() => handleExternalSearch("tineye")}>
                      TinEye
                    </button>
                    <button type="button" className="btn px-3 py-1 text-xs" onClick={() => handleExternalSearch("yandex")}>
                      Yandex Images
                    </button>
                  </div>
                  <p className="text-[11px] text-white/50 mt-2">
                    We’ll temporarily upload your cover image to Taedal storage (if not already uploaded) and open the chosen search engine in a new tab.
                  </p>
                </Section>
              )}
            </div>
          </div>
        </div>
      )}

      {/* STEP 2 */}
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

            <Section title="Collection" desc="Optional — group this item under a collection you own.">
              <div className="flex items-center gap-2">
                <select className="input flex-1" value={collectionId} onChange={(e) => setCollectionId(e.target.value as any)}>
                  <option value="">— No collection —</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn" onClick={() => setCollModalOpen(true)}>
                  + New
                </button>
              </div>
              <div className="text-xs text-white/60 mt-1">You can change this later from the artwork page.</div>
            </Section>

            <Section title="Dimensions (optional)">
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
                  <select className="input" {...register("dim_unit", { setValueAs: (v) => (v === "" ? undefined : v) })}>
                    <option value=""></option>
                    <option value="cm">cm</option>
                    <option value="in">in</option>
                    <option value="px">px</option>
                  </select>
                </div>
              </div>
              {artType === "physical" && (
                <p className="text-xs text-white/60 mt-2">
                  This item will start with status <code>with_creator</code>. You can update shipping later.
                </p>
              )}
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

            <Section title="Royalties (optional)">
              <div>
                <label className="block text-sm">Royalty (bps)</label>
                <input
                  className="input"
                  type="number"
                  {...register("royalty_bps", { setValueAs: (v) => (v === "" || v === null ? undefined : Number(v)) })}
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
              <button type="button" className="btn" onClick={() => setStep(0)}>
                Change type
              </button>
            </div>

            {anyDupes && (
              <InfoBar tone="warning">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={ackOriginal} onChange={(e) => setAckOriginal(e.target.checked)} />
                  <span className="text-sm">I am the original creator and have the rights to mint this artwork.</span>
                </label>
              </InfoBar>
            )}
          </div>

          <div className="lg:col-span-5">
            <div className="sticky top-6 space-y-3">
              <Section title="Preview">
                <div className="aspect-square overflow-hidden rounded-xl bg-neutral-900 border border-white/10">
                  {coverPreviewSrc ? (
                    <img key={coverPreviewSrc} src={coverPreviewSrc} className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-neutral-500 text-sm">No image</div>
                  )}
                </div>
                <div className="mt-3 space-y-1">
                  <div className="text-lg font-semibold truncate">{watch("title") || "Untitled"}</div>
                  <div className="text-xs text-white/60">
                    By you •{" "}
                    {collectionId ? `In ${collections.find((c) => c.id === collectionId)?.name ?? "collection"}` : "No collection"}
                  </div>
                </div>

                {images.length > 1 && (
                  <div className="grid grid-cols-5 gap-2 mt-2">
                    {images.slice(1).map((im, i) => (
                      <img key={i} src={im.previewUrl} className="h-16 w-full rounded-md object-cover border border-white/10" />
                    ))}
                  </div>
                )}
              </Section>
            </div>
          </div>
        </form>
      )}

      {/* STEP 3 */}
      {step === 3 && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-4">
            <AiEvaluationCard
              lowUsd={aiData?.estimated_value_low_usd ?? null}
              highUsd={aiData?.estimated_value_high_usd ?? null}
              confidence={aiData?.confidence_0_1 ?? null}
              momentumScore={aiData?.momentum_score_0_100 ?? null}
              skyrocket={aiData?.skyrocket_potential ?? null}
              uscoRecommendation={aiData?.usco_recommendation ?? null}
              uscoReason={aiData?.usco_reason ?? null}
              notes={aiData?.notes ?? null}
              disclaimer={aiData?.disclaimer ?? null}
              projection={
                aiData
                  ? {
                      trend: aiData.projection_trend,
                      changePct30d: aiData.projected_change_pct_30d,
                      lowUsd30d: aiData.projected_value_low_usd_30d,
                      highUsd30d: aiData.projected_value_high_usd_30d,
                      growthConfidence: aiData.growth_confidence_0_1,
                      narrative: aiData.projection_narrative,
                    }
                  : null
              }
              lastEvaluatedAt={null}
              refreshBusy={aiBusy}
              refreshErr={aiErr}
              onRefresh={() => (artworkId ? runAiEvaluation(artworkId) : undefined)}
            />

            <div className="flex flex-wrap gap-2">
              <button
                className="btn"
                type="button"
                disabled={!artworkId || pinning}
                onClick={async () => {
                  if (!artworkId) return;
                  setStep(4);
                  await pinAndReadyToMint(artworkId);
                }}
              >
                Continue to mint
              </button>

              <button className="btn" type="button" onClick={() => setStep(2)} disabled={aiBusy || pinning}>
                Back to details
              </button>

              {aiData?.usco_recommendation && (
                <a
                  className="btn bg-white/0 border border-emerald-300/30 hover:bg-emerald-400/10"
                  href="https://copyright.gov/registration/"
                  target="_blank"
                  rel="noreferrer"
                >
                  USCO registration (link)
                </a>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 space-y-3">
            <div className="sticky top-6 space-y-3">
              <Section title="Preview">
                <div className="aspect-square overflow-hidden rounded-xl border border-white/10 bg-neutral-900">
                  {coverPreviewSrc ? <img key={coverPreviewSrc} src={coverPreviewSrc} className="h-full w-full object-cover" /> : null}
                </div>
                <div className="mt-3">
                  <div className="text-lg font-semibold truncate">{watch("title") || "Untitled"}</div>
                  <div className="text-xs text-white/60">AI reads the cover image + your metadata.</div>
                </div>
              </Section>

              <InfoBar tone="warning">AI estimates are speculative and may be wrong. Treat this as guidance — not financial or legal advice.</InfoBar>
            </div>
          </div>
        </div>
      )}

      {/* STEP 4 */}
      {step === 4 && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-4">
            <Section title="Preview">
              <div className="aspect-square overflow-hidden rounded-xl border border-white/10 bg-neutral-900">
                {coverPreviewSrc ? <img key={coverPreviewSrc} src={coverPreviewSrc} className="h-full w-full object-cover" /> : null}
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
                  <button
                    className="btn"
                    onClick={async () => {
                      await clearDraftStorage();
                      nav(`/art/${artworkId}`);
                    }}
                  >
                    Skip (view artwork)
                  </button>
                  <button className="btn bg-white/0 border border-white/20 hover:bg-white/10" onClick={() => setStep(3)}>
                    Back to AI
                  </button>
                </div>
              )}

              {!pinning && artworkId && !pinData?.tokenURI && (
                <div className="flex gap-2 mt-3">
                  <button className="btn" onClick={() => pinAndReadyToMint(artworkId)}>
                    Pin now
                  </button>
                  <button className="btn bg-white/0 border border-white/20 hover:bg-white/10" onClick={() => setStep(3)}>
                    Back to AI
                  </button>
                </div>
              )}
            </Section>
          </div>
        </div>
      )}

      <NewCollectionModal
        open={collModalOpen}
        onClose={() => setCollModalOpen(false)}
        onCreated={(c) => {
          setCollections((cur) => [c, ...cur]);
          setCollectionId(c.id);
        }}
      />

      {showMint && artworkId && pinData?.tokenURI && (
        <MintModal
          artworkId={artworkId}
          tokenURI={pinData.tokenURI}
          onDone={async (ok) => {
            setShowMint(false);
            if (ok) {
              await clearDraftStorage();
              nav(`/art/${artworkId}`, { replace: true });
            }
          }}
        />
      )}

      <SimilarityOverlay open={showDupeOverlay} message="Scanning your artwork against Taedal’s database…" />
      <VideoOverlay open={showPinOverlay} message="pin" />
      <VideoOverlay open={showAiOverlay} message="ai" />

      {cropTargetIdx != null && currentCropFile && (
        <CropModal
          file={currentCropFile}
          aspect={1}
          title="Crop image"
          onCancel={() => setCropTargetIdx(null)}
          onDone={(blob) => {
            const idx = cropTargetIdx;
            const existing = images[idx];
            if (!existing) return setCropTargetIdx(null);

            const nextFile = new File([blob], existing.original.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
            const nextPreview = URL.createObjectURL(nextFile);

            setImages((arr) => {
              const copy = [...arr];
              const old = copy[idx];
              if (old?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(old.previewUrl);
              copy[idx] = { ...old, current: nextFile, previewUrl: nextPreview, dupes: null, hash: null };
              return copy;
            });

            setCropTargetIdx(null);
            checkImageDupes(idx, nextFile);
          }}
        />
      )}
    </div>
  );
}
