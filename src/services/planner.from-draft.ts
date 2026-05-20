import type { PlanTripRequest, PlanBlock, TripPlan } from "../schemas/trip-plan.schema.js";
import { tripPlanSchema } from "../schemas/trip-plan.schema.js";
import type { NaturalPlanDraft } from "../schemas/skeleton-plan.schema.js";
import { loadDestinations, resolveDestination } from "./catalog.service.js";

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

  const days = draft.days.map((day) => ({
    date: day.date,
    blocks: day.blocks.map(skeletonBlockToPlanBlock),
  }));

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
    plannerMode: "cursor",
  });
}
