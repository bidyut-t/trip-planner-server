import type { PlanTripRequest, TripPlan } from "../schemas/trip-plan.schema.js";
import { planTripRequestSchema } from "../schemas/trip-plan.schema.js";
import { naturalPlanDraftSchema } from "../schemas/skeleton-plan.schema.js";
import type { UserProfile } from "../schemas/user-profile.schema.js";
import {
  loadCatalog,
  loadDestinations,
  loadUserProfiles,
  type DestinationMeta,
} from "./catalog/catalog.service.js";
import { extractPromptKeywords } from "./nlp/nlp-parser.keywords.js";
import { parseLlmJson } from "../utils/llm-json.js";
import { runOpenAiPrompt } from "../utils/openai-mcp-agent.js";
import { isCatalogMcpEnabled } from "../utils/env.js";
import { buildCatalogMcpPromptBlock } from "../utils/mcp-catalog-prompt.js";
import { buildScheduleRulesBlock } from "./prompts/planner.schedule-rules.js";
import { 
  validatePartnerInPlan,
  getPartnerValidationSummary 
} from "./partner-validation.service.js";
import { addMapLinksToTripPlan } from "../utils/google-maps.js";
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
 * Build the AI prompt for natural language trip planning with optional personalization
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

  // User Profile Personalization Integration
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
        "walkingTime": string (e.g., "15 min"),
        "latitude": number (latitude coordinate for map links),
        "longitude": number (longitude coordinate for map links)
      }
    }]
  }]
}

${buildScheduleRulesBlock()}

IMPORTANT RULES:
- ALWAYS set "plannerMode": "openai" in the root response object
- Generate realistic, detailed data for all activity fields
- Use proper 12-hour time format (e.g., "10:00 AM", "2:30 PM")

**CRITICAL MULTI-DAY SCHEDULING REQUIREMENTS:**
- EVERY single day must be planned from 08:30 AM to 22:00 PM (10:00 PM) - NO EXCEPTIONS
- EVERY day MUST have 4-6 activities spanning the FULL day (breakfast → morning activity → lunch → afternoon activity → dinner → evening activity)
- Apply this rule to ALL days: Day 1, Day 2, Day 3, and every single day in the itinerary
- Each day's activities should span approximately 13+ hours (08:30 AM to 22:00 PM)
- NO day should have fewer than 4 activities
- NO day should end before 20:00 PM (8:00 PM)

**DAILY STRUCTURE FOR ALL DAYS:**
1. Breakfast/Morning meal (08:30-10:00 AM)
2. Morning activity/attraction (10:30 AM-1:30 PM)  
3. Lunch (2:00-3:30 PM)
4. Afternoon activity/attraction (4:00-7:00 PM)
5. Dinner (7:30-9:30 PM or 8:00-10:00 PM)
6. Optional evening activity if time permits

- Add 15-30 minute buffers between activities for travel time
- Include cab transfers when moving between distant areas
- Cluster activities geographically to minimize travel time (use real-world geography)
- Order activities sensibly: morning activity → lunch nearby → afternoon activity in same area → dinner → evening activity
- Consider weather and season when planning outdoor vs indoor activities
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
- IMPORTANT: Include realistic latitude and longitude coordinates for each activity (use actual coordinates for the city)
- Example coordinates for NYC: Times Square (40.7580, -73.9855), Central Park (40.7829, -73.9654), Museum Mile (40.7794, -73.9632)

Infer destination, dates (today is ${today}), travelers, pace, and interests from the message.
Keyword hints: ${keywordHint}

**CRITICAL: FOR MULTI-DAY TRIPS, EVERY SINGLE DAY MUST HAVE A COMPLETE SCHEDULE FROM MORNING TO EVENING**
- If the trip is 2 days, BOTH days need full schedules (8:30 AM - 10:00 PM)
- If the trip is 3 days, ALL THREE days need full schedules (8:30 AM - 10:00 PM)  
- If the trip is 7 days, ALL SEVEN days need full schedules (8:30 AM - 10:00 PM)
- NO day should be incomplete or have only 1-2 activities

Supported destinations:
${destList}
${isCatalogMcpEnabled() ? buildCatalogMcpPromptBlock() : ""}

User message:
${prompt}`;
}

/**
 * Natural language: ONE AI call (parse + plan). Catalog partner data via MCP tools, not local enrich.
 * 
 * Enhanced with keyword detection and programmatic map link generation.
 * Detects if user wants map links (keywords: map, link, route, directions, google maps).
 * AI generates coordinates, then custom utility function builds clean per-day URLs.
 * 
 * Enhanced with user profile personalization for CodeFest.
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

  // Load user profile if userId is explicitly provided
  // No profile personalization applied by default - keeps plans generic
  // In production, this would be based on authenticated user session
  let userProfile: UserProfile | undefined;
  if (userId) {
    const userProfiles = await loadUserProfiles();
    userProfile = userProfiles.find(p => p.id === userId);
    console.log('[natural-planner] User profile loaded:', userProfile ? `${userProfile.name} (${userId})` : 'NOT FOUND');
    if (userProfile) {
      console.log('[natural-planner] Profile details:', {
        travelStyle: userProfile.travelStyle,
        budgetLevel: userProfile.budgetLevel,
        fitnessLevel: userProfile.preferences.fitnessLevel,
        dietaryRestrictions: userProfile.dietaryRestrictions,
      });
    }
  } else {
    console.log('[natural-planner] No userId provided - generating generic plan');
  }

  // Keyword detection for map link generation
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
      userProfile,  // Pass user profile for personalized planning
    );
    
    if (userProfile) {
      console.log('[natural-planner] Using personalized prompt for:', userProfile.name);
    }
    
    const raw = await runOpenAiPrompt(naturalPlanPrompt);
    
    // AI returns the new schema directly - parse and validate partners
    const result = parseLlmJson(raw);
    
    // Validate and enrich partner information
    const validatedResult = await validateAndEnrichNewSchemaPartners(result);
    
    // Programmatic map link generation (CodeFest Feature)
    // Add per-day Google Maps links if user requested map in their prompt
    const resultWithMapLinks = addMapLinksToTripPlan(validatedResult, userWantsMap);
    
    return resultWithMapLinks;

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
              "timeBlock": "8:30 AM - 10:00 AM",
              "startTime": "8:30 AM",
              "endTime": "10:00 AM",
              "type": "restaurant",
              "isPartner": true,
              "addFromOurRecommendation": true,
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
              "timeBlock": "10:30 AM - 2:30 PM",
              "startTime": "10:30 AM",
              "endTime": "2:30 PM",
              "type": "attraction",
              "isPartner": true,
              "addFromOurRecommendation": true,
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
            },
            {
              "timeBlock": "3:00 PM - 4:30 PM",
              "startTime": "3:00 PM",
              "endTime": "4:30 PM",
              "type": "restaurant",
              "isPartner": false,
              "addFromOurRecommendation": false,
              "activity": {
                "id": "nyc-lunch-katzs-deli",
                "name": "Katz's Delicatessen",
                "provider": "Katz's Delicatessen",
                "category": "restaurant",
                "cuisineType": "Jewish Deli",
                "rating": 4.6,
                "reviews": 8420,
                "price": 35,
                "currency": "USD",
                "priceLevel": 2,
                "duration": "1.5 hours",
                "description": "Historic Lower East Side deli serving legendary pastrami sandwiches since 1888. A New York institution.",
                "highlights": [
                  "World-famous pastrami sandwich",
                  "Historic atmosphere since 1888",
                  "Authentic Jewish deli experience"
                ],
                "included": ["Meal"],
                "notIncluded": ["Drinks", "Tip"],
                "meetingPoint": "205 E Houston St, New York",
                "contact": "+1 (212) 254-2246",
                "bookingUrl": "https://katzsdelicatessen.com",
                "images": [
                  "https://images.unsplash.com/photo-1551024506-0bccd828d307?w=400"
                ],
                "verified": true,
                "popular": true,
                "openNow": true,
                "availability": "Daily 8:00 AM - 10:45 PM",
                "cancellationPolicy": "No reservation needed",
                "earnPoints": 0,
                "amenities": ["Historic landmark", "Takeout available"],
                "reviewSnippet": "The pastrami sandwich is incredible! A true New York experience.",
                "distance": "1.2 mi",
                "walkingTime": "20 min"
              }
            },
            {
              "timeBlock": "5:00 PM - 7:00 PM",
              "startTime": "5:00 PM",
              "endTime": "7:00 PM",
              "type": "activity",
              "isPartner": false,
              "addFromOurRecommendation": false,
              "activity": {
                "id": "nyc-central-park-walk",
                "name": "Central Park Walking Tour",
                "provider": "NYC Walking Tours",
                "category": "activity",
                "cuisineType": null,
                "rating": 4.7,
                "reviews": 2156,
                "price": 45,
                "currency": "USD",
                "priceLevel": 1,
                "duration": "2 hours",
                "description": "Guided walking tour through Central Park's most famous landmarks including Bethesda Fountain, Bow Bridge, and Strawberry Fields.",
                "highlights": [
                  "Bethesda Fountain",
                  "Bow Bridge",
                  "Strawberry Fields (John Lennon Memorial)",
                  "The Mall and Literary Walk"
                ],
                "included": ["Professional guide", "Park entry"],
                "notIncluded": ["Transportation to park"],
                "meetingPoint": "Central Park South entrance near Plaza Hotel",
                "contact": "+1 (212) 555-7890",
                "bookingUrl": "https://nycwalkingtours.com/central-park",
                "images": [
                  "https://images.unsplash.com/photo-1553969420-fb915ad70f4a?w=400",
                  "https://images.unsplash.com/photo-1541336528065-6d0a4d9f2b5f?w=400"
                ],
                "verified": true,
                "popular": true,
                "openNow": true,
                "availability": "Daily 9:00 AM - 7:00 PM",
                "cancellationPolicy": "Free cancellation up to 2 hours before",
                "earnPoints": 0,
                "amenities": ["Walking tour", "All weather"],
                "reviewSnippet": "Beautiful tour with amazing photo opportunities. Guide was very knowledgeable!",
                "distance": "0.5 mi",
                "walkingTime": "10 min"
              }
            },
            {
              "timeBlock": "8:00 PM - 10:00 PM",
              "startTime": "8:00 PM",
              "endTime": "10:00 PM",
              "type": "restaurant",
              "isPartner": true,
              "addFromOurRecommendation": true,
              "activity": {
                "id": "nyc-dinner-gramercy-tavern",
                "name": "Gramercy Tavern",
                "provider": "Marriott Bonvoy Tours & Activities",
                "category": "restaurant",
                "cuisineType": "American Fine Dining",
                "rating": 4.8,
                "reviews": 3245,
                "price": 95,
                "currency": "USD",
                "priceLevel": 3,
                "duration": "2 hours",
                "description": "Acclaimed American restaurant offering seasonal cuisine in an elegant, rustic setting. One of NYC's most beloved fine dining destinations.",
                "highlights": [
                  "James Beard Award-winning restaurant",
                  "Seasonal American menu",
                  "Elegant rustic atmosphere",
                  "Excellent wine selection"
                ],
                "included": ["Dinner", "Bread service"],
                "notIncluded": ["Wine", "Gratuity"],
                "meetingPoint": "42 E 20th St, New York",
                "contact": "+1 (212) 477-0777",
                "bookingUrl": "https://gramercytavern.com",
                "images": [
                  "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400",
                  "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400"
                ],
                "verified": true,
                "popular": true,
                "openNow": true,
                "availability": "Daily 5:30 PM - 10:00 PM",
                "cancellationPolicy": "24-hour cancellation policy",
                "earnPoints": 475,
                "amenities": ["Fine dining", "Wine bar", "Reservations required"],
                "reviewSnippet": "Exceptional dining experience! Every dish was perfectly executed. The service was impeccable.",
                "distance": "0.7 mi",
                "walkingTime": "12 min"
              }
            }
          ]
        },
        {
          "day": 2,
          "date": "July 2, 2026",
          "activities": [
            {
              "timeBlock": "8:30 AM - 10:00 AM",
              "startTime": "8:30 AM",
              "endTime": "10:00 AM",
              "type": "restaurant",
              "isPartner": false,
              "addFromOurRecommendation": false,
              "activity": {
                "id": "nyc-breakfast-balthazar",
                "name": "Balthazar",
                "provider": "Balthazar Restaurant",
                "category": "restaurant",
                "cuisineType": "French Bistro",
                "rating": 4.6,
                "reviews": 2340,
                "price": 35,
                "currency": "USD",
                "priceLevel": 2,
                "duration": "1.5 hours",
                "description": "Classic French bistro in the heart of SoHo serving authentic Parisian breakfast favorites.",
                "highlights": [
                  "Fresh croissants and pastries",
                  "Classic French omelettes",
                  "Authentic Parisian atmosphere"
                ],
                "included": ["Breakfast"],
                "notIncluded": ["Coffee"],
                "meetingPoint": "80 Spring St, New York",
                "contact": "+1 (212) 965-1414",
                "bookingUrl": "https://balthazarny.com",
                "images": [
                  "https://images.unsplash.com/photo-1551024506-0bccd828d307?w=400"
                ],
                "verified": true,
                "popular": true,
                "openNow": true,
                "availability": "Daily 7:30 AM - 1:00 AM",
                "cancellationPolicy": "2-hour notice required",
                "earnPoints": 0,
                "amenities": ["French bistro", "Outdoor seating"],
                "reviewSnippet": "Transport yourself to Paris with their authentic French breakfast!",
                "distance": "0.4 mi",
                "walkingTime": "8 min"
              }
            },
            {
              "timeBlock": "10:30 AM - 1:30 PM",
              "startTime": "10:30 AM",
              "endTime": "1:30 PM",
              "type": "museum",
              "isPartner": true,
              "addFromOurRecommendation": true,
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
            },
            {
              "timeBlock": "2:00 PM - 3:30 PM",
              "startTime": "2:00 PM",
              "endTime": "3:30 PM",
              "type": "restaurant",
              "isPartner": false,
              "addFromOurRecommendation": false,
              "activity": {
                "id": "nyc-lunch-shake-shack",
                "name": "Shake Shack - Madison Square Park",
                "provider": "Shake Shack",
                "category": "restaurant",
                "cuisineType": "American Burgers",
                "rating": 4.4,
                "reviews": 5680,
                "price": 18,
                "currency": "USD",
                "priceLevel": 1,
                "duration": "1.5 hours",
                "description": "The original Shake Shack location in Madison Square Park, famous for their ShackBurger and hand-spun shakes.",
                "highlights": [
                  "Original ShackBurger",
                  "Hand-spun milkshakes",
                  "Outdoor park setting"
                ],
                "included": ["Lunch"],
                "notIncluded": ["Drinks"],
                "meetingPoint": "Madison Square Park, New York",
                "contact": "+1 (212) 889-6600",
                "bookingUrl": "https://shakeshack.com",
                "images": [
                  "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400"
                ],
                "verified": true,
                "popular": true,
                "openNow": true,
                "availability": "Daily 11:00 AM - 11:00 PM",
                "cancellationPolicy": "No reservations",
                "earnPoints": 0,
                "amenities": ["Outdoor seating", "Park location"],
                "reviewSnippet": "The burger that started it all! Fresh ingredients and great atmosphere in the park.",
                "distance": "0.8 mi",
                "walkingTime": "15 min"
              }
            },
            {
              "timeBlock": "4:00 PM - 6:30 PM",
              "startTime": "4:00 PM",
              "endTime": "6:30 PM",
              "type": "activity",
              "isPartner": false,
              "addFromOurRecommendation": false,
              "activity": {
                "id": "nyc-high-line-walk",
                "name": "High Line Park Walk & Chelsea Market",
                "provider": "NYC Parks & Recreation",
                "category": "activity",
                "cuisineType": null,
                "rating": 4.8,
                "reviews": 12450,
                "price": 0,
                "currency": "USD",
                "priceLevel": 1,
                "duration": "2.5 hours",
                "description": "Walk along the elevated park built on former railway tracks, then explore the famous Chelsea Market food hall.",
                "highlights": [
                  "Elevated park with city views",
                  "Chelsea Market food exploration",
                  "Urban gardens and art installations",
                  "Hudson River views"
                ],
                "included": ["Park access", "Self-guided tour"],
                "notIncluded": ["Food at Chelsea Market", "Guided tour"],
                "meetingPoint": "Gansevoort St entrance, Meatpacking District",
                "contact": "+1 (212) 500-6035",
                "bookingUrl": "https://thehighline.org",
                "images": [
                  "https://images.unsplash.com/photo-1544620917-4eab4b65ee1f?w=400",
                  "https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=400"
                ],
                "verified": true,
                "popular": true,
                "openNow": true,
                "availability": "Daily 7:00 AM - 7:00 PM",
                "cancellationPolicy": "Free admission",
                "earnPoints": 0,
                "amenities": ["Wheelchair accessible", "Free admission", "Restrooms"],
                "reviewSnippet": "A unique NYC experience! Great views and the market has amazing food options.",
                "distance": "1.1 mi",
                "walkingTime": "20 min"
              }
            },
            {
              "timeBlock": "7:30 PM - 10:00 PM",
              "startTime": "7:30 PM",
              "endTime": "10:00 PM",
              "type": "restaurant",
              "isPartner": true,
              "addFromOurRecommendation": true,
              "activity": {
                "id": "nyc-dinner-le-bernardin",
                "name": "Le Bernardin",
                "provider": "Marriott Bonvoy Tours & Activities",
                "category": "restaurant",
                "cuisineType": "French Seafood",
                "rating": 4.9,
                "reviews": 1876,
                "price": 185,
                "currency": "USD",
                "priceLevel": 3,
                "duration": "2.5 hours",
                "description": "Three Michelin-starred restaurant specializing in exquisite French seafood cuisine. One of NYC's most prestigious dining experiences.",
                "highlights": [
                  "3 Michelin stars",
                  "World-renowned chef Eric Ripert",
                  "Exquisite seafood preparations",
                  "Impeccable service"
                ],
                "included": ["Multi-course tasting menu"],
                "notIncluded": ["Wine pairing", "Gratuity"],
                "meetingPoint": "155 W 51st St, New York",
                "contact": "+1 (212) 554-1515",
                "bookingUrl": "https://le-bernardin.com",
                "images": [
                  "https://images.unsplash.com/photo-1559339352-11d035aa65de?w=400",
                  "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400"
                ],
                "verified": true,
                "popular": true,
                "openNow": true,
                "availability": "Tue-Fri 5:15 PM - 10:30 PM, Sat 5:00 PM - 10:30 PM",
                "cancellationPolicy": "48-hour cancellation policy",
                "earnPoints": 925,
                "amenities": ["Fine dining", "Michelin starred", "Dress code"],
                "reviewSnippet": "An extraordinary culinary journey. Every bite is perfection. Truly world-class dining.",
                "distance": "0.6 mi",
                "walkingTime": "12 min"
              }
            }
          ]
        },
        {
          "day": 3,
          "date": "July 3, 2026",
          "activities": [
            {
              "timeBlock": "8:30 AM - 10:00 AM",
              "startTime": "8:30 AM",
              "endTime": "10:00 AM",
              "type": "restaurant",
              "isPartner": false,
              "addFromOurRecommendation": false,
              "activity": {
                "id": "nyc-breakfast-clinton-st-baking",
                "name": "Clinton St. Baking Company",
                "provider": "Clinton St. Baking Company",
                "category": "restaurant",
                "cuisineType": "American Brunch",
                "rating": 4.7,
                "reviews": 3420,
                "price": 28,
                "currency": "USD",
                "priceLevel": 2,
                "duration": "1.5 hours",
                "description": "Famous Lower East Side bakery and restaurant known for their legendary blueberry pancakes and fresh baked goods.",
                "highlights": [
                  "World-famous blueberry pancakes",
                  "Fresh-baked pastries",
                  "Cozy neighborhood atmosphere"
                ],
                "included": ["Breakfast"],
                "notIncluded": ["Coffee"],
                "meetingPoint": "4 Clinton St, New York",
                "contact": "+1 (646) 602-6263",
                "bookingUrl": "https://clintonstreetbaking.com",
                "images": [
                  "https://images.unsplash.com/photo-1554520735-0a6b8b6ce8b7?w=400"
                ],
                "verified": true,
                "popular": true,
                "openNow": true,
                "availability": "Mon-Sun 8:00 AM - 4:00 PM",
                "cancellationPolicy": "Walk-ins welcome",
                "earnPoints": 0,
                "amenities": ["Famous pancakes", "Bakery items"],
                "reviewSnippet": "The best pancakes in NYC! Worth the wait for these fluffy, perfectly sweet pancakes.",
                "distance": "0.3 mi",
                "walkingTime": "6 min"
              }
            },
            {
              "timeBlock": "10:30 AM - 1:30 PM",
              "startTime": "10:30 AM",
              "endTime": "1:30 PM",
              "type": "museum",
              "isPartner": true,
              "addFromOurRecommendation": true,
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
            },
            {
              "timeBlock": "2:00 PM - 3:30 PM",
              "startTime": "2:00 PM",
              "endTime": "3:30 PM",
              "type": "restaurant",
              "isPartner": false,
              "addFromOurRecommendation": false,
              "activity": {
                "id": "nyc-lunch-russ-daughters",
                "name": "Russ & Daughters",
                "provider": "Russ & Daughters",
                "category": "restaurant",
                "cuisineType": "Jewish Appetizing",
                "rating": 4.6,
                "reviews": 2890,
                "price": 32,
                "currency": "USD",
                "priceLevel": 2,
                "duration": "1.5 hours",
                "description": "Fourth-generation appetizing shop serving the finest smoked fish, bagels, and traditional Jewish specialties since 1914.",
                "highlights": [
                  "House-cured and smoked salmon",
                  "Traditional bagels and cream cheese",
                  "Century-old family recipes"
                ],
                "included": ["Lunch"],
                "notIncluded": ["Beverages"],
                "meetingPoint": "179 E Houston St, New York",
                "contact": "+1 (212) 475-4880",
                "bookingUrl": "https://russanddaughters.com",
                "images": [
                  "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400"
                ],
                "verified": true,
                "popular": true,
                "openNow": true,
                "availability": "Daily 8:00 AM - 6:00 PM",
                "cancellationPolicy": "No reservations for lunch",
                "earnPoints": 0,
                "amenities": ["Historic landmark", "Traditional appetizing"],
                "reviewSnippet": "Authentic NYC experience! The lox is incredible and the history is fascinating.",
                "distance": "0.2 mi",
                "walkingTime": "4 min"
              }
            },
            {
              "timeBlock": "4:00 PM - 6:30 PM",
              "startTime": "4:00 PM",
              "endTime": "6:30 PM",
              "type": "activity",
              "isPartner": false,
              "addFromOurRecommendation": false,
              "activity": {
                "id": "nyc-brooklyn-bridge-walk",
                "name": "Brooklyn Bridge Walk & DUMBO Exploration",
                "provider": "NYC Bridges",
                "category": "activity",
                "cuisineType": null,
                "rating": 4.7,
                "reviews": 8950,
                "price": 0,
                "currency": "USD",
                "priceLevel": 1,
                "duration": "2.5 hours",
                "description": "Walk across the iconic Brooklyn Bridge and explore DUMBO neighborhood with stunning views of Manhattan skyline.",
                "highlights": [
                  "Iconic Brooklyn Bridge crossing",
                  "Manhattan skyline views",
                  "DUMBO waterfront parks",
                  "Historic bridge architecture"
                ],
                "included": ["Self-guided bridge walk", "Park access"],
                "notIncluded": ["Transportation back", "Food in DUMBO"],
                "meetingPoint": "Brooklyn Bridge entrance, City Hall area",
                "contact": "+1 (311) 692-2000",
                "bookingUrl": "https://nyc.gov/parks",
                "images": [
                  "https://images.unsplash.com/photo-1514565131-fce0801e5785?w=400",
                  "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=400"
                ],
                "verified": true,
                "popular": true,
                "openNow": true,
                "availability": "24/7 bridge access",
                "cancellationPolicy": "Free activity",
                "earnPoints": 0,
                "amenities": ["Free activity", "Pedestrian walkway", "Photo opportunities"],
                "reviewSnippet": "Must-do NYC experience! The views are spectacular and the bridge itself is a marvel.",
                "distance": "0.5 mi",
                "walkingTime": "10 min"
              }
            },
            {
              "timeBlock": "7:30 PM - 10:00 PM",
              "startTime": "7:30 PM",
              "endTime": "10:00 PM",
              "type": "restaurant",
              "isPartner": true,
              "addFromOurRecommendation": true,
              "activity": {
                "id": "nyc-dinner-one-world-observatory",
                "name": "One World Observatory Sunset Dining Experience",
                "provider": "Marriott Bonvoy Tours & Activities",
                "category": "restaurant",
                "cuisineType": "Contemporary American",
                "rating": 4.8,
                "reviews": 2156,
                "price": 135,
                "currency": "USD",
                "priceLevel": 3,
                "duration": "2.5 hours",
                "description": "Spectacular dinner with panoramic views from the Western Hemisphere's tallest building. Watch the sunset over NYC while enjoying contemporary cuisine.",
                "highlights": [
                  "360° views from 102nd floor",
                  "Sunset dining experience",
                  "Contemporary American cuisine",
                  "Tallest building in Western Hemisphere"
                ],
                "included": ["Observatory access", "Multi-course dinner"],
                "notIncluded": ["Wine pairing", "Gratuity"],
                "meetingPoint": "One World Trade Center, 285 Fulton St",
                "contact": "+1 (212) 602-4000",
                "bookingUrl": "https://oneworldobservatory.com/dining",
                "images": [
                  "https://images.unsplash.com/photo-1577996693164-61ef2a9e8555?w=400",
                  "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400"
                ],
                "verified": true,
                "popular": true,
                "openNow": true,
                "availability": "Daily 6:00 PM - 10:00 PM",
                "cancellationPolicy": "24-hour cancellation policy",
                "earnPoints": 675,
                "amenities": ["Observatory access", "Sunset views", "Fine dining"],
                "reviewSnippet": "Breathtaking views and excellent food! Perfect way to end a NYC trip with unforgettable sunset views.",
                "distance": "1.8 mi",
                "walkingTime": "35 min"
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
