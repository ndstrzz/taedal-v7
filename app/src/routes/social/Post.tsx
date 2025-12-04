// app/src/routes/social/Post.tsx
import { useEffect } from "react";
import Composer from "../../components/social/Composer";

export default function SocialPost() {
  useEffect(() => {
    document.title = "Post — taedal";
  }, []);

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Create a post</h1>
        <p className="text-sm text-neutral-400">
          Share updates with your collectors and followers.
        </p>
      </header>

      <Composer />
    </main>
  );
}
