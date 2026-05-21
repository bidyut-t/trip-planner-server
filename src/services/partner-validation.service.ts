import { 
  loadPartnerActivities, 
  loadPartnerCabs, 
  loadPartnerGames, 
  loadPartnerRestaurants 
} from "../services/catalog/catalog.service.js";
import type { PlanBlock } from "../schemas/trip-plan.schema.js";

interface PartnerValidationResult {
  isValid: boolean;
  partnerExists: boolean;
  correctProvider?: string;
  reason?: string;
}

/**
 * Validate if a partner provider exists in our data
 */
export async function validatePartnerInPlan(
  block: PlanBlock,
  city: string
): Promise<PartnerValidationResult> {
  // Non-partner blocks are automatically valid
  if (!block.partner || !block.provider) {
    return {
      isValid: true,
      partnerExists: false,
    };
  }

  let partners: Array<{ name: string }> = [];
  
  // Load the appropriate partner data based on block type
  switch (block.type) {
    case "restaurant":
      partners = await loadPartnerRestaurants(city);
      break;
    case "activity":
      partners = await loadPartnerActivities(city);
      break;
    case "game":
      partners = await loadPartnerGames(city);
      break;
    case "cab":
    case "travel":
      partners = await loadPartnerCabs(city);
      break;
    default:
      // For other block types, we don't have partner data
      return {
        isValid: false,
        partnerExists: false,
        reason: `Block type '${block.type}' doesn't support partners`,
      };
  }

  // Check if the provider exists
  const providerExists = partners.some(p => 
    p.name.toLowerCase() === block.provider!.toLowerCase()
  );

  if (providerExists) {
    return {
      isValid: true,
      partnerExists: true,
    };
  }

  // Find closest match for suggestions
  const closestMatch = partners.find(p => 
    p.name.toLowerCase().includes(block.provider!.toLowerCase()) ||
    block.provider!.toLowerCase().includes(p.name.toLowerCase())
  );

  return {
    isValid: false,
    partnerExists: false,
    correctProvider: closestMatch?.name,
    reason: `Provider '${block.provider}' not found in ${block.type} partners for ${city}`,
  };
}

/**
 * Validate all blocks in a trip plan and fix addFromOurRecommendation flags
 */
export async function validateAndFixPlanBlocks(
  blocks: PlanBlock[],
  city: string
): Promise<PlanBlock[]> {
  const fixedBlocks: PlanBlock[] = [];

  for (const block of blocks) {
    const validation = await validatePartnerInPlan(block, city);
    
    const fixedBlock: PlanBlock = {
      ...block,
      addFromOurRecommendation: validation.isValid && validation.partnerExists,
    };

    // If partner is marked but doesn't exist, fix the partner flag
    if (block.partner && !validation.partnerExists) {
      fixedBlock.partner = false;
      fixedBlock.source = "suggested";
      delete fixedBlock.provider;
    }

    fixedBlocks.push(fixedBlock);
  }

  return fixedBlocks;
}

/**
 * Get summary of partner validation results
 */
export async function getPartnerValidationSummary(
  blocks: PlanBlock[],
  city: string
): Promise<{
  totalPartnerBlocks: number;
  validPartnerBlocks: number;
  invalidPartnerBlocks: number;
  suggestedCorrections: Array<{ originalProvider: string; suggestedProvider: string; blockTitle: string }>;
}> {
  const partnerBlocks = blocks.filter(b => b.partner && b.provider);
  const validations = await Promise.all(
    partnerBlocks.map(block => validatePartnerInPlan(block, city))
  );

  const validPartnerBlocks = validations.filter(v => v.isValid && v.partnerExists).length;
  const invalidPartnerBlocks = partnerBlocks.length - validPartnerBlocks;

  const suggestedCorrections = partnerBlocks
    .map((block, index) => ({
      block,
      validation: validations[index],
    }))
    .filter(({ validation }) => !validation.isValid && validation.correctProvider)
    .map(({ block, validation }) => ({
      originalProvider: block.provider!,
      suggestedProvider: validation.correctProvider!,
      blockTitle: block.title,
    }));

  return {
    totalPartnerBlocks: partnerBlocks.length,
    validPartnerBlocks,
    invalidPartnerBlocks,
    suggestedCorrections,
  };
}