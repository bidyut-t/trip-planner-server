import type { PlanTripRequest, TripPlan, PlanBlock } from "../schemas/trip-plan.schema.js";
import type { CatalogBundle, PoiItem, PartnerItem } from "./catalog/catalog.service.js";
import { eachDay, addMinutes } from "../utils/dates.js";

function block(
  start: string,
  durationMinutes: number,
  partial: Omit<PlanBlock, "start" | "end">
): PlanBlock {
  return {
    start,
    end: addMinutes(start, durationMinutes),
    ...partial,
  };
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

function pickPartner<T extends PartnerItem>(items: T[], index: number): T | undefined {
  if (items.length === 0) return undefined;
  return items[index % items.length];
}

export function planTripMock(input: PlanTripRequest, catalog: CatalogBundle): TripPlan {
  const days = eachDay(input.startDate, input.endDate);
  const usedPois = new Set<string>();
  const partnerCounts = new Map<string, { category: string; count: number }>();

  const trackPartner = (name: string, category: string) => {
    const key = `${category}:${name}`;
    const cur = partnerCounts.get(key) ?? { category, count: 0 };
    cur.count += 1;
    partnerCounts.set(key, cur);
  };

  const dayPlans = days.map((date, dayIndex) => {
    const blocks: PlanBlock[] = [];
    let cursor = dayIndex === 0 ? "08:30" : "09:00";

    const cab = pickPartner(catalog.cabs, dayIndex);
    if (cab) {
      blocks.push(
        block(cursor, cab.durationMinutes, {
          type: "cab",
          title: dayIndex === 0 ? `${cab.name}: Hotel / city transfer` : `${cab.name}: Inter-area transfer`,
          partner: true,
          provider: cab.name,
          source: "partner",
          addFromOurRecommendation: true,
        })
      );
      cursor = addMinutes(cursor, cab.durationMinutes + 15);
      trackPartner(cab.name, "cab");
    }

    const interestBatch = poisForInterests(catalog.pois, input.interests, usedPois);
    const morningPoi = interestBatch[0];
    if (morningPoi) {
      usedPois.add(morningPoi.id);
      const matched = input.interests.find((i) =>
        morningPoi.tags.some((t) => t.toLowerCase().includes(i.toLowerCase()))
      );
      blocks.push(
        block(cursor, morningPoi.durationMinutes, {
          type: "sightseeing",
          title: morningPoi.name,
          source: "poi",
          matchedInterest: matched,
          addFromOurRecommendation: false,
        })
      );
      cursor = addMinutes(cursor, morningPoi.durationMinutes + 20);
    }

    const lunch = pickPartner(catalog.restaurants, dayIndex);
    if (lunch) {
      blocks.push(
        block(cursor, lunch.durationMinutes, {
          type: "restaurant",
          title: lunch.name,
          partner: true,
          provider: lunch.name,
          source: "partner",
          matchedInterest: input.interests.includes("food") ? "food" : undefined,
          addFromOurRecommendation: true,
        })
      );
      cursor = addMinutes(cursor, lunch.durationMinutes + 15);
      trackPartner(lunch.name, "restaurant");
    }

    const afternoonPoi = interestBatch[1] ?? poisForInterests(catalog.pois, [], usedPois)[0];
    if (afternoonPoi && !usedPois.has(afternoonPoi.id)) {
      usedPois.add(afternoonPoi.id);
      const matched = input.interests.find((i) =>
        afternoonPoi.tags.some((t) => t.toLowerCase().includes(i.toLowerCase()))
      );
      blocks.push(
        block(cursor, afternoonPoi.durationMinutes, {
          type: "sightseeing",
          title: afternoonPoi.name,
          source: "poi",
          matchedInterest: matched,
          addFromOurRecommendation: false,
        })
      );
      cursor = addMinutes(cursor, afternoonPoi.durationMinutes + 20);
    }

    const activity = pickPartner(catalog.activities, dayIndex);
    if (activity && input.interests.some((i) => activity.tags.some((t) => t.includes(i)))) {
      blocks.push(
        block(cursor, activity.durationMinutes, {
          type: "activity",
          title: activity.name,
          partner: true,
          provider: activity.name,
          source: "partner",
          addFromOurRecommendation: true,
        })
      );
      cursor = addMinutes(cursor, activity.durationMinutes + 15);
      trackPartner(activity.name, "activity");
    }

    const dinner = pickPartner(catalog.restaurants, dayIndex + 1);
    if (dinner && dinner.id !== lunch?.id) {
      blocks.push(
        block(cursor, dinner.durationMinutes, {
          type: "restaurant",
          title: dinner.name,
          partner: true,
          provider: dinner.name,
          source: "partner",
          addFromOurRecommendation: true,
        })
      );
      cursor = addMinutes(cursor, dinner.durationMinutes + 15);
      trackPartner(dinner.name, "restaurant");
    }

    const game = pickPartner(catalog.games, dayIndex);
    if (game && (input.interests.includes("games") || dayIndex % 2 === 0)) {
      blocks.push(
        block(cursor, game.durationMinutes, {
          type: "game",
          title: game.name,
          partner: true,
          provider: game.name,
          source: "partner",
          matchedInterest: input.interests.includes("games") ? "games" : undefined,
          addFromOurRecommendation: true,
        })
      );
      trackPartner(game.name, "game");
    }

    return { date, blocks };
  });

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
    days: dayPlans,
    partnerPlacements: [...partnerCounts.entries()].map(([key, v]) => {
      const name = key.split(":").slice(1).join(":");
      return { service: name, category: v.category, count: v.count };
    }),
    plannerMode: "mock",
  };
}
