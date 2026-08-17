import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";

const TOKEN_PREFIX = "orp_mcp_";
const LAST_USED_WRITE_INTERVAL_MS = 15 * 60 * 1000;

export type AuthenticatedMcpToken = {
  tokenId: string;
  tokenName: string;
  workspaceId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
};

export function generateMcpAccessToken() {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenHash: hashMcpAccessToken(token),
    tokenPrefix: `${token.slice(0, 16)}…${token.slice(-4)}`,
  };
}

export function hashMcpAccessToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

export async function authenticateMcpAccessToken(
  plaintextToken: string
): Promise<AuthenticatedMcpToken | null> {
  if (!plaintextToken.startsWith(TOKEN_PREFIX) || plaintextToken.length < 40) {
    return null;
  }

  const token = await prisma.mcpAccessToken.findUnique({
    where: { tokenHash: hashMcpAccessToken(plaintextToken) },
    select: {
      id: true,
      name: true,
      workspaceId: true,
      userId: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  if (!token || token.revokedAt || (token.expiresAt && token.expiresAt <= new Date())) {
    return null;
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: token.workspaceId,
        userId: token.userId,
      },
    },
    select: { role: true },
  });
  if (!membership) return null;

  const now = new Date();
  if (
    !token.lastUsedAt ||
    now.getTime() - token.lastUsedAt.getTime() >= LAST_USED_WRITE_INTERVAL_MS
  ) {
    await prisma.mcpAccessToken.updateMany({
      where: { id: token.id, revokedAt: null },
      data: { lastUsedAt: now },
    });
  }

  return {
    tokenId: token.id,
    tokenName: token.name,
    workspaceId: token.workspaceId,
    userId: token.userId,
    role: membership.role,
  };
}
