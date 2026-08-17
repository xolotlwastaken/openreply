import {
  MCP_AGENT_DOCS_URL,
  MCP_DOCS_URL,
  OPENREPLY_REPOSITORY_URL,
} from "@/lib/mcp-docs";

export const dynamic = "force-static";

export function GET() {
  const content = `# OpenReply

OpenReply is a self-hosted Instagram comment-to-DM automation application with a local stdio MCP server for AI agents.

## Agent documentation
- MCP installation and operating guide: ${MCP_AGENT_DOCS_URL}
- Human-readable MCP documentation: ${MCP_DOCS_URL}
- Source repository: ${OPENREPLY_REPOSITORY_URL}

The documentation URL is not a remote MCP endpoint. Follow the agent guide to install the local stdio server.
`;

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
