import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "..", "data");

export interface PartnerItem {
  id: string;
  name: string;
  city: string;
  tags: string[];
  durationMinutes: number;
  priority: number;
}

export interface PoiItem {
  id: string;
  name: string;
  tags: string[];
  durationMinutes: number;
}

export interface DestinationMeta {
  key: string;
  name: string;
  timezone: string;
  summary: string;
  tips: string[];
  poiFile: string;
}

export interface CatalogBundle {
  cabs: PartnerItem[];
  restaurants: PartnerItem[];
  activities: PartnerItem[];
  games: PartnerItem[];
  pois: PoiItem[];
  destination: DestinationMeta;
}

async function readJson<T>(file: string): Promise<T> {
  const raw = await readFile(path.join(dataDir, file), "utf-8");
  return JSON.parse(raw) as T;
}

function normalizeCity(destination: string): string {
  const lower = destination.toLowerCase();
  if (lower.includes("jaipur")) return "Jaipur";
  return destination.split(",")[0]?.trim() ?? destination;
}

function matchesCity(item: PartnerItem, city: string): boolean {
  return item.city.toLowerCase() === city.toLowerCase();
}

export async function loadDestinations(): Promise<DestinationMeta[]> {
  return readJson<DestinationMeta[]>("destinations.json");
}

export async function loadCatalog(destination: string): Promise<CatalogBundle> {
  const destinations = await readJson<DestinationMeta[]>("destinations.json");
  const city = normalizeCity(destination);

  const dest =
    destinations.find((d) => d.name.toLowerCase() === destination.toLowerCase()) ??
    destinations.find((d) => destination.toLowerCase().includes(d.key)) ??
    destinations[0];

    // To DO:
    // 1. ONly share what is available in the catalog for the destination.
    // 2. If the destination is not in the catalog, return an error.
    // 3. If the destination is in the catalog, but the catalog is not available, return an error.
    // 4. If the catalog is available, but the destination is not in the catalog, return an error.

  const [cabs, restaurants, activities, games, pois] = await Promise.all([
    readJson<PartnerItem[]>("partners.cabs.json"),
    readJson<PartnerItem[]>("partners.restaurants.json"),
    readJson<PartnerItem[]>("partners.activities.json"),
    readJson<PartnerItem[]>("partners.games.json"),
    readJson<PoiItem[]>(dest.poiFile),
  ]);

  return {
    cabs: cabs.filter((c) => matchesCity(c, city)).sort((a, b) => b.priority - a.priority),
    restaurants: restaurants
      .filter((r) => matchesCity(r, city))
      .sort((a, b) => b.priority - a.priority),
    activities: activities
      .filter((a) => matchesCity(a, city))
      .sort((a, b) => b.priority - a.priority),
    games: games.filter((g) => matchesCity(g, city)).sort((a, b) => b.priority - a.priority),
    pois,
    destination: { ...dest, name: destination },
  };
}
