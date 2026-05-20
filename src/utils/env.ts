import "dotenv/config";

export function isCursorSdkEnabled(): boolean {
  return process.env.USE_CURSOR_SDK === "true";
}

/** Fast model for parsing + skeleton planning (avoid slow agent models). */
export function getCursorModelId(): string {
  return process.env.CURSOR_MODEL ?? "gemini-3-flash";
}
