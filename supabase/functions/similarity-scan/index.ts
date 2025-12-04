// supabase/functions/similarity-scan/index.ts

// Turn off TypeScript checking in VS Code for this Deno edge function.
// Supabase CLI will still compile and run it fine.
// If you want stricter typing later, we can wire proper Deno typings.
 // @ts-nocheck

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type DuplicateHit = {
  id: string;
  title: string | null;
  image_url: string | null;
  creator_id: string | null;
};

type WebMatch = {
  url: string;
  thumbnail?: string | null;
  domain?: string | null;
  similarity?: number | null;
};

type Payload = {
  hash?: string;
  limit?: number;
};

type ResponseBody = {
  internal: DuplicateHit[];
  web: WebMatch[];
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: {
        ...corsHeaders,
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...corsHeaders },
    });
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  const { hash, limit } = payload ?? {};
  if (!hash || typeof hash !== "string") {
    return new Response(
      JSON.stringify({ error: "Missing or invalid `hash`" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    const { data, error } = await client
      .from("artworks")
      .select("id,title,image_url,creator_id")
      .eq("image_sha256", hash)
      .limit(limit ?? 5);

    if (error) {
      console.error("similarity-scan error:", error);
      return new Response(
        JSON.stringify({ error: "Failed querying artworks" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    const body: ResponseBody = {
      internal: (data as DuplicateHit[]) ?? [],
      web: [],
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e) {
    console.error("similarity-scan unexpected error:", e);
    return new Response(
      JSON.stringify({ error: "Unexpected error in similarity-scan" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
});
