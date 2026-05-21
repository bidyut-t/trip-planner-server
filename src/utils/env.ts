import "dotenv/config";

export function isOpenAiSdkEnabled(): boolean {
  return process.env.USE_OPENAI_SDK === "true";
}

/** Fast model for parsing + skeleton planning (avoid slow agent models). */
export function getOpenAiModelId(): string {
  return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
}

/** Max km from current plan location to swap in a catalog restaurant/activity/game. */
export function getNearbyCatalogRadiusKm(): number {
  const n = Number(process.env.NEARBY_CATALOG_RADIUS_KM);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

/** Attach trip-catalog MCP tools to OpenAI chat completions (default: on when OpenAI SDK is on). */
export function isCatalogMcpEnabled(): boolean {
  if (process.env.USE_CATALOG_MCP === "false") return false;
  if (process.env.USE_CATALOG_MCP === "true") return true;
  return isOpenAiSdkEnabled();
}
