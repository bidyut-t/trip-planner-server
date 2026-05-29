/**
 * Plan Data Merger Utility
 * 
 * Ensures data integrity during plan refinement by programmatically merging
 * rich data from original activities into the AI-refined plan.
 * 
 * Problem: LLMs sometimes simplify JSON during refinement, losing prices, points, images
 * Solution: After AI refinement, copy all data from matching original activities
 * 
 * This is production-quality data integrity - never trust LLMs with data preservation!
 */

interface Block {
  title?: string;
  provider?: string;
  type?: string;
  price?: number;
  rating?: number;
  reviews?: number;
  earnPoints?: number;
  images?: string[];
  bookingUrl?: string;
  highlights?: string[];
  availability?: string;
  cancellationPolicy?: string;
  duration?: string;
  [key: string]: any;
}

interface Day {
  date: string;
  blocks?: Block[];
  activities?: any[];
}

interface Plan {
  destination?: string;
  days?: Day[];
  [key: string]: any;
}

/**
 * Merge rich data from original plan into refined plan
 * 
 * Strategy:
 * 1. Match activities by title/name (case-insensitive)
 * 2. For matches: Copy ALL data fields from original to refined
 * 3. For new activities: Keep as-is (should have data from MCP tools)
 * 4. Result: Refined plan with zero data loss
 * 
 * @param originalPlan - The original plan with complete data
 * @param refinedPlan - The AI-refined plan (may have missing data)
 * @returns Refined plan with all original data preserved
 */
export function mergeRefinedPlanWithOriginal(originalPlan: Plan, refinedPlan: Plan): Plan {
  if (!originalPlan || !refinedPlan) {
    return refinedPlan;
  }

  // Create lookup map of original activities by title (normalized)
  const originalActivitiesMap = new Map<string, Block>();
  
  originalPlan.days?.forEach(day => {
    const blocks = day.blocks || day.activities || [];
    blocks.forEach((block: Block) => {
      originalActivitiesMap.set(block.title || block.name || '', block);
    });
  });

  // Merge data into refined plan
  const mergedPlan = { ...refinedPlan };
  
  if (mergedPlan.days) {
    mergedPlan.days = mergedPlan.days.map(day => {
      const blocks = day.blocks || day.activities || [];
      
      const mergedBlocks = blocks.map((block: Block) => {
        const blockTitle = block.title || block.name || '';
        
        // Find matching original activity (fuzzy match)
        let originalBlock: Block | undefined;
        for (const [originalTitle, original] of originalActivitiesMap.entries()) {
          if (titlesMatch(blockTitle, originalTitle)) {
            originalBlock = original;
            break;
          }
        }
        
        if (originalBlock) {
          // Found matching activity - merge ALL data from original
          return {
            ...block,
            // Preserve ALL rich data fields
            price: originalBlock.price ?? block.price,
            rating: originalBlock.rating ?? block.rating,
            reviews: originalBlock.reviews ?? block.reviews,
            earnPoints: originalBlock.earnPoints ?? block.earnPoints,
            images: originalBlock.images || block.images,
            bookingUrl: originalBlock.bookingUrl || block.bookingUrl,
            highlights: originalBlock.highlights || block.highlights,
            availability: originalBlock.availability || block.availability,
            cancellationPolicy: originalBlock.cancellationPolicy || block.cancellationPolicy,
            duration: originalBlock.duration || block.duration,
            currency: originalBlock.currency || block.currency,
            // Keep refined scheduling and notes
            start: block.start,
            end: block.end,
            notes: block.notes,
            latitude: originalBlock.latitude || block.latitude,
            longitude: originalBlock.longitude || block.longitude,
          };
        }
        
        // New activity - keep as-is (should have data from MCP tools)
        return block;
      });
      
      return {
        ...day,
        blocks: day.blocks ? mergedBlocks : undefined,
        activities: day.activities ? mergedBlocks : undefined,
      };
    });
  }

  return mergedPlan;
}

/**
 * Normalize activity title for matching
 * Removes common prefixes, special chars, converts to lowercase
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    // Remove common prefixes that AI adds
    .replace(/^(breakfast at|lunch at|dinner at|visit to|explore|tour of)\s+/i, '')
    .replace(/[^a-z0-9\s]/g, '') // Remove special chars
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Check if two titles refer to the same activity (fuzzy match)
 * Handles cases like "Balthazar Restaurant" vs "Breakfast at Balthazar"
 */
function titlesMatch(title1: string, title2: string): boolean {
  const norm1 = normalizeTitle(title1);
  const norm2 = normalizeTitle(title2);
  
  // Exact match after normalization
  if (norm1 === norm2) return true;
  
  // Check if one contains the other (e.g., "Balthazar" in "Balthazar Restaurant")
  const words1 = norm1.split(' ').filter(w => w.length > 3); // Ignore short words
  const words2 = norm2.split(' ').filter(w => w.length > 3);
  
  // If they share 2+ significant words, consider it a match
  const sharedWords = words1.filter(w => words2.includes(w));
  return sharedWords.length >= Math.min(2, Math.min(words1.length, words2.length));
}
