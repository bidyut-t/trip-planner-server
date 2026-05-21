#!/usr/bin/env node
/**
 * MCP server: mock catalog backed by data/*.json
 * Run: npm run mcp:catalog
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  loadDestinations,
  loadPartnerActivities,
  loadPartnerCabs,
  loadPartnerGames,
  loadPartnerRestaurants,
  resolveDestination,
  type DestinationMeta,
} from "../services/catalog/catalog.service.js";

function jsonText(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function normalizeCityInput(destination?: string, city?: string): string | undefined {
  if (city?.trim()) return city.trim();
  if (!destination?.trim()) return undefined;
  const lower = destination.toLowerCase();
  if (lower.includes("jaipur")) return "Jaipur";
  return destination.split(",")[0]?.trim();
}

async function getDestinationByKey(key: string): Promise<DestinationMeta | undefined> {
  const destinations = await loadDestinations();
  return destinations.find((d) => d.key.toLowerCase() === key.toLowerCase());
}

const server = new McpServer(
  {
    name: "trip-catalog",
    version: "1.0.0",
  },
  {
    instructions: `Mock trip catalog from local JSON files.
Use list_destinations first to see supported places.
For partner cabs, restaurants, activities, and games, pass city (e.g. "Jaipur") or a destination string (e.g. "Jaipur, India").
Use get_catalog_bundle to fetch all partner lists for a destination in one call.`,
  }
);

server.registerTool(
  "list_destinations",
  {
    description: "List supported destinations from data/destinations.json",
    inputSchema: z.object({}),
  },
  async () => jsonText(await loadDestinations())
);

server.registerTool(
  "get_destination",
  {
    description: "Get one destination by key (e.g. jaipur) from data/destinations.json",
    inputSchema: z.object({
      key: z.string().describe("Destination key, e.g. jaipur"),
    }),
  },
  async ({ key }) => {
    const dest = await getDestinationByKey(key);
    if (!dest) {
      return {
        content: [{ type: "text", text: `No destination found for key: ${key}` }],
        isError: true,
      };
    }
    return jsonText(dest);
  }
);

server.registerTool(
  "list_cabs",
  {
    description: "Partner cab services from data/partners.cabs.json",
    inputSchema: z.object({
      city: z.string().optional().describe('Filter by city, e.g. "Jaipur"'),
      destination: z
        .string()
        .optional()
        .describe('Infer city from destination name, e.g. "Jaipur, India"'),
    }),
  },
  async ({ city, destination }) => jsonText(await loadPartnerCabs(normalizeCityInput(destination, city)))
);

server.registerTool(
  "list_restaurants",
  {
    description: "Partner restaurants from data/partners.restaurants.json",
    inputSchema: z.object({
      city: z.string().optional(),
      destination: z.string().optional(),
    }),
  },
  async ({ city, destination }) =>
    jsonText(await loadPartnerRestaurants(normalizeCityInput(destination, city)))
);

server.registerTool(
  "list_activities",
  {
    description: "Partner activities from data/partners.activities.json",
    inputSchema: z.object({
      city: z.string().optional(),
      destination: z.string().optional(),
    }),
  },
  async ({ city, destination }) =>
    jsonText(await loadPartnerActivities(normalizeCityInput(destination, city)))
);

server.registerTool(
  "list_games",
  {
    description: "Partner games from data/partners.games.json",
    inputSchema: z.object({
      city: z.string().optional(),
      destination: z.string().optional(),
    }),
  },
  async ({ city, destination }) =>
    jsonText(await loadPartnerGames(normalizeCityInput(destination, city)))
);

server.registerTool(
  "get_catalog_bundle",
  {
    description:
      "All partner lists (cabs, restaurants, activities, games) for a destination. Does not include POIs.",
    inputSchema: z.object({
      destination: z.string().describe('e.g. "Jaipur, India"'),
    }),
  },
  async ({ destination }) => {
    const dest = await resolveDestination(destination);
    if (!dest) {
      return {
        content: [
          {
            type: "text",
            text: `Destination not in catalog: ${destination}. Call list_destinations for supported keys.`,
          },
        ],
        isError: true,
      };
    }
    const city = normalizeCityInput(destination);
    const [cabs, restaurants, activities, games] = await Promise.all([
      loadPartnerCabs(city),
      loadPartnerRestaurants(city),
      loadPartnerActivities(city),
      loadPartnerGames(city),
    ]);
    return jsonText({ destination: dest, cabs, restaurants, activities, games });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
