import { getCursorModelId } from "./env.js";

export async function runCursorPrompt(prompt: string): Promise<string> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is required. Set it in .env (see .env.example).");
  }

  const { Agent } = await import("@cursor/sdk");
  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: getCursorModelId() },
    local: { cwd: process.cwd() },
  });

  const raw = result.result?.trim();
  if (!raw) {
    throw new Error("AI returned an empty response");
  }
  return raw;
}
