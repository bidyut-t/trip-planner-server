import OpenAI from "openai";
import https from "https";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getOpenAiModelId, isCatalogMcpEnabled } from "./env.js";
import { getTripCatalogMcpServers } from "./mcp-catalog-config.js";

// Disable SSL certificate verification for custom endpoints
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

interface McpClient {
  client: Client;
  tools: Tool[];
}

let mcpClientCache: McpClient | null = null;

async function getMcpClient(): Promise<McpClient | null> {
  if (!isCatalogMcpEnabled()) {
    return null;
  }

  if (mcpClientCache) {
    return mcpClientCache;
  }

  try {
    const servers = getTripCatalogMcpServers();
    const serverConfig = servers["trip-catalog"];
    
    if (!serverConfig) {
      console.warn("[openai-mcp] No trip-catalog server config found");
      return null;
    }

    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args || [],
      env: serverConfig.env,
      cwd: serverConfig.cwd,
    });

    const client = new Client(
      {
        name: "trip-planner-openai-client",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    await client.connect(transport);
    console.log("[openai-mcp] Connected to trip-catalog MCP server");

    // Get available tools
    const toolsResponse = await client.listTools();
    console.log(`[openai-mcp] Available tools: ${toolsResponse.tools.map(t => t.name).join(', ')}`);

    mcpClientCache = {
      client,
      tools: toolsResponse.tools,
    };

    return mcpClientCache;
  } catch (error) {
    console.error("[openai-mcp] Failed to connect to MCP server:", error);
    return null;
  }
}

function convertMcpToolsToOpenAi(mcpTools: Tool[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return mcpTools.map(tool => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>,
    },
  }));
}

export async function runOpenAiPromptWithMcp(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required. Set it in .env (see .env.example).",
    );
  }
console.log(`[openai-mcp] Starting OpenAI client`);
  const client = new OpenAI({
    apiKey,
    baseURL,
    httpAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
  });

  const mcpClient = await getMcpClient();
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "user", content: prompt }
  ];

  let tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined;
  if (mcpClient) {
    tools = convertMcpToolsToOpenAi(mcpClient.tools);
    console.log(`[openai-mcp] Using ${tools.length} MCP tools`);
  }

  const maxIterations = 5;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`[openai-mcp] Iteration ${iteration}`);

    const completion = await client.chat.completions.create({
      model: getOpenAiModelId(),
      messages,
      tools,
      tool_choice: iteration === 1 && tools ? "auto" : undefined,
    });

    console.log(`[openai-mcp] Iteration ${iteration} completed ${completion.choices[0]?.message?.content?.trim()}`);
    const message = completion.choices[0]?.message;
    if (!message) {
      throw new Error("OpenAI returned no message");
    }

    messages.push(message);

    // If no tool calls, return the content
    if (!message.tool_calls || message.tool_calls.length === 0) {
      const content = message.content?.trim();
      if (!content) {
        throw new Error("OpenAI returned an empty response");
      }
      return content;
    }

    // Process tool calls
    console.log(`[openai-mcp] Processing ${message.tool_calls.length} tool calls`);
    
    for (const toolCall of message.tool_calls) {
      if (!mcpClient) {
        console.warn("[openai-mcp] Tool call requested but no MCP client available");
        continue;
      }

      try {
        const args = JSON.parse(toolCall.function.arguments);
        console.log(`[openai-mcp] Calling tool: ${toolCall.function.name} with args:`, args);
        
        const result = await mcpClient.client.callTool({
          name: toolCall.function.name,
          arguments: args,
        });

        const resultText = result.content
          .map(c => c.type === "text" ? c.text : "[non-text content]")
          .join("\n");

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: resultText,
        });

        console.log(`[openai-mcp] Tool ${toolCall.function.name} result:`, resultText.substring(0, 200) + "...");
      } catch (error) {
        console.error(`[openai-mcp] Tool call failed:`, error);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  throw new Error("Maximum iterations reached without getting a final response");
}

// Cleanup function to close MCP connections
export function closeMcpConnections(): void {
  if (mcpClientCache) {
    try {
      mcpClientCache.client.close();
      mcpClientCache = null;
      console.log("[openai-mcp] MCP connections closed");
    } catch (error) {
      console.error("[openai-mcp] Error closing MCP connections:", error);
    }
  }
}

// Fallback to the original function for non-MCP usage
export async function runOpenAiPrompt(prompt: string): Promise<string> {
  if (isCatalogMcpEnabled()) {
    return runOpenAiPromptWithMcp(prompt);
  }

  // Original implementation for when MCP is disabled
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required. Set it in .env (see .env.example).",
    );
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
    httpAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
  });

  const completion = await client.chat.completions.create({
    model: getOpenAiModelId(),
    messages: [{ role: "user", content: prompt }],
  });

  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI returned an empty response");
  }
  return content;
}