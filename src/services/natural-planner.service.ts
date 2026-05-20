import type { PlanTripRequest, TripPlan } from "../schemas/trip-plan.schema.js";
import { planTripRequestSchema } from "../schemas/trip-plan.schema.js";
import { naturalPlanDraftSchema } from "../schemas/skeleton-plan.schema.js";
import { loadCatalog, loadDestinations, type DestinationMeta } from "./catalog.service.js";
import { extractPromptKeywords } from "./nlp-parser.keywords.js";
import { enrichSkeletonWithCatalog } from "./planner.catalog-enrich.js";
import { planTripMock } from "./planner.mock.js";
import { parseLlmJson } from "../utils/llm-json.js";
import { normalizeTripPlanFromLlm } from "../utils/normalize-llm-output.js";
import { runCursorPrompt } from "../utils/cursor-agent.js";
import { buildScheduleRulesBlock } from "./planner.schedule-rules.js";

function buildNaturalPlanPrompt(
  prompt: string,
  destinations: DestinationMeta[],
  suggestedKeywords: string[]
): string {
  const today = new Date().toISOString().slice(0, 10);
  const destList = destinations.map((d) => `- ${d.name} (key: ${d.key})`).join("\n");
  const keywordHint =
    suggestedKeywords.length > 0 ? suggestedKeywords.join(", ") : "(none)";

  return `Parse the user message and build a trip schedule skeleton. Reply with JSON only — no markdown.

Schema:
{
  "destination": string,
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "interests": string[],
  "travelers": number,
  "pace": "relaxed"|"moderate"|"packed",
  "days": [{
    "date": "YYYY-MM-DD",
    "blocks": [{
      "start": "HH:MM", "end": "HH:MM",
      "type": "cab"|"sightseeing"|"restaurant"|"activity"|"game"|"free"|"travel",
      "title": string,
      "notes"?: string,
      "latitude"?: number,
      "longitude"?: number
    }]
  }]
}

Infer destination, dates (today is ${today}), travelers, pace, and interests from the message.
Keyword hints: ${keywordHint}

${buildScheduleRulesBlock({ includeBlockSchema: true })}

Supported destinations:
${destList}

User message:
${prompt}`;
}

/**
 * Natural language: ONE AI call (parse + skeleton) → local catalog enrich.
 * Replaces the old two-call parse-then-huge-catalog-plan flow.
 */
export async function planFromNaturalLanguage(
  prompt: string
): Promise<{ request: PlanTripRequest; plan: TripPlan }> {
  const destinations = await loadDestinations();
  const suggestedKeywords = extractPromptKeywords(prompt);

  try {
    const raw = await runCursorPrompt(
      buildNaturalPlanPrompt(prompt, destinations, suggestedKeywords)
    );
    const draft = naturalPlanDraftSchema.parse(
      normalizeTripPlanFromLlm(parseLlmJson(raw))
    );

    const { days, ...requestFields } = draft;
    const request = planTripRequestSchema.parse(requestFields);
    const catalog = await loadCatalog(request.destination);
    const plan = enrichSkeletonWithCatalog({ days }, request, catalog);

    return { request, plan };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("[natural-planner] AI failed, falling back to mock:", detail);

    const lower = prompt.toLowerCase();
    const dest =
      destinations.find(
        (d) => lower.includes(d.key) || lower.includes(d.name.toLowerCase())
      ) ?? destinations[0];

    const request = planTripRequestSchema.parse({
      destination: dest.name,
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
      interests: suggestedKeywords,
      travelers: 2,
      pace: "moderate",
    });
    const catalog = await loadCatalog(request.destination);
    return { request, plan: planTripMock(request, catalog) };
  }
}
