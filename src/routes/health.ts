import { Router, Request, Response } from "express";
export const healthRouter = Router();

healthRouter.get("/", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    env: process.env.NODE_ENV || "development",
  });
});
