/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in kilometers
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface LocationPoint {
  latitude: number;
  longitude: number;
}

export interface Partner {
  id: string;
  name: string;
  city: string;
  tags: string[];
  priority: number;
  latitude?: number;
  longitude?: number;
}

/**
 * Filter partners within a specified radius from a location
 */
export function filterPartnersWithinRadius(
  partners: Partner[],
  centerPoint: LocationPoint,
  radiusKm: number
): Partner[] {
  return partners.filter(partner => {
    if (!partner.latitude || !partner.longitude) {
      // If partner has no coordinates, include it (could be city-wide service)
      return true;
    }
    
    const distance = calculateDistance(
      centerPoint.latitude,
      centerPoint.longitude,
      partner.latitude,
      partner.longitude
    );
    
    return distance <= radiusKm;
  });
}

/**
 * Find the closest partner from a list
 */
export function findClosestPartner(
  partners: Partner[],
  centerPoint: LocationPoint
): Partner | null {
  if (partners.length === 0) return null;
  
  let closestPartner = partners[0];
  let closestDistance = Infinity;
  
  for (const partner of partners) {
    if (!partner.latitude || !partner.longitude) {
      // If no coordinates, consider it as a city-wide service (close)
      return partner;
    }
    
    const distance = calculateDistance(
      centerPoint.latitude,
      centerPoint.longitude,
      partner.latitude,
      partner.longitude
    );
    
    if (distance < closestDistance) {
      closestDistance = distance;
      closestPartner = partner;
    }
  }
  
  return closestPartner;
}