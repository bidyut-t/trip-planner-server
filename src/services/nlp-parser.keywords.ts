import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const keywordExtractor = require("keyword-extractor") as {
  extract: (text: string, options?: Record<string, unknown>) => string[];
};

const STOPWORDS = new Set([
  "plan",
  "trip",
  "travel",
  "visit",
  "going",
  "want",
  "need",
  "from",
  "with",
  "days",
  "day",
  "people",
  "person",
  "relaxed",
  "moderate",
  "packed",
]);

export function extractPromptKeywords(prompt: string): string[] {
  const raw = keywordExtractor.extract(prompt, {
    language: "english",
    remove_digits: true,
    return_changed_case: true,
    remove_duplicates: true,
  });

  return raw
    .map((word) => word.toLowerCase().trim())
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}
