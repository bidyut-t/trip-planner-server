import type { PlanTripRequest } from "../schemas/trip-plan.schema.js";
import { tripSkeletonSchema, type TripSkeleton } from "../schemas/skeleton-plan.schema.js";
import type { DestinationMeta } from "./catalog.service.js";
import { parseLlmJson } from "../utils/llm-json.js";
import { normalizeTripPlanFromLlm } from "../utils/normalize-llm-output.js";
import { runCursorPrompt } from "../utils/cursor-agent.js";

function buildSkeletonPrompt(input: PlanTripRequest, destination: DestinationMeta): string {
  const dayCount =
    Math.round(
      (Date.parse(input.endDate) - Date.parse(input.startDate)) / (24 * 60 * 60 * 1000)
    ) + 1;

  return `You are a trip itinerary planner. Reply with JSON only — no markdown, no commentary.

Build a day-by-day schedule skeleton. Do NOT invent partner brand names; use generic titles (e.g. "Morning fort visit", "Lunch", "City transfer").

Schema:
{
  "days": [{
    "date": "YYYY-MM-DD",
    "blocks": [{
      "start": "HH:MM",
      "end": "HH:MM",
      "type": "cab"|"sightseeing"|"restaurant"|"activity"|"game"|"free"|"travel",
      "title": string,
      "notes"?: string
    }]
  }]
}

Trip:
- Destination: ${destination.name} — ${destination.summary}
- Dates: ${input.startDate} to ${input.endDate} (${dayCount} day(s))
- Interests: ${input.interests.join(", ") || "general sightseeing"}
- Travelers: ${input.travelers}
- Pace: ${input.pace}

Rules:
- One entry per calendar day from ${input.startDate} through ${input.endDate}
- Times between 08:30 and 22:00 with 15–30 min gaps
- Mix sightseeing, meals, transfers, some free time
- Use block types that fit: cab for transfers, restaurant for meals, sightseeing for sights
- Singular type names only (activity, not activities)`;
}

export async function planTripAiSkeleton(
  input: PlanTripRequest,
  destination: DestinationMeta
): Promise<TripSkeleton> {
  const raw = await runCursorPrompt(buildSkeletonPrompt(input, destination));
  const json = parseLlmJson(raw) as Record<string, unknown>;
  const skeletonInput = Array.isArray(json.days) ? { days: json.days } : json;
  return tripSkeletonSchema.parse(normalizeTripPlanFromLlm(skeletonInput));
}
