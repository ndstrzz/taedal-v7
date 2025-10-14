import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import { healthRouter } from "./routes/health";
import { rpcRouter } from "./routes/rpc";

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));

app.get("/", (_req, res) => {
  res.json({ ok: true, name: "taedal-server", uptime: process.uptime() });
});

app.use("/api/health", healthRouter);
app.use("/api", rpcRouter);

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, () => {
  console.log(`> taedal-server listening on http://localhost:${PORT}`);
});
