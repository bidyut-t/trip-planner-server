import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UserProfile } from "../../schemas/user-profile.schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "..", "..", "data");

export interface GeoTaggedItem {
  latitude?: number;
  longitude?: number;
}

export interface PartnerItem extends GeoTaggedItem {
  id: string;
  name: string;
  city: string;
  tags: string[];
  durationMinutes: number;
  priority: number;
}

export interface PoiItem extends GeoTaggedItem {
  id: string;
  name: string;
  tags: string[];
  durationMinutes: number;
}

export interface DestinationMeta {
  key: string;
  name: string;
  timezone: string;
  latitude?: number;
  longitude?: number;
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

async function loadPartners(file: string, city?: string): Promise<PartnerItem[]> {
  const items = await readJson<PartnerItem[]>(file);
  const filtered = city ? items.filter((item) => matchesCity(item, city)) : items;
  return filtered.sort((a, b) => b.priority - a.priority);
}

export async function loadPartnerCabs(city?: string): Promise<PartnerItem[]> {
  return loadPartners("partners.cabs.json", city);
}

export async function loadPartnerRestaurants(city?: string): Promise<PartnerItem[]> {
  return loadPartners("partners.restaurants.json", city);
}

export async function loadPartnerActivities(city?: string): Promise<PartnerItem[]> {
  return loadPartners("partners.activities.json", city);
}

export async function loadPartnerGames(city?: string): Promise<PartnerItem[]> {
  return loadPartners("partners.games.json", city);
}

export async function loadPartnerHotels(city?: string): Promise<PartnerItem[]> {
  return loadPartners("partners.hotels.json", city);
}

/**
 * Load user profiles from JSON file
 * 
 * Follows the same pattern as partner data loading.
 * Profiles contain dietary restrictions, accessibility needs, budget level,
 * and travel preferences for personalized trip planning.
 * 
 * @returns Array of user profiles for CodeFest demo (5 team members)
 */
export async function loadUserProfiles(): Promise<UserProfile[]> {
  return readJson<UserProfile[]>("user-profiles.json");
}

/**
 * Get a specific user profile by ID
 * 
 * @param userId - User profile ID (e.g., "user-001")
 * @returns User profile if found, undefined otherwise
 */
export async function getUserProfile(userId: string): Promise<UserProfile | undefined> {
  const profiles = await loadUserProfiles();
  return profiles.find(p => p.id === userId);
}

export async function resolveDestination(
  destination: string
): Promise<DestinationMeta | undefined> {
  const destinations = await loadDestinations();
  const destLower = destination.toLowerCase();
  
  return (
    // Exact match first
    destinations.find((d) => d.name.toLowerCase() === destLower) ??
    // Partial match by key
    destinations.find((d) => destLower.includes(d.key)) ??
    // Partial match by city name (handle cases like "New York City" vs "New York City, USA")
    destinations.find((d) => {
      const cityName = d.name.split(',')[0]?.trim().toLowerCase();
      return cityName === destLower || destLower.includes(cityName || '');
    })
  );
}

export async function loadCatalog(destination: string): Promise<CatalogBundle> {
  const destinations = await loadDestinations();
  const city = normalizeCity(destination);

  const dest =
    (await resolveDestination(destination)) ??
    destinations[0];

  const [cabs, restaurants, activities, games, pois] = await Promise.all([
    loadPartnerCabs(city),
    loadPartnerRestaurants(city),
    loadPartnerActivities(city),
    loadPartnerGames(city),
    readJson<PoiItem[]>(dest.poiFile),
  ]);

  return {
    cabs,
    restaurants,
    activities,
    games,
    pois,
    destination: { ...dest, name: destination },
  };
}
