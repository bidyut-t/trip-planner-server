import express from "express";
import cors from "cors";
import { modelsRouter } from "./routes/models.routes.js";
import { tripRouter } from "./routes/trip.routes.js";
import { loadCatalog } from "./services/catalog/catalog.service.js";
import { isOpenAiSdkEnabled } from "./utils/env.js";
import { weatherRouter } from "./routes/weather.routes.js";

const app = express();
const port = Number(process.env.PORT) || 8081;
const frontendBaseUrl = process.env.FRONTEND_BASE_URL || "http://localhost:3002";

app.use(cors({
  origin: frontendBaseUrl,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
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
app.use("/api/weather", weatherRouter);

app.listen(port, () => {
  console.log(`Trip planner server listening on http://localhost:${port}`);
  console.log(`Planner mode: ${isOpenAiSdkEnabled() ? "openai" : "mock"}`);
  console.log(`CORS enabled for: ${frontendBaseUrl}`);
});
