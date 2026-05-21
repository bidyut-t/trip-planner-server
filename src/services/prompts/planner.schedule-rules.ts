/** Shared AI schedule guidance (real-world routing, weather, geography). */
export function buildScheduleRulesBlock(options?: { includeBlockSchema?: boolean }): string {
  const schemaLine = options?.includeBlockSchema
    ? `- Optional on each block: "latitude" and "longitude" (approximate real-world pin for that stop; use known landmark coords when you know them)\n`
    : "";

  return `Schedule rules:
- Generic titles only (no invented partner brand names)
- One days[] entry per calendar day between startDate and endDate
- Times 08:30–22:00; singular block types only (activity, not activities)
- Use real-world geography: cluster sights/meals/activities along the same area each half-day to minimize backtracking (think Google Maps-style routing)
- Order the day as a sensible path: morning sight → lunch near that area → afternoon sight/activity nearby → dinner near evening location
- Consider season and typical weather for the destination on each date (e.g. avoid long outdoor fort walks at midday in hot summer; prefer indoor/covered or early-morning outdoor slots)
- Prefer outdoor activities/games in pleasant hours; move indoor options (museums, arcade, cooking class) to hot, rainy, or late slots when weather would be uncomfortable
- Add cab/travel blocks when moving between distant areas (e.g. old city ↔ Amber hill)
- Restaurants and activities on the same day should be geographically coherent with surrounding blocks
${schemaLine}- Our system will swap in partner catalog venues only when they are near the user's path; otherwise keep your generic AI suggestion`;
}
