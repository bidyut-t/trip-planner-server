/**
 * Delta-Based Refinement Service
 * 
 * Handles conversational plan modifications using a delta-based approach.
 * Instead of regenerating the entire plan (which causes data loss),
 * the AI generates only the changes (deltas) as structured operations.
 * 
 * Architecture:
 * 1. AI analyzes user request and current plan
 * 2. AI returns delta operations: add/remove/modify
 * 3. Backend applies deltas to existing plan
 * 4. Original activities remain unchanged, preserving all data
 */

import { runOpenAiPrompt } from "../utils/openai-mcp-agent.js";
import { parseLlmJson } from "../utils/llm-json.js";
import { loadUserProfiles } from "./catalog/catalog.service.js";
import { validateAndFixDelta } from "../utils/delta-validator.js";
import { extractClosingTime, normalizeTimeForSorting, convertTo12Hour, subtractMinutes, getTimeDiffMinutes } from "../utils/time-utils.js";
import { forceValidTimeline } from "../utils/force-timeline.js";
import type { UserProfile } from "../schemas/user-profile.schema.js";
import type { TripPlan } from "../schemas/trip-plan.schema.js";

/**
 * Delta operation types with smart scheduling
 */
export type DeltaOperation = 
  | { 
      type: "add"; 
      activities: any[]; 
      placement?: {
        strategy: "insert_before" | "insert_after" | "replace" | "replace_and_shift";
        targetActivity?: string;
        adjustments?: Array<{
          activityName: string;
          newStart: string;
          newEnd: string;
        }>;
      };
      // Legacy fields for backward compatibility
      insertAfter?: string; 
      insertAt?: "start" | "end";
    }
  | { type: "remove"; activityNames: string[] }
  | { type: "modify"; activityName: string; changes: any }
  | { type: "reorder"; newOrder: string[] };

export interface RefinementDelta {
  operations: DeltaOperation[];
  conversationalResponse: string;
}

/**
 * Generate refinement deltas from user feedback
 * 
 * The AI generates only the required changes, not the entire plan.
 * This approach keeps the AI focused on generating complete data for new items.
 * 
 * @param originalPlan - Current plan (never modified, only referenced)
 * @param feedback - User's modification request
 * @param userId - Optional user ID for personalization
 * @returns Delta operations to apply to the plan
 */
export async function generateRefinementDeltas(
  originalPlan: TripPlan,
  feedback: string,
  userId?: string,
): Promise<RefinementDelta> {
  // Load user profile for context
  let userProfile: UserProfile | undefined;
  if (userId) {
    const userProfiles = await loadUserProfiles();
    userProfile = userProfiles.find(p => p.id === userId);
  }

  const profileContext = userProfile ? `
User Profile Context:
- Name: ${userProfile.name}
- Travel Style: ${userProfile.travelStyle}
- Budget: ${userProfile.budgetLevel}
- Dietary Restrictions: ${userProfile.dietaryRestrictions.join(", ") || "None"}
- Accessibility Needs: ${userProfile.accessibilityNeeds.join(", ") || "None"}
` : "";

  // Serialize current plan for AI reference - include FULL timeline with times AND NAMES
  const currentPlanSummary = originalPlan.days?.map((day, idx) => {
    const activities = day.blocks || [];
    return `Day ${idx + 1} (${day.date}):
${activities.map((act: any, i: number) => {
  const startTime = act.start || act.startTime || '';
  const endTime = act.end || act.endTime || '';
  const name = act.title || act.name || act.activity?.name || 'Activity';
  const price = act.price || act.activity?.price || '';
  const type = act.type || act.activity?.type || '';
  return `  ${i + 1}. [${startTime}-${endTime}] "${name}" (${type}) ${price ? '$' + price : ''}`;
}).join('\n')}

WARNING: When using REMOVE or MODIFY operations, you MUST copy the activity names EXACTLY as shown above (in quotes).`;
  }).join('\n\n');

  const prompt = `You are a trip planning assistant helping modify an existing itinerary.

CURRENT PLAN:
${currentPlanSummary}

${profileContext}

USER REQUEST:
"${feedback}"

YOUR TASK:
Generate ONLY the changes needed (deltas). Don't regenerate the entire plan.

**CRITICAL RULE**: A day should have 6-7 activities MAX and end by 10 PM. When adding activities, you MUST remove or shorten others to maintain balance.

**NO OVERLAPS ALLOWED**: Look at the CURRENT PLAN timeline above. When adding activities, you MUST find EMPTY time slots. 
   - Example: Current plan has activity 2:00 PM - 4:00 PM → You CANNOT schedule anything between 2:00 PM - 4:00 PM!
   - You must schedule BEFORE (e.g., 12:00 PM - 2:00 PM) or AFTER (e.g., 4:00 PM - 6:00 PM)
   - If NO gaps exist, you MUST REMOVE an existing activity first to make room!

REQUEST TYPES:

1. ADD ACTIVITIES:
   **SMART ADDITION PROCESS:**
   - Step 1: READ the CURRENT PLAN timeline above - note ALL occupied time slots
   - Step 2: Count current activities in timeline
   - Step 3: If already 6+ activities, you MUST REMOVE something to make room
   - Step 4: Find an EMPTY time slot (gaps between existing activities)
   - Step 5: Add the new activities with realistic times IN THE EMPTY SLOTS
   - Step 6: Ensure day still ends by 10 PM
   - Step 7: VERIFY no overlaps - new activity must NOT conflict with ANY existing activity
   
   Example: "add more museums" when plan has 3 restaurants + 2 sightseeing + 1 activity (6 total)
   CORRECT: Remove 1 restaurant, add 2 museums IN EMPTY TIME SLOTS → 2 restaurants + 2 sightseeing + 2 museums (6 total)
   WRONG: Just add 2 museums → 3 restaurants + 2 sightseeing + 1 activity + 2 museums (8 total - TOO MANY!)
   WRONG: Add museum at same time as existing activity (OVERLAP!)
   
   Quantity:
   - Plural words ("activities", "museums") = add 2
   - Singular ("an activity", "a museum") = add 1
   - "multiple/several" = 2, "more/many" = 2-3
   - Specific number = exact amount requested

2. MODIFY ACTIVITIES:
   - "accessible" = add wheelchair/elevator notes to ALL activities
   - "budget-friendly" = replace expensive with cheaper alternatives
   - "with elderly" = slower pace, rest breaks, accessibility
   - "faster pace" = reduce durations, fit more activities

3. SHORTEN DAY (e.g., "end by 9pm"):
   CRITICAL: Last activity must end AT OR BEFORE requested time.
   
   Process:
   a) Identify current last activity end time
   b) Calculate time to save
   c) Work backwards: shorten/remove activities from end
   d) Compress durations (museums: 3h→2h, meals: 2h→1.5h)
   e) VERIFY: Check that last activity now ends by requested time
      - If still too late, REMOVE MORE activities
      - Do NOT submit until verification passes

4. REMOVE ACTIVITIES:
   - Remove ONLY activities explicitly mentioned
   - Use EXACT names from timeline above

OPERATION TYPES:

1. ADD new activities:
{
  "type": "add",
  "activities": [{
    "name": "The Metropolitan Museum of Art",
    "type": "sightseeing",
    "start": "10:30 AM",
    "end": "1:00 PM",
    "price": 30,
    "currency": "USD",
    "rating": 4.9,
    "reviews": 50000,
    "latitude": 40.7794,
    "longitude": -73.9632,
    "images": ["https://images.unsplash.com/photo-1566127444941-248386129999?w=400"],
    "description": "One of the world's largest art museums.",
    "highlights": ["Temple of Dendur", "European Paintings"],
    "availability": "10am-5pm",
    "earnPoints": 0,
    "duration": "2.5 hours"
  }],
  "placement": {
    "strategy": "replace_and_shift",
    "targetActivity": "Empire State Building Tour",
    "adjustments": [{
      "activityName": "Joe's Pizza",
      "newStart": "2:00 PM",
      "newEnd": "3:00 PM"
    }]
  }
}

2. REMOVE activities:
{ "type": "remove", "activityNames": ["Central Park Zoo"] }

3. MODIFY activity:
{
  "type": "modify",
  "activityName": "Whitney Museum",
  "changes": {
    "notes": "Wheelchair accessible. Elevators available.",
    "duration": "2 hours"
  }
}

CRITICAL RULES:
1. TIME FORMAT: 12-hour with AM/PM ("8:30 AM", "2:00 PM", "7:30 PM")
2. END AFTER START: End time MUST be later than start time. 
   
   NEVER DO THIS: "2:00 PM - 2:00 AM" (goes backwards!)
   NEVER DO THIS: "7:30 PM - 5:00 PM" (goes backwards!)
   NEVER DO THIS: "11:00 AM - 2:00 AM" (crosses midnight - not allowed!)
   
   CORRECT: "7:00 PM - 9:00 PM" (forward in time, same day)
   CORRECT: "11:00 AM - 1:00 PM" (forward in time, same day)
   CORRECT: "2:00 PM - 4:00 PM" (forward in time, same day)
   
   **RULE: All activities must be SAME-DAY. End time must be later in the day than start time.**
   **If you catch yourself about to write PM-to-AM, STOP. That's wrong.**

3. NO OVERLAPS (ABSOLUTELY CRITICAL - THIS IS THE #1 MISTAKE):
   
   **LOOK AT THE TIMELINE ABOVE CAREFULLY BEFORE SCHEDULING!**
   
   When adding an activity, you MUST find an EMPTY time slot:
   
   Example Timeline:
   1. [8:30 AM-10:00 AM] Breakfast
   2. [10:30 AM-1:30 PM] Guided Tour  
   3. [2:00 PM-4:00 PM] Joe's Pizza ← OCCUPIED
   4. [7:30 PM-10:00 PM] Dinner
   
   CORRECT ways to add Museum:
   - Option A: "1:30 PM - 2:00 PM" (fills gap between tour and pizza)
   - Option B: "4:00 PM - 7:30 PM" (fills gap between pizza and dinner)
   - Option C: REMOVE Joe's Pizza, then schedule Museum "2:00 PM - 4:00 PM"
   
   WRONG - These cause OVERLAPS:
   - "2:00 PM - 4:00 PM" ← OVERLAPS with Joe's Pizza (same exact time!)
   - "1:00 PM - 3:00 PM" ← OVERLAPS with Guided Tour (ends 1:30) AND Joe's Pizza (starts 2:00)
   - "3:00 PM - 5:00 PM" ← OVERLAPS with Joe's Pizza (2:00-4:00)
   
   **PROCESS:**
   1. Read the CURRENT PLAN timeline carefully
   2. Identify ALL occupied time slots
   3. Find GAPS between activities
   4. Schedule new activities ONLY in the gaps
   5. If no gaps exist, REMOVE something first!
4. AVAILABILITY STRING (Business Hours - separate from activity times):
   
   **This field describes when the venue is OPEN, not when the user visits.**
   
   ✓ CORRECT EXAMPLES:
   - "10am-6pm" = Museum open 10 AM to 6 PM
   - "11am-10pm" = Restaurant open 11 AM to 10 PM  
   - "9am-5pm" = Store open 9 AM to 5 PM
   
   ✗ WRONG: "11am-2am" - Don't use overnight hours. If a venue closes at 2 AM, use "11am-11pm" instead.
   
   **For restaurants/venues open late, cap at 11 PM in the availability string.**

5. ACTIVITY START/END TIMES (When user actually visits):
   
   - Schedule activities at realistic times WITHIN the availability hours
   - Example: Restaurant "11am-10pm" → Schedule dinner "7:00 PM - 9:00 PM" (2 hours)
   - The activity times (start/end) must be a SUBSET of availability hours
   - Use common sense durations: Meals 1-2 hrs, Museums 2-3 hrs, Shows match event length
   
   **YOU MUST RESPECT BUSINESS HOURS - THIS IS NON-NEGOTIABLE**
   
   - Parse the "availability" field to find closing time
   - Activity END time MUST be ≤ closing time (at or before)
   - If you don't know closing time, assume conservative 8:00 PM
   
   **EXAMPLES OF CORRECT SCHEDULING:**
   ✓ Museum "10am-6pm" + activity "3:00 PM - 6:00 PM" = CORRECT (ends at closing)
   ✓ Museum "10am-6pm" + activity "2:00 PM - 5:00 PM" = CORRECT (ends before closing)
   ✓ Restaurant "11am-8pm" + dinner "6:00 PM - 8:00 PM" = CORRECT (ends at closing)
   
   **EXAMPLES OF WRONG SCHEDULING (DO NOT DO THIS):**
   ✗ Museum "10am-6pm" + activity "4:00 PM - 7:00 PM" = WRONG (7pm > 6pm closing)
   ✗ Restaurant "11am-8pm" + dinner "7:00 PM - 9:00 PM" = WRONG (9pm > 8pm closing)
   ✗ Store "9am-5pm" + shopping "3:00 PM - 6:00 PM" = WRONG (6pm > 5pm closing)
   
   **HOW TO CALCULATE:**
   1. Find closing time from availability (e.g., "10am-6pm" → closes at 6pm)
   2. Decide activity duration (e.g., 3 hours)
   3. Calculate: START = CLOSING - DURATION
      Example: 6pm closing - 3 hours = start at 3pm
   4. Schedule: "3:00 PM - 6:00 PM" ✓
   
6. USE EXACT NAMES: When removing/modifying, copy activity names EXACTLY from timeline (in quotes)
7. REAL DATA: Use real places in ${originalPlan.destination}, realistic prices, ratings 4.0-5.0
8. INCLUDE ALL FIELDS: name, type, start, end, price, rating, reviews, images, description, highlights, latitude, longitude, availability

RESPONSE FORMAT:
{
  "operations": [{ /* operations */ }],
  "conversationalResponse": "I've added The Met to your morning and shifted lunch to 2pm."
}

Reply with JSON only.`;

  try {
    const raw = await runOpenAiPrompt(prompt);
    const delta = parseLlmJson(raw) as RefinementDelta;
    
    // Validate response structure
    if (!delta.operations || !Array.isArray(delta.operations)) {
      throw new Error("Invalid delta response: missing operations array");
    }
    
    console.log('[delta-refiner] Running strict time validation...');
    
    // Pre-check: Verify REMOVE/MODIFY operation names will match activities (only if plan has activities)
    const currentActivityNames = originalPlan.days?.[0]?.blocks?.map((act: any) => 
      act.title || act.name || act.activity?.name || 'Unknown'
    ) || [];
    
    if (currentActivityNames.length > 0) {
      console.log(`[delta-refiner] Current plan has ${currentActivityNames.length} activities:`, currentActivityNames.map(n => `"${n}"`).join(', '));
      
      for (const op of delta.operations) {
        if (op.type === 'remove') {
          for (const targetName of op.activityNames) {
            const found = currentActivityNames.some((name: string) => 
              name.toLowerCase().includes(targetName.toLowerCase())
            );
            if (!found) {
              console.error(`[delta-refiner] REMOVE will FAIL: Cannot find "${targetName}" in current plan`);
              console.error(`[delta-refiner] Available activities: ${currentActivityNames.join(', ')}`);
              throw new Error(
                `REMOVE operation failure: Activity "${targetName}" not found in current plan. ` +
                `Available activities are: ${currentActivityNames.map(n => `"${n}"`).join(', ')}. ` +
                `You MUST use the EXACT names shown in the timeline above (in quotes).`
              );
            }
          }
        }
        
        if (op.type === 'modify') {
          const found = currentActivityNames.some((name: string) => 
            name.toLowerCase().includes(op.activityName.toLowerCase())
          );
          if (!found) {
            console.error(`[delta-refiner] MODIFY will FAIL: Cannot find "${op.activityName}" in current plan`);
            console.error(`[delta-refiner] Available activities: ${currentActivityNames.join(', ')}`);
            throw new Error(
              `MODIFY operation failure: Activity "${op.activityName}" not found in current plan. ` +
              `Available activities are: ${currentActivityNames.map(n => `"${n}"`).join(', ')}. ` +
              `You MUST use the EXACT names shown in the timeline above (in quotes).`
            );
          }
        }
      }
    }
    
    // Now validate ADD operations for time issues
    for (const op of delta.operations) {
      if (op.type === 'add' && op.activities) {
        for (const activity of op.activities) {
          const activityName = activity.name || 'Unknown Activity';
          
          // Check 1: Times must be present
          if (!activity.start || !activity.end) {
            console.error(`[delta-refiner] MISSING TIMES: "${activityName}"`);
            throw new Error(
              `Activity "${activityName}" is missing start or end time. Both are required.`
            );
          }
          
          const startTime24 = normalizeTimeForSorting(activity.start);
          const endTime24 = normalizeTimeForSorting(activity.end);
          
          console.log(`[delta-refiner] Validating "${activityName}": ${activity.start} (${startTime24}) to ${activity.end} (${endTime24})`);
          
          // Check 2: End time must be after start time
          if (endTime24 <= startTime24) {
            console.error(`[delta-refiner] BACKWARD TIME: "${activityName}" ${activity.start} to ${activity.end}`);
            throw new Error(
              `INVALID TIME: "${activityName}" ends at ${activity.end} but starts at ${activity.start}. ` +
              `End time must be AFTER start time. Fix this immediately.`
            );
          }
          
          // Check 2.5: NEW activity must NOT overlap with EXISTING activities in the plan
          const existingActivities = originalPlan.days?.[0]?.blocks || [];
          for (const existing of existingActivities) {
            const existingAny = existing as any;
            const existingName = existingAny.title || existingAny.name || 'Unknown';
            const existingStart = normalizeTimeForSorting(existingAny.start || existingAny.startTime || '00:00');
            const existingEnd = normalizeTimeForSorting(existingAny.end || existingAny.endTime || '23:59');
            
            // Check if times overlap: new activity starts before existing ends AND new activity ends after existing starts
            const overlaps = (startTime24 < existingEnd) && (endTime24 > existingStart);
            
            if (overlaps) {
              console.error(`[delta-refiner] OVERLAP DETECTED: New "${activityName}" (${activity.start}-${activity.end}) overlaps with existing "${existingName}" (${existingAny.start || existingAny.startTime}-${existingAny.end || existingAny.endTime})`);
              throw new Error(
                `OVERLAP ERROR: You're trying to add "${activityName}" at ${activity.start}-${activity.end}, but "${existingName}" is already scheduled at ${existingAny.start || existingAny.startTime}-${existingAny.end || existingAny.endTime}.\n\n` +
                `You CANNOT schedule two activities at the same time!\n\n` +
                `CURRENT TIMELINE:\n${existingActivities.map((a: any) => `  [${a.start || a.startTime}-${a.end || a.endTime}] ${a.title || a.name}`).join('\n')}\n\n` +
                `HOW TO FIX:\n` +
                `Option 1: Schedule "${activityName}" in an EMPTY time slot (find a gap in the timeline)\n` +
                `Option 2: REMOVE "${existingName}" first, then add "${activityName}"\n` +
                `Option 3: Schedule "${activityName}" BEFORE or AFTER "${existingName}"\n\n` +
                `Look at the CURRENT TIMELINE above and find an available time slot!`
              );
            }
          }
          
          // Check 3: Activity must end before/at closing time (STRICT)
          if (activity.availability) {
            const closingTime = extractClosingTime(activity.availability);
            console.log(`[delta-refiner] Checking closing time for "${activityName}": availability="${activity.availability}" → closing=${closingTime}`);
            
            if (closingTime) {
              if (endTime24 > closingTime) {
                const closingTime12 = convertTo12Hour(closingTime);
                const minutesOver = getTimeDiffMinutes(closingTime, endTime24);
                
                console.error(`[delta-refiner] PAST CLOSING: "${activityName}" ends ${activity.end} (${endTime24}) but closes at ${closingTime12}`);
                throw new Error(
                  `BUSINESS HOURS VIOLATION: "${activityName}" is scheduled ${activity.start}-${activity.end} but closes at ${closingTime12}.\n\n` +
                  `You are ${minutesOver} minutes PAST closing time. This is NOT allowed.\n\n` +
                  `HOW TO FIX:\n` +
                  `Option 1: Start the activity EARLIER so it ends by ${closingTime12}\n` +
                  `  Example: If you need 3 hours, start at ${convertTo12Hour(subtractMinutes(closingTime, 180))} to end at ${closingTime12}\n` +
                  `Option 2: SHORTEN the activity duration to fit before closing\n` +
                  `  Example: Make it 2 hours instead of 3 hours\n\n` +
                  `Current schedule: ${activity.start}-${activity.end} ← WRONG\n` +
                  `Must end by: ${closingTime12} ← REQUIRED`
                );
              }
              console.log(`[delta-refiner] ✓ Closing time OK: ${endTime24} <= ${closingTime}`);
            }
          }
        }
      }
      
      if (op.type === 'modify' && op.changes) {
        if (op.changes.start && op.changes.end) {
          const startTime24 = normalizeTimeForSorting(op.changes.start);
          const endTime24 = normalizeTimeForSorting(op.changes.end);
          
          if (endTime24 <= startTime24) {
            console.error(`[delta-refiner] BACKWARD TIME (MODIFY): "${op.activityName}" ${op.changes.start} to ${op.changes.end}`);
            throw new Error(
              `INVALID TIME: Modified "${op.activityName}" ends at ${op.changes.end} but starts at ${op.changes.start}. ` +
              `End time must be AFTER start time.`
            );
          }
        }
      }
    }
    
    // Check 4: If user requested "end by [TIME]", validate STRICTLY
    const requestedEndTime = extractRequestedEndTime(feedback);
    if (requestedEndTime) {
      console.log(`[delta-refiner] User requested to end by: ${convertTo12Hour(requestedEndTime)}`);
      
      // Simulate applying deltas to check final end time
      const tempPlan = applyDeltasToPlan(originalPlan, delta);
      const actualEndTime = getFinalActivityEndTime(tempPlan);
      
      console.log(`[delta-refiner] After applying deltas, plan ends at: ${actualEndTime ? convertTo12Hour(actualEndTime) : 'UNKNOWN - THIS IS A PROBLEM'}`);
      
      // If we can't determine the end time, something went wrong
      if (!actualEndTime) {
        console.error(`[delta-refiner] CANNOT DETERMINE END TIME - Operations likely failed to apply!`);
        throw new Error(
          `Cannot verify end time requirement. The delta operations may not be finding the correct activities. ` +
          `Please ensure you are using EXACT activity names from the timeline shown above. ` +
          `Check the timeline carefully and copy activity names EXACTLY as shown (including quotes).`
        );
      }
      
      if (actualEndTime > requestedEndTime) {
        const gapMinutes = getTimeDiffMinutes(requestedEndTime, actualEndTime);
        console.error(`[delta-refiner] EXCEEDS END TIME: User wants ${convertTo12Hour(requestedEndTime)}, plan ends ${convertTo12Hour(actualEndTime)} (${gapMinutes} min late)`);
        throw new Error(
          `END TIME VIOLATION: User explicitly requested to end by ${convertTo12Hour(requestedEndTime)}, but your plan ends at ${convertTo12Hour(actualEndTime)}. ` +
          `This is NOT acceptable. You must REMOVE or SHORTEN more activities until the last activity ends by ${convertTo12Hour(requestedEndTime)}. ` +
          `Current gap: ${gapMinutes} minutes too late. Work backwards from the end and remove/shorten activities.`
        );
      }
      
      console.log(`[delta-refiner] ✓ End time validation PASSED: ${convertTo12Hour(actualEndTime)} <= ${convertTo12Hour(requestedEndTime)}`);
    }
    
    console.log('[delta-refiner] All validation checks PASSED');
    
    // **LEVEL 1 VALIDATION**: Auto-fix issues, log server-side, no UI errors
    const { delta: validatedDelta, validation } = validateAndFixDelta(delta, feedback, originalPlan);
    
    if (validation.autoFixedCount > 0) {
      console.log(`[delta-refiner] ✓ Auto-fixed ${validation.autoFixedCount} issues (professional UX maintained)`);
    }
    
    // **CRITICAL POST-VALIDATION**: Apply deltas and validate the RESULT
    const tempPlan = applyDeltasToPlan(originalPlan, validatedDelta);
    const finalActivities = tempPlan.days?.[0]?.blocks || [];
    
    console.log(`[delta-refiner] POST-VALIDATION: Checking final plan with ${finalActivities.length} activities`);
    
    // Check 1: Validate closing times in final plan
    for (const activity of finalActivities) {
      const activityAny = activity as any;
      if (activityAny.availability) {
        const activityName = activityAny.title || activityAny.name || 'Unknown';
        const endTime24 = normalizeTimeForSorting(activityAny.end || '');
        const closingTime = extractClosingTime(activityAny.availability);
        
        if (closingTime && endTime24 > closingTime) {
          console.error(`[delta-refiner] FINAL PLAN VIOLATION: "${activityName}" ends at ${activityAny.end} but closes at ${convertTo12Hour(closingTime)}`);
          throw new Error(
            `FINAL PLAN ERROR: Activity "${activityName}" is scheduled ${activityAny.start}-${activityAny.end} but the venue closes at ${convertTo12Hour(closingTime)}. ` +
            `This is NOT acceptable. Adjust the activity to end by ${convertTo12Hour(closingTime)}.`
          );
        }
      }
    }
    
    // Check 2: Validate NO overlaps in final plan
    for (let i = 1; i < finalActivities.length; i++) {
      const prev = finalActivities[i - 1] as any;
      const curr = finalActivities[i] as any;
      
      const prevEnd = normalizeTimeForSorting(prev.end || '23:59');
      const currStart = normalizeTimeForSorting(curr.start || '00:00');
      
      if (currStart < prevEnd) {
        const prevName = prev.title || prev.name || 'Unknown';
        const currName = curr.title || curr.name || 'Unknown';
        console.error(`[delta-refiner] OVERLAP IN FINAL PLAN: "${prevName}" (${prev.start}-${prev.end}) overlaps with "${currName}" (${curr.start}-${curr.end})`);
        throw new Error(
          `SCHEDULE CONFLICT: "${prevName}" ends at ${prev.end} but "${currName}" starts at ${curr.start}. ` +
          `Activities cannot overlap. Please adjust the start/end times so "${currName}" starts AFTER ${prev.end}.`
        );
      }
    }
    
    console.log(`[delta-refiner] ✓ POST-VALIDATION: All checks PASSED`);
    
    return validatedDelta;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[delta-refiner] Failed to generate deltas:", detail);
    throw new Error(`Failed to generate refinement deltas: ${detail}`);
  }
}

/**
 * Apply delta operations to an existing trip plan
 * 
 * This is where the magic happens - we modify the plan programmatically
 * without ever sending it back through the AI (which would lose data).
 * 
 * INCLUDES OVERLAP DETECTION: Automatically detects and fixes time conflicts
 * 
 * @param originalPlan - The current plan
 * @param delta - Delta operations to apply
 * @returns Modified plan with deltas applied and overlaps resolved
 */
export function applyDeltasToPlan(originalPlan: TripPlan, delta: RefinementDelta): TripPlan {
  // Deep clone to avoid mutations
  const modifiedPlan = JSON.parse(JSON.stringify(originalPlan));
  
  if (!modifiedPlan.days || modifiedPlan.days.length === 0) {
    return modifiedPlan;
  }

  // For simplicity, we'll apply all operations to the first day
  // (Multi-day support can be added later)
  const day = modifiedPlan.days[0];
  let activities = day.blocks || day.activities || [];

  for (const op of delta.operations) {
    switch (op.type) {
      case "add": {
        // Convert new activities to the schema format
        const newActivities = op.activities.map(act => ({
          start: act.start,
          end: act.end,
          type: act.type,
          title: act.name,
          partner: false,
          source: "suggested",
          addFromOurRecommendation: false,
          notes: act.description,
          latitude: act.latitude,
          longitude: act.longitude,
          price: act.price,
          currency: act.currency || "USD",
          rating: act.rating,
          reviews: act.reviews,
          earnPoints: act.earnPoints || 0,
          duration: act.duration,
          bookingUrl: act.bookingUrl,
          images: act.images || [],
          highlights: act.highlights || [],
          availability: act.availability,
          cancellationPolicy: act.cancellationPolicy,
        }));

        // Apply time adjustments for smart placement
        if (op.placement?.adjustments) {
          for (const adjustment of op.placement.adjustments) {
            const activityIndex = activities.findIndex((a: any) =>
              (a.title || a.name || '').toLowerCase().includes(adjustment.activityName.toLowerCase())
            );
            if (activityIndex >= 0) {
              activities[activityIndex] = {
                ...activities[activityIndex],
                start: adjustment.newStart,
                end: adjustment.newEnd,
              };
            }
          }
        }

        // Insert new activities based on strategy
        if (op.placement?.strategy === "replace") {
          // Replace target activity
          const targetIndex = activities.findIndex((a: any) =>
            (a.title || a.name || '').toLowerCase().includes(op.placement!.targetActivity!.toLowerCase())
          );
          if (targetIndex >= 0) {
            activities.splice(targetIndex, 1, ...newActivities);
          } else {
            activities.push(...newActivities);
          }
        } else if (op.placement?.strategy === "replace_and_shift") {
          // Replace target and adjustments already applied above
          const targetIndex = activities.findIndex((a: any) =>
            (a.title || a.name || '').toLowerCase().includes(op.placement!.targetActivity!.toLowerCase())
          );
          if (targetIndex >= 0) {
            activities.splice(targetIndex, 0, ...newActivities);
          } else {
            activities.push(...newActivities);
          }
        } else if (op.placement?.strategy === "insert_before") {
          const targetIndex = activities.findIndex((a: any) =>
            (a.title || a.name || '').toLowerCase().includes(op.placement!.targetActivity!.toLowerCase())
          );
          if (targetIndex >= 0) {
            activities.splice(targetIndex, 0, ...newActivities);
          } else {
            activities.push(...newActivities);
          }
        } else if (op.placement?.strategy === "insert_after") {
          const targetIndex = activities.findIndex((a: any) =>
            (a.title || a.name || '').toLowerCase().includes(op.placement!.targetActivity!.toLowerCase())
          );
          if (targetIndex >= 0) {
            activities.splice(targetIndex + 1, 0, ...newActivities);
          } else {
            activities.push(...newActivities);
          }
        } else if (op.insertAfter) {
          // Legacy: Find insertion point
          const insertIndex = activities.findIndex((a: any) => 
            (a.title || a.name || '').toLowerCase().includes(op.insertAfter!.toLowerCase())
          );
          if (insertIndex >= 0) {
            activities.splice(insertIndex + 1, 0, ...newActivities);
          } else {
            activities.push(...newActivities);
          }
        } else if (op.insertAt === "start") {
          activities.unshift(...newActivities);
        } else {
          activities.push(...newActivities);
        }
        
        // Sort activities by start time to maintain chronological order
        // Sort activities chronologically
        activities.sort((a: any, b: any) => {
          const timeA = normalizeTimeForSorting(a.start || a.startTime || '00:00');
          const timeB = normalizeTimeForSorting(b.start || b.startTime || '00:00');
          return timeA.localeCompare(timeB);
        });
        
        // Note: Overlap resolution disabled - it was causing activities to shift to midnight
        // to late times when user wanted to shorten the day.
        // The AI is now responsible for providing correct, non-overlapping times.
        // activities = resolveTimeOverlaps(activities);
        break;
      }

      case "remove": {
        const beforeCount = activities.length;
        activities = activities.filter((a: any) => {
          const activityName = a.title || a.name || a.activity?.name || '';
          const shouldRemove = op.activityNames.some(name => 
            activityName.toLowerCase().includes(name.toLowerCase())
          );
          if (shouldRemove) {
            console.log(`[delta-refiner] REMOVING: "${activityName}"`);
          }
          return !shouldRemove;
        });
        console.log(`[delta-refiner] Removed ${beforeCount - activities.length} activities`);
        break;
      }

      case "modify": {
        const activityName = op.activityName;
        const activityIndex = activities.findIndex((a: any) => {
          const name = a.title || a.name || a.activity?.name || '';
          return name.toLowerCase().includes(activityName.toLowerCase());
        });
        if (activityIndex >= 0) {
          console.log(`[delta-refiner] MODIFYING: "${activities[activityIndex].title || activities[activityIndex].name || activities[activityIndex].activity?.name}"`);
          activities[activityIndex] = {
            ...activities[activityIndex],
            ...op.changes,
          };
        } else {
          console.warn(`[delta-refiner] Could not find activity to modify: "${activityName}"`);
        }
        break;
      }

      case "reorder": {
        // Not implemented yet - would reorder based on activity names
        console.warn("[delta-refiner] Reorder operation not yet implemented");
        break;
      }
    }
  }

  // Sort activities chronologically and validate times
  activities.sort((a: any, b: any) => {
    const timeA = normalizeTimeForSorting(a.start || a.startTime || '00:00');
    const timeB = normalizeTimeForSorting(b.start || b.startTime || '00:00');
    return timeA.localeCompare(timeB);
  });
  
  // Validate: no backwards time jumps or overlaps
  for (let i = 1; i < activities.length; i++) {
    const prev = activities[i - 1];
    const curr = activities[i];
    
    const prevEnd = normalizeTimeForSorting(prev.end || prev.endTime || '23:59');
    const currStart = normalizeTimeForSorting(curr.start || curr.startTime || '00:00');
    
    if (currStart < prevEnd) {
      // Overlap detected: Log warning but don't auto-shift (AI should fix this)
      const prevName = prev.title || prev.name || prev.activity?.name || 'Unknown';
      const currName = curr.title || curr.name || curr.activity?.name || 'Unknown';
      console.warn(`[delta-refiner] TIME CONFLICT: "${prevName}" ends at ${prevEnd} but "${currName}" starts at ${currStart}`);
    }
  }

  // Update the day with modified activities
  if (day.blocks) {
    day.blocks = activities;
  } else {
    day.activities = activities;
  }

  // Force valid timeline (no overlaps, no backwards times)
  return forceValidTimeline(modifiedPlan);
}

/**
 * Extract requested end time from user feedback
 * Examples: "end by 9pm" → "21:00", "make it end by 8" → "20:00"
 */
function extractRequestedEndTime(feedback: string): string | null {
  if (!feedback) return null;
  
  const lowerFeedback = feedback.toLowerCase();
  
  // Patterns: "end by 9pm", "end by 9", "finish by 8pm", "done by 7"
  const patterns = [
    /end\s+by\s+(\d{1,2}):?(\d{2})?\s*(am|pm)?/i,
    /finish\s+by\s+(\d{1,2}):?(\d{2})?\s*(am|pm)?/i,
    /done\s+by\s+(\d{1,2}):?(\d{2})?\s*(am|pm)?/i,
  ];
  
  for (const pattern of patterns) {
    const match = lowerFeedback.match(pattern);
    if (match) {
      let hour = parseInt(match[1], 10);
      const min = match[2] ? parseInt(match[2], 10) : 0;
      const period = match[3] ? match[3].toUpperCase() : null;
      
      // If no AM/PM specified and hour < 12, assume PM (since "end by 9" usually means 9pm)
      if (!period) {
        if (hour < 12 && hour >= 1) {
          hour += 12;  // Assume PM for single-digit hours
        }
      } else if (period === 'PM' && hour !== 12) {
        hour += 12;
      } else if (period === 'AM' && hour === 12) {
        hour = 0;
      }
      
      return `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
    }
  }
  
  return null;
}

/**
 * Get the end time of the last activity in the plan
 */
function getFinalActivityEndTime(plan: TripPlan): string | null {
  if (!plan.days || plan.days.length === 0) return null;
  
  // Get last day
  const lastDay = plan.days[plan.days.length - 1];
  const activities = lastDay.blocks || [];
  
  if (activities.length === 0) return null;
  
  // Get last activity
  const lastActivity = activities[activities.length - 1];
  const endTime = lastActivity.end;
  
  if (!endTime) return null;
  
  return normalizeTimeForSorting(endTime);
}

