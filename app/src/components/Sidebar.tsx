import { NavLink, Link, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

/* ----------------------------- Types ----------------------------- */
type UserBits = {
  id: string;
  username?: string | null;
  avatar_url?: string | null;
  email?: string | null;
};

type NavItem = {
  to?: string;             // for regular links
  label: string;
  iconSrc: string;
  alt?: string;
  onClick?: () => void;    // for actions like opening the search panel
};

type SearchRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

/* -------------------------- Helpers ----------------------------- */
const RECENT_KEY = "taedal_recent_searches";
function loadRecent(): SearchRow[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 20);
  } catch {
    return [];
  }
}
function saveRecent(list: SearchRow[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {}
}

/* ---------------------------- Component ---------------------------- */
function RailLink({ to, label, iconSrc, alt, onClick }: NavItem) {
  // Action button variant
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={label}
        className={[
          "group/item w-full flex items-center gap-3 h-11 px-3 rounded-xl transition-colors",
          "text-white/75 hover:text-white",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
        ].join(" ")}
      >
        <div className="grid place-items-center w-8 shrink-0">
          <img
            src={iconSrc}
            alt={alt || label}
            className="h-5 w-5 transition-transform group-hover/item:scale-105"
          />
        </div>
        <span
          className="
            overflow-hidden opacity-0 max-w-0
            group-hover:opacity-100 group-hover:max-w-[180px]
            transition-[opacity,max-width] duration-200 text-sm
            whitespace-nowrap
          "
        >
          {label}
        </span>
      </button>
    );
  }

  // NavLink variant
  return (
    <NavLink
      to={to as string}
      title={label}
      className={({ isActive }) =>
        [
          "group/item w-full flex items-center gap-3 h-11 px-3 rounded-xl transition-colors",
          "text-white/75 hover:text-white",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
          isActive ? "bg-white/5" : "",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <div className="grid place-items-center w-8 shrink-0">
            <img
              src={iconSrc}
              alt={alt || label}
              className={["h-5 w-5 transition-transform", isActive ? "scale-105" : "group-hover/item:scale-105"].join(" ")}
            />
          </div>
          <span
            className="
              overflow-hidden opacity-0 max-w-0
              group-hover:opacity-100 group-hover:max-w-[180px]
              transition-[opacity,max-width] duration-200 text-sm
              whitespace-nowrap
            "
          >
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const nav = useNavigate();

  /* -------------------- auth / profile -------------------- */
  const [user, setUser] = useState<UserBits | null>(null);
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

    return () => sub.data.subscription.unsubscribe();
  }, []);

  const avatar = useMemo(
    () => user?.avatar_url || "/images/taedal-logo.svg",
    [user?.avatar_url]
  );
  const profileUrl = user?.username ? `/u/${user.username}` : "/account";

  /* -------------------- panel & menus -------------------- */
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (panelRef.current && panelRef.current.contains(e.target as Node)) return;
      if (accountRef.current && accountRef.current.contains(e.target as Node)) return;
      setSearchOpen(false);
      setAccountOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSearchOpen(false);
        setAccountOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  /* -------------------- search state -------------------- */
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [recent, setRecent] = useState<SearchRow[]>(() => loadRecent());
  const [sel, setSel] = useState(0);

  // query supabase for profiles
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const term = q.trim();
      if (!term) {
        if (alive) setRows([]);
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
        setRows([]);
        return;
      }
      setRows((data ?? []) as SearchRow[]);
      setSel(0);
    };
    const t = setTimeout(run, 140);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  function goToProfile(row: SearchRow) {
    // save to recent (front of list, dedupe by id)
    setRecent((prev) => {
      const next = [row, ...prev.filter((r) => r.id !== row.id)];
      saveRecent(next);
      return next;
    });
    setSearchOpen(false);
    setQ("");
    setRows([]);
    nav(`/u/${row.username || row.id}`);
  }

  function removeRecent(id: string) {
    setRecent((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveRecent(next);
      return next;
    });
  }

  /* -------------------- nav model -------------------- */
  const mainNav: NavItem[] = [
    { to: "/discover", label: "Discover", iconSrc: "/images/discover-icon.svg", alt: "Discover" },
    { to: "/explore", label: "Collections", iconSrc: "/images/collections-icon.svg" },
    { to: "/contracts", label: "Contracts", iconSrc: "/images/contract-icon.svg" },
    { to: "/studio", label: "Studio", iconSrc: "/images/studio-icon.svg" },
    { to: "/social", label: "Social", iconSrc: "/icons/social.svg" },

  ];

  /* ---------------------------- render ---------------------------- */
  return (
    <>
      <aside
        aria-label="Main navigation"
        className="
          fixed left-0 top-0 z-40 h-screen
          bg-black/80 backdrop-blur
          border-r border-neutral-800
          group
          transition-[width] duration-150
          w-14 hover:w-[264px]
          flex flex-col
          pt-2 pb-4
          overflow-hidden
        "
      >
        {/* Brand (collapsed: taedal-static; expanded: BIG taedal-logo; no wordmark) */}
        <Link
          to="/home"  // go to home, not boot
          title="Home"
          className="
            w-full flex items-center gap-3 h-11 px-3 rounded-xl
            text-white/90 hover:text-white
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30
          "
        >
          <div className="relative grid place-items-center w-8 overflow-visible">
            {/* Collapsed small icon */}
            <img
              src="/images/taedal-static.svg"
              alt="taedal"
              className="h-6 w-6 transition-opacity duration-200 group-hover:opacity-0"
            />

            {/* Expanded BIG logo (acts as the button) */}
            <img
              src="/images/taedal-logo.svg"
              alt="taedal"
              className="
                absolute left-0 top-1/2 -translate-y-1/2
                opacity-0 scale-100 origin-left
                h-6 w-6
                transition-all duration-200 ease-out
                group-hover:opacity-100 group-hover:scale-[3.6]
                drop-shadow-[0_8px_28px_rgba(0,0,0,0.45)]
              "
            />
          </div>
          <span className="sr-only">taedal</span>
        </Link>

        {/* Search rail button (opens panel) */}
        <div className="mt-2 px-1">
          <RailLink
            label="Search"
            iconSrc="/images/search-bar-icon.png"
            onClick={() => {
              setSearchOpen(true);
              setAccountOpen(false);
            }}
          />
        </div>

        {/* Main nav */}
        <nav className="mt-2 grid gap-2 px-1" role="navigation">
          {mainNav.map((it) => (
            <RailLink key={it.to} {...it} />
          ))}
        </nav>

        <div className="flex-1" />

        {/* Settings link */}
        <nav className="grid gap-2 px-1 mb-2">
          <RailLink to="/settings" label="Settings" iconSrc="/images/settings-icon.svg" />
        </nav>

        {/* Account bubble with hover/click menu */}
        <div className="px-1" ref={accountRef}>
          {!user ? (
            <Link
              to="/signin"
              title="Sign in"
              className="
                w-full flex items-center gap-3 h-11 px-3 rounded-xl
                text-white/80 hover:text-white
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30
              "
              onClick={() => {
                const here = window.location.pathname + window.location.search;
                sessionStorage.setItem("returnTo", here || "/account");
              }}
            >
              <div className="grid place-items-center w-8">
                <img src="/images/account-icon.svg" alt="Account" className="h-5 w-5" />
              </div>
              <span
                className="
                  overflow-hidden opacity-0 max-w-0
                  group-hover:opacity-100 group-hover:max-w-[180px]
                  transition-[opacity,max-width] duration-200 text-sm
                  whitespace-nowrap
                "
              >
                Sign in
              </span>
            </Link>
          ) : (
            <div className="relative">
              <button
                type="button"
                title="Account"
                onClick={() => setAccountOpen((v) => !v)}
                className="
                  w-full flex items-center gap-3 h-11 px-3 rounded-xl
                  text-white/90 hover:text-white
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30
                "
              >
                <img src={avatar} className="h-8 w-8 rounded-lg object-cover" alt="profile avatar" />
                <span
                  className="
                    overflow-hidden opacity-0 max-w-0
                    group-hover:opacity-100 group-hover:max-w-[180px]
                    transition-[opacity,max-width] duration-200 text-sm
                    whitespace-nowrap
                  "
                >
                  {user.username ? `@${user.username}` : user.email ?? "Profile"}
                </span>
              </button>

              {accountOpen && (
                <div
                  className="
                    absolute left-[60px] bottom-0 mb-1
                    w-56 rounded-xl border border-neutral-700 bg-neutral-900 shadow-lg overflow-hidden z-50
                  "
                >
                  <Link
                    to={profileUrl}
                    className="block px-3 py-2 text-sm hover:bg-neutral-800"
                    onClick={() => setAccountOpen(false)}
                  >
                    View profile
                  </Link>
                  <Link
                    to="/account"
                    className="block px-3 py-2 text-sm hover:bg-neutral-800"
                    onClick={() => setAccountOpen(false)}
                  >
                    Edit profile
                  </Link>
                  <Link
                    to="/settings"
                    className="block px-3 py-2 text-sm hover:bg-neutral-800"
                    onClick={() => setAccountOpen(false)}
                  >
                    Settings
                  </Link>
                  <button
                    onClick={async () => {
                      await supabase.auth.signOut({ scope: "global" });
                      setAccountOpen(false);
                      nav("/signin", { replace: true });
                    }}
                    className="w-full text-left block px-3 py-2 text-sm hover:bg-neutral-800"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ---------------- Slide-out Search Panel ---------------- */}
      {searchOpen && (
        <div
          ref={panelRef}
          className="
            fixed left-14 top-0 h-screen w-full max-w-[440px]
            border-r border-neutral-800 bg-black
            z-40
            animate-[fadeIn_.15s_ease-out]
          "
        >
          <div className="px-6 pt-6 pb-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Search</h2>
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="rounded-full h-8 w-8 grid place-items-center hover:bg-white/10"
                aria-label="Close search"
              >
                <span className="text-xl leading-none">×</span>
              </button>
            </div>

            <div className="relative mt-4">
              <img
                src="/images/search-bar-icon.png"
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-90"
              />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search"
                className="
                  w-full h-12 rounded-xl pl-10 pr-10
                  bg-white/10 border border-white/15
                  text-white placeholder:text-white/70
                  focus:bg-white/15 outline-none
                "
                onKeyDown={(e) => {
                  if (!rows.length) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSel((i) => (i + 1) % rows.length);
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSel((i) => (i - 1 + rows.length) % rows.length);
                  }
                  if (e.key === "Enter") {
                    const r = rows[Math.max(0, Math.min(sel, rows.length - 1))];
                    if (r) goToProfile(r);
                  }
                }}
              />
              {q && (
                <button
                  type="button"
                  aria-label="Clear"
                  onClick={() => setQ("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded-full hover:bg-white/10"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          <div className="border-t border-white/10" />

          {/* Results or Recent */}
          {q.trim() ? (
            <ul className="overflow-auto max-h-[calc(100vh-170px)]">
              {rows.map((r, i) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => goToProfile(r)}
                    className={[
                      "w-full flex items-center gap-3 px-6 py-3 hover:bg-white/5",
                      i === sel ? "bg-white/5" : "",
                    ].join(" ")}
                  >
                    <img
                      src={r.avatar_url || "/images/taedal-logo.svg"}
                      alt=""
                      className="h-10 w-10 rounded-full object-cover"
                    />
                    <div className="min-w-0 text-left">
                      <div className="truncate">{r.display_name || r.username || "User"}</div>
                      <div className="text-sm text-neutral-400 truncate">@{r.username || r.id}</div>
                    </div>
                  </button>
                </li>
              ))}
              {!rows.length && (
                <div className="px-6 py-8 text-neutral-400">No results.</div>
              )}
            </ul>
          ) : (
            <div className="overflow-auto max-h-[calc(100vh-170px)]">
              <div className="flex items-center justify-between px-6 py-3">
                <div className="text-lg font-medium">Recent</div>
                {recent.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setRecent([]);
                      saveRecent([]);
                    }}
                    className="text-sm text-sky-400 hover:underline"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <ul>
                {recent.map((r) => (
                  <li key={r.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => goToProfile(r)}
                      className="w-full flex items-center gap-3 px-6 py-3 hover:bg-white/5 text-left"
                    >
                      <img
                        src={r.avatar_url || "/images/taedal-logo.svg"}
                        alt=""
                        className="h-10 w-10 rounded-full object-cover"
                      />
                      <div className="min-w-0">
                        <div className="truncate">{r.display_name || r.username || "User"}</div>
                        <div className="text-sm text-neutral-400 truncate">
                          @{r.username || r.id}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label="Remove from recent"
                      onClick={() => removeRecent(r.id)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded-full hover:bg-white/10"
                    >
                      ×
                    </button>
                  </li>
                ))}
                {recent.length === 0 && (
                  <div className="px-6 py-8 text-neutral-400">No recent searches.</div>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
