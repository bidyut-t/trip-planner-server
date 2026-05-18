import { z } from "zod";

export const planTripRequestSchema = z.object({
  destination: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  interests: z.array(z.string()).optional().default([]),
  travelers: z.number().int().positive().optional().default(2),
  pace: z.enum(["relaxed", "moderate", "packed"]).optional().default("moderate"),
});

export type PlanTripRequest = z.infer<typeof planTripRequestSchema>;

export const planBlockSchema = z.object({
  start: z.string(),
  end: z.string(),
  type: z.enum([
    "cab",
    "sightseeing",
    "restaurant",
    "activity",
    "game",
    "free",
    "travel",
  ]),
  title: z.string(),
  partner: z.boolean().optional(),
  provider: z.string().optional(),
  source: z.enum(["poi", "partner", "suggested"]).optional(),
  matchedInterest: z.string().optional(),
  notes: z.string().optional(),
  addFromOurRecommendation: z.boolean(),
});

export const dayPlanSchema = z.object({
  date: z.string(),
  blocks: z.array(planBlockSchema),
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
  plannerMode: z.enum(["mock", "cursor"]),
});

export type TripPlan = z.infer<typeof tripPlanSchema>;
export type PlanBlock = z.infer<typeof planBlockSchema>;
