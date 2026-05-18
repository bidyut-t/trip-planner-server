import { Router } from "express";
import { ZodError } from "zod";
import { planTripRequestSchema } from "../schemas/trip-plan.schema.js";
import { planTrip } from "../services/planner.service.js";

export const tripRouter = Router();

tripRouter.post("/plan", async (req, res) => {
  try {
    const input = planTripRequestSchema.parse(req.body);
    const plan = await planTrip(input);
    res.json(plan);
  } catch (err) {
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
});
