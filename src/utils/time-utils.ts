/**
 * Shared time utility functions for plan validation
 */

/**
 * Normalize time strings to 24-hour format for sorting/comparison
 * Handles: "08:30", "8:30 AM", "2:00 PM", "14:00"
 */
export function normalizeTimeForSorting(timeStr: string): string {
  // Already in 24-hour format (HH:MM)
  if (/^\d{2}:\d{2}$/.test(timeStr)) {
    return timeStr;
  }
  
  // Handle 12-hour format with AM/PM
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (match) {
    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const period = match[3].toUpperCase();
    
    if (period === 'PM' && hours !== 12) {
      hours += 12;
    } else if (period === 'AM' && hours === 12) {
      hours = 0;
    }
    
    return `${hours.toString().padStart(2, '0')}:${minutes}`;
  }
  
  // Fallback
  return timeStr;
}

/**
 * Convert 24-hour time to 12-hour format
 */
export function convertTo12Hour(time: string): string {
  const [hourStr, minutes] = time.split(':');
  let hour = parseInt(hourStr, 10);
  const period = hour >= 12 ? 'PM' : 'AM';
  
  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;
  
  return `${hour}:${minutes} ${period}`;
}

/**
 * Extract closing time from availability string
 * Enhanced to handle multiple formats with fallback
 */
export function extractClosingTime(availability: string): string | null {
  if (!availability) return null;
  
  const original = availability;
  availability = availability.toLowerCase();
  
  // Special cases first
  if (availability.includes('24/7') || availability.includes('24 hours') || availability.includes('open 24')) {
    console.log(`[extractClosingTime] "${original}" → ALWAYS OPEN (no closing time)`);
    return null; // Open 24/7, no closing time
  }
  
  if (availability.includes('open late') || availability.includes('late night')) {
    console.log(`[extractClosingTime] "${original}" → defaults to 11:00 PM (open late)`);
    return '23:00';
  }
  
  // Enhanced pattern matching
  const patterns = [
    // Pattern 1: "10am-6pm" or "10:00 am - 6:00 pm"
    /(\d{1,2}):?(\d{2})?\s*(am|pm)?\s*[-–—]\s*(\d{1,2}):?(\d{2})?\s*(am|pm)/i,
    // Pattern 2: "closes at 8pm" or "until 11pm"
    /(closes?|until|till)\s+(?:at\s+)?(\d{1,2}):?(\d{2})?\s*(am|pm)/i,
    // Pattern 3: "daily 9-6", "open 9-5"
    /(?:daily|open)\s+(\d{1,2})\s*[-–—]\s*(\d{1,2})/i,
  ];
  
  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    const match = availability.match(pattern);
    
    if (match) {
      let closingHour: number;
      let closingMin: number = 0;
      let period: string | undefined;
      
      if (i === 0) {
        // Pattern 1: "10am-6pm" - take the closing time (after the dash)
        closingHour = parseInt(match[4], 10);
        closingMin = match[5] ? parseInt(match[5], 10) : 0;
        period = match[6].toUpperCase();
      } else if (i === 1) {
        // Pattern 2: "closes at 8pm"
        closingHour = parseInt(match[2], 10);
        closingMin = match[3] ? parseInt(match[3], 10) : 0;
        period = match[4].toUpperCase();
      } else {
        // Pattern 3: "daily 9-6" (assume second number is PM if < 12)
        closingHour = parseInt(match[2], 10);
        if (closingHour < 12) {
          closingHour += 12; // Assume PM for closing time
        }
      }
      
      // Convert to 24-hour format if period is specified
      if (period) {
        if (period === 'PM' && closingHour !== 12) {
          closingHour += 12;
        } else if (period === 'AM' && closingHour === 12) {
          closingHour = 0;
        } else if (period === 'AM' && closingHour < 12) {
          // CRITICAL FIX: Overnight closing times (like 2 AM, 4 AM) mean next day
          // For trip planning, we should NOT schedule activities into overnight hours
          // Convert to a reasonable same-day closing time instead
          // Example: "10am-4am" becomes "10am-11pm" for planning purposes
          console.warn(`[extractClosingTime] Overnight closing time detected: "${original}" closes at ${closingHour}:${closingMin.toString().padStart(2, '0')} AM`);
          console.warn(`[extractClosingTime] → Converting to 11:00 PM for same-day trip planning (overnight hours not supported)`);
          closingHour = 23; // 11 PM
          closingMin = 0;
        }
      }
      
      const result = `${closingHour.toString().padStart(2, '0')}:${closingMin.toString().padStart(2, '0')}`;
      console.log(`[extractClosingTime] ✓ Parsed "${original}" → closing at ${result} (pattern ${i + 1})`);
      return result;
    }
  }
  
  // FALLBACK: If we can't parse closing time, use conservative default (8pm)
  console.warn(`[extractClosingTime] Could not parse "${original}" → using FALLBACK: 8:00 PM (20:00)`);
  return '20:00'; // Conservative default: 8pm
}

/**
 * Subtract minutes from a time string
 */
export function subtractMinutes(time: string, minutes: number): string {
  const [hour, min] = time.split(':').map(Number);
  let totalMinutes = hour * 60 + min - minutes;
  if (totalMinutes < 0) totalMinutes = 0; // Don't go before midnight
  const newHour = Math.floor(totalMinutes / 60) % 24;
  const newMin = totalMinutes % 60;
  return `${newHour.toString().padStart(2, '0')}:${newMin.toString().padStart(2, '0')}`;
}

/**
 * Calculate time difference in minutes
 */
export function getTimeDiffMinutes(time1: string, time2: string): number {
  const [h1, m1] = time1.split(':').map(Number);
  const [h2, m2] = time2.split(':').map(Number);
  
  const minutes1 = h1 * 60 + m1;
  const minutes2 = h2 * 60 + m2;
  
  return Math.abs(minutes2 - minutes1);
}
