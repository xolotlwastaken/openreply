import { describe, expect, it, vi } from "vitest";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

vi.mock("@/lib/workspace-access", () => ({
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));

import { createOpenReplyMcpServer } from "@/mcp/server";

async function sendMcpMessage(body: unknown) {
  const server = createOpenReplyMcpServer({
    workspaceId: "workspace_test",
    userId: "user_test",
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(
    new Request("https://openreply.example/api/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify(body),
    })
  );
}

describe("OpenReply Streamable HTTP transport", () => {
  it("initializes statelessly and advertises the OpenReply tool directory", async () => {
    const initialize = await sendMcpMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "OpenReply test", version: "1.0.0" },
      },
    });
    expect(initialize.status).toBe(200);
    await expect(initialize.json()).resolves.toMatchObject({
      result: { serverInfo: { name: "openreply", version: "0.2.0" } },
    });

    const tools = await sendMcpMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(tools.status).toBe(200);
    const payload = await tools.json();
    expect(payload.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining([
        "openreply_health",
        "openreply_create_campaign",
        "openreply_sync_zernio_post",
      ])
    );
  });
});
