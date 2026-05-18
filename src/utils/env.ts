import "dotenv/config";

export function isCursorSdkEnabled(): boolean {
  return process.env.USE_CURSOR_SDK === "true";
}
