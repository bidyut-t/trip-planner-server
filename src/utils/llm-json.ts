import { jsonrepair } from "jsonrepair";

function extractBalancedJson(text: string): string | null {
  const start = text.search(/[{\[]/);
  if (start === -1) return null;

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence ? fence[1].trim() : trimmed;
}

function tryParse(raw: string): unknown {
  return JSON.parse(raw);
}

export function parseLlmJson(text: string): unknown {
  const candidates = [stripMarkdownFence(text), text.trim()];
  const balanced = extractBalancedJson(candidates[0] ?? text);
  if (balanced) candidates.unshift(balanced);

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);

    try {
      return tryParse(candidate);
    } catch {
      // continue
    }

    try {
      return tryParse(jsonrepair(candidate));
    } catch {
      // continue
    }
  }

  throw new SyntaxError("Could not parse JSON from model response");
}
