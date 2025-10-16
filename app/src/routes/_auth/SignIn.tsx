import { useState } from "react";
import { supabase } from "../../lib/supabase";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // bring user back to where they started after the callback
    if (!sessionStorage.getItem("returnTo")) {
      sessionStorage.setItem("returnTo", "/account");
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <div className="min-h-[100dvh] grid place-items-center p-6">
      <div className="card max-w-md w-full">
        <h1 className="text-2xl font-bold mb-4">Sign in</h1>
        {sent ? (
          <p>Check your email for a magic link. Keep this tab open.</p>
        ) : (
          <form onSubmit={signIn} className="space-y-3">
            <input
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="btn w-full" type="submit">Send magic link</button>
          </form>
        )}
        {error && <p className="text-red-400 mt-2">{error}</p>}
      </div>
    </div>
  );
}
