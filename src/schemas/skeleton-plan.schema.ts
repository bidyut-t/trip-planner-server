import { z } from "zod";
import { normalizeBlockType } from "../utils/normalize-llm-output.js";

const skeletonBlockTypeSchema = z.preprocess(
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

export const skeletonBlockSchema = z.object({
  start: z.string(),
  end: z.string(),
  type: skeletonBlockTypeSchema,
  title: z.string(),
  notes: z.string().optional(),
});

export const skeletonDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  blocks: z.array(skeletonBlockSchema),
});

export const tripSkeletonSchema = z.object({
  days: z.array(skeletonDaySchema),
});

export type SkeletonBlock = z.infer<typeof skeletonBlockSchema>;
export type SkeletonDay = z.infer<typeof skeletonDaySchema>;
export type TripSkeleton = z.infer<typeof tripSkeletonSchema>;

/** Single AI response for /plan/natural: structured request + day skeleton. */
export const naturalPlanDraftSchema = z.object({
  destination: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  interests: z.array(z.string()).optional().default([]),
  travelers: z.number().int().positive().optional().default(2),
  pace: z.enum(["relaxed", "moderate", "packed"]).optional().default("moderate"),
  days: z.array(skeletonDaySchema),
});

export type NaturalPlanDraft = z.infer<typeof naturalPlanDraftSchema>;
