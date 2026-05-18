import { Cursor, type SDKModel } from "@cursor/sdk";

export async function listAvailableModels(): Promise<SDKModel[]> {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is required to list models");
  }
  return Cursor.models.list({ apiKey });
}
