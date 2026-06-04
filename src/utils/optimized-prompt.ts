import { DestinationMeta } from "../services/catalog/catalog.service.js";
import type { UserProfile } from "../schemas/user-profile.schema.js";
import { isCatalogMcpEnabled } from "./env.js";

/**
 * Create a concise, optimized prompt for trip planning
 * Removes verbose instructions and focuses on essential requirements
 */
export function buildOptimizedPrompt(
  prompt: string,
  destinations: DestinationMeta[],
  userProfile?: UserProfile
): string {
  const today = new Date().toISOString().slice(0, 10);
  const destList = destinations.slice(0, 5).map(d => `${d.name}`).join(", ");
  
  const profileHints = userProfile ? [
    userProfile.dietaryRestrictions.length > 0 ? `Dietary: ${userProfile.dietaryRestrictions.join(", ")}` : "",
    userProfile.accessibilityNeeds.length > 0 ? `Accessibility: ${userProfile.accessibilityNeeds.join(", ")}` : "",
    `Budget: ${userProfile.budgetLevel}`,
    `Style: ${userProfile.travelStyle}`
  ].filter(Boolean).join(". ") : "";

  return `Create a trip plan from: "${prompt}"

${profileHints ? `User preferences: ${profileHints}` : ""}

RULES:
- Use real places only (exact names from Google Maps/Yelp)
- No chains like Starbucks, McDonald's, Chipotle
- Times: same-day only (no "PM to AM"), end > start, respect business hours
- Include tourist-worthy experiences, not convenience stores

Destinations: ${destList}

JSON schema:
{
  "destination": "City Name",
  "description": "Brief trip description",
  "startDate": "${today}",
  "endDate": "${today}", 
  "travelers": {"adults": 2, "children": 0},
  "plannerMode": "openai",
  "days": [{
    "day": 1,
    "date": "${today}",
    "activities": [{
      "timeBlock": "10:00 AM - 12:00 PM",
      "startTime": "10:00 AM",
      "endTime": "12:00 PM",
      "type": "restaurant|activity|attraction",
      "isPartner": false,
      "activity": {
        "id": "unique-id",
        "name": "Exact Business Name",
        "provider": "Exact Business Name",
        "category": "restaurant|activity|attraction",
        "rating": 4.5,
        "price": 25,
        "currency": "USD",
        "priceLevel": 2,
        "duration": "2 hours",
        "description": "Brief description",
        "availability": "9am-6pm",
        "verified": true,
        "popular": true
      }
    }]
  }]
}

Reply with JSON only:`;
}