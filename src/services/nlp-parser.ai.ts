import type { PlanTripRequest } from "../schemas/trip-plan.schema.js";
import { planTripRequestSchema } from "../schemas/trip-plan.schema.js";
import { parseLlmJson } from "../utils/llm-json.js";
import type { DestinationMeta } from "./catalog.service.js";

function buildParsePrompt(
  prompt: string,
  destinations: DestinationMeta[],
  suggestedKeywords: string[]
): string {
  const today = new Date().toISOString().slice(0, 10);
  const destList = destinations.map((d) => `- ${d.name} (key: ${d.key})`).join("\n");
  const keywordHint =
    suggestedKeywords.length > 0
      ? suggestedKeywords.join(", ")
      : "(none detected — infer from context)";

  return `Extract structured trip planning fields from the user message. Reply with a single JSON object only — no markdown fences, no commentary.

Schema:
{
  "destination": string,
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "interests": string[],
  "travelers": number,
  "pace": "relaxed" | "moderate" | "packed"
}

You must infer from the user message:
- destination (match supported list when possible)
- startDate and endDate (resolve relative dates like "next Friday", "for 3 days starting June 10"; today is ${today})
- travelers (e.g. "family of 4", "couple", "solo" → 1)
- pace when mentioned (relaxed | moderate | packed)
- interests: travel-relevant topics; use suggested keywords below where they fit

Suggested keywords (from keyword-extractor, not stopwords): ${keywordHint}

Rules:
- Trip length cannot exceed 14 days; endDate must be on or after startDate
- Default travelers to 2 and pace to moderate when not specified
- interests: lowercase short tags (e.g. history, food, photography)

Supported destinations:
${destList}

User message:
${prompt}`;
}

export async function parseTripRequestWithAi(
  prompt: string,
  destinations: DestinationMeta[],
  suggestedKeywords: string[]
): Promise<PlanTripRequest> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error(
      "CURSOR_API_KEY is required for natural language planning. Set it in .env (see .env.example)."
    );
  }

  const { Agent } = await import("@cursor/sdk");
  const result = await Agent.prompt(
    buildParsePrompt(prompt, destinations, suggestedKeywords),
    {
      apiKey,
      model: { id: "composer-2" },
      local: { cwd: process.cwd() },
    }
  );

  const raw = result.result?.trim();
  if (!raw) {
    throw new Error("AI parser returned an empty response");
  }

  const parsed = parseLlmJson(raw);
  return planTripRequestSchema.parse(parsed);
}
