import OpenAI from "openai";

export interface OpenAiModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export async function listAvailableModels(): Promise<OpenAiModel[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to list models");
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
  });
  const response = await client.models.list();
  return response.data;
}
