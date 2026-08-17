import { MCP_AGENT_MARKDOWN } from "@/lib/mcp-docs";

export const dynamic = "force-static";

export function GET() {
  return new Response(MCP_AGENT_MARKDOWN, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Content-Disposition": 'inline; filename="openreply-mcp-agent-guide.md"',
    },
  });
}
