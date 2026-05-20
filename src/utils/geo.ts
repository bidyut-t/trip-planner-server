export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface GeoTagged {
  latitude?: number;
  longitude?: number;
}

export function hasCoordinates(item: GeoTagged): item is Coordinates {
  return (
    typeof item.latitude === "number" &&
    typeof item.longitude === "number" &&
    Number.isFinite(item.latitude) &&
    Number.isFinite(item.longitude)
  );
}

/** Great-circle distance in kilometres (works like map pin distance). */
export function haversineKm(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export interface NearbyPickOptions<T extends GeoTagged & { id: string; priority?: number }> {
  items: T[];
  from: Coordinates;
  usedIds: Set<string>;
  maxKm: number;
  filter?: (item: T) => boolean;
}

/** Nearest catalog item within maxKm, preferring higher priority when distances tie. */
export function pickNearest<T extends GeoTagged & { id: string; priority?: number }>(
  options: NearbyPickOptions<T>
): T | undefined {
  const { items, from, usedIds, maxKm, filter } = options;

  const candidates = items
    .filter((item): item is T & Coordinates => !usedIds.has(item.id) && hasCoordinates(item) && (!filter || filter(item)))
    .map((item) => ({
      item,
      distanceKm: haversineKm(from, item),
    }))
    .filter(({ distanceKm }) => distanceKm <= maxKm)
    .sort((a, b) => {
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      return (b.item.priority ?? 0) - (a.item.priority ?? 0);
    });

  return candidates[0]?.item;
}

export function geoFields(item: GeoTagged): Pick<Coordinates, "latitude" | "longitude"> | undefined {
  if (!hasCoordinates(item)) return undefined;
  return { latitude: item.latitude, longitude: item.longitude };
}
