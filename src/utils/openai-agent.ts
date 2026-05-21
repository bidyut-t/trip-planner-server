import OpenAI from "openai";
import https from "https";
import { getOpenAiModelId, isCatalogMcpEnabled } from "./env.js";
import { getTripCatalogMcpServers } from "./mcp-catalog-config.js";

// Disable SSL certificate verification for custom endpoints
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export async function runOpenAiPrompt(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required. Set it in .env (see .env.example).",
    );
  }

  const client = new OpenAI({
    apiKey,
    baseURL: "https://d1t4hkdc2i746c.cloudfront.net",
    httpAgent: new https.Agent({
      rejectUnauthorized: false, // Allow self-signed certificates
    }),
  });

  const completion = await client.chat.completions.create({
    model: getOpenAiModelId(),
    messages: [{ role: "user", content: prompt }],
  });

  console.log(completion);
  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI returned an empty response");
  }
  return content;
}
