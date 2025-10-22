// app/src/components/Navbar.tsx
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

/* ----------------------------- types ----------------------------- */
type UserBits = {
  id: string;
  username?: string | null;
  avatar_url?: string | null;
  email?: string | null;
};

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

/* small util */
const cls = (...xs: Array<string | false | undefined | null>) =>
  xs.filter(Boolean).join(" ");

export default function Navbar() {
  const nav = useNavigate();
  const loc = useLocation();

  const [user, setUser] = useState<UserBits | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /* ---------------------- session + profile load ---------------------- */
  useEffect(() => {
    let mounted = true;

    async function load() {
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
    }

    load();

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

  /* Live-updating username/avatar if profile row changes */
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
      supabase.removeChannel(chan);
    };
  }, [user?.id]);

  /* close account dropdown on route change */
  useEffect(() => {
    setMenuOpen(false);
  }, [loc.pathname, loc.search]);

  /* close dropdowns on outside click / Esc */
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (menuRef.current.contains(e.target as Node)) return;
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

  const avatar = useMemo(() => user?.avatar_url || "/images/taedal-logo.svg", [user?.avatar_url]);
  const myProfileUrl = user?.username ? `/profiles/${user.username}` : "/account";

  /* ----------------------------- search ----------------------------- */
  const [q, setQ] = useState("");
  const [openSearch, setOpenSearch] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [users, setUsers] = useState<HitUser[]>([]);
  const [arts, setArts] = useState<HitArtwork[]>([]);
  const [selIndex, setSelIndex] = useState<number>(-1); // keyboard highlight

  // Reset results when route changes or query clears
  useEffect(() => {
    setOpenSearch(false);
    setUsers([]);
    setArts([]);
    setSelIndex(-1);
    setQ("");
  }, [loc.pathname, loc.search]);

  // Debounced search
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setUsers([]);
      setArts([]);
      setOpenSearch(false);
      setSelIndex(-1);
      return;
    }

    let alive = true;
    setLoadingSearch(true);

    const t = setTimeout(async () => {
      try {
        const like = `%${term}%`;

        // Profiles: match username OR display_name
        const pQuery = supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .or(`username.ilike.${like},display_name.ilike.${like}`)
          .order("username", { ascending: true })
          .limit(5);

        // Artworks: match title; prefer active (falls back to non-deleted if status missing)
        const aQuery = supabase
          .from("artworks")
          .select("id, title, image_url, status, deleted_at")
          .ilike("title", like)
          .order("created_at", { ascending: false })
          .limit(8);

        const [pRes, aRes] = await Promise.all([pQuery, aQuery]);

        if (!alive) return;

        const pRows = (pRes.data ?? []) as any[];
        const aRows = ((aRes.data ?? []) as any[]).filter((r) => {
          // show public-ish items first; keep simple so nothing breaks
          if (r.deleted_at) return false;
          if (typeof r.status === "string") return r.status !== "draft";
          return true;
        });

        setUsers(
          pRows.map((r) => ({
            id: r.id,
            username: r.username ?? null,
            display_name: r.display_name ?? null,
            avatar_url: r.avatar_url ?? null,
          }))
        );
        setArts(
          aRows.map((r) => ({
            id: r.id,
            title: r.title ?? null,
            image_url: r.image_url ?? null,
          }))
        );
        setOpenSearch(true);
        setSelIndex(-1);
      } catch {
        // ignore; keep old results
      } finally {
        if (alive) setLoadingSearch(false);
      }
    }, 250); // debounce

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  // Flatten results for keyboard nav (users first, then artworks)
  const flatResults = useMemo(
    () => [
      ...users.map((u) => ({ kind: "user" as const, data: u })),
      ...arts.map((a) => ({ kind: "art" as const, data: a })),
    ],
    [users, arts]
  );

  const goToIndex = (i: number) => {
    const item = flatResults[i];
    if (!item) return;
    if (item.kind === "user") {
      const u = item.data as HitUser;
      const url = u.username ? `/profiles/${u.username}` : `/profiles/${u.id}`;
      nav(url);
    } else {
      const a = item.data as HitArtwork;
      nav(`/art/${a.id}`);
    }
    // close dropdown
    setOpenSearch(false);
    setSelIndex(-1);
    setQ("");
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!openSearch && e.key === "ArrowDown" && flatResults.length > 0) {
      setOpenSearch(true);
      setSelIndex(0);
      return;
    }
    if (!openSearch) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selIndex >= 0) goToIndex(selIndex);
      else if (flatResults.length > 0) goToIndex(0);
    } else if (e.key === "Escape") {
      setOpenSearch(false);
      setSelIndex(-1);
    }
  };

  return (
    <header className="w-full sticky top-0 z-40 bg-black/80 backdrop-blur supports-[backdrop-filter]:bg-black/60 border-b border-neutral-800">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-3 relative">
        {/* brand */}
        <Link to="/" className="font-semibold tracking-wide">
          taedal
        </Link>

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

          {/* dropdown */}
          {openSearch && (users.length || arts.length || loadingSearch) ? (
            <div className="absolute left-0 right-0 mt-2 rounded-xl border border-neutral-700 bg-neutral-900 shadow-xl overflow-hidden">
              {/* Users */}
              {users.length > 0 && (
                <div className="py-2">
                  <div className="px-3 pb-1 text-xs uppercase tracking-wider text-neutral-400">
                    Users
                  </div>
                  {users.map((u, idx) => {
                    const flatIdx = idx; // users are first
                    const active = selIndex === flatIdx;
                    const url = u.username ? `/profiles/${u.username}` : `/profiles/${u.id}`;
                    return (
                      <button
                        key={`${u.id}-${idx}`}
                        onMouseEnter={() => setSelIndex(flatIdx)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => goToIndex(flatIdx)}
                        className={cls(
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
                  <div className="px-3 pb-1 text-xs uppercase tracking-wider text-neutral-400">
                    Artworks
                  </div>
                  {arts.map((a, idx) => {
                    const flatIdx = users.length + idx;
                    const active = selIndex === flatIdx;
                    return (
                      <button
                        key={`${a.id}-${idx}`}
                        onMouseEnter={() => setSelIndex(flatIdx)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => goToIndex(flatIdx)}
                        className={cls(
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

              {loadingSearch && (
                <div className="px-3 py-2 text-sm text-neutral-400 border-t border-neutral-800">
                  Searching…
                </div>
              )}

              {!loadingSearch && users.length === 0 && arts.length === 0 && (
                <div className="px-3 py-2 text-sm text-neutral-400">No results</div>
              )}
            </div>
          ) : null}
        </div>

        {/* nav links */}
        <nav className="flex items-center gap-4">
          <NavLink
            to="/contracts"
            className={({ isActive }) => (isActive ? "text-white" : "text-neutral-300 hover:text-white")}
          >
            Contracts
          </NavLink>

          {/* 'Create' → 'Studio' to /studio */}
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

          {/* right side: account slot */}
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
