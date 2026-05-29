import { Router } from "express";
import { ZodError } from "zod";
import {
  planTripNaturalRequestSchema,
  refinePlanRequestSchema,
} from "../schemas/trip-plan.schema.js";
import { planFromNaturalLanguage } from "../services/natural-planner.service.js";
import { refinePlanFromFeedback } from "../services/refine-planner.service.js";
import { generateRefinementDeltas, applyDeltasToPlan } from "../services/delta-refiner.service.js";
import { loadUserProfiles, getUserProfile } from "../services/catalog/catalog.service.js";
import { runOpenAiPrompt } from "../utils/openai-mcp-agent.js";

export const tripRouter = Router();

/**
 * AI-Powered Intent Detection
 * 
 * Analyzes user's message to determine: "Is this modifying current plan or requesting new trip?"
 * Much more reliable than keyword matching - AI understands nuance and context.
 * 
 * Examples:
 * - "add museums" → 'modify' (refine existing plan)
 * - "make it end earlier" → 'modify' (adjust existing plan)
 * - "actually, plan a trip to Paris instead" → 'new' (completely different trip)
 * - "I want to go to Tokyo for 5 days" → 'new' (different destination)
 */
async function determineUserIntent(
  userMessage: string, 
  currentPlan: any
): Promise<'modify' | 'new'> {
  const prompt = `You are analyzing user intent in a conversational trip planning system.

CURRENT TRIP PLAN:
- Destination: ${currentPlan.destination}
- Duration: ${currentPlan.days?.length || 1} day(s)
- Activities: ${currentPlan.days?.[0]?.blocks?.length || 0} activities on first day

USER'S NEW MESSAGE:
"${userMessage}"

TASK: Determine the user's intent. Reply with ONLY one word:
- "modify" if the user wants to ADJUST/REFINE the CURRENT ${currentPlan.destination} trip (add activities, change timing, remove something, etc.)
- "new" if the user wants a COMPLETELY DIFFERENT trip (different destination, or explicitly saying "new trip", "instead", "forget that", etc.)

EXAMPLES:
User: "add kid friendly activities" → modify
User: "make it end earlier" → modify  
User: "remove the museum" → modify
User: "change the restaurant" → modify
User: "actually, plan a trip to Paris instead" → new
User: "I want to go to Tokyo for 5 days" → new
User: "forget that, show me London" → new

Reply with ONLY "modify" or "new" (no explanation):`;

  try {
    const response = await runOpenAiPrompt(prompt);
    const intent = response.trim().toLowerCase();
    
    if (intent.includes('new')) return 'new';
    if (intent.includes('modify')) return 'modify';
    
    // Default to modify (safer - preserves work)
    console.warn("[intent-detection] Ambiguous response, defaulting to 'modify':", response);
    return 'modify';
  } catch (err) {
    console.error("[intent-detection] Failed to determine intent, defaulting to 'modify':", err);
    return 'modify'; // Safer default
  }
}

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
// AI-POWERED INTENT DETECTION: AI decides whether to modify existing plan or create new one
// No brittle keyword detection - AI understands natural conversation
tripRouter.post("/plan/natural", async (req, res) => {
  try {
    const { prompt, userId, previousPlan } = planTripNaturalRequestSchema.parse(req.body);
    
    let result;
    if (previousPlan) {
      // AI INTENT DETECTION: Let AI decide if this is a modification or new plan request
      console.log("[unified-endpoint] Previous plan exists - AI will determine intent");
      console.log("[unified-endpoint] User request:", prompt);
      console.log("[unified-endpoint] Current destination:", previousPlan.destination);
      
      // AI analyzes: "Is user modifying current plan, or requesting entirely new trip?"
      const intent = await determineUserIntent(prompt, previousPlan);
      console.log("[unified-endpoint] AI detected intent:", intent);
      
      if (intent === 'modify') {
        // DELTA REFINEMENT MODE: AI generates only changes
        console.log("[unified-endpoint] → Delta refinement mode - modifying existing plan");
        const delta = await generateRefinementDeltas(previousPlan, prompt, userId);
        console.log("[delta-refiner] Operations:", delta.operations.length);
        result = applyDeltasToPlan(previousPlan, delta);
        console.log("[delta-refiner] Applied deltas successfully");
      } else {
        // NEW PLAN MODE: User wants a completely different trip
        console.log("[unified-endpoint] → New plan mode - user wants different trip");
        result = await planFromNaturalLanguage(prompt, userId);
      }
    } else {
      // No previous plan: definitely a new trip request
      console.log("[unified-endpoint] New plan mode - no previous context");
      result = await planFromNaturalLanguage(prompt, userId);
    }
    
    // DEBUG: Log what we're sending back
    const activityCount = result.days?.[0]?.blocks?.length || result.days?.[0]?.activities?.length || 0;
    console.log(`[unified-endpoint] Returning plan with ${activityCount} activities`);
    if (result.days?.[0]?.blocks) {
      console.log('[unified-endpoint] Activity names:', result.days[0].blocks.map((a: any) => a.title || a.name).join(', '));
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
