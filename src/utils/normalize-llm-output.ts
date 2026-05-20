import type { PlanBlock } from "../schemas/trip-plan.schema.js";

const BLOCK_TYPES = new Set<PlanBlock["type"]>([
  "cab",
  "sightseeing",
  "restaurant",
  "activity",
  "game",
  "free",
  "travel",
]);

const BLOCK_TYPE_ALIASES: Record<string, PlanBlock["type"]> = {
  cab: "cab",
  cabs: "cab",
  taxi: "cab",
  transfer: "cab",
  transport: "travel",
  transportation: "travel",
  travel: "travel",
  sightseeing: "sightseeing",
  sightsee: "sightseeing",
  poi: "sightseeing",
  pois: "sightseeing",
  monument: "sightseeing",
  monuments: "sightseeing",
  restaurant: "restaurant",
  restaurants: "restaurant",
  dining: "restaurant",
  meal: "restaurant",
  meals: "restaurant",
  lunch: "restaurant",
  dinner: "restaurant",
  breakfast: "restaurant",
  food: "restaurant",
  activity: "activity",
  activities: "activity",
  experience: "activity",
  experiences: "activity",
  tour: "activity",
  tours: "activity",
  game: "game",
  games: "game",
  arcade: "game",
  free: "free",
  break: "free",
  rest: "free",
  leisure: "free",
};

export const SOURCE_ALIASES: Record<string, "poi" | "partner" | "suggested"> = {
  poi: "poi",
  pois: "poi",
  partner: "partner",
  partners: "partner",
  catalog: "partner",
  suggested: "suggested",
  suggestion: "suggested",
  ai: "suggested",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeSource(value: unknown): "poi" | "partner" | "suggested" | unknown {
  if (typeof value !== "string") return value;
  const key = value.toLowerCase().trim();
  return SOURCE_ALIASES[key] ?? value;
}

export function normalizeBlockType(value: unknown): PlanBlock["type"] | unknown {
  if (typeof value !== "string") return value;

  const key = value.toLowerCase().trim().replace(/[\s-]+/g, "_");
  const mapped = BLOCK_TYPE_ALIASES[key];
  if (mapped) return mapped;

  if (BLOCK_TYPES.has(key as PlanBlock["type"])) return key;

  return value;
}

function normalizeBlock(block: Record<string, unknown>): Record<string, unknown> {
  const type = normalizeBlockType(block.type);
  const source =
    typeof block.source === "string"
      ? (SOURCE_ALIASES[block.source.toLowerCase().trim()] ?? block.source)
      : block.source;

  return {
    ...block,
    type,
    source,
    addFromOurRecommendation:
      typeof block.addFromOurRecommendation === "boolean"
        ? block.addFromOurRecommendation
        : Boolean(block.partner),
  };
}

function normalizePartnerPlacement(row: Record<string, unknown>): Record<string, unknown> {
  const category =
    typeof row.category === "string"
      ? String(normalizeBlockType(row.category) ?? row.category)
      : row.category;

  return { ...row, category };
}

/** Coerce common LLM variants (plurals, synonyms) before Zod validation. */
export function normalizeTripPlanFromLlm(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;

  const days = Array.isArray(payload.days)
    ? payload.days.map((day) => {
        if (!isRecord(day)) return day;
        const blocks = Array.isArray(day.blocks)
          ? day.blocks.map((block) =>
              isRecord(block) ? normalizeBlock(block) : block
            )
          : day.blocks;
        return { ...day, blocks };
      })
    : payload.days;

  const partnerPlacements = Array.isArray(payload.partnerPlacements)
    ? payload.partnerPlacements.map((row) =>
        isRecord(row) ? normalizePartnerPlacement(row) : row
      )
    : payload.partnerPlacements;

  return { ...payload, days, partnerPlacements };
}
