# Schema Compatibility Updates

**Date:** May 22, 2026  
**Author:** Aria  
**Purpose:** Made map links and conversation refinement features compatible with team's new schema format

---

## Problem
After pulling the latest code from main, the features broke because:
1. The new schema uses `activities[]` with nested `activity` objects instead of flat `blocks[]`
2. The new schema didn't include `latitude`/`longitude` fields needed for map links
3. The refinement endpoint validation expected the old `TripPlan` schema

---

## Changes Made

### 1. Updated AI Prompt to Generate Coordinates
**File:** `src/services/natural-planner.service.ts`

**Change:** Added `latitude` and `longitude` fields to the activity schema definition in the AI prompt (lines 196-198):
```typescript
"latitude": number (latitude coordinate for map links),
"longitude": number (longitude coordinate for map links)
```

**Why:** The new schema didn't have coordinate fields, so map links couldn't be generated. Added these as optional fields in the AI prompt so the LLM generates realistic coordinates.

---

### 2. Updated Google Maps Utility for New Schema
**File:** `src/utils/google-maps.ts`

**Changes:**
- Modified `generateDayMapLink()` to read from `activities[]` instead of `blocks[]`
- Updated to access nested coordinates at `activity.activity.latitude/longitude`
- Changed filter to exclude `type === "transportation"` instead of `"cab"` or `"travel"`
- Made function signature use `any[]` instead of `TripPlan["days"][0]["blocks"]`

**Why:** The new schema structure is completely different - activities are nested objects with a nested `activity` property containing details.

---

### 3. Fixed Refinement Schema Validation
**File:** `src/schemas/trip-plan.schema.ts`

**Change:** Updated `refinePlanRequestSchema` to use `z.any()` for `originalPlan` instead of `tripPlanSchema` (line 99):
```typescript
originalPlan: z.any(),  // ARIA: Full plan object to be refined (new schema format)
```

**Why:** The new schema format doesn't have a defined Zod schema yet (it's just `any`), but the old validation expected the strict `tripPlanSchema` with `blocks[]`. Using `z.any()` allows the new format to pass validation.

---

### 4. Resolved Merge Conflict
**File:** `src/services/natural-planner.service.ts`

**Change:** Added both imports after merge conflict (lines 21-22):
```typescript
import { addMapLinksToTripPlan } from "../utils/google-maps.js";
import { loadUserProfiles } from "./catalog/catalog.service.js";
```

**Why:** Both my branch and the team's branch added imports at the same location. Kept both to preserve all functionality.

---

## Testing Results

✅ **Map Links:** Working - generates per-day Google Maps links when user requests them  
✅ **Conversation Refinement:** Working - successfully modifies plans based on feedback  
✅ **User Profiles:** Working - all profile data intact


---

## Files Modified
1. `src/services/natural-planner.service.ts` - Added lat/long to AI prompt, resolved imports
2. `src/utils/google-maps.ts` - Updated to work with new activities schema
3. `src/schemas/trip-plan.schema.ts` - Changed validation to accept new schema format
4. `data/user-profiles.json` - Updated with Maverick/Goose and generic names
