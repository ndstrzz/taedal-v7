// server/routes/wallets.ts
import express, { Request, Response } from "express";
// In dev we just generate a fake address. Later this will call a real provider.
import { randomBytes } from "crypto";

const router = express.Router();

// Helper: generate a fake 0x... address for now
function generateDevAddress() {
  // 20 bytes -> 40 hex chars
  const buf = randomBytes(20);
  return "0x" + buf.toString("hex");
}

router.post("/", async (req: Request, res: Response) => {
  try {
    // TODO: replace this with your real auth once wired
    // e.g. const userId = (req as any).user?.id;
    const userId = (req as any).user?.id ?? "dev-user";

    // 1) call wallet provider here (Privy / Thirdweb / custom signer)
    //    For now we just generate a fake address:
    const address = generateDevAddress();

    // 2) TODO: save to DB (Supabase) – user_wallets table
    //
    // Example pseudo-code (depends on how your server talks to Supabase):
    // await supabaseClient
    //   .from("user_wallets")
    //   .insert({
    //     user_id: userId,
    //     address,
    //     provider: "dev",
    //   });

    // 3) respond to frontend
    res.json({ address });
  } catch (err) {
    console.error("[POST /api/wallets] error", err);
    res.status(500).json({ error: "Failed to create wallet" });
  }
});

export default router;
