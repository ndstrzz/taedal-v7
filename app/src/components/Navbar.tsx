// app/src/components/Navbar.tsx
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type UserBits = {
  id: string;
  username?: string | null;
  avatar_url?: string | null;
  email?: string | null;
};

// search result shapes (match your views)
type HitUser = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};
type HitArtwork = {
  id: string;
  title: string | null;
  image_url: string | null;
};

const cx = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

export default function Navbar() {
  const nav = useNavigate();
  const loc = useLocation();

  const [user, setUser] = useState<UserBits | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // ---------------- Session + profile (for avatar/username) ----------------
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const u = data.session?.user ?? null;
      if (!mounted) return;

      if (!u) {
        setUser(null);
        return;
      }
      const uid = u.id;
      const { data: prof } = await supabase
        .from("profiles")
        .select("username, avatar_url")
        .eq("id", uid)
        .maybeSingle();

      setUser({
        id: uid,
        email: u.email,
        username: prof?.username ?? null,
        avatar_url: prof?.avatar_url ?? null,
      });
    })();

    const sub = supabase.auth.onAuthStateChange((_e, s) => {
      const u = s?.user ?? null;
      if (!u) {
        setUser(null);
        return;
      }
      (async () => {
        const { data: prof } = await supabase
          .from("profiles")
          .select("username, avatar_url")
          .eq("id", u.id)
          .maybeSingle();
        setUser({
          id: u.id,
          email: u.email,
          username: prof?.username ?? null,
          avatar_url: prof?.avatar_url ?? null,
        });
      })();
    });

    return () => {
      mounted = false;
      sub.data.subscription.unsubscribe();
    };
  }, []);

  // live avatar/username if your row updates
useEffect(() => {
  if (!user?.id) return;
  const chan = supabase
    .channel("navbar_profile_live")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
      (payload) => {
        const rec = payload.new as { username?: string | null; avatar_url?: string | null };
        setUser((u) =>
          u ? { ...u, username: rec?.username ?? u.username, avatar_url: rec?.avatar_url ?? u.avatar_url } : u
        );
      }
    )
    .subscribe();

  return () => {
    // IMPORTANT: don’t return a Promise from cleanup
    void supabase.removeChannel(chan); // or: void chan.unsubscribe();
  };
}, [user?.id]);


  // close menus when route changes
  useEffect(() => {
    setMenuOpen(false);
    setOpenSearch(false);
    setUsers([]);
    setArts([]);
    setSel(-1);
    setQ("");
  }, [loc.pathname, loc.search]);

  // close on outside click / Esc
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
      setOpenSearch(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setOpenSearch(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut({ scope: "global" });
    setUser(null);
    setMenuOpen(false);
    nav("/signin", { replace: true });
  };

  const avatar = useMemo(
    () => user?.avatar_url || "/images/taedal-logo.svg",
    [user?.avatar_url]
  );
  const myProfileUrl = user?.username ? `/profiles/${user.username}` : `/profiles/${user?.id ?? ""}`;

  // ------------------------------- Search -------------------------------
  const [q, setQ] = useState("");
  const [openSearch, setOpenSearch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<HitUser[]>([]);
  const [arts, setArts] = useState<HitArtwork[]>([]);
  const [sel, setSel] = useState(-1);

  // DEBOUNCED fetch from the *views*
  useEffect(() => {
    const term = q.trim();
    if (term && !openSearch) setOpenSearch(true);
    if (!term) {
      setUsers([]);
      setArts([]);
      setOpenSearch(false);
      setSel(-1);
      setLoading(false);
      return;
    }

    let alive = true;
    setLoading(true);

    const t = setTimeout(async () => {
      try {
        const likePrefix = `${term}%`;
        const likeAny = `%${term}%`;

        // PROFILES: search username prefix, then contains on username/display_name
        const pPrefix = supabase
          .from("search_profiles_v")
          .select("id, username, display_name, avatar_url")
          .ilike("username", likePrefix)
          .order("username")
          .limit(12);

        const pAny = supabase
          .from("search_profiles_v")
          .select("id, username, display_name, avatar_url")
          .or(`username.ilike.${likeAny},display_name.ilike.${likeAny}`)
          .order("username")
          .limit(18);

        // ARTWORKS: title prefix, then contains; the view already filters draft/deleted
        const aPrefix = supabase
          .from("search_artworks_v")
          .select("id, title, image_url")
          .ilike("title", likePrefix)
          .order("title")
          .limit(16);

        const aAny = supabase
          .from("search_artworks_v")
          .select("id, title, image_url")
          .ilike("title", likeAny)
          .order("title")
          .limit(24);

        const [pp, pa, ap, aa] = await Promise.all([pPrefix, pAny, aPrefix, aAny]);

        if (!alive) return;

        // helpful logging if something is wrong with RLS/GRANTs
        if (pp.error) console.warn("[search] profiles prefix error:", pp.error);
        if (pa.error) console.warn("[search] profiles any error:", pa.error);
        if (ap.error) console.warn("[search] artworks prefix error:", ap.error);
        if (aa.error) console.warn("[search] artworks any error:", aa.error);

        const uniqById = <T extends { id: string }>(arr: T[]) => {
          const seen = new Set<string>();
          const out: T[] = [];
          for (const x of arr) if (!seen.has(x.id)) { seen.add(x.id); out.push(x); }
          return out;
        };

        const usersRows = uniqById([...(pp.data ?? []), ...(pa.data ?? [])] as HitUser[]);
        const artsRows  = uniqById([...(ap.data ?? []), ...(aa.data ?? [])] as HitArtwork[]);

        setUsers(usersRows.slice(0, 20));
        setArts(artsRows.slice(0, 32));
        setSel(-1);
      } catch (err) {
        console.warn("[search] unexpected error:", err);
      } finally {
        if (alive) setLoading(false);
      }
    }, 200);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, openSearch]);

  // Flatten for keyboard nav
  const flat = useMemo(
    () => [
      ...users.map((u) => ({ kind: "user" as const, data: u })),
      ...arts.map((a) => ({ kind: "art" as const, data: a })),
    ],
    [users, arts]
  );

  const goToIndex = (i: number) => {
    const item = flat[i];
    if (!item) return;
    if (item.kind === "user") {
      const u = item.data as HitUser;
      const url = u.username ? `/profiles/${u.username}` : `/profiles/${u.id}`;
      nav(url);
    } else {
      const a = item.data as HitArtwork;
      nav(`/art/${a.id}`);
    }
    setOpenSearch(false);
    setSel(-1);
    setQ("");
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (sel >= 0) {
        e.preventDefault();
        goToIndex(sel);
      }
      return;
    }
    if (!openSearch && e.key === "ArrowDown" && flat.length > 0) {
      setOpenSearch(true);
      setSel(0);
      return;
    }
    if (!openSearch) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      setOpenSearch(false);
      setSel(-1);
    }
  };

  // ------------------------------- UI -------------------------------
  return (
    <header className="w-full sticky top-0 z-40 bg-black/80 backdrop-blur supports-[backdrop-filter]:bg-black/60 border-b border-neutral-800">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-3 relative">
        {/* brand */}
        <Link to="/" className="font-semibold tracking-wide">taedal</Link>

        {/* search */}
        <div className="flex-1 relative">
          <input
            className="w-full input"
            placeholder="🔎 search artworks or users"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => (q.trim() ? setOpenSearch(true) : null)}
            onKeyDown={onSearchKeyDown}
          />

          {openSearch && (
            <div className="absolute left-0 right-0 mt-2 rounded-xl border border-neutral-700 bg-neutral-900 shadow-xl overflow-hidden">
              <div className="max-h-[60vh] overflow-auto">
                {loading && (
                  <div className="px-3 py-2 text-sm text-neutral-400 border-b border-neutral-800">
                    Searching…
                  </div>
                )}

                {/* Users */}
                {users.length > 0 && (
                  <div className="py-2">
                    <div className="px-3 pb-1 text-xs uppercase tracking-wider text-neutral-400">Users</div>
                    {users.map((u, idx) => {
                      const flatIdx = idx;
                      const active = sel === flatIdx;
                      return (
                        <button
                          key={`${u.id}-${idx}`}
                          onMouseEnter={() => setSel(flatIdx)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => goToIndex(flatIdx)}
                          className={cx(
                            "w-full flex items-center gap-3 px-3 py-2 text-left",
                            active ? "bg-neutral-800" : "hover:bg-neutral-800/60"
                          )}
                        >
                          <img
                            src={u.avatar_url || "/images/taedal-logo.svg"}
                            alt=""
                            className="h-7 w-7 rounded-full object-cover bg-neutral-800"
                          />
                          <div className="min-w-0">
                            <div className="text-sm truncate">
                              {u.display_name || u.username || "User"}
                            </div>
                            {u.username && (
                              <div className="text-xs text-neutral-400 truncate">@{u.username}</div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Artworks */}
                {arts.length > 0 && (
                  <div className="py-2 border-t border-neutral-800">
                    <div className="px-3 pb-1 text-xs uppercase tracking-wider text-neutral-400">Artworks</div>
                    {arts.map((a, idx) => {
                      const flatIdx = users.length + idx;
                      const active = sel === flatIdx;
                      return (
                        <button
                          key={`${a.id}-${idx}`}
                          onMouseEnter={() => setSel(flatIdx)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => goToIndex(flatIdx)}
                          className={cx(
                            "w-full flex items-center gap-3 px-3 py-2 text-left",
                            active ? "bg-neutral-800" : "hover:bg-neutral-800/60"
                          )}
                        >
                          <div className="h-9 w-9 rounded-md overflow-hidden bg-neutral-800 border border-neutral-700">
                            {a.image_url ? (
                              <img src={a.image_url} alt="" className="h-full w-full object-cover" />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm truncate">{a.title || "Untitled"}</div>
                            <div className="text-xs text-neutral-400">Artwork</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {!loading && users.length === 0 && arts.length === 0 && (
                  <div className="px-3 py-2 text-sm text-neutral-400">No results</div>
                )}
              </div>

              <div className="px-3 py-2 border-t border-neutral-800 flex items-center justify-between">
                <div className="text-xs text-neutral-500">
                  {users.length + arts.length} result{users.length + arts.length === 1 ? "" : "s"}
                </div>
                <button
                  className="text-sm text-neutral-200 hover:underline"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    // Optional: add a /search route to show a full page of results
                    const term = q.trim();
                    if (!term) return;
                    nav(`/search?q=${encodeURIComponent(term)}`);
                    setOpenSearch(false);
                    setSel(-1);
                  }}
                >
                  View all results
                </button>
              </div>
            </div>
          )}
        </div>

        {/* top-level links */}
        <nav className="flex items-center gap-4">
          <NavLink
            to="/contracts"
            className={({ isActive }) => (isActive ? "text-white" : "text-neutral-300 hover:text-white")}
          >
            Contracts
          </NavLink>

          <NavLink
            to="/studio"
            className={({ isActive }) => (isActive ? "text-white" : "text-neutral-300 hover:text-white")}
          >
            Studio
          </NavLink>

          <NavLink
            to="/explore"
            className={({ isActive }) => (isActive ? "text-white" : "text-neutral-300 hover:text-white")}
          >
            Explore
          </NavLink>

          {/* account slot */}
          {!user ? (
            <Link
              to="/signin"
              onClick={() => {
                const here = window.location.pathname + window.location.search;
                sessionStorage.setItem("returnTo", here || "/account");
              }}
              className="rounded-full px-3 py-1 bg-neutral-800 border border-neutral-700 text-neutral-100 hover:bg-neutral-700"
            >
              Sign in
            </Link>
          ) : (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full bg-neutral-800 border border-neutral-700 pr-3 pl-1 h-9"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <img src={avatar} alt="avatar" className="h-7 w-7 rounded-full object-cover" />
                <span className="text-sm text-neutral-100">
                  {user.username ? `@${user.username}` : user.email ?? "Account"}
                </span>
              </button>

              {menuOpen && (
                <div
                  className="absolute right-0 mt-2 w-48 rounded-xl border border-neutral-700 bg-neutral-900 shadow-lg overflow-hidden"
                  role="menu"
                >
                  <Link
                    to={myProfileUrl}
                    className="block px-3 py-2 text-sm hover:bg-neutral-800"
                    onClick={() => setMenuOpen(false)}
                    role="menuitem"
                  >
                    View profile
                  </Link>
                  <Link
                    to="/account"
                    className="block px-3 py-2 text-sm hover:bg-neutral-800"
                    onClick={() => setMenuOpen(false)}
                    role="menuitem"
                  >
                    Edit profile
                  </Link>
                  <button
                    onClick={signOut}
                    className="w-full text-left block px-3 py-2 text-sm hover:bg-neutral-800"
                    role="menuitem"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
