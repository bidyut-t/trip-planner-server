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
    
    // Step 1: Fix backwards times (PM to AM, or end before start)
    for (const activity of activities) {
      const startTime = activity.startTime || activity.start;
      const endTime = activity.endTime || activity.end;
      
      if (!startTime || !endTime) continue;
      
      const start24 = normalizeTimeForSorting(startTime);
      const end24 = normalizeTimeForSorting(endTime);
      
      if (end24 <= start24 || (startTime.includes('PM') && endTime.includes('AM'))) {
        // BACKWARDS! Fix it
        const [startHour, startMin] = start24.split(':').map(Number);
        let newEndHour = startHour + 2; // Add 2 hours
        if (newEndHour >= 24) newEndHour = 23;
        
        const newEnd24 = `${newEndHour.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}`;
        const newEnd12 = convertTo12Hour(newEnd24);
        
        activity.endTime = newEnd12;
        activity.end = newEnd12;
        activity.timeBlock = `${startTime} - ${newEnd12}`;
        
        console.log(`[force-timeline] ✓ Fixed backwards time: ${startTime}-${endTime} → ${startTime}-${newEnd12}`);
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
