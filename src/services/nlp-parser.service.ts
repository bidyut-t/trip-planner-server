import type { PlanTripRequest } from "../schemas/trip-plan.schema.js";
import { loadDestinations } from "./catalog.service.js";
import { extractPromptKeywords } from "./nlp-parser.keywords.js";
import { parseTripRequestWithAi } from "./nlp-parser.ai.js";

export async function parseTripRequestFromNaturalLanguage(
  prompt: string
): Promise<PlanTripRequest> {
  const destinations = await loadDestinations();
  const suggestedKeywords = extractPromptKeywords(prompt);
  return parseTripRequestWithAi(prompt, destinations, suggestedKeywords);
}
