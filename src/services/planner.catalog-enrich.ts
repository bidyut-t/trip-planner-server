import type { PlanTripRequest, TripPlan, PlanBlock } from "../schemas/trip-plan.schema.js";
import type { TripSkeleton, SkeletonBlock } from "../schemas/skeleton-plan.schema.js";
import type { CatalogBundle, PartnerItem, PoiItem } from "./catalog.service.js";
import { addMinutes } from "../utils/dates.js";

interface EnrichState {
  usedPois: Set<string>;
  restaurantIndex: number;
  partnerCounts: Map<string, { category: string; count: number }>;
}

function pickPartner<T extends PartnerItem>(items: T[], index: number): T | undefined {
  if (items.length === 0) return undefined;
  return items[index % items.length];
}

function poisForInterests(pois: PoiItem[], interests: string[], used: Set<string>): PoiItem[] {
  if (interests.length === 0) {
    return pois.filter((p) => !used.has(p.id)).slice(0, 2);
  }
  const matched = pois.filter(
    (p) =>
      !used.has(p.id) &&
      interests.some((i) => p.tags.some((t) => t.toLowerCase().includes(i.toLowerCase())))
  );
  return matched.length > 0 ? matched : pois.filter((p) => !used.has(p.id));
}

function matchPoiByTitle(
  title: string,
  pois: PoiItem[],
  used: Set<string>
): PoiItem | undefined {
  const lower = title.toLowerCase();
  return pois.find((p) => {
    if (used.has(p.id)) return false;
    const name = p.name.toLowerCase();
    return lower.includes(name) || name.split(/\s+/).some((w) => w.length > 3 && lower.includes(w));
  });
}

function trackPartner(state: EnrichState, name: string, category: string): void {
  const key = `${category}:${name}`;
  const cur = state.partnerCounts.get(key) ?? { category, count: 0 };
  cur.count += 1;
  state.partnerCounts.set(key, cur);
}

function partnerBlock(
  start: string,
  item: PartnerItem,
  type: PlanBlock["type"],
  title?: string,
  matchedInterest?: string
): PlanBlock {
  return {
    start,
    end: addMinutes(start, item.durationMinutes),
    type,
    title: title ?? item.name,
    partner: true,
    provider: item.name,
    source: "partner",
    matchedInterest,
    addFromOurRecommendation: true,
  };
}

function enrichBlock(
  block: SkeletonBlock,
  dayIndex: number,
  input: PlanTripRequest,
  catalog: CatalogBundle,
  state: EnrichState
): PlanBlock {
  const { start } = block;

  switch (block.type) {
    case "cab": {
      const cab = pickPartner(catalog.cabs, dayIndex);
      if (cab) {
        trackPartner(state, cab.name, "cab");
        return partnerBlock(
          start,
          cab,
          "cab",
          dayIndex === 0 ? `${cab.name}: Hotel / city transfer` : `${cab.name}: Inter-area transfer`
        );
      }
      break;
    }
    case "restaurant": {
      const restaurant = pickPartner(catalog.restaurants, state.restaurantIndex++);
      if (restaurant) {
        trackPartner(state, restaurant.name, "restaurant");
        return partnerBlock(
          start,
          restaurant,
          "restaurant",
          restaurant.name,
          input.interests.includes("food") ? "food" : undefined
        );
      }
      break;
    }
    case "activity": {
      const activity = pickPartner(catalog.activities, dayIndex);
      if (
        activity &&
        (input.interests.length === 0 ||
          input.interests.some((i) => activity.tags.some((t) => t.includes(i))))
      ) {
        trackPartner(state, activity.name, "activity");
        return partnerBlock(start, activity, "activity");
      }
      break;
    }
    case "game": {
      const game = pickPartner(catalog.games, dayIndex);
      if (game) {
        trackPartner(state, game.name, "game");
        return partnerBlock(
          start,
          game,
          "game",
          game.name,
          input.interests.includes("games") ? "games" : undefined
        );
      }
      break;
    }
    case "sightseeing": {
      const matched =
        matchPoiByTitle(block.title, catalog.pois, state.usedPois) ??
        poisForInterests(catalog.pois, input.interests, state.usedPois)[0];
      if (matched) {
        state.usedPois.add(matched.id);
        const interest = input.interests.find((i) =>
          matched.tags.some((t) => t.toLowerCase().includes(i.toLowerCase()))
        );
        return {
          start,
          end: addMinutes(start, matched.durationMinutes),
          type: "sightseeing",
          title: matched.name,
          source: "poi",
          matchedInterest: interest,
          notes: block.notes,
          addFromOurRecommendation: false,
        };
      }
      break;
    }
    default:
      break;
  }

  return {
    start: block.start,
    end: block.end,
    type: block.type,
    title: block.title,
    notes: block.notes,
    source: "suggested",
    addFromOurRecommendation: false,
  };
}

export function enrichSkeletonWithCatalog(
  skeleton: TripSkeleton,
  input: PlanTripRequest,
  catalog: CatalogBundle
): TripPlan {
  const state: EnrichState = {
    usedPois: new Set(),
    restaurantIndex: 0,
    partnerCounts: new Map(),
  };

  const days = skeleton.days.map((day, dayIndex) => ({
    date: day.date,
    blocks: day.blocks.map((block) => enrichBlock(block, dayIndex, input, catalog, state)),
  }));

  return {
    destination: {
      name: catalog.destination.name,
      summary: catalog.destination.summary,
      timezone: catalog.destination.timezone,
      tips: catalog.destination.tips,
    },
    startDate: input.startDate,
    endDate: input.endDate,
    interests: input.interests,
    days,
    partnerPlacements: [...state.partnerCounts.entries()].map(([key, v]) => ({
      service: key.split(":").slice(1).join(":"),
      category: v.category,
      count: v.count,
    })),
    plannerMode: "cursor",
  };
}
