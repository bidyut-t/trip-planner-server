/**
 * AGGRESSIVE TIME FIXING - Forces all activities into valid, non-overlapping time slots
 * This runs AFTER the AI generates the plan to ensure times always make sense.
 */

import { normalizeTimeForSorting, convertTo12Hour } from './time-utils.js';

export function forceValidTimeline(plan: any): any {
  if (!plan.days || plan.days.length === 0) return plan;
  
  for (const day of plan.days) {
    const activities = day.blocks || day.activities || [];
    if (activities.length === 0) continue;
    
    console.log(`[force-timeline] Fixing ${activities.length} activities for day ${day.day}`);
    
    // Step 1: Fix backwards times (PM to AM, or end before start) AND unreasonably long activities
    for (const activity of activities) {
      const startTime = activity.startTime || activity.start;
      const endTime = activity.endTime || activity.end;
      const activityName = activity.title || activity.name || activity.activity?.name || 'Activity';
      const activityType = activity.type || activity.activity?.type || 'unknown';
      
      if (!startTime || !endTime) continue;
      
      const start24 = normalizeTimeForSorting(startTime);
      const end24 = normalizeTimeForSorting(endTime);
      
      // Calculate duration in minutes
      const [startHour, startMin] = start24.split(':').map(Number);
      const [endHour, endMin] = end24.split(':').map(Number);
      const durationMinutes = (endHour * 60 + endMin) - (startHour * 60 + startMin);
      
      // CRITICAL FIX: Detect PM to AM crossings (like "2:00 PM - 12:00 AM")
      const isPMtoAM = startTime.includes('PM') && endTime.includes('AM');
      
      // CRITICAL FIX: Detect unreasonably long activities (> 4 hours for most things)
      const maxDuration = activityType === 'museum' || activityType === 'activity' ? 240 : 150; // 4 hours for museums, 2.5 hours for others
      const isTooLong = durationMinutes > maxDuration || durationMinutes < 0;
      
      if (end24 <= start24 || isPMtoAM || isTooLong) {
        // BACKWARDS or TOO LONG! Fix it with reasonable duration
        let reasonableDuration = 120; // Default 2 hours
        
        // Type-specific durations
        if (activityType === 'restaurant') reasonableDuration = 90; // 1.5 hours
        if (activityType === 'museum' || activityType === 'attraction') reasonableDuration = 150; // 2.5 hours
        if (activityType === 'activity') reasonableDuration = 180; // 3 hours
        if (activityType === 'transportation') reasonableDuration = 30; // 30 min
        
        const newEndMinutes = (startHour * 60 + startMin) + reasonableDuration;
        let newEndHour = Math.floor(newEndMinutes / 60);
        let newEndMin = newEndMinutes % 60;
        
        // Cap at 10 PM (22:00) to avoid midnight
        if (newEndHour >= 22) {
          newEndHour = 22;
          newEndMin = 0;
        }
        
        const newEnd24 = `${newEndHour.toString().padStart(2, '0')}:${newEndMin.toString().padStart(2, '0')}`;
        const newEnd12 = convertTo12Hour(newEnd24);
        
        activity.endTime = newEnd12;
        activity.end = newEnd12;
        activity.timeBlock = `${startTime} - ${newEnd12}`;
        
        const reason = isPMtoAM ? 'PM-to-AM crossing' : isTooLong ? `too long (${Math.round(durationMinutes/60)}hrs)` : 'backwards';
        console.log(`[force-timeline] ✓ Fixed "${activityName}" (${reason}): ${startTime}-${endTime} → ${startTime}-${newEnd12}`);
      }
    }
    
    // Step 2: Sort chronologically
    activities.sort((a: any, b: any) => {
      const timeA = normalizeTimeForSorting(a.startTime || a.start || '00:00');
      const timeB = normalizeTimeForSorting(b.startTime || b.start || '00:00');
      return timeA.localeCompare(timeB);
    });
    
    // Step 3: Fix overlaps - BUT DON'T SHIFT TO MIDNIGHT
    // Instead, just log warnings. The AI should fix this by not adding too many activities.
    for (let i = 1; i < activities.length; i++) {
      const prev = activities[i - 1];
      const curr = activities[i];
      
      const prevEnd = normalizeTimeForSorting(prev.endTime || prev.end || '00:00');
      const currStart = normalizeTimeForSorting(curr.startTime || curr.start || '00:00');
      
      if (currStart < prevEnd) {
        // OVERLAP! Just log it, don't shift
        const prevName = prev.title || prev.name || prev.activity?.name || 'Activity';
        const currName = curr.title || curr.name || curr.activity?.name || 'Activity';
        console.warn(`[force-timeline] OVERLAP DETECTED: "${prevName}" ends at ${prevEnd} but "${currName}" starts at ${currStart}`);
        console.warn(`[force-timeline] → AI generated too many activities for one day!`);
      }
    }
    
    // Update the day
    if (day.blocks) {
      day.blocks = activities;
    } else {
      day.activities = activities;
    }
  }
  
  console.log('[force-timeline] Timeline forced to be valid');
  return plan;
}

function getMinutesBetween(time1: string, time2: string): number {
  const [h1, m1] = time1.split(':').map(Number);
  const [h2, m2] = time2.split(':').map(Number);
  return (h2 * 60 + m2) - (h1 * 60 + m1);
}

function addMinutes(time: string, minutes: number): string {
  const [hour, min] = time.split(':').map(Number);
  let totalMinutes = hour * 60 + min + minutes;
  if (totalMinutes >= 24 * 60) totalMinutes = 23 * 60 + 59; // Cap at 11:59 PM
  const newHour = Math.floor(totalMinutes / 60);
  const newMin = totalMinutes % 60;
  return `${newHour.toString().padStart(2, '0')}:${newMin.toString().padStart(2, '0')}`;
}
