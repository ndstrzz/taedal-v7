// app/src/components/Topbar.tsx
import { Link, useLocation, useNavigate } from "react-router-dom";
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

/* tiny util */
const cx = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

export default function Topbar() {
  const nav = useNavigate();
  const loc = useLocation();

  const [user, setUser] = useState<UserBits | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // refs for outside-click handling
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  /* ---------------------- session + profile load ---------------------- */
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

  /* close account dropdown on route change */
  useEffect(() => setMenuOpen(false), [loc.pathname, loc.search]);

  /* ----------------------------- search ----------------------------- */
  const [q, setQ] = useState("");
  const [openSearch, setOpenSearch] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [results, setResults] = useState<HitUser[]>([]);
  const [selIndex, setSelIndex] = useState<number>(-1);

  // Debounced live search — show panel immediately (with "Searching…")
  useEffect(() => {
    const term = q.trim();

    // open the panel as soon as there is any term
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
        const likeAnywhere = `%${term}%`;
        const { data, error } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .or(`username.ilike.${likeAnywhere},display_name.ilike.${likeAnywhere}`)
          .order("username", { ascending: true })
          .limit(20);

        if (!alive) return;
        if (error) {
          console.warn("[search] error:", error);
          setResults([]);
        } else {
          setResults(
            (data ?? []).map((r: any) => ({
              id: r.id,
              username: r.username ?? null,
              display_name: r.display_name ?? null,
              avatar_url: r.avatar_url ?? null,
            }))
          );
        }
        setSelIndex(-1);
      } catch (err) {
        if (alive) console.warn("[search] error:", err);
      } finally {
        if (alive) setLoadingSearch(false);
      }
    }, 180); // snappy debounce

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, openSearch]);

  const profileHref = (u: HitUser) =>
    u.username ? `/profiles/${u.username}` : `/profiles/${u.id}`;

  const goToIndex = (i: number) => {
    const u = results[i];
    if (!u) return;
    nav(profileHref(u));
    setOpenSearch(false);
    setSelIndex(-1);
    setQ("");
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
    if (!openSearch && e.key === "ArrowDown" && results.length > 0) {
      setOpenSearch(true);
      setSelIndex(0);
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

  /* -------------------------- outside clicks -------------------------- */
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      // keep account menu open only when clicking inside it
      if (menuRef.current?.contains(t)) return;
      // keep search open when clicking inside the search area
      if (searchRef.current?.contains(t)) return;

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
  const myProfileUrl = user?.username
    ? `/profiles/${user.username}`
    : `/profiles/${user?.id || ""}`;

  return (
    <header className="sticky top-0 z-30 bg-black/80 backdrop-blur border-b border-neutral-800">
      <div className="h-14 flex items-center gap-3 px-4">
        {/* spacer to account for sidebar width */}
        <div className="w-14 shrink-0" />

        {/* search */}
        <div className="flex-1 relative" ref={searchRef}>
          <input
            className="w-full input"
            placeholder="🔎 search the name of the artwork or username"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => (q.trim() ? setOpenSearch(true) : null)}
            onKeyDown={onSearchKeyDown}
          />

          {/* dropdown */}
          {openSearch ? (
            <div className="absolute left-0 right-0 mt-2 rounded-xl border border-neutral-700 bg-neutral-900 shadow-xl overflow-hidden">
              <div className="max-h-[60vh] overflow-auto">
                {/* when searching and nothing yet */}
                {loadingSearch && (
                  <div className="px-3 py-2 text-sm text-neutral-400 border-b border-neutral-800">
                    Searching…
                  </div>
                )}

                {/* Users */}
                {results.length > 0 && (
                  <div className="py-2">
                    <div className="px-3 pb-1 text-xs uppercase tracking-wider text-neutral-400">
                      Users
                    </div>
                    {results.map((u, idx) => {
                      const active = selIndex === idx;
                      const href = profileHref(u);
                      return (
                        <Link
                          key={`${u.id}-${idx}`}
                          to={href}
                          className={cx(
                            "w-full flex items-center gap-3 px-3 py-2 text-left",
                            active ? "bg-neutral-800" : "hover:bg-neutral-800/60"
                          )}
                          onMouseEnter={() => setSelIndex(idx)}
                          onClick={() => {
                            // let the router navigate, then close panel
                            setOpenSearch(false);
                            setSelIndex(-1);
                            setQ("");
                          }}
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
                              <div className="text-xs text-neutral-400 truncate">
                                @{u.username}
                              </div>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}

                {!loadingSearch && results.length === 0 && (
                  <div className="px-3 py-2 text-sm text-neutral-400">
                    No results
                  </div>
                )}
              </div>

              {/* footer row */}
              <div className="px-3 py-2 border-t border-neutral-800 flex items-center justify-between">
                <div className="text-xs text-neutral-500">
                  {results.length} result{results.length === 1 ? "" : "s"}
                </div>
                {results.length > 0 && (
                  <button
                    className="text-sm text-neutral-200 hover:underline"
                    onClick={() => goToIndex(selIndex >= 0 ? selIndex : 0)}
                  >
                    Open selected
                  </button>
                )}
              </div>
            </div>
          ) : null}
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
              <img
                src={avatar}
                alt="avatar"
                className="h-7 w-7 rounded-full object-cover"
              />
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
      </div>
    </header>
  );
}
