import type { PlanTripRequest, TripPlan } from "../schemas/trip-plan.schema.js";
import { tripPlanSchema } from "../schemas/trip-plan.schema.js";
import { parseLlmJson } from "../utils/llm-json.js";
import { normalizeTripPlanFromLlm } from "../utils/normalize-llm-output.js";
import type { CatalogBundle } from "./catalog.service.js";
import { planTripMock } from "./planner.mock.js";

function buildPrompt(input: PlanTripRequest, catalog: CatalogBundle): string {
  return `You are a trip itinerary planner. Reply with a single JSON object only — no markdown fences, no commentary, no trailing commas. Every key and string value must use double quotes.
Schema:
{
  "destination": { "name": string, "summary": string, "timezone": string, "tips": string[] },
  "startDate": string,
  "endDate": string,
  "interests": string[],
  "days": [{ "date": "YYYY-MM-DD", "blocks": [{
    "start": "HH:MM", "end": "HH:MM",
    "type": "cab"|"sightseeing"|"restaurant"|"activity"|"game"|"free"|"travel" (singular only — never "activities" or "restaurants"),
    "title": string, "partner"?: boolean, "provider"?: string,
    "source"?: "poi"|"partner"|"suggested", "matchedInterest"?: string, "notes"?: string,
    "addFromOurRecommendation": boolean
  }]}],
  "partnerPlacements": [{ "service": string, "category": string, "count": number }],
  "plannerMode": "cursor"
}

Rules:
- Trip: ${input.destination}, ${input.startDate} to ${input.endDate}
- Interests: ${input.interests.join(", ") || "general sightseeing"}
- Every block MUST include addFromOurRecommendation (boolean):
  - true ONLY when the block uses a specific item from Cabs, Restaurants, Activities, or Games catalogs below (set partner:true, source:"partner", provider to exact catalog name)
  - false for sightseeing from POIs, free/travel buffers, and any AI-invented or generic suggestions not tied to a catalog partner entry
- Mix partner catalog picks with POI sightseeing and organic free time — do NOT fill the whole day from partner catalogs
- Use ONLY partner names from catalogs below for partner:true blocks
- Include cab transfers, some partner meals, interest-matched POIs, games when relevant
- Time-based schedule 08:30-22:00 with 15-30 min buffers
- Set plannerMode to "cursor"

Destination meta: ${JSON.stringify(catalog.destination)}
POIs: ${JSON.stringify(catalog.pois)}
Cabs: ${JSON.stringify(catalog.cabs)}
Restaurants: ${JSON.stringify(catalog.restaurants)}
Activities: ${JSON.stringify(catalog.activities)}
Games: ${JSON.stringify(catalog.games)}`;
}

export async function planTripCursor(
  input: PlanTripRequest,
  catalog: CatalogBundle
): Promise<TripPlan> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is required when USE_CURSOR_SDK=true");
  }

  try {
    const { Agent } = await import("@cursor/sdk");
    const result = await Agent.prompt(buildPrompt(input, catalog), {
      apiKey,
      model: { id: "gemini-3-flash" },
      local: { cwd: process.cwd() },
    });

    const raw = result.result?.trim();
    if (!raw) {
      throw new Error("Cursor agent returned an empty response");
    }

    const parsed = normalizeTripPlanFromLlm(parseLlmJson(raw));
    const plan = tripPlanSchema.parse(parsed);
    return { ...plan, plannerMode: "cursor" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("[planner.cursor] AI plan invalid or failed, falling back to mock:", detail);
    return planTripMock(input, catalog);
  }
}
