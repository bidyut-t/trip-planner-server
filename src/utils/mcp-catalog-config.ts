import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..", "..");

/** Stdio MCP server that exposes mock catalog JSON as tools. */
export const tripCatalogMcpServerName = "trip-catalog";

/** SDK-agnostic stdio MCP config */
export type StdioMcpServerConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export function getTripCatalogMcpServers(): Record<string, StdioMcpServerConfig> {
  return {
    [tripCatalogMcpServerName]: {
      type: "stdio",
      command: process.platform === "win32" ? "npm.cmd" : "npm",
      args: ["run", "mcp:catalog"],
      cwd: projectRoot,
    },
  };
}
