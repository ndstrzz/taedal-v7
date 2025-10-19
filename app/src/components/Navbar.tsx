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

export default function Navbar() {
  const nav = useNavigate();
  const loc = useLocation();

  const [user, setUser] = useState<UserBits | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // ---- load session + profile into navbar ----
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
      // fetch username + avatar for navbar
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
      // on state change, re-pull profile quickly
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

  // ---- keep avatar/username live if the profile row updates (realtime) ----
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

  // close dropdown on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [loc.pathname, loc.search]);

  // close dropdown on outside click / Esc
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (menuRef.current.contains(e.target as Node)) return;
      setMenuOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
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

  return (
    <header className="w-full sticky top-0 z-40 bg-black/80 backdrop-blur supports-[backdrop-filter]:bg-black/60 border-b border-neutral-800">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-3">
        {/* brand */}
        <Link to="/" className="font-semibold tracking-wide">
          taedal
        </Link>

        {/* search (placeholder) */}
        <div className="flex-1">
          <input
            className="w-full input"
            placeholder="🔎 search the name of the artwork or username"
          />
        </div>

        {/* nav links */}
        <nav className="flex items-center gap-4">
          <NavLink
            to="/contracts"
            className={({ isActive }) =>
              isActive ? "text-white" : "text-neutral-300 hover:text-white"
            }
          >
            Contracts
          </NavLink>

          {/* CHANGED: 'Create' → 'Studio' and route to /studio */}
          <NavLink
            to="/studio"
            className={({ isActive }) =>
              isActive ? "text-white" : "text-neutral-300 hover:text-white"
            }
          >
            Studio
          </NavLink>

          <NavLink
            to="/explore"
            className={({ isActive }) =>
              isActive ? "text-white" : "text-neutral-300 hover:text-white"
            }
          >
            Explore
          </NavLink>

          {/* right side: account slot */}
          {!user ? (
            // LOGGED OUT → Sign in (remember where to return)
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
            // LOGGED IN → avatar + dropdown
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
        </nav>
      </div>
    </header>
  );
}
