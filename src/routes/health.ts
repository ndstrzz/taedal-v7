import { Router } from "express";
export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    env: process.env.NODE_ENV || "development",
  });
});
