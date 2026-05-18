import type { PlanTripRequest, TripPlan } from "../schemas/trip-plan.schema.js";
import { loadCatalog } from "./catalog.service.js";
import { planTripMock } from "./planner.mock.js";
import { planTripCursor } from "./planner.cursor.js";
import { eachDay } from "../utils/dates.js";
import { isCursorSdkEnabled } from "../utils/env.js";

export async function planTrip(input: PlanTripRequest): Promise<TripPlan> {
  console.log("inside plan trip ")
  const days = eachDay(input.startDate, input.endDate);
  if (days.length === 0) {
    throw new Error("endDate must be on or after startDate");
  }
  if (days.length > 14) {
    throw new Error("Trip length cannot exceed 14 days");
  }

  const catalog = await loadCatalog(input.destination);
  if (isCursorSdkEnabled()) {
    console.log("Using Cursor SDK");
    return planTripCursor(input, catalog);
  }
  console.log("Using mock planner");
  return planTripMock(input, catalog);
}
