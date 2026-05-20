import type { PlanTripRequest, TripPlan } from "../schemas/trip-plan.schema.js";
import type { CatalogBundle } from "./catalog.service.js";
import { planTripAiSkeleton } from "./planner.ai-skeleton.js";
import { enrichSkeletonWithCatalog } from "./planner.catalog-enrich.js";
import { planTripMock } from "./planner.mock.js";

/**
 * Hybrid planner: small AI prompt (destination meta only) → local catalog swap.
 * Avoids sending full partner/POI JSON to the model (major latency win).
 */
export async function planTripHybrid(
  input: PlanTripRequest,
  catalog: CatalogBundle
): Promise<TripPlan> {
  const t0 = Date.now();
  try {
    const skeleton = await planTripAiSkeleton(input, catalog.destination);
    const plan = enrichSkeletonWithCatalog(skeleton, input, catalog);
    console.log(`[planner.hybrid] done in ${Date.now() - t0}ms (1 AI call + catalog enrich)`);
    return plan;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("[planner.hybrid] AI skeleton failed, falling back to mock:", detail);
    return planTripMock(input, catalog);
  }
}
