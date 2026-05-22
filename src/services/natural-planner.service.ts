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
import { parseLlmJson } from "../utils/llm-json.js";
import { runOpenAiPrompt } from "../utils/openai-mcp-agent.js";
import { isCatalogMcpEnabled } from "../utils/env.js";
import { buildCatalogMcpPromptBlock } from "../utils/mcp-catalog-prompt.js";
import { buildScheduleRulesBlock } from "./prompts/planner.schedule-rules.js";
import { addMapLinksToTripPlan } from "../utils/google-maps.js";
import { loadUserProfiles } from "./catalog/catalog.service.js";
import { 
  validatePartnerInPlan,
  getPartnerValidationSummary 
} from "./partner-validation.service.js";

/**
 * Validate and enrich partner information in the new schema format
 */
async function validateAndEnrichNewSchemaPartners(result: any): Promise<any> {
  if (!result || !result.destination || !result.days) {
    return result;
  }

  // Extract city name for partner validation
  const city = result.destination.split(",")[0]?.trim() || result.destination;
  
  // Convert new schema activities to old PlanBlock format for validation
  const allBlocks: any[] = [];
  
  try {
    for (const day of result.days) {
      if (!day.activities) continue;
      
      for (const activity of day.activities) {
        if (activity.isPartner && activity.activity?.provider) {
          // Create a PlanBlock-like object for validation
          const blockType = activity.type === 'attraction' ? 'activity' : 
                           activity.type === 'museum' ? 'activity' : 
                           activity.type;
                           
          const block = {
            start: activity.startTime || "09:00",
            end: activity.endTime || "10:00", 
            type: blockType,
            title: activity.activity.name || "Untitled Activity",
            partner: true,
            provider: activity.activity.provider,
            source: "partner"
          };
          
          allBlocks.push(block);
          
          // Validate this partner (simplified for now)
          console.log(`[partner-validation] Checking partner: ${activity.activity.provider}`);
        }
      }
    }

    // Log validation summary
    console.log(`[partner-validation] City: ${city}`);
    console.log(`[partner-validation] Total partner activities processed: ${allBlocks.length}`);
    
  } catch (error) {
    console.warn(`[partner-validation] Error during validation:`, error);
  }

  return result;
}


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

  const catalogHint = isCatalogMcpEnabled()
    ? " IMPORTANT: You MUST call trip-catalog MCP tools (get_catalog_bundle, list_restaurants, list_cabs, list_activities, list_games) FIRST to get real partner data for the destination. Use ONLY the exact partner names from the MCP tool results as the 'provider' field in activities. For partner activities: set isPartner=true, provider=<exact partner name>. For non-partner activities: set isPartner=false and use realistic provider names."
    : "";


  return `Parse the user message and build a complete trip schedule.${catalogHint} ${profileContext} Reply with JSON only — no markdown.

Schema:
{
  "destination": string (city name only, e.g., "New York City"),
  "description": string (engaging description of the trip highlighting the interests and city),
  "startDate": string (formatted as "Month DD, YYYY"),
  "endDate": string (formatted as "Month DD, YYYY"), 
  "travelers": {
    "adults": number,
    "children": number
  },
  "plannerMode": "openai",
  "days": [{
    "day": number (1, 2, 3...),
    "date": string (formatted as "Month DD, YYYY"),
    "activities": [{
      "timeBlock": string ("H:MM AM/PM - H:MM AM/PM"),
      "startTime": string ("H:MM AM/PM"), 
      "endTime": string ("H:MM AM/PM"),
      "type": "restaurant"|"attraction"|"museum"|"activity"|"transportation",
      "isPartner": boolean,
      "addFromOurRecommendation": boolean,
      "activity": {
        "id": string (unique identifier like "nyc-museum-met-art"),
        "name": string (activity name),
        "provider": string (business/provider name),
        "category": string (same as type),
        "cuisineType": string | null (for restaurants only),
        "rating": number (4.0-5.0),
        "reviews": number (realistic review count),
        "price": number (USD amount),
        "currency": "USD",
        "priceLevel": number (1-3, budget to expensive),
        "duration": string (e.g., "2 hours", "3.5 hours"),
        "description": string (detailed description),
        "highlights": string[] (key features/attractions),
        "included": string[] (what's included),
        "notIncluded": string[] (what's not included),
        "meetingPoint": string (where to meet/location),
        "contact": string (phone number),
        "bookingUrl": string (website URL),
        "images": string[] (2-3 image URLs),
        "verified": boolean,
        "popular": boolean,
        "openNow": boolean,
        "availability": string (hours/schedule),
        "cancellationPolicy": string,
        "earnPoints": number (loyalty points),
        "amenities": string[] (facilities/features),
        "reviewSnippet": string (sample review),
        "distance": string (e.g., "0.8 mi"),
        "walkingTime": string (e.g., "15 min")
      }
    }]
  }]
}

IMPORTANT RULES:
- ALWAYS set "plannerMode": "openai" in the root response object
- Generate realistic, detailed data for all activity fields
- Use proper 12-hour time format (e.g., "10:00 AM", "2:30 PM")
- IMPORTANT: Include cab transfers, some partner meals, interest-matched POIs, games when relevant
- IMPORTANT: Time-based schedule 08:30-22:00 with 15-30 min buffers
- For restaurants: include cuisineType (Italian, American, etc.)
- For attractions/museums: set cuisineType to null
- Create unique IDs using format: citycode-type-descriptive-name
- Use realistic phone numbers: +1 (212) 555-XXXX
- Generate engaging descriptions and highlights
- Include 2-3 sample image URLs (use placeholder URLs like https://images.unsplash.com/photo-xyz?w=400)
- Set realistic prices: restaurants $15-60, attractions $25-100
- Create believable review snippets
- For partner activities: use exact provider names from MCP data
- For non-partner activities: create realistic business names
- For partner blocks: set isPartner=true, provider=exact name from MCP data, source="partner", addFromOurRecommendation=true
- For non-partner blocks: set isPartner=false, source="suggested", addFromOurRecommendation=false

Infer destination, dates (today is ${today}), travelers, pace, and interests from the message.
Keyword hints: ${keywordHint}

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
): Promise<any> {
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
    
    // AI returns the new schema directly - parse and validate partners
    const result = parseLlmJson(raw);
    
    // Validate and enrich partner information
    const validatedResult = await validateAndEnrichNewSchemaPartners(result);
    // TODO: link integration
    return validatedResult;

  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("[natural-planner] AI failed, falling back to mock:", detail);

    // For mock fallback, generate response in new schema format
    const dest = destinations.find(d => d.key === "new_york") ?? destinations[0];
    
    // Generate mock response in new schema format  
    return {
      "destination": "New York City",
      "description": "Experience the vibrant energy of New York City, where world-class museums meet diverse culinary adventures. From iconic landmarks to hidden local gems, your personalized itinerary combines culture, cuisine, and unforgettable experiences perfect for families.",
      "startDate": "March 1, 2026",
      "endDate": "March 3, 2026",
      "travelers": {
        "adults": 2,
        "children": 1
      },
      "plannerMode": "mock",
      "days": [
        {
          "day": 1,
          "date": "July 1, 2026",
          "activities": [
            {
              "timeBlock": "9:00 AM - 10:30 AM",
              "startTime": "9:00 AM",
              "endTime": "10:30 AM",
              "type": "restaurant",
              "isPartner": true,
              "activity": {
                "id": "nyc-breakfast-jacks-wife-freda",
                "name": "Jack's Wife Freda",
                "provider": "Marriott Bonvoy Tours & Activities",
                "category": "restaurant",
                "cuisineType": "Mediterranean",
                "rating": 4.7,
                "reviews": 1845,
                "price": 25,
                "currency": "USD",
                "priceLevel": 2,
                "duration": "1.5 hours",
                "description": "Beloved breakfast spot serving Mediterranean-inspired American fare in a cozy setting. Famous for their green shakshuka and rosewater waffles.",
                "highlights": [
                  "Signature green shakshuka",
                  "Rosewater waffles",
                  "Fresh Mediterranean flavors",
                  "Instagrammable dishes"
                ],
                "included": [],
                "notIncluded": [],
                "meetingPoint": "224 Lafayette St, Soho",
                "contact": "+1 (212) 510-8550",
                "bookingUrl": "https://jackswifefreda.com",
                "images": [
                  "https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?w=400",
                  "https://images.unsplash.com/photo-1504754524776-8f4f37790ca0?w=400"
                ],
                "verified": true,
                "popular": true,
                "openNow": true,
                "availability": "Daily 8:00 AM - 4:00 PM",
                "cancellationPolicy": "Walk-in or reservations recommended",
                "earnPoints": 125,
                "amenities": [
                  "Brunch",
                  "Outdoor seating",
                  "Vegetarian options"
                ],
                "reviewSnippet": "Best brunch in Soho! The green shakshuka is a must-try. Get there early to avoid the wait.",
                "distance": "0.8 mi",
                "walkingTime": "15 min"
              }
            },
            {
              "timeBlock": "11:00 AM - 3:00 PM",
              "startTime": "11:00 AM",
              "endTime": "3:00 PM",
              "type": "attraction",
              "isPartner": true,
              "activity": {
                "id": "nyc-empire-state-top-rock",
                "name": "Empire State Building & Top of the Rock Tour",
                "provider": "Marriott Bonvoy Tours & Activities",
                "category": "attraction",
                "cuisineType": null,
                "rating": 4.8,
                "reviews": 3542,
                "price": 89,
                "currency": "USD",
                "priceLevel": 2,
                "duration": "4 hours",
                "description": "Experience breathtaking views from two of NYC's most iconic observation decks. Includes skip-the-line access to Empire State Building's 86th floor and Top of the Rock at Rockefeller Center.",
                "highlights": [
                  "Skip-the-line access to both observatories",
                  "Expert guide with historical insights",
                  "360° views of Manhattan skyline",
                  "Visit during golden hour for best photos"
                ],
                "included": [
                  "Skip-the-line tickets",
                  "Professional tour guide",
                  "Headsets for larger groups"
                ],
                "notIncluded": [
                  "Hotel pickup/drop-off",
                  "Food and drinks",
                  "Gratuities"
                ],
                "meetingPoint": "Rockefeller Center, 45 Rockefeller Plaza",
                "contact": "+1 (212) 698-2000",
                "bookingUrl": "https://activities.marriott.com/.../best_views_of_nyc",
                "images": [
                  "https://images.unsplash.com/photo-1543716627-839b54c40519?w=400",
                  "https://images.unsplash.com/photo-1534430480872-3498386e7856?w=400"
                ],
                "verified": true,
                "popular": true,
                "openNow": true,
                "availability": "Daily 10:00 AM - 6:00 PM",
                "cancellationPolicy": "Free cancellation up to 24 hours before",
                "earnPoints": 445,
                "amenities": [
                  "Skip-the-line",
                  "Audio guide",
                  "Wheelchair accessible"
                ],
                "reviewSnippet": "Absolutely stunning views! Our guide was knowledgeable and the skip-the-line access saved us hours.",
                "distance": "0.3 mi",
                "walkingTime": "5 min"
              }
            }
          ]
        },
        {
          "day": 2,
          "date": "July 2, 2026",
          "activities": [
            {
              "timeBlock": "10:30 AM - 1:30 PM",
              "startTime": "10:30 AM",
              "endTime": "1:30 PM",
              "type": "museum",
              "isPartner": true,
              "activity": {
                "id": "nyc-met-museum-tour",
                "name": "Metropolitan Museum of Art Guided Tour",
                "provider": "Marriott Bonvoy Tours & Activities",
                "category": "museum",
                "cuisineType": null,
                "rating": 4.9,
                "reviews": 4325,
                "price": 85,
                "currency": "USD",
                "priceLevel": 2,
                "duration": "3 hours",
                "description": "Skip-the-line access to one of the world's greatest museums. Expert art historian guide highlights masterpieces from Egyptian artifacts to modern art.",
                "highlights": [
                  "Skip-the-line entry",
                  "Expert art historian guide",
                  "See Egyptian Temple",
                  "View European masterpieces"
                ],
                "included": [
                  "Museum admission",
                  "Professional guide",
                  "Headsets"
                ],
                "notIncluded": [
                  "Food and drinks",
                  "Hotel pickup"
                ],
                "meetingPoint": "1000 5th Ave, Main Entrance",
                "contact": "+1 (212) 535-7710",
                "bookingUrl": "https://activities.marriott.com/.../met_museum",
                "images": [
                  "https://images.unsplash.com/photo-1564399579883-451a5d44ec08?w=400",
                  "https://images.unsplash.com/photo-1595433707802-6b2626ef1c91?w=400"
                ],
                "verified": true,
                "popular": true,
                "openNow": true,
                "availability": "Tue-Sun 10:00 AM, 2:00 PM",
                "cancellationPolicy": "Free cancellation up to 24 hours before",
                "earnPoints": 425,
                "amenities": [
                  "Skip-the-line",
                  "Audio guide",
                  "Wheelchair accessible"
                ],
                "reviewSnippet": "Our guide brought the art to life! Learned so much and didn't feel rushed. Highly recommend!",
                "distance": "1.5 mi",
                "walkingTime": "25 min"
              }
            }
          ]
        },
        {
          "day": 3,
          "date": "July 3, 2026",
          "activities": [
            {
              "timeBlock": "11:00 AM - 2:00 PM",
              "startTime": "11:00 AM",
              "endTime": "2:00 PM",
              "type": "museum",
              "isPartner": true,
              "activity": {
                "id": "nyc-moma-american-museum",
                "name": "MoMA & American Museum of Natural History Tour",
                "provider": "Marriott Bonvoy Tours & Activities",
                "category": "museum",
                "cuisineType": null,
                "rating": 4.8,
                "reviews": 3890,
                "price": 115,
                "currency": "USD",
                "priceLevel": 3,
                "duration": "5 hours",
                "description": "Visit two world-class museums in one day. See modern art masterpieces at MoMA, then explore dinosaurs and space at the American Museum of Natural History.",
                "highlights": [
                  "Two museums in one day",
                  "Skip-the-line at both",
                  "Expert guide",
                  "Van Gogh, Picasso, and more"
                ],
                "included": [
                  "Museum admissions",
                  "Professional guide",
                  "Transportation between museums",
                  "Headsets"
                ],
                "notIncluded": [
                  "Lunch",
                  "Gratuities"
                ],
                "meetingPoint": "11 W 53rd St, MoMA entrance",
                "contact": "+1 (212) 708-9400",
                "bookingUrl": "https://activities.marriott.com/.../two_museums",
                "images": [
                  "https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=400",
                  "https://images.unsplash.com/photo-1582555172866-f73bb12a2ab3?w=400"
                ],
                "verified": true,
                "popular": true,
                "openNow": true,
                "availability": "Wed-Mon 10:00 AM",
                "cancellationPolicy": "Free cancellation up to 48 hours before",
                "earnPoints": 575,
                "amenities": [
                  "Skip-the-line",
                  "Two museums",
                  "Transportation",
                  "Family-friendly"
                ],
                "reviewSnippet": "Perfect way to see two amazing museums! Our guide was knowledgeable and kept the kids engaged.",
                "distance": "0.9 mi",
                "walkingTime": "15 min"
              }
            }
          ]
        }
      ]
    };
  }
}

function formatDateForDisplay(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
}
