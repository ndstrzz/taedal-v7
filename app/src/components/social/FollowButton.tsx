import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { getFollowState, toggleFollow } from "../../lib/follow";

type Props = {
  profileId: string; // the profile being viewed
};

export default function FollowButton({ profileId }: Props) {
  const nav = useNavigate();
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);

  // Load session + initial follow state
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id ?? null;
      if (!alive) return;
      setMe(uid);

      if (uid && profileId && uid !== profileId) {
        try {
          const s = await getFollowState(profileId);
          if (alive) setIsFollowing(s);
        } catch {
          /* no-op; keep false */
        }
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [profileId]);

  // If still loading or user is viewing own profile, render nothing
  if (loading || (me && me === profileId)) return null;

  async function onClick() {
    // Require auth
    if (!me) {
      const here = window.location.pathname + window.location.search;
      sessionStorage.setItem("returnTo", here);
      nav("/signin");
      return;
    }

    setBusy(true);
    try {
      const next = await toggleFollow(profileId);
      setIsFollowing(next);
    } catch (e: any) {
      // Show a lightweight inline error; you can replace with your toast
      console.warn(e?.message || e);
      alert(e?.message || "Failed to update follow.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={[
        "px-5 h-10 rounded-xl font-medium",
        isFollowing ? "bg-white text-black hover:opacity-90" : "bg-indigo-500 hover:bg-indigo-400",
        busy ? "opacity-60 cursor-wait" : "",
      ].join(" ")}
    >
      {isFollowing ? "Following" : "Follow"}
    </button>
  );
}
