import type { PlanTripRequest, PlanBlock, TripPlan } from "../schemas/trip-plan.schema.js";
import { tripPlanSchema } from "../schemas/trip-plan.schema.js";
import type { NaturalPlanDraft } from "../schemas/skeleton-plan.schema.js";
import { loadDestinations, resolveDestination } from "./catalog/catalog.service.js";
import { validateAndFixPlanBlocks, getPartnerValidationSummary } from "./partner-validation.service.js";

const PARTNER_TYPES = new Set<PlanBlock["type"]>(["cab", "restaurant", "activity", "game"]);

function skeletonBlockToPlanBlock(block: NaturalPlanDraft["days"][0]["blocks"][0]): PlanBlock {
  const isPartner = PARTNER_TYPES.has(block.type);
  const partner = block.partner ?? isPartner;
  const provider = block.provider ?? (partner ? block.title : undefined);

  return {
    start: block.start,
    end: block.end,
    type: block.type,
    title: block.title,
    notes: block.notes,
    latitude: block.latitude,
    longitude: block.longitude,
    partner: partner || undefined,
    provider,
    source: block.source ?? (isPartner ? "partner" : block.type === "sightseeing" ? "suggested" : undefined),
    addFromOurRecommendation: block.addFromOurRecommendation ?? Boolean(partner),
  };
}

function collectPartnerPlacements(days: TripPlan["days"]): TripPlan["partnerPlacements"] {
  const counts = new Map<string, { category: string; count: number }>();
  for (const day of days) {
    for (const block of day.blocks) {
      if (!block.partner || !block.provider) continue;
      const key = `${block.type}:${block.provider}`;
      const cur = counts.get(key) ?? { category: block.type, count: 0 };
      cur.count += 1;
      counts.set(key, cur);
    }
  }
  return [...counts.entries()].map(([key, v]) => ({
    service: key.split(":").slice(1).join(":"),
    category: v.category,
    count: v.count,
  }));
}

/** Build API trip plan from AI output (catalog names come from MCP tools, not local enrich). */
export async function buildTripPlanFromDraft(
  draft: NaturalPlanDraft,
  request: PlanTripRequest
): Promise<TripPlan> {
  const destMeta =
    (await resolveDestination(request.destination)) ?? (await loadDestinations())[0];

  // Extract city name for partner validation
  const city = request.destination.split(",")[0]?.trim() || request.destination;

  const days = await Promise.all(draft.days.map(async (day) => {
    const initialBlocks = day.blocks.map(skeletonBlockToPlanBlock);
    const validatedBlocks = await validateAndFixPlanBlocks(initialBlocks, city);
    
    return {
      date: day.date,
      blocks: validatedBlocks,
    };
  }));

  // Get validation summary for logging
  const allBlocks = days.flatMap(day => day.blocks);
  const validationSummary = await getPartnerValidationSummary(allBlocks, city);
  
  console.log(`[partner-validation] City: ${city}`);
  console.log(`[partner-validation] Partner blocks: ${validationSummary.totalPartnerBlocks}`);
  console.log(`[partner-validation] Valid: ${validationSummary.validPartnerBlocks}`);
  console.log(`[partner-validation] Invalid: ${validationSummary.invalidPartnerBlocks}`);
  
  if (validationSummary.suggestedCorrections.length > 0) {
    console.log(`[partner-validation] Suggested corrections:`);
    validationSummary.suggestedCorrections.forEach(correction => {
      console.log(`  - "${correction.originalProvider}" → "${correction.suggestedProvider}" in "${correction.blockTitle}"`);
    });
  }

  return tripPlanSchema.parse({
    destination: {
      name: request.destination,
      summary: destMeta.summary,
      timezone: destMeta.timezone,
      tips: destMeta.tips,
    },
    startDate: request.startDate,
    endDate: request.endDate,
    interests: request.interests,
    days,
    partnerPlacements: collectPartnerPlacements(days),
    plannerMode: "openai",
  });
}
