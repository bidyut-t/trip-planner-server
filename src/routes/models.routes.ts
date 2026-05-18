import { Router } from "express";
import { listAvailableModels } from "../services/cursor-models.service.js";

export const modelsRouter = Router();

modelsRouter.get("/", async (_req, res) => {
  try {
    const models = await listAvailableModels();
    res.json({ count: models.length, models });
  } catch (err) {
    if (err instanceof Error && err.message.includes("CURSOR_API_KEY")) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(502).json({
      error: err instanceof Error ? err.message : "Failed to list models",
    });
  }
});
