// app/src/components/Topbar.tsx
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

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

const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(" ");

export default function Topbar() {
  const nav = useNavigate();
  const loc  = useLocation();

  const [user, setUser] = useState<UserBits | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /* ---------- load session + small profile bits ---------- */
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const u = data.session?.user ?? null;
      if (!mounted) return;
      if (!u) return setUser(null);
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

    const sub = supabase.auth.onAuthStateChange((_e, s) => {
      const u = s?.user ?? null;
      if (!u) return setUser(null);
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

  /* ---------- close dropdowns on route change / outside click / Esc ---------- */
  useEffect(() => {
    setMenuOpen(false);
    setOpenSearch(false);
    setResults([]);
    setQ("");
    setSelIndex(-1);
  }, [loc.pathname, loc.search]);

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

  /* ---------- sign out ---------- */
  const signOut = async () => {
    await supabase.auth.signOut({ scope: "global" });
    setUser(null);
    setMenuOpen(false);
    nav("/signin", { replace: true });
  };

  const avatar = useMemo(() => user?.avatar_url || "/images/taedal-logo.svg", [user?.avatar_url]);
  const profileUrl = user?.username ? `/u/${user.username}` : "/account";

  /* --------------------------------------------------------------------------
   *                           LIVE USERNAME SEARCH
   * ------------------------------------------------------------------------*/
  const [q, setQ] = useState("");
  const [openSearch, setOpenSearch] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [results, setResults] = useState<HitUser[]>([]);
  const [selIndex, setSelIndex] = useState(-1);

  // Debounced fetch (prefix match first, then contains)
  useEffect(() => {
    const term = q.trim();

    if (term && !openSearch) setOpenSearch(true);
    if (!term) {
      setResults([]);
      setOpenSearch(false);
      setSelIndex(-1);
      setLoadingSearch(false);
      return;
    }

    let alive = true;
    setLoadingSearch(true);

    const t = setTimeout(async () => {
      try {
        const likePrefix = `${term}%`;
        const likeAny    = `%${term}%`;

        const qPrefix = supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .ilike("username", likePrefix)
          .order("username")
          .limit(12);

        const qAny = supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .or(`username.ilike.${likeAny},display_name.ilike.${likeAny}`)
          .order("username")
          .limit(20);

        const [rp, ra] = await Promise.all([qPrefix, qAny]);

        if (!alive) return;

        const uniq = (arr: HitUser[]) => {
          const seen = new Set<string>();
          const out: HitUser[] = [];
          for (const x of arr) {
            const key = x.id;
            if (!seen.has(key)) {
              seen.add(key);
              out.push(x);
            }
          }
          return out;
        };

        const rows = uniq([...(rp.data ?? []), ...(ra.data ?? [])] as HitUser[]).slice(0, 20);
        setResults(rows);
        setSelIndex(rows.length ? 0 : -1);
      } catch (err) {
        console.warn("[search] error:", err);
      } finally {
        if (alive) setLoadingSearch(false);
      }
    }, 180);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, openSearch]);

  const goToIndex = (i: number) => {
    const u = results[i];
    if (!u) return;
    const url = u.username ? `/u/${u.username}` : `/profiles/${u.id}`;
    nav(url);
    setOpenSearch(false);
    setSelIndex(-1);
    setQ("");
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!openSearch && e.key === "ArrowDown" && results.length > 0) {
      setOpenSearch(true);
      setSelIndex(0);
      return;
    }
    if (e.key === "Enter") {
      if (selIndex >= 0) {
        e.preventDefault();
        goToIndex(selIndex);
      } else if (q.trim() && results.length) {
        e.preventDefault();
        goToIndex(0);
      }
      return;
    }
    if (!openSearch) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      setOpenSearch(false);
      setSelIndex(-1);
    }
  };

  return (
    <header className="sticky top-0 z-30 bg-black/80 backdrop-blur border-b border-neutral-800">
      <div className="h-14 flex items-center gap-3 px-4 relative">
        {/* spacer to account for sidebar width */}
        <div className="w-14 shrink-0" />

        {/* search */}
        <div className="flex-1 relative">
          <input
            className="w-full input"
            placeholder="🔎 search the name of the artwork or username"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => (q.trim() ? setOpenSearch(true) : null)}
            onKeyDown={onSearchKeyDown}
            aria-autocomplete="list"
            aria-expanded={openSearch}
          />

          {/* dropdown */}
          {openSearch && (
            <div className="absolute left-0 right-0 mt-2 rounded-xl border border-neutral-700 bg-neutral-900 shadow-xl overflow-hidden">
              <div className="max-h-[60vh] overflow-auto">
                {loadingSearch && (
                  <div className="px-3 py-2 text-sm text-neutral-400 border-b border-neutral-800">
                    Searching…
                  </div>
                )}

                {results.length > 0 ? (
                  <div className="py-2">
                    <div className="px-3 pb-1 text-xs uppercase tracking-wider text-neutral-400">
                      Users
                    </div>
                    {results.map((u, idx) => {
                      const active = selIndex === idx;
                      return (
                        <button
                          key={`${u.id}-${idx}`}
                          onMouseEnter={() => setSelIndex(idx)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => goToIndex(idx)}
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
                ) : (
                  !loadingSearch && (
                    <div className="px-3 py-2 text-sm text-neutral-400">No results</div>
                  )
                )}
              </div>

              <div className="px-3 py-2 border-t border-neutral-800 flex items-center justify-between">
                <div className="text-xs text-neutral-500">
                  {results.length} result{results.length === 1 ? "" : "s"}
                </div>
                <div className="text-xs text-neutral-500">Enter to open • Esc to close</div>
              </div>
            </div>
          )}
        </div>

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
                  to={profileUrl}
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
      </div>
    </header>
  );
}
