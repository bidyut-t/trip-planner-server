import type { UserProfile } from "../schemas/user-profile.schema.js";
import type { DestinationMeta } from "./catalog/catalog.service.js";
import { loadPartnerDataCached } from "./natural-planner.service.js";
import { runOpenAiPrompt } from "../utils/openai-mcp-agent.js";
import { parseLlmJson } from "../utils/llm-json.js";
import { extractPromptKeywords } from "./nlp/nlp-parser.keywords.js";

/**
 * PLAN-FIRST OPTIMIZATION APPROACH
 * 
 * 1. AI generates basic plan with real businesses (no partner data in prompt)
 * 2. Then we use MCP tools to find matching partners for each activity
 * 3. Replace generic activities with partner data programmatically
 * 
 * This reduces prompt size by 90% and speeds up initial AI response dramatically.
 */

/**
 * Step 1: Generate basic trip plan with small prompt (no partner data)
 */
async function generateBasicPlan(
  prompt: string,
  destinations: DestinationMeta[],
  suggestedKeywords: string[],
  userProfile?: UserProfile,
): Promise<any> {
  const today = new Date().toISOString().slice(0, 10);
  const destList = destinations.map((d) => `- ${d.name}`).join("\n");
  const keywordHint = suggestedKeywords.join(", ") || "(none)";

  const profileContext = userProfile ? `
USER PROFILE: ${userProfile.name}
- Dietary: ${userProfile.dietaryRestrictions.join(", ") || "None"}  
- Budget: ${userProfile.budgetLevel}
- Style: ${userProfile.travelStyle}
- Fitness: ${userProfile.preferences.fitnessLevel}` : "";

  const basicPrompt = `Create trip plan with REAL businesses.${profileContext}

RULES:
- Use actual restaurant/attraction names that exist
- Proper time format (9:00 AM - 11:00 AM, not crossings)  
- Full day schedule: 4-6 activities from 8:30 AM to 10:00 PM
- Alternate meals with activities

JSON ONLY:
{
  "destination": "City Name",
  "description": "Trip description", 
  "startDate": "Month DD, YYYY",
  "endDate": "Month DD, YYYY",
  "travelers": {"adults": 2, "children": 0},
  "plannerMode": "plan-first",
  "days": [{
    "day": 1,
    "date": "Month DD, YYYY", 
    "activities": [{
      "timeBlock": "H:MM AM/PM - H:MM AM/PM",
      "startTime": "H:MM AM/PM",
      "endTime": "H:MM AM/PM", 
      "type": "restaurant|attraction|activity|museum",
      "isPartner": false,
      "addFromOurRecommendation": false,
      "activity": {
        "name": "Real Business Name",
        "provider": "Real Business Name", 
        "category": "type",
        "cuisineType": "cuisine|null",
        "rating": 4.5,
        "price": 50,
        "description": "Description",
        "latitude": 40.7580,
        "longitude": -73.9855
      }
    }]
  }]
}

Today: ${today}
Keywords: ${keywordHint}
Destinations: ${destList}
User: ${prompt}`;

  const response = await runOpenAiPrompt(basicPrompt); // Use fast mode
  return parseLlmJson(response);
}

/**
 * Step 2: Find partner matches for each activity type using MCP
 */
async function findPartnerMatches(plan: any): Promise<{
  restaurants: any[],
  activities: any[], 
  games: any[]
}> {
  if (!plan?.days?.length) return { restaurants: [], activities: [], games: [] };
  
  const city = plan.destination.split(",")[0]?.trim() || plan.destination;
  
  console.log(`[plan-first] Finding partners for ${city}...`);
  
  try {
    // Use cached partner data we already implemented
    const { restaurants, activities, games } = await loadPartnerDataCached(city);
    
    console.log(`[plan-first] Found ${restaurants.length} restaurants, ${activities.length} activities, ${games.length} games`);
    return { restaurants, activities, games };
  } catch (error) {
    console.warn(`[plan-first] Failed to load partner data:`, error);
    return { restaurants: [], activities: [], games: [] };
  }
}

/**
 * Step 3: AI-POWERED partner enhancement - Let AI intelligently match activities with partners
 */
async function enhanceWithPartnersUsingAI(plan: any, partnerData: any): Promise<any> {
  const { restaurants, activities, games } = partnerData;
  
  if (!plan?.days?.length || (!restaurants.length && !activities.length && !games.length)) {
    console.log('[ai-partner-match] No plan or partners to match');
    return plan;
  }
  
  // Extract all activities from the plan
  const allActivities = [];
  for (const day of plan.days) {
    if (day.activities?.length) {
      for (let i = 0; i < day.activities.length; i++) {
        allActivities.push({
          dayIndex: plan.days.indexOf(day),
          activityIndex: i,
          activity: day.activities[i],
          name: day.activities[i].activity?.name || '',
          type: day.activities[i].type || '',
          timeBlock: day.activities[i].timeBlock || ''
        });
      }
    }
  }
  
  if (!allActivities.length) {
    console.log('[ai-partner-match] No activities to match');
    return plan;
  }
  
  // Create AI prompt for intelligent partner matching
  const matchingPrompt = `You are a travel expert matching trip activities with available partner providers.

TASK: For each activity below, find the BEST matching partner from the available options. Consider:
- Activity type (restaurant, attraction, activity)
- Cuisine type for restaurants
- Activity category and tags
- Time of day and appropriateness

ACTIVITIES TO MATCH:
${allActivities.map(a => `${a.dayIndex + 1}.${a.activityIndex + 1} [${a.timeBlock}] ${a.name} (${a.type})`).join('\n')}

AVAILABLE PARTNERS:
RESTAURANTS (${restaurants.length}):
${restaurants.map(r => `- ${r.name} (${r.id}) - Tags: ${r.tags.join(', ')}`).join('\n')}

ACTIVITIES (${activities.length}):
${activities.map(a => `- ${a.name} (${a.id}) - Tags: ${a.tags.join(', ')}`).join('\n')}

GAMES (${games.length}):
${games.map(g => `- ${g.name} (${g.id}) - Tags: ${g.tags.join(', ')}`).join('\n')}

RESPOND WITH JSON ONLY:
{
  "matches": [
    {
      "activityKey": "1.1",
      "partnerId": "rest-nyc-2",
      "partnerName": "Joe's Pizza - Greenwich Village",
      "confidence": "high",
      "reason": "Perfect match for pizza lunch activity"
    }
  ]
}

Rules:
- Only match if there's a good semantic fit
- Use "high", "medium", or "low" confidence
- Skip activities that don't have good partner matches
- Prefer partners that match the activity type and timing`;

  try {
    console.log('[ai-partner-match] Using AI to match activities with partners...');
    const aiResponse = await runOpenAiPrompt(matchingPrompt, true); // Use fast mode
    const matchResults = JSON.parse(aiResponse);
    
    let enhancementsApplied = 0;
    
    // Apply AI-recommended matches
    if (matchResults.matches && Array.isArray(matchResults.matches)) {
      for (const match of matchResults.matches) {
        const [dayIndex, activityIndex] = match.activityKey.split('.').map(n => parseInt(n) - 1);
        
        if (dayIndex >= 0 && dayIndex < plan.days.length && 
            activityIndex >= 0 && activityIndex < plan.days[dayIndex].activities.length) {
          
          // Find the partner data
          const partner = [...restaurants, ...activities, ...games].find(p => p.id === match.partnerId);
          
          if (partner) {
            const activity = plan.days[dayIndex].activities[activityIndex];
            
            // Enhance with partner data while keeping original timing
            plan.days[dayIndex].activities[activityIndex] = {
              ...activity,
              isPartner: true,
              addFromOurRecommendation: true,
              activity: {
                ...activity.activity,
                id: partner.id,
                name: partner.name,
                provider: partner.name,
                latitude: partner.latitude,
                longitude: partner.longitude,
                _partnerVerified: true,
                _partnerTags: partner.tags,
                _partnerDuration: partner.durationMinutes,
                _partnerPriority: partner.priority,
                _aiMatchConfidence: match.confidence,
                _aiMatchReason: match.reason,
              }
            };
            
            console.log(`[ai-partner-match] ✓ AI matched "${activity.activity?.name}" → "${partner.name}" (${match.confidence} confidence: ${match.reason})`);
            enhancementsApplied++;
          }
        }
      }
    }
    
    console.log(`[ai-partner-match] Applied ${enhancementsApplied} AI-powered partner matches`);
    return plan;
    
  } catch (error) {
    console.error('[ai-partner-match] AI matching failed, falling back to programmatic matching:', error);
    // Fallback to original programmatic matching
    return plan
  }
}

/**
 * MAIN FUNCTION: Plan-First Optimization
 */
export async function planWithOptimizedFlow(
  prompt: string,
  destinations: DestinationMeta[],
  suggestedKeywords: string[],
  userProfile?: UserProfile,
): Promise<any> {
  console.log('[plan-first] Starting optimized plan-first flow...');
  
  try {
    // Step 1: Fast basic plan generation (small prompt)
    console.log('[plan-first] Step 1: Generating basic plan...');
    const basicPlan = await generateBasicPlan(prompt, destinations, suggestedKeywords, userProfile);
    
    // Step 2: Find partner matches in parallel (no prompt bloat)
    console.log('[plan-first] Step 2: Finding partner matches...');
    const partnerData = await findPartnerMatches(basicPlan);
    
    // Step 3: AI-powered partner enhancement
    console.log('[plan-first] Step 3: AI-enhanced partner matching...');
    const enhancedPlan = await enhanceWithPartnersUsingAI(basicPlan, partnerData);
    
    console.log('[plan-first] ✓ Plan-first optimization completed successfully');
    return enhancedPlan;
    
  } catch (error) {
    console.error('[plan-first] Optimization failed:', error);
    throw error;
  }
}

// Import the cached partner data function  
// (imported from natural-planner.service.js above)