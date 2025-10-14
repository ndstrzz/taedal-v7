//C:\Users\User\Downloads\taedal-v7\server\src\routes\rpc.ts
import { Router, Request, Response } from "express";
import { z } from "zod";
import { makeUserClient, sbAdmin } from "../lib/supabase";
export const rpcRouter = Router();

// 👇 widen the type here
function bearer(req: any): string | undefined {
  const h = req.headers?.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : undefined;
}



// POST /api/listings
rpcRouter.post("/listings", async (req: Request, res: Response) => {
  const token = bearer(req);
  const schema = z.object({
    artwork_id: z.string().uuid(),
    type: z.enum(["coming_soon", "fixed_price", "auction"]),
    status: z.enum(["draft", "active", "paused", "ended", "canceled"]).default("active"),
    sale_currency: z.string().default("ETH"),
    fixed_price: z.number().optional().nullable(),
    reserve_price: z.number().optional().nullable(),
    start_at: z.string().datetime().nullish(),
    end_at: z.string().datetime().nullish(),
    quantity: z.number().int().positive().default(1),
    settlement_kind: z.enum(["onchain", "stripe", "coinbase_commerce"]).default("onchain"),
    payout_wallet_id: z.string().uuid().nullish(),
    charity_flag: z.boolean().optional().default(false),
    charity_pct_bps: z.number().int().min(0).max(10000).optional().default(0),
    charity_target_id: z.string().uuid().nullish(),
    charity_name: z.string().nullish(),
    charity_wallet_address: z.string().nullish(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const client = makeUserClient(token ?? undefined);
    const payload: any = {
      p_artwork_id: parsed.data.artwork_id,
      p_type: parsed.data.type,
      p_status: parsed.data.status,
      p_sale_currency: parsed.data.sale_currency,
      p_fixed_price: parsed.data.fixed_price ?? null,
      p_reserve_price: parsed.data.reserve_price ?? null,
      p_start_at: parsed.data.start_at ?? null,
      p_end_at: parsed.data.end_at ?? null,
      p_quantity: parsed.data.quantity,
      p_settlement_kind: parsed.data.settlement_kind,
      p_payout_wallet_id: parsed.data.payout_wallet_id ?? null,
      p_charity_flag: parsed.data.charity_flag,
      p_charity_pct_bps: parsed.data.charity_pct_bps,
      p_charity_target_id: parsed.data.charity_target_id ?? null,
      p_charity_name: parsed.data.charity_name ?? null,
      p_charity_wallet_address: parsed.data.charity_wallet_address ?? null,
    };
    const { data, error } = await client.rpc("create_listing", payload);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ id: data });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: "create_listing failed" });
  }
});

// POST /api/bids
rpcRouter.post("/bids", async (req: Request, res: Response) => {
  const token = bearer(req);
  const schema = z.object({
    listing_id: z.string().uuid(),
    amount: z.number().positive(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const client = makeUserClient(token ?? undefined);
    const { data, error } = await client.rpc("place_bid", {
      p_listing_id: parsed.data.listing_id,
      p_amount: parsed.data.amount,
    } as any);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ id: data });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: "place_bid failed" });
  }
});

// POST /api/orders/:id/paid  (service role only)
rpcRouter.post("/orders/:id/paid", async (req: Request, res: Response) => {
  const orderId = req.params.id;
  const schema = z.object({
    chain_id: z.number().int().optional().default(0),
    tx_hash: z.string().nullish(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const { error } = await sbAdmin.rpc("mark_order_paid", {
      p_order_id: orderId,
      p_chain_id: parsed.data.chain_id,
      p_tx_hash: parsed.data.tx_hash ?? null,
    } as any);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: "mark_order_paid failed" });
  }
});
