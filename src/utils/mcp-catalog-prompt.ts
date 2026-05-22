import { tripCatalogMcpServerName } from "./mcp-catalog-config.js";

export function buildCatalogMcpPromptBlock(): string {
  return `
Catalog data: you MUST call "${tripCatalogMcpServerName}" MCP tools (get_catalog_bundle or list_restaurants / list_cabs / list_activities / list_games) before finalizing the schedule. Use exact names from tool results; do not invent partner brands.`;
}
