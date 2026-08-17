import { beforeEach, describe, expect, it, vi } from "vitest";

const { authenticate, rateLimit } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/mcp/access-tokens", () => ({
  readBearerToken: (request: Request) => {
    const value = request.headers.get("authorization");
    return value?.startsWith("Bearer ") ? value.slice(7) : null;
  },
  authenticateMcpAccessToken: authenticate,
}));
vi.mock("@/lib/mcp/rate-limit", () => ({ checkMcpRateLimit: rateLimit }));
vi.mock("@/mcp/server", () => ({ createOpenReplyMcpServer: vi.fn() }));
vi.mock("@/lib/db/client", () => ({
  prisma: { operationalEvent: { createMany: vi.fn() } },
}));

import { POST } from "@/app/api/mcp/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("remote MCP authentication boundary", () => {
  it("requires a bearer token", async () => {
    const response = await POST(
      new Request("https://openreply.example/api/mcp", { method: "POST" })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("rejects invalid or revoked tokens", async () => {
    authenticate.mockResolvedValue(null);
    const response = await POST(
      new Request("https://openreply.example/api/mcp", {
        method: "POST",
        headers: { Authorization: "Bearer orp_mcp_invalid" },
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it("rate-limits an authenticated token before invoking MCP tools", async () => {
    authenticate.mockResolvedValue({
      tokenId: "token_1",
      tokenName: "Codex",
      workspaceId: "workspace_1",
      userId: "user_1",
      role: "OWNER",
    });
    rateLimit.mockResolvedValue({
      allowed: false,
      limit: 120,
      remaining: 0,
      retryAfterSeconds: 42,
    });

    const response = await POST(
      new Request("https://openreply.example/api/mcp", {
        method: "POST",
        headers: { Authorization: "Bearer orp_mcp_valid" },
      })
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("ratelimit-remaining")).toBe("0");
  });
});
