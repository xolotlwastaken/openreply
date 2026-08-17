import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    mcpAccessToken: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    workspaceMember: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import {
  authenticateMcpAccessToken,
  generateMcpAccessToken,
  hashMcpAccessToken,
  readBearerToken,
} from "@/lib/mcp/access-tokens";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MCP access tokens", () => {
  it("generates a high-entropy token and stores only its deterministic hash", () => {
    const first = generateMcpAccessToken();
    const second = generateMcpAccessToken();

    expect(first.token).toMatch(/^orp_mcp_[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(hashMcpAccessToken(first.token));
    expect(first.tokenHash).toHaveLength(64);
    expect(first.tokenPrefix).not.toContain(first.token);
  });

  it("reads only a well-formed bearer authorization value", () => {
    expect(readBearerToken(new Request("https://example.com"))).toBeNull();
    expect(
      readBearerToken(
        new Request("https://example.com", {
          headers: { Authorization: "Bearer orp_mcp_example" },
        })
      )
    ).toBe("orp_mcp_example");
    expect(
      readBearerToken(
        new Request("https://example.com", {
          headers: { Authorization: "Basic abc" },
        })
      )
    ).toBeNull();
  });

  it("authenticates an active token only while its user remains a workspace member", async () => {
    const plaintext = generateMcpAccessToken().token;
    mockPrisma.mcpAccessToken.findUnique.mockResolvedValue({
      id: "token_1",
      name: "Codex",
      workspaceId: "workspace_1",
      userId: "user_1",
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
    });
    mockPrisma.workspaceMember.findUnique.mockResolvedValue({ role: "ADMIN" });
    mockPrisma.mcpAccessToken.updateMany.mockResolvedValue({ count: 1 });

    await expect(authenticateMcpAccessToken(plaintext)).resolves.toEqual({
      tokenId: "token_1",
      tokenName: "Codex",
      workspaceId: "workspace_1",
      userId: "user_1",
      role: "ADMIN",
    });
    expect(mockPrisma.mcpAccessToken.updateMany).toHaveBeenCalledWith({
      where: { id: "token_1", revokedAt: null },
      data: { lastUsedAt: expect.any(Date) },
    });

    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);
    await expect(authenticateMcpAccessToken(plaintext)).resolves.toBeNull();
  });

  it("rejects revoked and expired credentials", async () => {
    const plaintext = generateMcpAccessToken().token;
    mockPrisma.mcpAccessToken.findUnique.mockResolvedValue({
      id: "token_1",
      name: "Codex",
      workspaceId: "workspace_1",
      userId: "user_1",
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: new Date(),
    });
    await expect(authenticateMcpAccessToken(plaintext)).resolves.toBeNull();
    expect(mockPrisma.workspaceMember.findUnique).not.toHaveBeenCalled();

    mockPrisma.mcpAccessToken.findUnique.mockResolvedValue({
      id: "token_2",
      name: "Expired",
      workspaceId: "workspace_1",
      userId: "user_1",
      lastUsedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
      revokedAt: null,
    });
    await expect(authenticateMcpAccessToken(plaintext)).resolves.toBeNull();
  });
});
