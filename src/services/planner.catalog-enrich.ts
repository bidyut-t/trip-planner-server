import type { PlanTripRequest, TripPlan, PlanBlock } from "../schemas/trip-plan.schema.js";
import type { TripSkeleton, SkeletonBlock } from "../schemas/skeleton-plan.schema.js";
import type { CatalogBundle, PartnerItem, PoiItem } from "./catalog.service.js";
import { addMinutes } from "../utils/dates.js";
import { getNearbyCatalogRadiusKm } from "../utils/env.js";
import {
  type Coordinates,
  geoFields,
  hasCoordinates,
  pickNearest,
} from "../utils/geo.js";

/** Mutable state while enriching one day: dedupe catalog picks and track partner usage. */
interface EnrichState {
  usedPois: Set<string>;
  usedRestaurants: Set<string>;
  usedActivities: Set<string>;
  usedGames: Set<string>;
  currentLocation: Coordinates | undefined;
  partnerCounts: Map<string, { category: string; count: number }>;
}

/**
 * Fallback map anchor when no block has set `currentLocation` yet.
 *
 * @example input: catalog with `destination: { latitude: 13.75, longitude: 100.5, ... }`
 * @returns `{ latitude: 13.75, longitude: 100.5 }` or `undefined` if destination has no coords
 */
function defaultDayLocation(catalog: CatalogBundle): Coordinates | undefined {
  const dest = catalog.destination;
  if (hasCoordinates(dest)) {
    return { latitude: dest.latitude, longitude: dest.longitude };
  }
  return undefined;
}

/**
 * Extract lat/lng from an AI skeleton block when the model supplied coordinates.
 *
 * @example input: `{ ..., latitude: 13.7, longitude: 100.5 }`
 * @returns `{ latitude: 13.7, longitude: 100.5 }` or `undefined`
 */
function skeletonPin(block: SkeletonBlock): Coordinates | undefined {
  if (hasCoordinates(block)) {
    return { latitude: block.latitude, longitude: block.longitude };
  }
  return undefined;
}

/**
 * Candidate POIs for sightseeing, preferring tags that match trip interests.
 *
 * @example input: `pois`, `interests: ["temple", "food"]`, `used: Set(["poi-1"])`
 * @returns unused POIs whose tags overlap interests; if none match, all unused POIs (capped to 2 when no interests)
 */
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

/**
 * Match a catalog POI to the AI block title (substring / significant word overlap).
 * When `near` is set, prefers the geographically closest match within ~3× radius.
 *
 * @example input: `title: "Visit Wat Pho temple"`, `pois`, `used`, `near: { latitude, longitude }`, `maxKm: 5`
 * @returns first matching `PoiItem`, or nearest among matches, or `undefined`
 */
function matchPoiByTitle(
  title: string,
  pois: PoiItem[],
  used: Set<string>,
  near?: Coordinates,
  maxKm?: number
): PoiItem | undefined {
  const lower = title.toLowerCase();
  const byTitle = pois.filter((p) => {
    if (used.has(p.id)) return false;
    const name = p.name.toLowerCase();
    return lower.includes(name) || name.split(/\s+/).some((w) => w.length > 3 && lower.includes(w));
  });

  if (byTitle.length === 0) return undefined;
  if (!near || maxKm === undefined) return byTitle[0];

  return (
    pickNearest({
      items: byTitle,
      from: near,
      usedIds: used,
      maxKm: maxKm * 3,
    }) ?? byTitle[0]
  );
}

/**
 * Increment partner placement counts for the final `partnerPlacements` summary.
 *
 * @example input: `state`, `name: "Grab"`, `category: "cab"` → map entry `"cab:Grab"` count +1
 * @returns void (mutates `state.partnerCounts`)
 */
function trackPartner(state: EnrichState, name: string, category: string): void {
  const key = `${category}:${name}`;
  const cur = state.partnerCounts.get(key) ?? { category, count: 0 };
  cur.count += 1;
  state.partnerCounts.set(key, cur);
}

/**
 * Build a schedule block kept as an AI suggestion (no catalog partner/POI match).
 *
 * @example input: skeleton `{ start: "09:00", end: "10:00", type: "free", title: "Rest" }`
 * @returns `PlanBlock` with `source: "suggested"`, `addFromOurRecommendation: false`
 */
function aiSuggestedBlock(block: SkeletonBlock, extra?: Partial<PlanBlock>): PlanBlock {
  return {
    start: block.start,
    end: block.end,
    type: block.type,
    title: block.title,
    notes: block.notes,
    source: "suggested",
    addFromOurRecommendation: false,
    ...geoFields(block),
    ...extra,
  };
}

/**
 * Build a schedule block backed by a catalog partner item (cab, restaurant, activity, game).
 *
 * @example input: `start: "12:00"`, `item: { name: "Blue Elephant", durationMinutes: 90, ... }`, `type: "restaurant"`
 * @returns `PlanBlock` with `source: "partner"`, `partner: true`, end time from `durationMinutes`
 */
function partnerBlock(
  start: string,
  item: PartnerItem,
  type: PlanBlock["type"],
  title?: string,
  matchedInterest?: string,
  notes?: string
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
    notes,
    addFromOurRecommendation: true,
    ...geoFields(item),
  };
}

/**
 * Choose the nearest unused partner catalog item from the user's current location.
 *
 * @example input: `catalog.restaurants`, `state` with `currentLocation` set, `usedKey: "usedRestaurants"`
 * @returns nearest `PartnerItem` within env radius, or `undefined` if no location or no match
 */
function pickNearbyPartner(
  items: PartnerItem[],
  state: EnrichState,
  usedKey: keyof Pick<EnrichState, "usedRestaurants" | "usedActivities" | "usedGames">,
  filter?: (item: PartnerItem) => boolean
): PartnerItem | undefined {
  if (!state.currentLocation) return undefined;

  return pickNearest({
    items,
    from: state.currentLocation,
    usedIds: state[usedKey],
    maxKm: getNearbyCatalogRadiusKm(),
    filter,
  });
}

/**
 * Update `state.currentLocation` after placing a block so later picks stay geographically coherent.
 *
 * @example input: `state`, `item: { latitude: 13.7, longitude: 100.5 }`
 * @returns void (mutates `state.currentLocation` when item has coordinates)
 */
function setLocationFrom(state: EnrichState, item: GeoTaggedItemLike): void {
  if (hasCoordinates(item)) {
    state.currentLocation = { latitude: item.latitude, longitude: item.longitude };
  }
}

type GeoTaggedItemLike = { latitude?: number; longitude?: number };

/**
 * Turn one AI skeleton block into a full `PlanBlock` by type: partner catalog, POI, or AI fallback.
 *
 * @example input: `{ type: "restaurant", start: "12:00", title: "Lunch" }`, `dayIndex: 0`, `input`, `catalog`, `state`
 * @returns enriched `PlanBlock` (may mutate `state` for dedupe, location, partner counts)
 */
function enrichBlock(
  block: SkeletonBlock,
  dayIndex: number,
  input: PlanTripRequest,
  catalog: CatalogBundle,
  state: EnrichState
): PlanBlock {
  const { start } = block;
  const aiPin = skeletonPin(block);
  if (aiPin) state.currentLocation = aiPin;

  switch (block.type) {
    case "cab": {
      const cab = catalog.cabs[dayIndex % catalog.cabs.length];
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
      const restaurant = pickNearbyPartner(catalog.restaurants, state, "usedRestaurants");
      if (restaurant) {
        state.usedRestaurants.add(restaurant.id);
        trackPartner(state, restaurant.name, "restaurant");
        const enriched = partnerBlock(
          start,
          restaurant,
          "restaurant",
          restaurant.name,
          input.interests.includes("food") ? "food" : undefined,
          block.notes
        );
        setLocationFrom(state, restaurant);
        return enriched;
      }
      return aiSuggestedBlock(block, {
        notes: block.notes
          ? `${block.notes} (no nearby partner restaurant in catalog)`
          : "AI suggestion — no nearby partner restaurant in catalog",
      });
    }
    case "activity": {
      const activity = pickNearbyPartner(
        catalog.activities,
        state,
        "usedActivities",
        (item) =>
          input.interests.length === 0 ||
          input.interests.some((i) => item.tags.some((t) => t.includes(i)))
      );
      if (activity) {
        state.usedActivities.add(activity.id);
        trackPartner(state, activity.name, "activity");
        const enriched = partnerBlock(start, activity, "activity", activity.name, undefined, block.notes);
        setLocationFrom(state, activity);
        return enriched;
      }
      return aiSuggestedBlock(block, {
        notes: block.notes
          ? `${block.notes} (no nearby partner activity in catalog)`
          : "AI suggestion — no nearby partner activity in catalog",
      });
    }
    case "game": {
      const game = pickNearbyPartner(catalog.games, state, "usedGames");
      if (game) {
        state.usedGames.add(game.id);
        trackPartner(state, game.name, "game");
        const enriched = partnerBlock(
          start,
          game,
          "game",
          game.name,
          input.interests.includes("games") ? "games" : undefined,
          block.notes
        );
        setLocationFrom(state, game);
        return enriched;
      }
      return aiSuggestedBlock(block, {
        notes: block.notes
          ? `${block.notes} (no nearby partner game venue in catalog)`
          : "AI suggestion — no nearby partner game venue in catalog",
      });
    }
    case "sightseeing": {
      const anchor = state.currentLocation ?? defaultDayLocation(catalog);
      let matched =
        matchPoiByTitle(
          block.title,
          catalog.pois,
          state.usedPois,
          anchor,
          getNearbyCatalogRadiusKm()
        ) ?? undefined;

      if (!matched && anchor) {
        matched = pickNearest({
          items: poisForInterests(catalog.pois, input.interests, state.usedPois),
          from: anchor,
          usedIds: state.usedPois,
          maxKm: getNearbyCatalogRadiusKm() * 5,
        });
      }

      if (!matched) {
        matched = poisForInterests(catalog.pois, input.interests, state.usedPois)[0];
      }

      if (matched) {
        state.usedPois.add(matched.id);
        const interest = input.interests.find((i) =>
          matched.tags.some((t) => t.toLowerCase().includes(i.toLowerCase()))
        );
        setLocationFrom(state, matched);
        return {
          start,
          end: addMinutes(start, matched.durationMinutes),
          type: "sightseeing",
          title: matched.name,
          source: "poi",
          matchedInterest: interest,
          notes: block.notes,
          addFromOurRecommendation: false,
          ...geoFields(matched),
        };
      }
      break;
    }
    default:
      break;
  }

  return aiSuggestedBlock(block);
}

/**
 * Main entry: merge AI day skeleton with destination catalog into a client-ready trip plan.
 *
 * @example input:
 *   skeleton: `{ days: [{ date: "2026-06-01", blocks: [{ type: "sightseeing", start: "09:00", ... }] }] }`
 *   input: `{ destination: "Bangkok", startDate: "2026-06-01", endDate: "2026-06-03", interests: ["temple"], ... }`
 *   catalog: bundle from `loadCatalog(destination)`
 * @returns `TripPlan` with resolved blocks, destination meta, and `partnerPlacements` counts
 */
export function enrichSkeletonWithCatalog(
  skeleton: TripSkeleton,
  input: PlanTripRequest,
  catalog: CatalogBundle
): TripPlan {
  const partnerCounts = new Map<string, { category: string; count: number }>();

  const days = skeleton.days.map((day, dayIndex) => {
    const state: EnrichState = {
      usedPois: new Set(),
      usedRestaurants: new Set(),
      usedActivities: new Set(),
      usedGames: new Set(),
      currentLocation: defaultDayLocation(catalog),
      partnerCounts,
    };

    const blocks = day.blocks.map((block) =>
      enrichBlock(block, dayIndex, input, catalog, state)
    );

    return { date: day.date, blocks };
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
    days,
    partnerPlacements: [...partnerCounts.entries()].map(([key, v]) => ({
      service: key.split(":").slice(1).join(":"),
      category: v.category,
      count: v.count,
    })),
    plannerMode: "cursor",
  };
}
