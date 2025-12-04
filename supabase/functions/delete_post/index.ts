// supabase/functions/delete_post/index.ts
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const { postId } = await req.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // auth check (optional stronger: verify JWT & author owns post)
    const authHeader = req.headers.get("authorization") ?? "";
    const user = (await sb.auth.getUser(authHeader.replace("Bearer ", ""))).data.user;
    if (!user) return new Response("Unauthorized", { status: 401 });

    // fetch media rows
    const { data: media, error: mErr } = await sb.from("post_media")
      .select("url, post_id, posts!inner(author_id)")
      .eq("post_id", postId);
    if (mErr) throw mErr;

    // auth: ensure owner
    if (media?.[0] && media[0].posts.author_id !== user.id) {
      return new Response("Forbidden", { status: 403 });
    }

    // derive storage paths from URLs (assuming public URLs: /storage/v1/object/public/post-media/<path>)
    const paths: string[] = (media ?? []).map((m) =>
      decodeURIComponent(new URL(m.url).pathname.replace(/^.*\/post-media\//, ""))
    );

    // delete storage objects
    if (paths.length) {
      const del = await sb.storage.from("post-media").remove(paths);
      if (del.error) throw del.error;
    }

    // delete db rows (media -> post)
    const { error: delMediaErr } = await sb.from("post_media").delete().eq("post_id", postId);
    if (delMediaErr) throw delMediaErr;
    const { error: delPostErr } = await sb.from("posts").delete().eq("id", postId);
    if (delPostErr) throw delPostErr;

    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response(String(e?.message ?? e), { status: 500 });
  }
});
