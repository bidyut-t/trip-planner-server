import { Router } from "express";
import { ZodError } from "zod";
import {
  planTripNaturalRequestSchema,
  planTripRequestSchema,
} from "../schemas/trip-plan.schema.js";
import { parseTripRequestFromNaturalLanguage } from "../services/nlp-parser.service.js";
import { planTrip } from "../services/planner.service.js";

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

tripRouter.post("/plan", async (req, res) => {
  try {
    const input = planTripRequestSchema.parse(req.body);
    const plan = await planTrip(input);
    res.json(plan);
  } catch (err) {
    handlePlanError(err, res);
  }
});

tripRouter.post("/plan/natural", async (req, res) => {
  try {
    const { prompt } = planTripNaturalRequestSchema.parse(req.body);
    const request = await parseTripRequestFromNaturalLanguage(prompt);
    const plan = await planTrip(request);
    res.json({ request, plan });
  } catch (err) {
    handlePlanError(err, res);
  }
});
