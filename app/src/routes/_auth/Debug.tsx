import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export default function DebugAuth() {
  const [session, setSession] = useState<any>(null);
  const [msg, setMsg] = useState<string>("");

  const refresh = async () => {
    const s = await supabase.auth.getSession();
    setSession(s.data?.session || null);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setMsg("Signed out.");
  };

  const nukeLocal = () => {
    Object.keys(localStorage).forEach((k) => k.startsWith("sb-") && localStorage.removeItem(k));
    sessionStorage.clear();
    setMsg("Local auth data cleared.");
  };

  useEffect(() => { refresh(); }, []);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">Auth Debug</h1>
      <div className="space-x-2">
        <button className="btn" onClick={refresh}>Refresh session</button>
        <button className="btn" onClick={signOut}>Sign out</button>
        <button className="btn" onClick={nukeLocal}>Nuke local</button>
      </div>
      {msg && <p className="text-sm text-amber-300">{msg}</p>}
      <pre className="text-xs whitespace-pre-wrap mt-4">
        {JSON.stringify(session, null, 2)}
      </pre>
    </div>
  );
}
