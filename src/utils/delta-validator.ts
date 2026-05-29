/**
 * Delta Response Validation Layer
 * 
 * Level 1: Auto-Fix Validation
 * - Automatically corrects logical errors in AI-generated deltas
 * - Logs issues server-side for debugging
 * - NO user-facing error messages (professional UX)
 * 
 * What it fixes:
 * - Closing time violations (activity ends after venue closes)
 * - Time format inconsistencies (already handled by overlap detection)
 * - Data completeness warnings (logs but doesn't block)
 * 
 * What it logs (but allows):
 * - Quantity mismatches (user asked for plural, got 1)
 * - Missing optional data (images, highlights)
 */

import type { RefinementDelta } from '../services/delta-refiner.service.js';

interface ValidationResult {
  isValid: boolean;
  autoFixedCount: number;
  warnings: string[];
}

/**
 * Validate and auto-fix delta response from AI
 * Returns validated/fixed delta with issues logged server-side
 */
export function validateAndFixDelta(
  delta: RefinementDelta,
  userPrompt: string,
  originalPlan?: any
): { delta: RefinementDelta; validation: ValidationResult } {
  const warnings: string[] = [];
  let autoFixedCount = 0;

  // Validate each operation
  for (const operation of delta.operations) {
    if (operation.type === 'add' && operation.activities) {
      // Check 0: Time range validation (CRITICAL)
      for (const activity of operation.activities) {
        const timeError = validateTimeRange(activity);
        if (timeError) {
          warnings.push(timeError);
          console.error('[validation] CRITICAL TIME ERROR:', timeError);
        }
      }
      
      // Check 1: Quantity validation (log only, don't block)
      const quantityIssue = checkQuantity(operation.activities, userPrompt);
      if (quantityIssue) {
        warnings.push(quantityIssue);
        console.warn('[validation]', quantityIssue);
      }

      // Check 2: Closing time validation (auto-fix)
      for (const activity of operation.activities) {
        const closingTimeFix = fixClosingTimeViolation(activity);
        if (closingTimeFix) {
          autoFixedCount++;
          warnings.push(closingTimeFix);
          console.log('[validation] AUTO-FIX:', closingTimeFix);
        }
      }

      // Check 3: Data completeness (log only, don't block)
      for (const activity of operation.activities) {
        const dataWarnings = checkDataCompleteness(activity);
        warnings.push(...dataWarnings);
        dataWarnings.forEach(w => console.warn('[validation]', w));
      }

      // Check 4: Semantic time mismatches (log only, don't block)
      for (const activity of operation.activities) {
        const timingWarning = checkSemanticTiming(activity);
        if (timingWarning) {
          warnings.push(timingWarning);
          console.warn('[validation]', timingWarning);
        }
      }
    }
    
    // Validate MODIFY operations too
    if (operation.type === 'modify' && operation.changes) {
      if (operation.changes.start && operation.changes.end) {
        const timeError = validateTimeRange(operation.changes);
        if (timeError) {
          warnings.push(`MODIFY operation: ${timeError}`);
          console.error('[validation] CRITICAL TIME ERROR in MODIFY:', timeError);
        }
      }
    }
  }

  const result: ValidationResult = {
    isValid: true, // Always true for Level 1 (we fix or allow)
    autoFixedCount,
    warnings,
  };

  if (warnings.length > 0) {
    console.log(`[validation] Summary: ${autoFixedCount} auto-fixed, ${warnings.length - autoFixedCount} warnings logged`);
  }

  return { delta, validation: result };
}

/**
 * Validate that activity end time is after start time
 * Returns error string if invalid, null otherwise
 */
function validateTimeRange(activity: any): string | null {
  if (!activity.start || !activity.end) return null;
  
  const startTime24 = parseTimeTo24Hour(activity.start);
  const endTime24 = parseTimeTo24Hour(activity.end);
  
  if (!startTime24 || !endTime24) {
    return `INVALID TIME FORMAT: "${activity.name || 'Unknown'}" has unparseable times (start: ${activity.start}, end: ${activity.end})`;
  }
  
  if (endTime24 <= startTime24) {
    return `BACKWARD TIME RANGE: "${activity.name || 'Unknown'}" ends at ${activity.end} but starts at ${activity.start}. Activities cannot end before they start!`;
  }
  
  return null;
}

/**
 * Check if AI returned correct quantity
 * Returns warning string if mismatch, null otherwise
 */
function checkQuantity(activities: any[], userPrompt: string): string | null {
  const lowerPrompt = userPrompt.toLowerCase();
  
  // Check for plural nouns
  const hasPluralRequest = 
    lowerPrompt.includes('activities') ||
    lowerPrompt.includes('museums') ||
    lowerPrompt.includes('restaurants') ||
    lowerPrompt.includes('places') ||
    lowerPrompt.includes('spots') ||
    lowerPrompt.match(/\b(multiple|several|some|few)\b/);

  if (hasPluralRequest && activities.length < 2) {
    return `QUANTITY MISMATCH: User requested plural ("${userPrompt}") but AI generated ${activities.length} activity`;
  }

  return null;
}

/**
 * Fix closing time violations
 * Returns fix description if changed, null otherwise
 */
function fixClosingTimeViolation(activity: any): string | null {
  if (!activity.availability) return null;

  // Parse closing time from availability string
  // Patterns: "10am-5pm", "10:00-17:00", "closes at 8pm", "until 11pm"
  const patterns = [
    /(\d{1,2}):?(\d{2})?\s*-\s*(\d{1,2}):?(\d{2})?\s*(am|pm)/i,  // "10am-5pm"
    /closes?\s+at\s+(\d{1,2}):?(\d{2})?\s*(am|pm)/i,              // "closes at 8pm"
    /until\s+(\d{1,2}):?(\d{2})?\s*(am|pm)/i,                     // "until 8pm"
  ];
  
  let closingTime24: string | null = null;
  
  for (const pattern of patterns) {
    const match = activity.availability.match(pattern);
    if (match) {
      let closingHour: number;
      let closingMin: number;
      let period: string;
      
      if (pattern.source.includes('closes|until')) {
        // Format: "closes at 8pm"
        closingHour = parseInt(match[1], 10);
        closingMin = match[2] ? parseInt(match[2], 10) : 0;
        period = match[3].toUpperCase();
      } else {
        // Format: "10am-5pm" (take the second time)
        closingHour = parseInt(match[3], 10);
        closingMin = match[4] ? parseInt(match[4], 10) : 0;
        period = match[5].toUpperCase();
      }
      
      // Convert to 24-hour format
      if (period === 'PM' && closingHour !== 12) {
        closingHour += 12;
      } else if (period === 'AM' && closingHour === 12) {
        closingHour = 0;
      }
      
      closingTime24 = `${closingHour.toString().padStart(2, '0')}:${closingMin.toString().padStart(2, '0')}`;
      break;
    }
  }
  
  if (!closingTime24) return null;

  // Parse activity end time
  const activityEnd = parseTimeTo24Hour(activity.end);
  if (!activityEnd) return null;

  // Check if activity ends after closing time
  if (activityEnd > closingTime24) {
    // Fix: Set end time to closing time
    const [hour, min] = closingTime24.split(':').map(Number);
    const period = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    
    const oldEnd = activity.end;
    activity.end = `${hour12}:${min.toString().padStart(2, '0')} ${period}`;
    
    return `CLOSING TIME FIX: "${activity.name}" was ${activity.start}-${oldEnd} but closes at ${closingTime24}. Fixed to end at ${activity.end}`;
  }

  return null;
}

/**
 * Check data completeness
 * Returns array of warning strings
 */
function checkDataCompleteness(activity: any): string[] {
  const warnings: string[] = [];

  if (!activity.price || activity.price === 0) {
    warnings.push(`DATA WARNING: "${activity.name}" has price=$0`);
  }

  if (!activity.rating || activity.rating === 0) {
    warnings.push(`DATA WARNING: "${activity.name}" has rating=0`);
  }

  if (!activity.images || activity.images.length === 0) {
    warnings.push(`DATA WARNING: "${activity.name}" has no images`);
  }

  return warnings;
}

/**
 * Check semantic timing (e.g., "afternoon" activity scheduled at 6pm)
 * Returns warning string if mismatch, null otherwise
 */
function checkSemanticTiming(activity: any): string | null {
  if (!activity.name || !activity.start) return null;

  const nameLower = activity.name.toLowerCase();
  const startTime24 = parseTimeTo24Hour(activity.start);
  if (!startTime24) return null;

  const hour = parseInt(startTime24.split(':')[0], 10);

  // Check for "morning" activities scheduled after 12pm
  if (nameLower.includes('morning') && hour >= 12) {
    return `SEMANTIC TIMING: "${activity.name}" contains "morning" but starts at ${activity.start} (afternoon/evening)`;
  }

  // Check for "afternoon" activities scheduled after 6pm
  if (nameLower.includes('afternoon') && hour >= 18) {
    return `SEMANTIC TIMING: "${activity.name}" contains "afternoon" but starts at ${activity.start} (evening)`;
  }

  // Check for "evening" activities scheduled before 5pm
  if (nameLower.includes('evening') && hour < 17) {
    return `SEMANTIC TIMING: "${activity.name}" contains "evening" but starts at ${activity.start} (too early)`;
  }

  return null;
}

/**
 * Parse time string to 24-hour format for comparison
 */
function parseTimeTo24Hour(timeStr: string): string | null {
  if (!timeStr) return null;

  // Already 24-hour format
  if (/^\d{2}:\d{2}$/.test(timeStr)) {
    return timeStr;
  }

  // Parse 12-hour format
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

  return null;
}
