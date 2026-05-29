import { z } from "zod";
import { normalizeBlockType, normalizeSource } from "../utils/normalize-llm-output.js";

const planBlockTypeSchema = z.preprocess(
  normalizeBlockType,
  z.enum([
    "cab",
    "sightseeing",
    "restaurant",
    "activity",
    "game",
    "free",
    "travel",
  ])
);

export const planTripRequestSchema = z.object({
  destination: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  interests: z.array(z.string()).optional().default([]),
  travelers: z.number().int().positive().optional().default(2),
  pace: z.enum(["relaxed", "moderate", "packed"]).optional().default("moderate"),
});

export type PlanTripRequest = z.infer<typeof planTripRequestSchema>;

// Natural language request schema with optional user profile selection
// Now supports conversational refinement via optional previousPlan field
export const planTripNaturalRequestSchema = z.object({
  prompt: z.string().min(3).max(2000),
  userId: z.string().optional(),  // Optional user ID to select which profile to use
  previousPlan: z.any().optional(),  // Optional plan for refinement - if provided, treats request as modification
});

export type PlanTripNaturalRequest = z.infer<typeof planTripNaturalRequestSchema>;

export const planBlockSchema = z.object({
  start: z.string(),
  end: z.string(),
  type: planBlockTypeSchema,
  title: z.string(),
  partner: z.boolean().optional(),
  provider: z.string().optional(),
  source: z.preprocess(normalizeSource, z.enum(["poi", "partner", "suggested"])).optional(),
  matchedInterest: z.string().optional(),
  notes: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  addFromOurRecommendation: z.preprocess(
    (v) => (typeof v === "boolean" ? v : false),
    z.boolean()
  ),
});

// Added mapLink field to support per-day Google Maps route links
// Generated programmatically (not by AI) to ensure reliability
export const dayPlanSchema = z.object({
  date: z.string(),
  blocks: z.array(planBlockSchema),
  mapLink: z.string().url().optional(), // Per-day map link
});

export const destinationInfoSchema = z.object({
  name: z.string(),
  summary: z.string(),
  timezone: z.string(),
  tips: z.array(z.string()),
});

export const partnerPlacementSchema = z.object({
  service: z.string(),
  category: z.string(),
  count: z.number(),
});

export const tripPlanSchema = z.object({
  destination: destinationInfoSchema,
  startDate: z.string(),
  endDate: z.string(),
  interests: z.array(z.string()),
  days: z.array(dayPlanSchema),
  partnerPlacements: z.array(partnerPlacementSchema),
  plannerMode: z.enum(["mock", "openai"]),
});

export type TripPlan = z.infer<typeof tripPlanSchema>;
export type PlanBlock = z.infer<typeof planBlockSchema>;

export const planTripNaturalResponseSchema = z.object({
  request: planTripRequestSchema,
  plan: tripPlanSchema,
});

export type PlanTripNaturalResponse = z.infer<typeof planTripNaturalResponseSchema>;

// Conversational refinement request schema for iterative plan modifications
// Allows users to refine existing plans with natural language feedback
// Example: "I'll be with my mom, adjust for accessibility" or "Add kid-friendly activities"
// UPDATED: Using z.any() for originalPlan to support new schema format (activities instead of blocks)
// DEPRECATED: Use planTripNaturalRequestSchema with previousPlan field instead for unified endpoint
export const refinePlanRequestSchema = z.object({
  originalPlan: z.any(),  // Full plan object to be refined (new schema format)
  feedback: z.string().min(3).max(1000),  // Natural language modification request
  userId: z.string().optional(),  // Optional user ID to maintain profile context
});

export type RefinePlanRequest = z.infer<typeof refinePlanRequestSchema>;
