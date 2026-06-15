import { z } from "zod";

/**
 * User profile schema for personalized trip planning
 * 
 * Follows the same pattern as partner data (JSON file + TypeScript types).
 * Profiles include dietary restrictions, accessibility needs, budget level,
 * travel style, and personal preferences for AI-powered personalization.
 */

export interface HotelBooking {
  hotelId?: string;
  hotelName: string;
  city: string;
  checkInDate: string;
  checkOutDate: string;
  confirmationNumber?: string;
  isMarriottProperty?: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  bonvoyMemberNumber: string;
  dietaryRestrictions: string[];
  accessibilityNeeds: string[];
  budgetLevel: "budget" | "moderate" | "luxury";
  travelStyle: "adventure" | "relaxation" | "cultural" | "foodie" | "mixed";
  preferences: {
    avoidCrowds: boolean;
    preferLocalExperiences: boolean;
    fitnessLevel: "low" | "moderate" | "high";
  };
  hotelBookings?: HotelBooking[];
}

// Zod schema for hotel booking validation
export const hotelBookingSchema = z.object({
  hotelId: z.string().optional(),
  hotelName: z.string(),
  city: z.string(),
  checkInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  checkOutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  confirmationNumber: z.string().optional(),
  isMarriottProperty: z.boolean().default(false),
});

// Zod schema for runtime validation and type safety
export const userProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  bonvoyMemberNumber: z.string().regex(/^\d{9}$/, "Bonvoy number must be 9 digits"),
  dietaryRestrictions: z.array(z.string()).default([]),
  accessibilityNeeds: z.array(z.string()).default([]),
  budgetLevel: z.enum(["budget", "moderate", "luxury"]).default("moderate"),
  travelStyle: z.enum(["adventure", "relaxation", "cultural", "foodie", "mixed"]).default("mixed"),
  preferences: z.object({
    avoidCrowds: z.boolean().default(false),
    preferLocalExperiences: z.boolean().default(true),
    fitnessLevel: z.enum(["low", "moderate", "high"]).default("moderate"),
  }).default({}),
  hotelBookings: z.array(hotelBookingSchema).default([]),
});
