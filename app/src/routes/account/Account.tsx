import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import CropModal from "../../components/CropModal";
import { supabase } from "../../lib/supabase";

/* --- tiny image resizer --- */
async function resizeImage(
  file: Blob,
  maxW: number,
  maxH: number,
  mime = "image/jpeg",
  quality = 0.9
) {
  const img = document.createElement("img");
  img.src = URL.createObjectURL(file);
  await new Promise((r) => (img.onload = r));
  const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
  const w = Math.round(img.naturalWidth * ratio);
  const h = Math.round(img.naturalHeight * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(img.src);
  return new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), mime, quality)
  );
}

/* ---------- tiny inline brand icons ---------- */
function IconInstagram(props: any) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}>
      <path
        fill="currentColor"
        d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm5 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zm0 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm5.25-2.25a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z"
      />
    </svg>
  );
}
function IconX(props: any) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}>
      <path
        fill="currentColor"
        d="M3 3h4.7l4.2 6.2L17.7 3H21l-7 8.1L21 21h-4.7l-4.6-6.8L6.3 21H3l7.3-8.3L3 3z"
      />
    </svg>
  );
}
function IconYouTube(props: any) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}>
      <path
        fill="currentColor"
        d="M23 7.5a4 4 0 0 0-2.8-2.8C18.3 4 12 4 12 4s-6.3 0-8.2.7A4 4 0 0 0 1 7.5 41 41 0 0 0 1 12a41 41 0 0 0 0 4.5 4 4 0 0 0 2.8 2.8C5.7 20 12 20 12 20s6.3 0 8.2-.7A4 4 0 0 0 23 16.5 41 41 0 0 0 23 12a41 41 0 0 0 0-4.5zM10 15.5v-7l6 3.5-6 3.5z"
      />
    </svg>
  );
}
function IconTelegram(props: any) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}>
      <path
        fill="currentColor"
        d="M9.2 14.6l-.4 5.8c.6 0 .9-.3 1.3-.6l3.1-3 6.4 4.7c1.2.6 2 .3 2.3-1.1l4.1-19.2c.4-1.7-.6-2.4-1.8-2l-22.4 8.6c-1.5.6-1.5 1.4-.3 1.7l5.7 1.8L20 5.5c.7-.4 1.4-.2.9.2"
      />
    </svg>
  );
}

/* ---------- types ---------- */
type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  instagram?: string | null;
  x_handle?: string | null;
  youtube?: string | null;
  telegram?: string | null;
};

type ArtworkThumb = {
  id: string;
  title: string | null;
  image_url: string | null;
  creator_id: string;
  created_at: string;
};

export default function Account() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [form, setForm] = useState<Profile>({
    id: "",
    username: "",
    display_name: "",
    bio: "",
    avatar_url: "",
    cover_url: "",
    instagram: "",
    x_handle: "",
    youtube: "",
    telegram: "",
  });

  // gallery data
  const [created, setCreated] = useState<ArtworkThumb[]>([]);
  const [purchased, setPurchased] = useState<ArtworkThumb[]>([]);
  const [activeTab, setActiveTab] = useState<"created" | "purchased">("created");

  // local, post-crop files
  const [avatarFile, setAvatarFile] = useState<Blob | null>(null);
  const [coverFile, setCoverFile] = useState<Blob | null>(null);

  // which cropper is open?
  const [cropTarget, setCropTarget] = useState<
    null | { kind: "avatar" | "cover"; file: File }
  >(null);

  const avatarPreview = useMemo(
    () =>
      avatarFile
        ? URL.createObjectURL(avatarFile)
        : form.avatar_url || "/images/taedal-logo.svg",
    [avatarFile, form.avatar_url]
  );
  const coverPreview = useMemo(
    () => (coverFile ? URL.createObjectURL(coverFile) : form.cover_url || ""),
    [coverFile, form.cover_url]
  );

  useEffect(
    () => () => {
      if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
      if (coverPreview?.startsWith("blob:")) URL.revokeObjectURL(coverPreview);
    },
    [avatarPreview, coverPreview]
  );

  function normalizeHandle(v?: string | null) {
    if (!v) return null;
    return v.trim().replace(/^@/, "") || null;
  }
  function normalizeUrlOrHandle(v?: string | null) {
    if (!v) return null;
    const s = v.trim();
    return s || null;
  }

  async function loadProfile(uid: string) {
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, username, display_name, bio, avatar_url, cover_url, instagram, x_handle, youtube, telegram"
      )
      .eq("id", uid)
      .maybeSingle();
    if (error) throw error;

    const base: Profile = {
      id: uid,
      username: data?.username ?? "",
      display_name: data?.display_name ?? "",
      bio: data?.bio ?? "",
      avatar_url: data?.avatar_url ?? "",
      cover_url: data?.cover_url ?? "",
      instagram: data?.instagram ?? "",
      x_handle: data?.x_handle ?? "",
      youtube: data?.youtube ?? "",
      telegram: data?.telegram ?? "",
    };
    setForm(base);
  }

  async function loadCreated(uid: string) {
    const { data, error } = await supabase
      .from("artworks")
      .select("id,title,image_url,creator_id,created_at")
      .eq("creator_id", uid)
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) throw error;
    setCreated((data ?? []) as ArtworkThumb[]);
  }

  async function loadPurchased(uid: string) {
    // Pull from ownerships → artworks. Sort by ownerships.updated_at for recency.
    const { data, error } = await supabase
      .from("ownerships")
      .select(
        `
        artwork_id,
        updated_at,
        artworks:artworks!ownerships_artwork_id_fkey (
          id, title, image_url, creator_id, created_at
        )
      `
      )
      .eq("owner_id", uid)
      .order("updated_at", { ascending: false }) // ⬅️ new: surface latest purchases
      .limit(120);

    if (error) throw error;

    type Row = {
      artwork_id: string;
      updated_at: string;
      artworks: ArtworkThumb | ArtworkThumb[];
    };
    const rows = (data ?? []) as Row[];

    const mapped: ArtworkThumb[] = rows
      .map((r) => (Array.isArray(r.artworks) ? r.artworks[0] : r.artworks))
      .filter((a): a is ArtworkThumb => !!a && a.creator_id !== uid);

    // Fallback (legacy schemas or strict RLS)
    if (!mapped.length) {
      const { data: owned, error: fbErr } = await supabase
        .from("artworks")
        .select("id,title,image_url,creator_id,created_at")
        .eq("owner_id", uid)
        .order("created_at", { ascending: false })
        .limit(120);
      if (!fbErr) {
        const filtered = (owned ?? []).filter((a) => a.creator_id !== uid);
        setPurchased(filtered as ArtworkThumb[]);
        return;
      }
    }

    setPurchased(mapped);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const { data: s } = await supabase.auth.getSession();
        const uid = s?.session?.user?.id ?? null;
        setUserId(uid);
        if (!uid) return;
        await Promise.all([loadProfile(uid), loadCreated(uid), loadPurchased(uid)]);
      } catch (e: any) {
        setMsg(e?.message || "Failed to load account");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    document.title = form.display_name?.trim()
      ? `${form.display_name} — taedal`
      : "Account — taedal";
  }, [form.display_name]);

  const signOut = async () => {
    try {
      await supabase.auth.signOut({ scope: "global" });
    } finally {
      window.location.replace("/signin");
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setSaving(true);
    setMsg(null);

    try {
      let avatar_url = form.avatar_url || null;
      let cover_url = form.cover_url || null;
      const stamp = `v=${Date.now()}`;

      if (avatarFile) {
        const resized = await resizeImage(avatarFile, 512, 512);
        const path = `avatars/${userId}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("avatars")
          .upload(path, resized, { upsert: true, cacheControl: "0" });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
        avatar_url = `${pub.publicUrl}${pub.publicUrl.includes("?") ? "&" : "?"}${stamp}`;
      }

      if (coverFile) {
        const resized = await resizeImage(coverFile, 1600, 500);
        const path = `covers/${userId}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("covers")
          .upload(path, resized, { upsert: true, cacheControl: "0" });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("covers").getPublicUrl(path);
        cover_url = `${pub.publicUrl}${pub.publicUrl.includes("?") ? "&" : "?"}${stamp}`;
      }

      const payload = {
        username: form.username?.trim() || null,
        display_name: form.display_name?.trim() || null,
        bio: form.bio?.trim() || null,
        avatar_url,
        cover_url,
        instagram: normalizeHandle(form.instagram),
        x_handle: normalizeHandle(form.x_handle),
        youtube: normalizeUrlOrHandle(form.youtube),
        telegram: normalizeHandle(form.telegram),
      };

      const { error } = await supabase
        .from("profiles")
        .upsert({ id: userId, ...payload });
      if (error) throw error;

      setForm((f) => ({
        ...f,
        avatar_url: avatar_url || "",
        cover_url: cover_url || "",
      }));
      setAvatarFile(null);
      setCoverFile(null);
      setMsg("Saved ✔");
    } catch (e: any) {
      setMsg(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  /* ---------- social links renderer ---------- */
  function SocialLink({
    kind,
    handle,
  }: {
    kind: "ig" | "x" | "yt" | "tg";
    handle?: string | null;
  }) {
    if (!handle) return null;
    let href = "#";
    let Icon: any = null;
    if (kind === "ig") {
      href = `https://instagram.com/${handle.replace(/^@/, "")}`;
      Icon = IconInstagram;
    }
    if (kind === "x") {
      href = `https://x.com/${handle.replace(/^@/, "")}`;
      Icon = IconX;
    }
    if (kind === "yt") {
      href = handle.startsWith("http") ? handle : `https://youtube.com/${handle}`;
      Icon = IconYouTube;
    }
    if (kind === "tg") {
      href = `https://t.me/${handle.replace(/^@/, "")}`;
      Icon = IconTelegram;
    }

    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-xs"
      >
        <Icon /> <span className="hidden sm:inline">{handle}</span>
      </a>
    );
  }

  if (loading) return <div className="p-6">loading…</div>;

  return (
    <div className="min-h-[100dvh]">
      {/* Cover */}
      <div
        className="relative bg-neutral-900 border-b border-neutral-800"
        style={{ height: "clamp(12rem, 28vh, 24rem)" }}
      >
        {coverPreview && (
          <img src={coverPreview} alt="cover" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-black/10 pointer-events-none" />
        <div className="absolute right-4 bottom-4">
          <label className="btn cursor-pointer">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setCropTarget({ kind: "cover", file: f });
              }}
            />
            Change cover
          </label>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto p-6 space-y-6 -mt-10">
        {msg && <p className="text-sm text-amber-300">{msg}</p>}

        <div className="flex items-end justify-between">
          <div className="flex items-end gap-4">
            <div className="relative">
              <img
                src={avatarPreview}
                alt="avatar"
                className="h-24 w-24 rounded-full object-cover border-4 border-black shadow"
              />
              <label className="btn px-2 py-1 text-xs absolute -right-1 -bottom-1 cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setCropTarget({ kind: "avatar", file: f });
                  }}
                />
                Change
              </label>
            </div>
            <div className="pb-1">
              <h1 className="text-2xl font-bold">{form.display_name?.trim() || "Account"}</h1>
              {form.username ? <p className="text-neutral-400">@{form.username}</p> : null}
              <div className="mt-2 flex items-center gap-2">
                <SocialLink kind="ig" handle={form.instagram} />
                <SocialLink kind="x" handle={form.x_handle} />
                <SocialLink kind="yt" handle={form.youtube} />
                <SocialLink kind="tg" handle={form.telegram} />
              </div>
            </div>
          </div>
          <button className="btn" onClick={signOut}>
            Sign out
          </button>
        </div>

        {/* Profile form */}
        <form onSubmit={save} className="card space-y-3">
          <h2 className="font-semibold">Profile</h2>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Username</label>
              <input
                className="input"
                value={form.username ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Display name</label>
              <input
                className="input"
                value={form.display_name ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm mb-1">Bio</label>
              <textarea
                className="input min-h-[96px]"
                value={form.bio ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              />
            </div>
          </div>

          <h3 className="font-semibold pt-2">Social</h3>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Instagram (handle)</label>
              <input
                className="input"
                placeholder="e.g. art.by.kuro"
                value={form.instagram ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, instagram: e.target.value }))}
                onBlur={(e) =>
                  setForm((f) => ({ ...f, instagram: e.target.value.trim().replace(/^@/, "") }))
                }
              />
              <p className="mt-1 text-xs text-neutral-400">
                We store it without “@”. Link shows as instagram.com/<b>{(form.instagram || "").replace(/^@/, "")}</b>.
              </p>
            </div>
            <div>
              <label className="block text-sm mb-1">X / Twitter (handle)</label>
              <input
                className="input"
                placeholder="e.g. kuro_wolf"
                value={form.x_handle ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, x_handle: e.target.value }))}
                onBlur={(e) =>
                  setForm((f) => ({ ...f, x_handle: e.target.value.trim().replace(/^@/, "") }))
                }
              />
              <p className="mt-1 text-xs text-neutral-400">
                We store it without “@” → x.com/<b>{(form.x_handle || "").replace(/^@/, "")}</b>.
              </p>
            </div>
            <div>
              <label className="block text-sm mb-1">Telegram (handle)</label>
              <input
                className="input"
                placeholder="e.g. kurochannel"
                value={form.telegram ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, telegram: e.target.value }))}
                onBlur={(e) =>
                  setForm((f) => ({ ...f, telegram: e.target.value.trim().replace(/^@/, "") }))
                }
              />
              <p className="mt-1 text-xs text-neutral-400">
                We store it without “@” → t.me/<b>{(form.telegram || "").replace(/^@/, "")}</b>.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="btn" disabled={saving} type="submit">
              {saving ? "Saving…" : "Save"}
            </button>
            {avatarFile || coverFile ? (
              <span className="text-sm text-neutral-400">You have unsaved image changes.</span>
            ) : null}
          </div>
          {msg && <p className="text-sm text-amber-300">{msg}</p>}
        </form>

        {/* Tabs */}
        <div className="flex gap-3">
          <button
            className={`px-3 py-1 rounded-lg ${
              activeTab === "created" ? "bg-neutral-800" : "bg-neutral-900 border border-neutral-800"
            }`}
            onClick={() => setActiveTab("created")}
          >
            Created
          </button>
          <button
            className={`px-3 py-1 rounded-lg ${
              activeTab === "purchased" ? "bg-neutral-800" : "bg-neutral-900 border border-neutral-800"
            }`}
            onClick={() => setActiveTab("purchased")}
          >
            Purchased
          </button>
        </div>

        {/* Galleries */}
        {activeTab === "created" ? (
          <Gallery title="Your Artworks" subtitle="Uploads you created." items={created} />
        ) : (
          <Gallery title="Purchased" subtitle="Pieces you currently own." items={purchased} />
        )}
      </div>

      {/* Crop modal */}
      {cropTarget && (
        <CropModal
          file={cropTarget.file}
          aspect={cropTarget.kind === "avatar" ? 1 : 16 / 5}
          title={cropTarget.kind === "avatar" ? "Crop avatar" : "Crop cover"}
          onCancel={() => setCropTarget(null)}
          onDone={(blob) => {
            if (cropTarget.kind === "avatar") setAvatarFile(blob);
            else setCoverFile(blob);
            setCropTarget(null);
          }}
        />
      )}
    </div>
  );
}

/* ---------- small grid component ---------- */
function Gallery({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle?: string;
  items: ArtworkThumb[];
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {subtitle && <p className="text-sm text-neutral-400">{subtitle}</p>}
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-neutral-400">Nothing here yet.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((a) => (
            <Link
              to={`/art/${a.id}`}
              key={a.id}
              className="block bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden hover:border-neutral-700"
            >
              <div className="aspect-square bg-neutral-950 grid place-items-center overflow-hidden">
                {a.image_url ? (
                  <img src={a.image_url} alt={a.title ?? "Artwork"} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-neutral-500 text-xs">No image</span>
                )}
              </div>
              <div className="p-2 text-sm truncate">{a.title || "Untitled"}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
