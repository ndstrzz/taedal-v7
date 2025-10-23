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

type SearchRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export default function Topbar() {
  const nav = useNavigate();
  const loc = useLocation();

  const [user, setUser] = useState<UserBits | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /* -------------------- bootstrap user + auth listener -------------------- */
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

  useEffect(() => setMenuOpen(false), [loc.pathname, loc.search]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (menuRef.current.contains(e.target as Node)) return;
      setMenuOpen(false);
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setOpen(false);
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
  const profileUrl = user?.username ? `/u/${user.username}` : "/account";

  /* ------------------------------ Search UI ------------------------------ */
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [sel, setSel] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<number | null>(null);

  // Fetch users for query
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

  function go(row: SearchRow | undefined) {
    if (!row) return;
    nav(`/u/${row.username || row.id}`);
    setOpen(false);
    setQ("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && rows.length) {
      e.preventDefault();
      setOpen(true);
      setSel((i) => (i + 1) % rows.length);
      return;
    }
    if (e.key === "ArrowUp" && rows.length) {
      e.preventDefault();
      setOpen(true);
      setSel((i) => (i - 1 + rows.length) % rows.length);
      return;
    }
    if (e.key === "Enter") {
      // Always navigate to the top result if available
      const r = rows[Math.max(0, Math.min(sel, rows.length - 1))];
      if (r) {
        e.preventDefault();
        go(r);
      } else {
        // no results → do nothing special
      }
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 bg-black/80 backdrop-blur border-b border-neutral-800">
      <div className="h-14 flex items-center gap-3 px-4">
        {/* spacer to account for sidebar width */}
        <div className="w-14 shrink-0" />

        {/* search box + results */}
        <div className="relative flex-1" ref={boxRef}>
          <input
            className="w-full input"
            placeholder="🔎 search the name of the artwork or username"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => rows.length && setOpen(true)}
            onBlur={() => {
              // small delay so clicks on items still register
              blurTimer.current = window.setTimeout(() => setOpen(false), 120);
            }}
            onKeyDown={onKeyDown}
          />
          {open && rows.length > 0 && (
            <div className="absolute left-0 right-0 mt-2 rounded-xl border border-neutral-700 bg-neutral-900 shadow-lg overflow-hidden z-50">
              <div className="px-3 py-2 text-xs text-neutral-400">USERS</div>
              <ul className="max-h-80 overflow-auto">
                {rows.map((r, i) => {
                  const href = `/u/${r.username || r.id}`;
                  return (
                    <li key={r.id}>
                      <Link
                        to={href}
                        onMouseDown={() => {
                          // cancel pending blur-close
                          if (blurTimer.current) {
                            clearTimeout(blurTimer.current);
                            blurTimer.current = null;
                          }
                        }}
                        onClick={() => go(r)}
                        className={[
                          "flex items-center gap-3 px-3 py-2 hover:bg-neutral-800",
                          i === sel ? "bg-neutral-800" : "",
                        ].join(" ")}
                      >
                        <img
                          src={r.avatar_url || "/images/taedal-logo.svg"}
                          alt=""
                          className="h-7 w-7 rounded-full object-cover"
                        />
                        <div className="min-w-0">
                          <div className="truncate">{r.display_name || r.username || "User"}</div>
                          <div className="text-xs text-neutral-400 truncate">
                            @{r.username || r.id}
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="px-3 py-2 text-xs text-neutral-500 border-t border-neutral-800">
                Enter to open selected • Esc to close
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
