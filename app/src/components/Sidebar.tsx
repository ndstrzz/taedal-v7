// app/src/components/Sidebar.tsx
import { NavLink, Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type UserBits = {
  id: string;
  username?: string | null;
  avatar_url?: string | null;
  email?: string | null;
};

type NavItem = {
  to: string;
  label: string;
  iconSrc: string;
  alt?: string;
};

function RailLink({ to, label, iconSrc, alt }: NavItem) {
  return (
    <NavLink
      to={to}
      title={label}
      className={({ isActive }) =>
        [
          "group/item w-full flex items-center gap-3 h-11 px-3 rounded-xl transition-colors",
          "text-white/75 hover:text-white",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <div className="grid place-items-center w-8 shrink-0">
            <img
              src={iconSrc}
              alt={alt || label}
              className={[
                "h-5 w-5 transition-transform",
                isActive ? "tae-glow-icon" : "group-hover/item:scale-105",
              ].join(" ")}
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

  const mainNav: NavItem[] = [
    { to: "/discover", label: "Discover", iconSrc: "/images/discover-icon.svg", alt: "Discover" },
    { to: "/explore", label: "Collections", iconSrc: "/images/collections-icon.svg" },
    { to: "/contracts", label: "Contracts", iconSrc: "/images/contract-icon.svg" }, // ✅
    { to: "/studio", label: "Studio", iconSrc: "/images/studio-icon.svg" },
  ];

  return (
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
      <Link
        to="/"
        title="Home"
        className="
          w-full flex items-center gap-3 h-11 px-3 rounded-xl
          text-white/90 hover:text-white
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30
        "
      >
        <div className="relative grid place-items-center w-8">
          <img
            src="/images/taedal-static.svg"
            alt="taedal"
            className="h-6 w-6 transition-opacity duration-200 group-hover:opacity-0"
          />
          <img
            src="/images/taedal-logo.svg"
            alt="taedal (expanded)"
            className="h-6 w-6 absolute inset-0 m-auto opacity-0 transition-opacity duration-200 group-hover:opacity-100"
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
          taedal
        </span>
      </Link>

      <nav className="mt-2 grid gap-2 px-1" role="navigation">
        {mainNav.map((it) => (
          <RailLink key={it.to} {...it} />
        ))}
      </nav>

      <div className="flex-1" />

      <nav className="grid gap-2 px-1 mb-2">
        <RailLink to="/settings" label="Settings" iconSrc="/images/settings-icon.svg" />
      </nav>

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
        <Link
          to={profileUrl}
          title="Profile"
          className="
            w-full flex items-center gap-3 h-11 px-3 rounded-xl
            hover:text-white
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30
          "
        >
          <img src={avatar} className="h-8 w-8 rounded-lg object-cover" alt="profile avatar" />
          <span
            className="
              overflow-hidden opacity-0 max-w-0
              group-hover:opacity-100 group-hover:max-w-[180px]
              transition-[opacity,max-width] duration-200 text-sm text-white/80
              whitespace-nowrap
            "
          >
            {user.username ? `@${user.username}` : user.email ?? "Profile"}
          </span>
        </Link>
      )}
    </aside>
  );
}
