import express from "express";
import cors from "cors";
import { modelsRouter } from "./routes/models.routes.js";
import { tripRouter } from "./routes/trip.routes.js";
import { loadCatalog } from "./services/catalog/catalog.service.js";
import { isOpenAiSdkEnabled } from "./utils/env.js";

const app = express();
const port = Number(process.env.PORT) || 8081;

// Enable CORS for frontend (localhost:3002)
app.use(cors({
  origin: ['http://localhost:3002', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    plannerMode: isOpenAiSdkEnabled() ? "openai" : "mock",
  });
});

app.get("/api/catalog/:destination", async (req, res) => {
  try {
    const catalog = await loadCatalog(req.params.destination);
    res.json(catalog);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to load catalog",
    });
  }
});

app.use("/api/models", modelsRouter);
app.use("/api/trips", tripRouter);

app.listen(port, () => {
  console.log(`Trip planner server listening on http://localhost:${port}`);
  console.log(`Planner mode: ${isOpenAiSdkEnabled() ? "openai" : "mock"}`);
});
