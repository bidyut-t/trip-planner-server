import type { PlanTripRequest, TripPlan } from "../schemas/trip-plan.schema.js";
import { planTripRequestSchema } from "../schemas/trip-plan.schema.js";
import { naturalPlanDraftSchema } from "../schemas/skeleton-plan.schema.js";
import type { UserProfile } from "../schemas/user-profile.schema.js";
import {
  loadCatalog,
  loadDestinations,
  type DestinationMeta,
} from "./catalog/catalog.service.js";
import { extractPromptKeywords } from "./nlp/nlp-parser.keywords.js";
import { buildTripPlanFromDraft } from "./planner.from-draft.js";
import { planTripMock } from "./planner.mock.js";
import { parseLlmJson } from "../utils/llm-json.js";
import { normalizeTripPlanFromLlm } from "../utils/normalize-llm-output.js";
import { runOpenAiPrompt } from "../utils/openai-mcp-agent.js";
import { isCatalogMcpEnabled } from "../utils/env.js";
import { buildCatalogMcpPromptBlock } from "../utils/mcp-catalog-prompt.js";
import { buildScheduleRulesBlock } from "./prompts/planner.schedule-rules.js";
import { addMapLinksToTripPlan } from "../utils/google-maps.js";
import { loadUserProfiles } from "./catalog/catalog.service.js";

/**
 * ARIA: Build the AI prompt for natural language trip planning with optional personalization
 * 
 * Constructs the complete prompt sent to the AI, including:
 * - Available destinations and keywords
 * - MCP tool calling instructions (if enabled)
 * - User profile personalization context (if provided)
 * - JSON schema and formatting rules
 * 
 * When a userProfile is provided, the AI receives detailed constraints about:
 * - Dietary restrictions (vegetarian, vegan, gluten-free, etc.)
 * - Accessibility needs (wheelchair accessible, hearing impaired, etc.)
 * - Budget level (budget, moderate, luxury)
 * - Travel style (adventure, relaxation, cultural, foodie, mixed)
 * - Preferences (avoid crowds, local experiences, fitness level)
 * 
 * @param prompt - User's natural language request
 * @param destinations - Available destinations
 * @param suggestedKeywords - Keywords extracted from prompt
 * @param userProfile - Optional user profile for personalized planning
 * @returns Complete prompt string for AI with all context and instructions
 * @author Aria
 */
function buildNaturalPlanPrompt(
  prompt: string,
  destinations: DestinationMeta[],
  suggestedKeywords: string[],
  userProfile?: UserProfile,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const destList = destinations
    .map((d) => `- ${d.name} (key: ${d.key})`)
    .join("\n");
  const keywordHint =
    suggestedKeywords.length > 0 ? suggestedKeywords.join(", ") : "(none)";

  const catalogHint = isCatalogMcpEnabled()
    ? " IMPORTANT: You MUST call trip-catalog MCP tools (get_catalog_bundle, list_restaurants, list_cabs, list_activities, list_games) FIRST to get real partner data for the destination. Use ONLY the exact partner names from the MCP tool results in the 'provider' field. For any block using a partner from MCP results: set partner=true, provider=<exact partner name>, source=\"partner\", and addFromOurRecommendation=true. For non-partner suggestions: set partner=false, source=\"suggested\", and addFromOurRecommendation=false. NEVER invent partner names."
    : "";

  // ARIA: User Profile Personalization Integration
  // If a user profile is provided, inject it into the AI prompt with strong constraints.
  // This makes the AI consider dietary restrictions, accessibility, budget, travel style,
  // and preferences (crowds, local experiences, fitness level) when generating the plan.
  // The AI will filter restaurants by dietary needs, match activities to fitness level,
  // and respect budget constraints when selecting partners and experiences.
  const profileContext = userProfile ? `

USER PROFILE - IMPORTANT: Consider these preferences when planning for ${userProfile.name} (Bonvoy Member: ${userProfile.bonvoyMemberNumber}):
- Dietary Restrictions: ${userProfile.dietaryRestrictions.length > 0 ? userProfile.dietaryRestrictions.join(", ") : "None"}
- Accessibility Needs: ${userProfile.accessibilityNeeds.length > 0 ? userProfile.accessibilityNeeds.join(", ") : "None"}
- Budget Level: ${userProfile.budgetLevel}
- Travel Style: ${userProfile.travelStyle}
- Avoid Crowds: ${userProfile.preferences.avoidCrowds ? "Yes" : "No"}
- Prefer Local Experiences: ${userProfile.preferences.preferLocalExperiences ? "Yes" : "No"}
- Fitness Level: ${userProfile.preferences.fitnessLevel}

CRITICAL INSTRUCTIONS:
- For restaurants: ONLY suggest places that accommodate the dietary restrictions above
- For activities: Ensure all activities match the fitness level and accessibility needs
- Match the budget level when selecting partners and activities
- Respect the travel style (${userProfile.travelStyle}) when building the itinerary
- If avoiding crowds, prefer early morning or late evening activities
` : "";

  return `Parse the user message and build a complete trip schedule.${catalogHint}${profileContext} Reply with JSON only — no markdown.

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
      "addFromOurRecommendation"?: boolean,
      "notes"?: string,
      "latitude"?: number,
      "longitude"?: number
    }]
  }]
}

IMPORTANT RULES:
- type must EXACTLY match one of: "cab", "sightseeing", "restaurant", "activity", "game", "free", "travel"
- For shopping/markets, use type="activity"
- For museums/monuments, use type="sightseeing"  
- Always use exact dates from user request, not relative dates
- For partner blocks: set partner=true, provider=exact name from MCP data, source="partner", addFromOurRecommendation=true
- For non-partner blocks: set partner=false, source="suggested", addFromOurRecommendation=false

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
 * 
 * ARIA: Enhanced with keyword detection and programmatic map link generation.
 * Detects if user wants map links (keywords: map, link, route, directions, google maps).
 * AI generates coordinates, then custom utility function builds clean per-day URLs.
 * 
 * ARIA: Enhanced with user profile personalization (Feature 2 - CodeFest).
 * When a userId is provided, loads the corresponding user profile from data/user-profiles.json
 * and injects it into the AI prompt for personalized trip planning. The AI will:
 * - Filter restaurants by dietary restrictions (vegetarian, vegan, gluten-free, etc.)
 * - Match activities to fitness level and accessibility needs
 * - Respect budget level when selecting partners and activities
 * - Align itinerary with travel style (adventure, relaxation, cultural, foodie, mixed)
 * - Consider preferences (avoid crowds, prefer local experiences)
 * 
 * If no userId is provided, generates a generic (non-personalized) trip plan.
 * 
 * @param prompt - User's natural language request
 * @param userId - Optional user ID to select specific profile (no profile applied if omitted)
 * @returns Trip request and personalized plan (or generic plan if no userId)
 * @author Aria (Map Links + User Profiles)
 */
export async function planFromNaturalLanguage(
  prompt: string,
  userId?: string,
): Promise<{ request: PlanTripRequest; plan: TripPlan }> {
  const destinations = await loadDestinations();
  const suggestedKeywords = extractPromptKeywords(prompt);

  // ARIA: Load user profile ONLY if userId is explicitly provided
  // No profile personalization applied by default - keeps plans generic
  // In production, this would be based on authenticated user session
  let userProfile: UserProfile | undefined;
  if (userId) {
    const userProfiles = await loadUserProfiles();
    userProfile = userProfiles.find(p => p.id === userId);
  }

  // ARIA: Keyword detection for map link generation
  // Check if user wants map links (only generates if explicitly requested)
  const lowerPrompt = prompt.toLowerCase();
  const userWantsMap = lowerPrompt.includes("map") || 
                       lowerPrompt.includes("link") || 
                       lowerPrompt.includes("route") ||
                       lowerPrompt.includes("directions") ||
                       lowerPrompt.includes("google maps");

  try {
    const naturalPlanPrompt = buildNaturalPlanPrompt(
      prompt,
      destinations,
      suggestedKeywords,
      userProfile,  // ARIA: Pass user profile for personalized planning
    );
    const raw = await runOpenAiPrompt(naturalPlanPrompt);
    const draft = naturalPlanDraftSchema.parse(
      normalizeTripPlanFromLlm(parseLlmJson(raw)),
    );

    const { days: _days, ...requestFields } = draft;
    const request = planTripRequestSchema.parse(requestFields);
    let plan = await buildTripPlanFromDraft(draft, request);

    // ARIA: Programmatic map link generation
    // Add clean Google Maps links to each day if user requested them
    // Filters out cab blocks and duplicates to avoid messy looped routes
    plan = addMapLinksToTripPlan(plan, userWantsMap);

    return { request, plan };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("[natural-planner] AI failed, falling back to mock:", detail);

    const lower = prompt.toLowerCase();
    const dest =
      destinations.find(
        (d) => lower.includes(d.key) || lower.includes(d.name.toLowerCase()),
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
