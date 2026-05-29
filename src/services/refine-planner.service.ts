import type { TripPlan } from "../schemas/trip-plan.schema.js";
import type { UserProfile } from "../schemas/user-profile.schema.js";
import { naturalPlanDraftSchema } from "../schemas/skeleton-plan.schema.js";
import { loadDestinations, type DestinationMeta } from "./catalog/catalog.service.js";
import { buildTripPlanFromDraft } from "./planner.from-draft.js";
import { parseLlmJson } from "../utils/llm-json.js";
import { normalizeTripPlanFromLlm } from "../utils/normalize-llm-output.js";
import { runOpenAiPrompt } from "../utils/openai-mcp-agent.js";
import { isCatalogMcpEnabled } from "../utils/env.js";
import { buildCatalogMcpPromptBlock } from "../utils/mcp-catalog-prompt.js";
import { buildScheduleRulesBlock } from "./prompts/planner.schedule-rules.js";
import { addMapLinksToTripPlan } from "../utils/google-maps.js";
import { mergeRefinedPlanWithOriginal } from "../utils/plan-merger.js";
import { loadUserProfiles } from "./catalog/catalog.service.js";

/**
 * Conversational Plan Refinement Feature (CodeFest)
 * 
 * Build the AI prompt for refining an existing trip plan based on user feedback.
 * This enables iterative, conversational modifications where users can:
 * - Adjust for companions ("I'll be with my mom who gets tired easily")
 * - Add new requirements ("Add kid-friendly activities")
 * - Change pace or intensity ("Make day 2 more relaxed")
 * - Modify dietary/accessibility needs dynamically
 * 
 * The prompt shows the AI the original plan and asks for modifications while:
 * - Preserving the destination, dates, and overall structure
 * - Maintaining user profile constraints (if provided)
 * - Keeping partner placements where possible
 * - Respecting MCP tool calling patterns for partner data
 * 
 * @param originalPlan - The existing trip plan to be refined
 * @param feedback - Natural language modification request from user
 * @param destinations - Available destinations for validation
 * @param userProfile - Optional user profile for maintained personalization
 * @returns Complete prompt string for AI with original plan context and refinement instructions
 */
function buildRefinementPrompt(
  originalPlan: TripPlan,
  feedback: string,
  destinations: DestinationMeta[],
  userProfile?: UserProfile,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const destList = destinations
    .map((d) => `- ${d.name} (key: ${d.key})`)
    .join("\n");

  const catalogHint = isCatalogMcpEnabled()
    ? " IMPORTANT: You MUST call trip-catalog MCP tools (get_catalog_bundle, list_restaurants, list_cabs, list_activities, list_games) FIRST to get real partner data for the destination. Use ONLY the exact partner names from the MCP tool results in the 'provider' field. For any block using a partner from MCP results: set partner=true, provider=<exact partner name>, source=\"partner\", and addFromOurRecommendation=true. For non-partner suggestions: set partner=false, source=\"suggested\", and addFromOurRecommendation=false. NEVER invent partner names."
    : "";

  // User Profile Personalization Integration (same as initial planning)
  // Maintains profile context across refinements (dietary, accessibility, budget, style)
  // Even when feedback adds new constraints, original profile constraints remain
  const profileContext = userProfile ? `

USER PROFILE - IMPORTANT: Maintain these preferences while applying feedback for ${userProfile.name} (Bonvoy Member: ${userProfile.bonvoyMemberNumber}):
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

  // Serialize original plan for AI context
  // AI needs to see the full current plan to make informed modifications
  const originalPlanJson = JSON.stringify(originalPlan, null, 2);

  return `You are refining an existing trip plan based on user feedback.

CRITICAL REQUIREMENT - READ THIS FIRST:
You MUST call trip-catalog MCP tools (get_catalog_bundle, list_restaurants, list_cabs, list_activities, list_games) to get real Marriott Bonvoy partner data for this destination. 
- For EVERY activity/restaurant block (both existing and new), you need: exact provider name, price, rating, earnPoints, images, bookingUrl, etc.
- Call MCP tools at the START before generating your response
- Use ONLY exact partner names from MCP tool results
- If a block has partner=true: it MUST have price, earnPoints, bookingUrl, and all other partner fields
${profileContext}

ORIGINAL PLAN (Current state):
${originalPlanJson}

USER FEEDBACK (What to change):
"${feedback}"

INSTRUCTIONS FOR REFINEMENT:
1. Keep the same destination, dates, and overall trip structure
2. Modify activities, restaurants, timing, and schedule based on the feedback
3. Maintain user profile constraints (dietary, accessibility, budget, travel style)
4. Preserve partner placements where possible (unless feedback contradicts them)
5. If feedback adds new constraints (e.g., "with elderly mom"), apply them throughout the plan
6. If feedback contradicts profile (e.g., vegan user asks for steakhouse), prioritize the feedback

CRITICAL DATA PRESERVATION RULES - MUST FOLLOW:
7. For activities you keep from the original plan: COPY ALL their fields EXACTLY (price, rating, earnPoints, bookingUrl, images, highlights, etc.)
8. NEVER output price=0, earnPoints=0, or empty images[] for activities that had data in the original plan
9. If an activity had price=$50 and earnPoints=200 in the original, keep those EXACT values
10. For new activities you add, use MCP tools to get full partner data with all fields
11. Output the COMPLETE refined plan in the same JSON format as the original
12. Double-check: every activity should have realistic prices, points, and images - if you see zeros, you did it wrong!

Reply with JSON only — no markdown.

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
      "longitude"?: number,
      "price"?: number,
      "currency"?: string,
      "rating"?: number,
      "reviews"?: number,
      "earnPoints"?: number,
      "duration"?: string,
      "bookingUrl"?: string,
      "images"?: string[],
      "highlights"?: string[],
      "availability"?: string,
      "cancellationPolicy"?: string
    }]
  }]
}

CRITICAL: When including partner activities from MCP tools, ALWAYS include all available fields: price, rating, reviews, earnPoints, duration, bookingUrl, images, highlights, availability, cancellationPolicy. These fields are essential for the user experience.

IMPORTANT RULES:
- type must EXACTLY match one of: "cab", "sightseeing", "restaurant", "activity", "game", "free", "travel"
- For shopping/markets, use type="activity"
- For museums/monuments, use type="sightseeing"  
- Always use exact dates from original plan, not relative dates
- For partner blocks: set partner=true, provider=exact name from MCP data, source="partner", addFromOurRecommendation=true
- For non-partner blocks: set partner=false, source="suggested", addFromOurRecommendation=false

${buildScheduleRulesBlock({ includeBlockSchema: true })}

Supported destinations:
${destList}
${isCatalogMcpEnabled() ? buildCatalogMcpPromptBlock() : ""}

Today's date: ${today}

User feedback:
${feedback}`;
}

/**
 * Conversational Plan Refinement (CodeFest Feature)
 * 
 * Main orchestration function for refining an existing trip plan based on user feedback.
 * Enables multi-turn conversational modifications where users can iteratively improve plans.
 * 
 * Flow:
 * 1. Load user profile (if userId provided) to maintain personalization
 * 2. Build refinement prompt with original plan + feedback + profile context
 * 3. Call AI to generate refined plan
 * 4. Parse and validate the refined plan
 * 5. Handle map link generation (if user requests it via keywords)
 * 
 * Example use cases:
 * - "I'll be with my elderly mom, adjust for accessibility"
 * - "Add more food experiences and restaurants"
 * - "Make day 2 more relaxed with fewer activities"
 * - "Remove the fort visit, add kid-friendly activities"
 * 
 * @param originalPlan - The existing trip plan to be refined
 * @param feedback - Natural language modification request
 * @param userId - Optional user ID to maintain profile context across refinements
 * @returns Refined trip plan incorporating the feedback
 */
export async function refinePlanFromFeedback(
  originalPlan: TripPlan,
  feedback: string,
  userId?: string,
): Promise<TripPlan> {
  const destinations = await loadDestinations();

  // Load user profile if userId is explicitly provided
  // This maintains profile context across refinements (same behavior as initial planning)
  let userProfile: UserProfile | undefined;
  if (userId) {
    const userProfiles = await loadUserProfiles();
    userProfile = userProfiles.find(p => p.id === userId);
  }

  // Keyword detection for map link generation
  // Check if user wants map links in the refined plan (only generates if explicitly requested)
  const lowerFeedback = feedback.toLowerCase();
  const userWantsMap = lowerFeedback.includes("map") || 
                       lowerFeedback.includes("link") || 
                       lowerFeedback.includes("route") ||
                       lowerFeedback.includes("directions") ||
                       lowerFeedback.includes("google maps");

  try {
    const refinementPrompt = buildRefinementPrompt(
      originalPlan,
      feedback,
      destinations,
      userProfile,
    );

    const raw = await runOpenAiPrompt(refinementPrompt);
    const draft = naturalPlanDraftSchema.parse(
      normalizeTripPlanFromLlm(parseLlmJson(raw)),
    );

    const { days: _days, ...requestFields } = draft;
    const request = {
      destination: requestFields.destination,
      startDate: requestFields.startDate,
      endDate: requestFields.endDate,
      interests: requestFields.interests,
      travelers: requestFields.travelers,
      pace: requestFields.pace,
    };

    let refinedPlan = await buildTripPlanFromDraft(draft, request);

    // Merge original data back into refined plan to ensure data integrity
    // Problem: AI sometimes simplifies JSON during refinement, losing prices/points/images
    // Solution: Programmatically copy ALL data from matching original activities
    // This ensures zero data loss - code guarantees what AI prompts cannot
    refinedPlan = mergeRefinedPlanWithOriginal(originalPlan, refinedPlan);

    // Programmatic map link generation (same as initial planning)
    // Add clean Google Maps links to each day if user requested them
    // Filters out cab blocks and duplicates to avoid messy looped routes
    refinedPlan = addMapLinksToTripPlan(refinedPlan, userWantsMap);

    return refinedPlan;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("[refine-planner] AI refinement failed:", detail);
    throw new Error(`Failed to refine plan: ${detail}`);
  }
}
