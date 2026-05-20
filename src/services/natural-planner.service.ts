import type { PlanTripRequest, TripPlan } from "../schemas/trip-plan.schema.js";
import { planTripRequestSchema } from "../schemas/trip-plan.schema.js";
import { naturalPlanDraftSchema } from "../schemas/skeleton-plan.schema.js";
import { loadCatalog, loadDestinations, type DestinationMeta } from "./catalog.service.js";
import { extractPromptKeywords } from "./nlp-parser.keywords.js";
import { buildTripPlanFromDraft } from "./planner.from-draft.js";
import { planTripMock } from "./planner.mock.js";
import { parseLlmJson } from "../utils/llm-json.js";
import { normalizeTripPlanFromLlm } from "../utils/normalize-llm-output.js";
import { runCursorPrompt } from "../utils/cursor-agent.js";
import { isCatalogMcpEnabled } from "../utils/env.js";
import { buildCatalogMcpPromptBlock } from "../utils/mcp-catalog-prompt.js";
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

  const catalogHint = isCatalogMcpEnabled()
    ? " Before building the schedule, call trip-catalog MCP tools (e.g. get_catalog_bundle or list_restaurants) for the destination. Use exact partner names from those results in titles; set partner=true and provider to the partner name for cab/restaurant/activity/game blocks."
    : "";
  return `Parse the user message and build a complete trip schedule.${catalogHint} Reply with JSON only — no markdown.

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
      "partner"?: boolean,
      "provider"?: string,
      "source"?: "poi"|"partner"|"suggested",
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
${isCatalogMcpEnabled() ? buildCatalogMcpPromptBlock() : ""}

User message:
${prompt}`;
}

/**
 * Natural language: ONE AI call (parse + plan). Catalog partner data via MCP tools, not local enrich.
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

    const { days: _days, ...requestFields } = draft;
    const request = planTripRequestSchema.parse(requestFields);
    const plan = await buildTripPlanFromDraft(draft, request);

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
