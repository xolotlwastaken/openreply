import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { generateMcpAccessToken } from "@/lib/mcp/access-tokens";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

const revokeSchema = z.object({
  tokenId: z.string().min(1),
});

function remoteMcpUrl() {
  return `${getBaseUrl().replace(/\/$/, "")}/api/mcp`;
}

async function recordTokenEvent(input: {
  workspaceId: string;
  userId: string;
  tokenId: string;
  message: string;
}) {
  await prisma.operationalEvent.create({
    data: {
      workspaceId: input.workspaceId,
      source: "SYSTEM",
      message: input.message,
      payload: { tokenId: input.tokenId, userId: input.userId },
    },
  }).catch((error) => {
    console.error("[OpenReply MCP] Could not record token audit event", error);
  });
}

async function listTokens(workspaceId: string, userId: string) {
  return prisma.mcpAccessToken.findMany({
    where: { workspaceId, userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
}

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    data: {
      endpoint: remoteMcpUrl(),
      tokens: await listTokens(context.workspaceId, context.userId),
    },
  });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Enter a token name between 1 and 80 characters" },
      { status: 400 }
    );
  }

  const generated = generateMcpAccessToken();
  const created = await prisma.mcpAccessToken.create({
    data: {
      workspaceId: context.workspaceId,
      userId: context.userId,
      name: parsed.data.name,
      tokenHash: generated.tokenHash,
      tokenPrefix: generated.tokenPrefix,
    },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  await recordTokenEvent({
    workspaceId: context.workspaceId,
    userId: context.userId,
    tokenId: created.id,
    message: `Remote MCP token created: ${created.name}`,
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        endpoint: remoteMcpUrl(),
        token: generated.token,
        accessToken: created,
      },
    },
    { status: 201 }
  );
}

export async function DELETE(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = revokeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Missing token ID" }, { status: 400 });
  }

  const token = await prisma.mcpAccessToken.findFirst({
    where: {
      id: parsed.data.tokenId,
      workspaceId: context.workspaceId,
      userId: context.userId,
      revokedAt: null,
    },
    select: { id: true, name: true },
  });
  if (!token) {
    return NextResponse.json({ success: false, error: "Active token not found" }, { status: 404 });
  }

  await prisma.mcpAccessToken.update({
    where: { id: token.id },
    data: { revokedAt: new Date() },
  });
  await recordTokenEvent({
    workspaceId: context.workspaceId,
    userId: context.userId,
    tokenId: token.id,
    message: `Remote MCP token revoked: ${token.name}`,
  });

  return NextResponse.json({
    success: true,
    data: {
      endpoint: remoteMcpUrl(),
      tokens: await listTokens(context.workspaceId, context.userId),
    },
  });
}
