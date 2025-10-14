import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";

import { healthRouter } from "./routes/health";
import { rpcRouter } from "./routes/rpc";

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));

app.get("/", (_req: Request, res: Response) => {
  res.json({ ok: true, name: "taedal-server", uptime: process.uptime() });
});

app.use("/api/health", healthRouter);
app.use("/api", rpcRouter);

// error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(`> taedal-server listening on http://localhost:${PORT}`);
});
