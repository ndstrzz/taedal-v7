// deno deploy style
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

serve(async (req) => {
  try {
    const payload = await req.json(); // depends on provider
    const tracking = payload.tracking_number as string | undefined;
    const status = (payload.status as string | undefined)?.toLowerCase().replaceAll(" ", "_");

    if (!tracking) return new Response("no tracking", { status: 400 });

    // find shipment by tracking number
    const { data: ships } = await supabase
      .from("shipments")
      .select("id")
      .eq("tracking_number", tracking)
      .limit(1);

    if (ships && ships[0]) {
      const shipmentId = ships[0].id;
      if (status) {
        await supabase.from("shipments").update({ status }).eq("id", shipmentId);
      }
      await supabase
        .from("shipment_events")
        .insert({
          shipment_id: shipmentId,
          code: status || "custom",
          message: payload.description ?? null,
          meta: payload,
        });
    }

    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
