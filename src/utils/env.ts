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

/** Attach trip-catalog MCP tools to Cursor agent prompts (default: on when Cursor SDK is on). */
export function isCatalogMcpEnabled(): boolean {
  if (process.env.USE_CATALOG_MCP === "false") return false;
  if (process.env.USE_CATALOG_MCP === "true") return true;
  return isCursorSdkEnabled();
}
