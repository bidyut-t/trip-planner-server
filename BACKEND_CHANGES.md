# Backend Changes - API Unification

## Overview

This document outlines the recent changes made to unify the trip planning API for better frontend integration and simpler architecture.

### Changes Made in This Update:
1. **Unified API Endpoint** - Consolidated trip planning and refinement into single endpoint
2. **Schema Updates** - Added optional `previousPlan` parameter support

### Existing CodeFest Features (Already Implemented):
1. **Google Maps Link Generation** - Programmatic map links for daily routes
2. **User Profile Personalization** - AI-powered trip customization based on user preferences
3. **Conversational Plan Refinement** - Iterative plan improvements with natural language

---

## Key Changes in This Update

### 1. Unified API Endpoint

**Problem:** Previously had two separate endpoints for trip planning
- `/api/trips/plan/natural` - Generate new trips
- `/api/trips/plan/refine` - Modify existing trips

**Solution:** Merged into single unified endpoint

**Files Changed:**
- `src/routes/trip.routes.ts` - Added smart routing logic
- `src/schemas/trip-plan.schema.ts` - Added `previousPlan` optional parameter

**Implementation:**

```typescript
POST /api/trips/plan/natural
{
  "prompt": "Plan a 2-day NYC trip",
  "userId": "user-002",           // Optional - for personalization
  "previousPlan": { ... }         // Optional - triggers refinement mode
}
```

**Routing Logic:**
```typescript
if (previousPlan) {
  // Refinement mode - update existing plan
  result = await refinePlanFromFeedback(previousPlan, prompt, userId);
} else {
  // New plan mode - generate from scratch
  result = await planFromNaturalLanguage(prompt, userId);
}
```

**Benefits:**
- Simpler API surface (one endpoint vs two)
- Frontend integration is cleaner
- Backward compatible (old `/plan/refine` endpoint still works with deprecation warning)

---

### 2. Schema Updates

**File:** `src/schemas/trip-plan.schema.ts`

**Changes:**
```typescript
export const planTripNaturalRequestSchema = z.object({
  prompt: z.string().min(3).max(2000),
  userId: z.string().optional(),
  previousPlan: z.any().optional(),  // NEW: Enables refinement through unified endpoint
});
```

**Deprecated:**
```typescript
// DEPRECATED: Use planTripNaturalRequestSchema with previousPlan field instead
export const refinePlanRequestSchema = z.object({
  originalPlan: z.any(),
  feedback: z.string().min(3).max(1000),
  userId: z.string().optional(),
});
```

---

## Existing Features (No Changes)

The following CodeFest features were already implemented and remain unchanged:

### Feature 1: Google Maps Link Generation

### What It Does
Automatically generates clean Google Maps direction links for each day of the trip, showing a route through all activities.

### Implementation

**Files Changed:**
- `src/utils/google-maps.ts` - Map link generation utility
- `src/services/natural-planner.service.ts` - Integration with trip planning
- `src/schemas/trip-plan.schema.ts` - Added `mapLink` field to `dayPlanSchema`

**How It Works:**
1. **Keyword Detection**: Checks if user's prompt includes keywords like "map", "link", "route", "directions", or "google maps"
2. **Coordinate Extraction**: Extracts latitude/longitude from each activity in the day
3. **Smart Filtering**: Removes transportation activities and duplicate consecutive coordinates
4. **URL Generation**: Builds a clean Google Maps Directions URL with all waypoints
5. **Per-Day Links**: Generates one map link per day, attached to the day object

**Code Example:**
```typescript
// AI generates activities with coordinates
// Then programmatic utility creates map link:
const mapLink = buildGoogleMapsDirectionsUrl([
  { lat: 40.7484, lng: -73.9857 },  // Empire State Building
  { lat: 40.7295, lng: -74.0024 },  // Joe's Pizza
  { lat: 40.7681, lng: -73.9819 }   // Asiate Restaurant
]);
// Result: Clean Google Maps URL with 3 waypoints
```

**API Response Structure:**
```json
{
  "days": [
    {
      "day": 1,
      "date": "May 27, 2026",
      "mapLink": "https://www.google.com/maps/dir/?api=1&origin=40.7484,-73.9857&destination=40.7681,-73.9819&waypoints=40.7295,-74.0024",
      "activities": [...]
    }
  ]
}
```

### Frontend Integration
- Frontend receives `mapLink` field in day objects
- Displays as clickable "View Map" buttons in the itinerary
- Opens Google Maps in new tab with pre-loaded route

---

### Feature 2: User Profile Personalization

### What It Does
Allows AI to generate personalized trip plans based on user dietary restrictions, accessibility needs, budget level, travel style, and fitness preferences.

### Implementation

**Files Changed:**
- `data/user-profiles.json` - 5 mock user profiles with diverse preferences
- `src/schemas/user-profile.schema.ts` - UserProfile type and validation schema
- `src/services/catalog/catalog.service.ts` - Profile loading functions
- `src/services/natural-planner.service.ts` - Profile injection into AI prompts
- `src/routes/trip.routes.ts` - Profile API endpoints
- `src/schemas/trip-plan.schema.ts` - Added optional `userId` parameter

**User Profiles Available:**
1. **Maverick** (user-001) - High-protein diet, luxury budget, adventure style, high fitness
2. **Goose** (user-002) - No restrictions, moderate budget, foodie style, high fitness
3. **Emily** (user-003) - Pescatarian, moderate budget, cultural style, moderate fitness
4. **Sarah** (user-004) - Vegan, budget-conscious, relaxation style, low fitness
5. **Taylor** (user-005) - Gluten-free, hearing aid, moderate budget, cultural style, low fitness

**How It Works:**
1. **Optional Parameter**: API accepts optional `userId` in POST `/api/trips/plan/natural`
2. **Profile Loading**: Backend loads user profile from `data/user-profiles.json`
3. **Prompt Injection**: Profile constraints are injected into the AI prompt:
   ```
   USER PROFILE - IMPORTANT: Consider these preferences when planning for Goose:
   - Dietary Restrictions: None
   - Accessibility Needs: None
   - Budget Level: moderate
   - Travel Style: foodie
   - Fitness Level: high
   
   CRITICAL INSTRUCTIONS:
   - For restaurants: ONLY suggest places that accommodate dietary restrictions
   - For activities: Ensure all match fitness level and accessibility needs
   - Match the budget level when selecting partners and activities
   - Respect the travel style (foodie) when building the itinerary
   ```
4. **AI Personalization**: OpenAI generates plan respecting all profile constraints
5. **Consistent Context**: Profile is maintained across refinements

**API Endpoints:**

**GET `/api/trips/profiles`**
```json
// Returns all available profiles
[
  {
    "id": "user-001",
    "name": "Maverick",
    "bonvoyMemberNumber": "123456789",
    "dietaryRestrictions": ["high-protein", "no sugar"],
    "accessibilityNeeds": [],
    "budgetLevel": "luxury",
    "travelStyle": "adventure",
    "preferences": {
      "avoidCrowds": false,
      "preferLocalExperiences": true,
      "fitnessLevel": "high"
    }
  }
]
```

**GET `/api/trips/profiles/:userId`**
```json
// Returns specific profile by ID
{
  "id": "user-004",
  "name": "Sarah",
  "dietaryRestrictions": ["vegan"],
  "budgetLevel": "budget",
  ...
}
```

**POST `/api/trips/plan/natural` (with userId)**
```json
{
  "prompt": "Plan a 1-day NYC food tour",
  "userId": "user-002"  // Optional - omit for generic planning
}
```

**Example Personalization:**

**Generic Plan (no userId):**
- Mix of restaurants (steakhouse, seafood, pizza)
- Standard activity pricing
- General fitness activities

**Goose's Plan (userId: "user-002", foodie, moderate budget):**
- Chinatown & Little Italy Food Tour ($85)
- Joe's Pizza - authentic slice ($15)
- Russ & Daughters - bagels and lox ($25)
- Focus on culinary experiences
- Description: "immersive, foodie-focused adventure"

**Sarah's Plan (userId: "user-004", vegan, budget):**
- Would include only vegan restaurants
- Budget-friendly activities (<$50)
- Lower fitness level activities

### Frontend Integration
- Frontend sends `userId` parameter when user selects a profile
- Backend personalizes the entire trip generation based on profile
- All recommendations match user's constraints automatically

---

### Feature 3: Conversational Plan Refinement

### What It Does
Allows users to iteratively improve trip plans using natural language feedback without regenerating from scratch.

### Implementation

**Files Changed:**
- `src/services/refine-planner.service.ts` - Refinement orchestration and AI prompts
- `src/routes/trip.routes.ts` - Unified endpoint supporting refinement
- `src/schemas/trip-plan.schema.ts` - Added `previousPlan` parameter support
- `src/services/natural-planner.service.ts` - Unified endpoint logic

**How It Works:**

1. **Unified Endpoint**: Single endpoint handles both new plans and refinements
   ```typescript
   POST /api/trips/plan/natural
   {
     "prompt": "Add more kid-friendly activities",
     "userId": "user-003",  // Optional
     "previousPlan": { /* full plan object */ }  // Optional - triggers refinement
   }
   ```

2. **Smart Routing**: Backend detects `previousPlan` and routes to refinement service
   ```typescript
   if (previousPlan) {
     // Refinement mode - modify existing plan
     result = await refinePlanFromFeedback(previousPlan, prompt, userId);
   } else {
     // New plan mode - generate from scratch
     result = await planFromNaturalLanguage(prompt, userId);
   }
   ```

3. **Context Preservation**: AI receives full original plan + user feedback
   ```
   You are a trip planning assistant. The user has an existing trip plan 
   and wants to refine it based on feedback.
   
   ORIGINAL PLAN:
   {
     "destination": "New York City",
     "days": [...full plan with all activities...]
   }
   
   USER FEEDBACK: "Add more kid-friendly activities"
   
   USER PROFILE: [if userId provided, profile constraints included]
   
   INSTRUCTIONS:
   - Keep the overall structure and existing activities that work well
   - Make ONLY the changes requested in the feedback
   - Maintain profile constraints (dietary, budget, fitness)
   - Return complete updated plan with all rich activity data
   ```

4. **Map Link Regeneration**: If user requests maps in feedback, generates new links

**Example Refinement Flow:**

**Initial Request:**
```json
POST /api/trips/plan/natural
{
  "prompt": "Plan a 2-day NYC trip",
  "userId": "user-003"
}
```

**Response:** Full 2-day plan for Emily (pescatarian, cultural style)

**Refinement Request:**
```json
POST /api/trips/plan/natural
{
  "prompt": "Make the first day more focused on museums",
  "userId": "user-003",
  "previousPlan": { /* full plan from initial response */ }
}
```

**Response:** Updated plan with more museums on Day 1, Day 2 unchanged, still respecting Emily's profile

### Frontend Integration Status
**Backend Fully Implemented, Frontend Integration Pending**

The backend refinement feature is complete and working. However, the frontend currently uses a client-side rule-based modification system (`utils/modificationEngine.ts`) instead of calling the backend API.

**Why Not Integrated:**
- Backend refinement was returning simplified activity data (missing prices, images, Bonvoy points)
- AI would regenerate activities without preserving all rich metadata
- Frontend integration was reverted to maintain data quality

**To Integrate in Future:**
Frontend would need to:
1. Call `/api/trips/plan/natural` with `previousPlan` parameter
2. Handle potential incomplete data from AI responses
3. OR: Backend needs to improve data preservation during refinement

**Testing Backend Refinement:**
Can be tested directly with curl:
```bash
# Generate initial plan
curl -X POST http://localhost:8081/api/trips/plan/natural \
  -H "Content-Type: application/json" \
  -d '{"prompt": "2-day NYC trip", "userId": "user-002"}'

# Refine the plan (paste full plan from above as previousPlan)
curl -X POST http://localhost:8081/api/trips/plan/natural \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Add more food tours",
    "userId": "user-002",
    "previousPlan": { ... }
  }'
```

---

## Unified Architecture

### Endpoint Consolidation
All trip planning now flows through a single unified endpoint:

```typescript
POST /api/trips/plan/natural
```

**Request Parameters:**
- `prompt` (required): User's natural language request
- `userId` (optional): User profile ID for personalization
- `previousPlan` (optional): Existing plan to refine (triggers refinement mode)

**Behavior:**
- `previousPlan` present → Refinement mode (modify existing plan)
- `previousPlan` absent → New plan mode (generate from scratch)
- `userId` present → Personalized based on profile
- `userId` absent → Generic planning

**Backward Compatibility:**
- Old `/api/trips/plan/refine` endpoint still exists but logs deprecation warning
- Will be removed in future version
- All new integrations should use unified endpoint

---

## Technical Implementation Details

### AI Prompt Engineering
- Profiles injected with "CRITICAL INSTRUCTIONS" to ensure constraints are followed
- Explicit schema definitions in prompts for consistent output format
- Keyword detection for optional features (maps) to reduce token usage
- Context preservation in refinement prompts (full plan + feedback)

### Data Flow
1. Frontend → Backend: HTTP POST with prompt, optional userId, optional previousPlan
2. Backend loads profile (if userId provided)
3. Backend builds AI prompt with profile constraints
4. OpenAI generates/refines plan with MCP tool calls for partner data
5. Backend validates partner data and enriches activities
6. Backend generates map links (if requested)
7. Backend returns complete plan to frontend

### MCP Integration
All features maintain full MCP (Model Context Protocol) integration:
- AI calls `list_restaurants`, `list_activities`, `list_cabs` for partner data
- Partner activities marked with `isPartner: true` and `addFromOurRecommendation: true`
- Rich activity metadata: prices, ratings, images, Bonvoy points, booking URLs
- Profile constraints applied when AI selects partners

---

## Testing the Features

### 1. Google Maps Links
```bash
curl -X POST http://localhost:8081/api/trips/plan/natural \
  -H "Content-Type: application/json" \
  -d '{"prompt": "1-day NYC trip with map links"}'

# Check response for mapLink field in each day
```

### 2. User Profile Personalization
```bash
# Goose (foodie) plan
curl -X POST http://localhost:8081/api/trips/plan/natural \
  -H "Content-Type: application/json" \
  -d '{"prompt": "1-day NYC food tour", "userId": "user-002"}'

# Sarah (vegan, budget) plan
curl -X POST http://localhost:8081/api/trips/plan/natural \
  -H "Content-Type: application/json" \
  -d '{"prompt": "1-day NYC food tour", "userId": "user-004"}'

# Compare results - Sarah's will have vegan restaurants and lower prices
```

### 3. Conversational Refinement
```bash
# Step 1: Generate initial plan
curl -X POST http://localhost:8081/api/trips/plan/natural \
  -H "Content-Type: application/json" \
  -d '{"prompt": "2-day NYC trip", "userId": "user-002"}' > plan.json

# Step 2: Refine the plan (use plan.json content as previousPlan)
curl -X POST http://localhost:8081/api/trips/plan/natural \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Make it more foodie-focused",
    "userId": "user-002",
    "previousPlan": <paste-plan-from-step-1>
  }'
```

---

## Environment Setup

Required environment variables (`.env`):
```env
OPENAI_API_KEY=your-key-here
PLANNER_MODE=openai
PORT=8081
MCP_CATALOG_ENABLED=true
```

---

## Summary of This Update

### What Changed
- Unified `/api/trips/plan/natural` endpoint (handles both new plans and refinements)
- Added `previousPlan` optional parameter to schema
- Deprecated `/api/trips/plan/refine` (backward compatible)

### What Didn't Change
- Google Maps link generation (already working)
- User profile personalization (already working)
- Conversational refinement logic (already working)
- MCP integration (already working)
- All existing functionality preserved

### Impact
- Simpler API for frontend integration
- Single endpoint reduces complexity
- Easier to maintain and explain
- Google Maps link generation (keyword-based)
- User profile personalization (5 profiles with diverse preferences)
- Conversational plan refinement (backend fully implemented)
- Unified API endpoint for all trip planning
- MCP integration with partner data
- Profile context maintained across refinements

### Frontend Integration Status
- Google Maps links - Fully integrated and working
- User profile selection - Fully integrated and working
- Conversational refinement - Backend ready, frontend uses client-side alternative

### Known Limitations
- Refinement may not preserve all rich activity metadata (images, detailed prices)
- Map links only generated if user explicitly requests them
- Profile personalization quality depends on AI following prompt instructions
- 5 mock profiles for demo (production would use real user accounts)
