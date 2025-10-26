// app/src/routes/collection/CollectionEdit.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";

type Collection = {
  id: string;
  slug: string | null;
  name: string | null;
  owner_id: string | null;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
};

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

function Card({
  title,
  right,
  children,
  className = "",
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.04] p-4 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between">
          {title ? <h3 className="text-sm font-semibold">{title}</h3> : <div />}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

export default function CollectionEdit() {
  const nav = useNavigate();
  const { slug } = useParams(); // slug or id
  const [viewerId, setViewerId] = useState<string | null>(null);

  const [col, setCol] = useState<Collection | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  // meta fields
  const [name, setName] = useState<string>("");
  const [desc, setDesc] = useState<string>("");

  // media upload busy flags
  const [logoBusy, setLogoBusy] = useState(false);
  const [bannerBusy, setBannerBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  // debug
  const [lastUploadKey, setLastUploadKey] = useState<string>("");

  // danger zone states
  const [transferQ, setTransferQ] = useState("");
  const [transferRows, setTransferRows] = useState<ProfileRow[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSel, setTransferSel] = useState(0);
  const blurTimer = useRef<number | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setViewerId(data.session?.user?.id ?? null);
    })();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setMsg(null);
      try {
        if (!slug) throw new Error("Missing collection key");

        const uuid = isUuid(slug);
        const { data, error } = await supabase
          .from("collections")
          .select("id,slug,name,owner_id,description,logo_url,banner_url")
          .or(uuid ? `id.eq.${slug}` : `slug.eq.${slug}`)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          setCol(null);
          setMsg("Collection not found.");
          return;
        }

        if (!alive) return;
        const c = data as Collection;
        setCol(c);
        setName(c.name || "");
        setDesc(c.description || "");
      } catch (e: any) {
        setMsg(e?.message || "Failed to load collection.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [slug]);

  const canEdit = useMemo(() => {
    return !!viewerId && !!col?.owner_id && viewerId === col.owner_id;
  }, [viewerId, col?.owner_id]);

  /* ───────────────────────────── save meta (name/desc) ───────────────────────────── */
  async function saveMeta() {
    if (!col) return;
    setSaveBusy(true);
    setMsg(null);
    try {
      const payload: Partial<Collection> = {
        name: name.trim() || null,
        description: desc.trim() || null,
      };
      const { error } = await supabase.from("collections").update(payload).eq("id", col.id);
      if (error) throw error;
      setMsg("Saved ✔️");
      setCol((c) => (c ? { ...c, ...payload } as Collection : c));
    } catch (e: any) {
      setMsg(e?.message || "Save failed.");
    } finally {
      setSaveBusy(false);
    }
  }

  /* ───────────────────────────── media uploads ───────────────────────────── */
  function extFromFile(f: File): string {
    const byName = f.name?.split(".").pop();
    if (byName && byName.length <= 5) return byName.toLowerCase();
    const byType = f.type?.split("/").pop();
    return (byType || "png").toLowerCase();
  }

  async function uploadAndSave(kind: "logo" | "banner", f: File) {
    if (!col) return;
    const setterBusy = kind === "logo" ? setLogoBusy : setBannerBusy;
    setterBusy(true);
    setMsg(null);

    try {
      const ext = extFromFile(f);
      // Bucket-relative key (RLS expects first segment = collection_id)
      const path = `${col.id}/${kind}.${ext}`;
      setLastUploadKey(path);

      const { error: upErr } = await supabase.storage.from("collections").upload(path, f, {
        upsert: true,
        cacheControl: "3600",
        contentType: f.type || undefined,
      });
      if (upErr) throw new Error(`[Storage] ${upErr.message || "upload failed"} (key: ${path})`);

      const { data: pub } = supabase.storage.from("collections").getPublicUrl(path);
      const publicUrl = (pub?.publicUrl || "") + `?v=${Date.now()}`;

      const payload = kind === "logo" ? { logo_url: publicUrl } : { banner_url: publicUrl };
      const { error: updErr } = await supabase.from("collections").update(payload).eq("id", col.id);
      if (updErr) throw updErr;

      setCol((c) =>
        c ? { ...c, ...(kind === "logo" ? { logo_url: publicUrl } : { banner_url: publicUrl }) } : c
      );
      setMsg(`${kind === "logo" ? "Logo" : "Banner"} updated ✔️`);
    } catch (e: any) {
      const text = e?.message || "Upload failed.";
      setMsg(text);
      console.error("Upload error:", e);
    } finally {
      setterBusy(false);
    }
  }

  /* ───────────────────────────── transfer: typeahead ───────────────────────────── */
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const term = transferQ.trim();
      if (!term || isUuid(term)) {
        // hide suggestions if empty or a pasted UUID (we'll allow direct transfer by UUID)
        if (alive) setTransferRows([]);
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("id,username,display_name,avatar_url")
        .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
        .order("username", { ascending: true })
        .limit(20);

      if (!alive) return;
      if (error) {
        setTransferRows([]);
        return;
      }
      setTransferRows((data ?? []) as ProfileRow[]);
      setTransferSel(0);
    };
    const t = setTimeout(run, 140);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [transferQ]);

  function onTransferKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && transferRows.length) {
      e.preventDefault();
      setTransferOpen(true);
      setTransferSel((i) => (i + 1) % transferRows.length);
      return;
    }
    if (e.key === "ArrowUp" && transferRows.length) {
      e.preventDefault();
      setTransferOpen(true);
      setTransferSel((i) => (i - 1 + transferRows.length) % transferRows.length);
      return;
    }
    if (e.key === "Enter") {
      if (transferRows.length && transferOpen) {
        const r = transferRows[Math.max(0, Math.min(transferSel, transferRows.length - 1))];
        if (r) {
          e.preventDefault();
          setTransferQ(r.username || r.id);
          setTransferRows([]);
          setTransferOpen(false);
        }
      }
      return;
    }
    if (e.key === "Escape") setTransferOpen(false);
  }

  async function transferOwnership() {
    if (!col || !viewerId) return;
    const term = transferQ.trim();
    if (!term) {
      setMsg("Enter a username or user id to transfer.");
      return;
    }
    if (isUuid(term) && term === viewerId) {
      setMsg("You already own this collection.");
      return;
    }

    setTransferBusy(true);
    setMsg(null);
    try {
      let targetId: string | null = null;

      if (isUuid(term)) {
        targetId = term;
      } else {
        // resolve via profiles first
        const { data } = await supabase
          .from("profiles")
          .select("id,username")
          .or(`username.eq.${term},display_name.eq.${term}`)
          .limit(1)
          .maybeSingle();
        targetId = data?.id ?? null;
      }

      if (!targetId) throw new Error("User not found.");
      if (targetId === viewerId) throw new Error("You already own this collection.");

      // RLS policy “transfer ownership” allows this if current owner matches auth.uid()
      const { error } = await supabase
        .from("collections")
        .update({ owner_id: targetId })
        .eq("id", col.id);
      if (error) throw error;

      setMsg("Ownership transferred ✔️ You now have read-only access.");
      setCol((c) => (c ? { ...c, owner_id: targetId! } : c));
    } catch (e: any) {
      setMsg(e?.message || "Transfer failed.");
    } finally {
      setTransferBusy(false);
    }
  }

  /* ───────────────────────────── soft delete ───────────────────────────── */
  async function softDelete() {
    if (!col) return;
    if (deleteConfirm.trim().toLowerCase() !== "kuro") {
      setMsg("Please type 'kuro' to confirm.");
      return;
    }
    setDeleteBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase
        .from("collections")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", col.id);
      if (error) throw error;
      setMsg("Collection deleted (soft) ✔️");
      // bounce to your collections list (or home)
      nav("/explore?tab=collections", { replace: true });
    } catch (e: any) {
      setMsg(e?.message || "Delete failed.");
    } finally {
      setDeleteBusy(false);
    }
  }

  /* ───────────────────────────── render ───────────────────────────── */
  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="h-6 w-40 bg-white/10 rounded animate-pulse" />
        <div className="mt-4 h-40 bg-white/5 border border-white/10 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!col) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="text-rose-400">Collection not found.</div>
        <Link to="/" className="btn mt-4 inline-block">
          Back
        </Link>
      </div>
    );
  }

  const headerTitle = col.name || col.slug || col.id.slice(0, 6);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Edit collection — {headerTitle}</h1>
        <Link to={`/collection/${encodeURIComponent(col.slug || col.id)}`} className="btn">
          View
        </Link>
      </div>

      {canEdit && (
        <div className="text-[11px] text-white/50">
          auth uid: <code>{viewerId}</code> • owner_id: <code>{col.owner_id}</code>
          {lastUploadKey ? (
            <>
              {" "}
              • last key: <code>{lastUploadKey}</code>
            </>
          ) : null}
        </div>
      )}

      {msg && <div className="text-sm text-amber-300 break-words">{msg}</div>}

      {!canEdit ? (
        <Card title="You don’t have permission to edit this collection">
          <div className="text-sm text-white/70">You must be the owner to make changes.</div>
        </Card>
      ) : (
        <>
          {/* Meta (name + description) */}
          <Card title="Details">
            <div className="grid gap-3">
              <div>
                <div className="text-sm mb-1">Name</div>
                <input
                  className="input w-full"
                  placeholder="Collection name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <div className="text-sm mb-1">Description</div>
                <textarea
                  className="input w-full h-36 resize-vertical"
                  placeholder="Write something about this collection…"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                />
              </div>
              <div>
                <button className="btn" onClick={saveMeta} disabled={saveBusy}>
                  {saveBusy ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </Card>

          {/* Media */}
          <Card
            title={
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold">Logo & banner</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10">
                  Bucket: <code>collections</code>
                </span>
              </div>
            }
          >
            <div className="grid sm:grid-cols-2 gap-4">
              {/* Logo */}
              <div>
                <div className="text-sm mb-2">Logo</div>
                <div className="h-36 w-36 rounded-xl border border-white/10 bg-neutral-900 overflow-hidden grid place-items-center">
                  {col.logo_url ? (
                    <img src={col.logo_url} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-white/40 text-sm">No logo</span>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <label className="btn cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadAndSave("logo", f);
                        e.currentTarget.value = "";
                      }}
                    />
                    Choose File
                  </label>
                  {logoBusy && <span className="text-xs text-white/60">Uploading…</span>}
                </div>
              </div>

              {/* Banner */}
              <div>
                <div className="text-sm mb-2">Banner</div>
                <div className="h-36 rounded-xl border border-white/10 bg-neutral-900 overflow-hidden grid place-items-center">
                  {col.banner_url ? (
                    <img src={col.banner_url} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-white/40 text-sm">No banner</span>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <label className="btn cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadAndSave("banner", f);
                        e.currentTarget.value = "";
                      }}
                    />
                    Choose File
                  </label>
                  {bannerBusy && <span className="text-xs text-white/60">Uploading…</span>}
                </div>
              </div>
            </div>
          </Card>

          {/* Danger Zone */}
          <Card
            title={<span className="text-rose-300">Danger zone</span>}
            className="border-rose-900/50 bg-rose-900/5"
          >
            {/* Transfer ownership */}
            <div className="rounded-xl border border-amber-900/50 bg-amber-900/10 p-4 mb-4">
              <div className="text-base font-semibold mb-1">Transfer ownership</div>
              <div className="text-sm text-white/70 mb-3">
                Transfer to another user. Enter a <b>username</b>, <b>display name</b>, or{" "}
                <b>User&nbsp;ID (UUID)</b>. You’ll immediately lose edit access.
              </div>

              <div className="relative">
                <input
                  className="input w-full"
                  placeholder="username / display name / user id"
                  value={transferQ}
                  onChange={(e) => {
                    setTransferQ(e.target.value);
                    setTransferOpen(true);
                  }}
                  onFocus={() => transferRows.length && setTransferOpen(true)}
                  onBlur={() => {
                    blurTimer.current = window.setTimeout(() => setTransferOpen(false), 100);
                  }}
                  onKeyDown={onTransferKeyDown}
                />

                {transferOpen && transferRows.length > 0 && !isUuid(transferQ.trim()) && (
                  <div className="absolute left-0 right-0 mt-2 rounded-xl border border-neutral-700 bg-neutral-900 shadow-lg overflow-hidden z-50">
                    <div className="px-3 py-2 text-xs text-neutral-400">USERS</div>
                    <ul className="max-h-80 overflow-auto">
                      {transferRows.map((r, i) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onMouseDown={(ev) => {
                              ev.preventDefault();
                              if (blurTimer.current) {
                                clearTimeout(blurTimer.current);
                                blurTimer.current = null;
                              }
                              setTransferQ(r.username || r.id);
                              setTransferRows([]);
                              setTransferOpen(false);
                            }}
                            className={[
                              "w-full text-left flex items-center gap-3 px-3 py-2 hover:bg-neutral-800",
                              i === transferSel ? "bg-neutral-800" : "",
                            ].join(" ")}
                          >
                            <img
                              src={r.avatar_url || "/images/taedal-logo.svg"}
                              className="h-7 w-7 rounded-full object-cover"
                            />
                            <div className="min-w-0">
                              <div className="truncate">
                                {r.display_name || r.username || "User"}
                              </div>
                              <div className="text-xs text-neutral-400 truncate">
                                @{r.username || r.id}
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="px-3 py-2 text-xs text-neutral-500 border-t border-neutral-800">
                      Enter to pick • Esc to close
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-3">
                <button className="btn" onClick={transferOwnership} disabled={transferBusy}>
                  {transferBusy ? "Transferring…" : "Transfer"}
                </button>
              </div>
            </div>

            {/* Soft delete */}
            <div className="rounded-xl border border-rose-900/50 bg-rose-900/10 p-4">
              <div className="text-base font-semibold mb-1">Delete collection</div>
              <div className="text-sm text-white/70 mb-3">
                This will <b>soft-delete</b> the collection (you can restore later via support).
                Type <code>kuro</code> to confirm.
              </div>
              <div className="flex items-center gap-3">
                <input
                  className="input flex-1"
                  placeholder="kuro"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                />
                <button className="btn bg-rose-600 hover:bg-rose-500" onClick={softDelete} disabled={deleteBusy}>
                  {deleteBusy ? "Deleting…" : "Delete"}
                </button>
              </div>

              <div className="text-xs text-white/50 mt-3">
                Coming soon: “Restore collection” (owner-only if soft-deleted), audit log, and hard delete (service role).
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
