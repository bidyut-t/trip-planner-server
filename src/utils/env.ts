import "dotenv/config";

export function isCursorSdkEnabled(): boolean {
  return process.env.USE_CURSOR_SDK === "true";
}

/** Fast model for parsing + skeleton planning (avoid slow agent models). */
export function getCursorModelId(): string {
  return process.env.CURSOR_MODEL ?? "gemini-3-flash";
}

/** Max km from current plan location to swap in a catalog restaurant/activity/game. */
export function getNearbyCatalogRadiusKm(): number {
  const n = Number(process.env.NEARBY_CATALOG_RADIUS_KM);
  return Number.isFinite(n) && n > 0 ? n : 4;
}
