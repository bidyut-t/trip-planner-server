import type { PlanTripRequest } from "../schemas/trip-plan.schema.js";
import { tripSkeletonSchema, type TripSkeleton } from "../schemas/skeleton-plan.schema.js";
import type { DestinationMeta } from "./catalog.service.js";
import { parseLlmJson } from "../utils/llm-json.js";
import { normalizeTripPlanFromLlm } from "../utils/normalize-llm-output.js";
import { runCursorPrompt } from "../utils/cursor-agent.js";
import { isCatalogMcpEnabled } from "../utils/env.js";
import { buildCatalogMcpPromptBlock } from "../utils/mcp-catalog-prompt.js";
import { buildScheduleRulesBlock } from "./planner.schedule-rules.js";

function buildSkeletonPrompt(input: PlanTripRequest, destination: DestinationMeta): string {
  const dayCount =
    Math.round(
      (Date.parse(input.endDate) - Date.parse(input.startDate)) / (24 * 60 * 60 * 1000)
    ) + 1;

  return `You are a trip itinerary planner. Reply with JSON only — no markdown, no commentary.

Build a day-by-day schedule skeleton.${isCatalogMcpEnabled() ? " Use MCP catalog tools for real partner names when scheduling cabs, restaurants, activities, or games." : ' Do NOT invent partner brand names; use generic titles (e.g. "Morning fort visit", "Lunch", "City transfer").'}

Schema:
{
  "days": [{
    "date": "YYYY-MM-DD",
    "blocks": [{
      "start": "HH:MM",
      "end": "HH:MM",
      "type": "cab"|"sightseeing"|"restaurant"|"activity"|"game"|"free"|"travel",
      "title": string,
      "notes"?: string,
      "latitude"?: number,
      "longitude"?: number
    }]
  }]
}

Trip:
- Destination: ${destination.name} — ${destination.summary}
- Dates: ${input.startDate} to ${input.endDate} (${dayCount} day(s))
- Interests: ${input.interests.join(", ") || "general sightseeing"}
- Travelers: ${input.travelers}
- Pace: ${input.pace}

${buildScheduleRulesBlock({ includeBlockSchema: true })}
${isCatalogMcpEnabled() ? buildCatalogMcpPromptBlock() : ""}`;
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
