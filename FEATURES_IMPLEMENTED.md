# Trip Planner - New Features Implementation

**Author**: Aria  
**Date**: May 21, 2026  
**CodeFest Deliverables**

This document outlines three major features implemented for the trip planner backend.

---

## Feature 1: Google Maps Link Generation (Per-Day Routes)

### What It Does
Automatically generates clean Google Maps direction links for each day's itinerary when the user requests it. The system detects keywords like "map", "link", "route", or "directions" in the user's prompt and adds a `mapLink` field to each day.

### How It Works
- **Keyword Detection**: Checks user prompt for map-related keywords
- **AI Generates Coordinates**: LLM provides latitude/longitude for all locations
- **Programmatic Link Generation**: Custom utility filters out transport blocks (cabs) and duplicate coordinates, then builds clean Google Maps URLs

### Code Changes
| File | What Changed |
|------|-------------|
| `src/schemas/trip-plan.schema.ts` | Added `mapLink: z.string().url().optional()` to `dayPlanSchema` |
| `src/utils/google-maps.ts` | **NEW FILE** - Utility for generating per-day map links |
| `src/services/natural-planner.service.ts` | Added keyword detection and map link integration |

### API Usage
```bash
# Request with map links
curl -X POST http://localhost:8081/api/trips/plan/natural \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Plan a 2-day trip to Jaipur with map links"}'
```

### Response Format
```json
{
  "plan": {
    "days": [
      {
        "date": "2026-05-22",
        "blocks": [...],
        "mapLink": "https://www.google.com/maps/dir/?api=1&origin=26.9855,75.8513&destination=26.927,75.823&waypoints=26.9848,75.8502|26.9124,75.7873&travelmode=driving"
      }
    ]
  }
}
```

### Key Notes
- Map links are **optional** - only generated when user requests them
- Links are **per-day**, not for the entire trip
- Filters out cab/travel blocks to show only actual destinations
- Removes duplicate consecutive coordinates to avoid loops

---

## Feature 2: Mock User Profile Integration (Personalized Planning)

### What It Does
Allows trip plans to be personalized based on user profiles containing dietary restrictions, accessibility needs, budget level, travel style, and personal preferences. The AI considers these constraints when generating plans.

### How It Works
- **Profile Storage**: Mock profiles stored in `data/user-profiles.json`
- **Profile Injection**: When `userId` is provided, the system loads the profile and injects constraints into the AI prompt
- **AI Personalization**: LLM filters restaurants by dietary needs, matches activities to fitness level, respects budget, etc.

### Code Changes
| File | What Changed |
|------|-------------|
| `src/schemas/user-profile.schema.ts` | **NEW FILE** - UserProfile type and Zod schema |
| `data/user-profiles.json` | **NEW FILE** - Mock profiles for 5 team members |
| `src/services/catalog/catalog.service.ts` | Added `loadUserProfiles()` and `getUserProfile()` functions |
| `src/services/natural-planner.service.ts` | Updated to accept `userId` and inject profile context into AI prompt |
| `src/routes/trip.routes.ts` | Added `GET /api/trips/profiles` and `GET /api/trips/profiles/:userId` endpoints |
| `src/schemas/trip-plan.schema.ts` | Updated `planTripNaturalRequestSchema` to accept optional `userId` |

### API Usage

#### Get All Profiles
```bash
curl http://localhost:8081/api/trips/profiles
```

#### Get Specific Profile
```bash
curl http://localhost:8081/api/trips/profiles/user-001
```

#### Generate Personalized Plan
```bash
curl -X POST http://localhost:8081/api/trips/plan/natural \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Plan a 2-day trip to Jaipur", "userId": "user-004"}'
```

### User Profiles
| User ID | Name | Dietary | Accessibility | Budget | Style |
|---------|------|---------|--------------|--------|-------|
| user-001 | Anesh | Vegetarian, no dairy | Wheelchair accessible | Moderate | Cultural |
| user-002 | Devesh | None | None | Luxury | Foodie |
| user-003 | Bidyut | Pescatarian | None | Moderate | Mixed |
| user-004 | Tarun | Vegan | None | Budget | Adventure |
| user-005 | Sree Kanth | Gluten-free | Hearing impaired | Moderate | Relaxation |

### Key Notes
- Profile personalization is **opt-in** - no profile applied if `userId` is omitted
- AI maintains profile constraints throughout the entire itinerary
- Each profile includes Marriott Bonvoy member number for demo purposes
- Profiles are stored in JSON format, consistent with partner data

---

## Feature 3: Conversational Plan Refinement (Multi-Turn Interaction)

### What It Does
Enables users to iteratively refine trip plans through natural language feedback. Users can provide modifications like "I'll be with my mom, adjust for accessibility" or "Add kid-friendly activities", and the system generates an updated plan.

### How It Works
- **Stateless Design**: UI sends the full original plan + feedback to the backend
- **AI Refinement**: System builds a specialized prompt showing the AI the original plan and the requested changes
- **Profile Preservation**: If `userId` is provided, profile constraints are maintained across refinements
- **Structure Preservation**: Same destination, dates, and overall format maintained

### Code Changes
| File | What Changed |
|------|-------------|
| `src/services/refine-planner.service.ts` | **NEW FILE** - Refinement service with AI prompt builder |
| `src/schemas/trip-plan.schema.ts` | Added `refinePlanRequestSchema` for refinement requests |
| `src/routes/trip.routes.ts` | Added `POST /api/trips/plan/refine` endpoint |

### API Usage

#### Initial Plan
```bash
curl -X POST http://localhost:8081/api/trips/plan/natural \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Plan a 2-day trip to Jaipur"}' > plan.json
```

#### Refine Plan
```bash
curl -X POST http://localhost:8081/api/trips/plan/refine \
  -H "Content-Type: application/json" \
  -d "{\"originalPlan\": $(cat plan.json | jq '.plan'), \"feedback\": \"I will be with my elderly mom, make it easier and more relaxed\"}"
```

#### Further Refinement (with Profile)
```bash
curl -X POST http://localhost:8081/api/trips/plan/refine \
  -H "Content-Type: application/json" \
  -d "{\"originalPlan\": $(cat refined_plan.json | jq '.plan'), \"feedback\": \"Add more food experiences\", \"userId\": \"user-001\"}"
```

### Request Schema
```typescript
{
  originalPlan: TripPlan,  // Full plan object from previous response
  feedback: string,        // Natural language modification (3-1000 chars)
  userId?: string          // Optional user ID to maintain profile context
}
```

### Response Format
```json
{
  "plan": {
    "destination": {...},
    "days": [...],
    "partnerPlacements": [...],
    "plannerMode": "openai"
  }
}
```

### Use Cases
- **Companion Adjustments**: "I'll be with my elderly mom" → adds rest breaks, removes strenuous activities
- **Activity Preferences**: "Add more food experiences" → adds restaurants, cooking classes, food tours
- **Pace Changes**: "Make day 2 more relaxed" → reduces number of activities, increases free time
- **Accessibility**: "Need wheelchair accessible venues" → filters for accessible locations
- **Family-Friendly**: "Add kid-friendly activities" → swaps in family-appropriate experiences

### Key Notes
- Refinement is **stateless** - no server-side plan storage required
- Response format is **identical** to initial planning endpoint
- Profile constraints are **preserved** across refinements
- Partner data and MCP integration are **maintained**
- UI can chain refinements indefinitely

---

## UI Integration Guide

### Simple Conversational Flow
```javascript
// Step 1: Initial plan
const response1 = await fetch('/api/trips/plan/natural', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    prompt: "Plan a 3-day trip to NYC",
    userId: "user-001" // Optional
  })
});
const { plan: plan1 } = await response1.json();

// Step 2: User provides feedback
const userFeedback = "I'll be with kids, make it family-friendly";

const response2 = await fetch('/api/trips/plan/refine', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    originalPlan: plan1,
    feedback: userFeedback,
    userId: "user-001" // Optional, maintains profile
  })
});
const { plan: plan2 } = await response2.json();

// Step 3: Further refinements
const response3 = await fetch('/api/trips/plan/refine', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    originalPlan: plan2,
    feedback: "Add more food spots on day 2"
  })
});
const { plan: plan3 } = await response3.json();
```

### Key Points for UI Team
1. **Backward Compatible**: All existing code continues to work without changes
2. **Optional Features**: Profile and refinement are opt-in - can be added incrementally
3. **Same Response Format**: All endpoints return consistent `TripPlan` structure
4. **No Breaking Changes**: Existing API contracts unchanged
5. **Type-Safe**: Full Zod validation on all request/response schemas

---

## Testing

### Test Feature 1 (Map Links)
```bash
curl -X POST http://localhost:8081/api/trips/plan/natural \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Plan a 2-day trip to Jaipur with map links for each day"}'
```

### Test Feature 2 (User Profiles)
```bash
# Get profiles
curl http://localhost:8081/api/trips/profiles

# Personalized plan
curl -X POST http://localhost:8081/api/trips/plan/natural \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Plan a 2-day trip to Jaipur", "userId": "user-004"}'
```

### Test Feature 3 (Conversational Refinement)
```bash
# Initial plan
curl -X POST http://localhost:8081/api/trips/plan/natural \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Plan a 2-day trip to Jaipur"}' > plan.json

# Refine it
curl -X POST http://localhost:8081/api/trips/plan/refine \
  -H "Content-Type: application/json" \
  -d "{\"originalPlan\": $(cat plan.json | jq '.plan'), \"feedback\": \"Make it more relaxed\"}"
```

---

## API Endpoints Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/trips/plan/natural` | POST | Generate initial trip plan (supports userId, map keywords) |
| `/api/trips/plan/refine` | POST | Refine existing plan with feedback |
| `/api/trips/profiles` | GET | Get all user profiles |
| `/api/trips/profiles/:userId` | GET | Get specific user profile |

---