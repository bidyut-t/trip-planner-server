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

// Unified endpoint for both new trip planning and conversational refinement
// If previousPlan is provided, it refines the existing plan with the prompt as feedback
// If previousPlan is missing, it generates a new trip plan from the prompt
tripRouter.post("/plan/natural", async (req, res) => {
  try {
    const { prompt, userId, previousPlan } = planTripNaturalRequestSchema.parse(req.body);
    
    let result;
    if (previousPlan) {
      // Refinement mode: user is modifying existing plan
      console.log("[unified-endpoint] Refinement mode - updating existing plan");
      result = await refinePlanFromFeedback(previousPlan, prompt, userId);
    } else {
      // New plan mode: user is requesting a new trip
      console.log("[unified-endpoint] New plan mode - generating fresh itinerary");
      result = await planFromNaturalLanguage(prompt, userId);
    }
    
    res.json(result);
  } catch (err) {
    handlePlanError(err, res);
  }
});

// Get all user profiles for demo/testing
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

// Get specific user profile by ID
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

// Conversational Plan Refinement endpoint (CodeFest Feature)
// Allows users to iteratively refine trip plans with natural language feedback
// Example: "I'll be with my mom, adjust for accessibility" or "Add kid-friendly activities"
// DEPRECATED: Use POST /plan/natural with previousPlan field instead for unified API
tripRouter.post("/plan/refine", async (req, res) => {
  try {
    console.warn("[DEPRECATED] /plan/refine endpoint - use /plan/natural with previousPlan instead");
    const { originalPlan, feedback, userId } = refinePlanRequestSchema.parse(req.body);
    const refinedPlan = await refinePlanFromFeedback(originalPlan, feedback, userId);
    res.json({ plan: refinedPlan });
  } catch (err) {
    handlePlanError(err, res);
  }
});
