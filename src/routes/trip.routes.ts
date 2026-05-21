import { Router } from "express";
import { ZodError } from "zod";
import {
  planTripNaturalRequestSchema,
  refinePlanRequestSchema,
} from "../schemas/trip-plan.schema.js";
import { planFromNaturalLanguage } from "../services/natural-planner.service.js";
import { refinePlanFromFeedback } from "../services/refine-planner.service.js";
import { loadUserProfiles, getUserProfile } from "../services/catalog/catalog.service.js";

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
    const { prompt, userId } = planTripNaturalRequestSchema.parse(req.body);
    const result = await planFromNaturalLanguage(prompt, userId);  // ARIA: Pass userId for profile selection
    res.json(result);
  } catch (err) {
    handlePlanError(err, res);
  }
});

// ARIA: Get all user profiles for demo/testing
tripRouter.get("/profiles", async (_req, res) => {
  try {
    const profiles = await loadUserProfiles();
    res.json(profiles);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to load user profiles"
    });
  }
});

// ARIA: Get specific user profile by ID
tripRouter.get("/profiles/:userId", async (req, res) => {
  try {
    const profile = await getUserProfile(req.params.userId);
    if (!profile) {
      res.status(404).json({ error: "User profile not found" });
      return;
    }
    res.json(profile);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to load user profile"
    });
  }
});

// ARIA: Conversational Plan Refinement endpoint (Feature 3 - CodeFest)
// Allows users to iteratively refine trip plans with natural language feedback
// Example: "I'll be with my mom, adjust for accessibility" or "Add kid-friendly activities"
tripRouter.post("/plan/refine", async (req, res) => {
  try {
    const { originalPlan, feedback, userId } = refinePlanRequestSchema.parse(req.body);
    const refinedPlan = await refinePlanFromFeedback(originalPlan, feedback, userId);
    res.json({ plan: refinedPlan });
  } catch (err) {
    handlePlanError(err, res);
  }
});
