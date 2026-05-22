import { Router } from "express";
import { ZodError } from "zod";
import {
  planTripNaturalRequestSchema,
} from "../schemas/trip-plan.schema.js";
import { planFromNaturalLanguage } from "../services/natural-planner.service.js";

export const tripRouter = Router();

function handlePlanError(err: unknown, res: import("express").Response): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: err.flatten() });
    return;
  }
  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: "Internal server error" });
}

tripRouter.post("/plan/natural", async (req, res) => {
  try {
    const { prompt } = planTripNaturalRequestSchema.parse(req.body);
    const result = await planFromNaturalLanguage(prompt);
    res.json(result);
  } catch (err) {
    handlePlanError(err, res);
  }
});
