import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createOpenReplyMcpServer } from "@/mcp/server";

async function main() {
  const server = createOpenReplyMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[OpenReply MCP] Local stdio server started");
}

main().catch((error) => {
  console.error("[OpenReply MCP] Server failed:", error);
  process.exitCode = 1;
});
