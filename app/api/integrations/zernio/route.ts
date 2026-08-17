import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import {
  createZernioWebhook,
  deleteZernioWebhook,
  listZernioInstagramAccounts,
} from "@/lib/zernio/client";
import { zernioIntegrationEnabled } from "@/lib/zernio/config";
import { syncZernioConnection } from "@/lib/zernio/sync";
import { normalizeZernioUsername } from "@/lib/zernio/types";

export const dynamic = "force-dynamic";

const connectSchema = z.object({ apiKey: z.string().min(8).max(500) });
const mappingSchema = z.object({
  mappings: z
    .array(
      z.object({
        instagramAccountId: z.string().min(1),
        zernioAccountId: z.string().min(1),
      })
    )
    .max(100),
});

function disabledResponse() {
  return NextResponse.json(
    { success: false, error: "Zernio integration is disabled" },
    { status: 404 }
  );
}

async function manageableContext() {
  const context = await getCurrentWorkspaceContext();
  return context && canManageWorkspace(context.role) ? context : null;
}

export async function GET() {
  if (!zernioIntegrationEnabled()) return disabledResponse();
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const connection = await prisma.zernioConnection.findUnique({
    where: { workspaceId: context.workspaceId },
    include: {
      accountMappings: {
        include: {
          instagramAccount: { select: { id: true, username: true } },
        },
      },
    },
  });
  if (!connection) return NextResponse.json({ success: true, data: null });
  const [zernioAccounts, instagramAccounts] = await Promise.all([
    listZernioInstagramAccounts(decryptToken(connection.encryptedApiKey)).catch(() => []),
    prisma.instagramAccount.findMany({
      where: { workspaceId: context.workspaceId },
      select: { id: true, username: true },
      orderBy: { connectedAt: "desc" },
    }),
  ]);
  return NextResponse.json({
    success: true,
    data: {
      id: connection.id,
      enabled: connection.enabled,
      webhookReady: Boolean(connection.webhookId),
      lastSyncedAt: connection.lastSyncedAt,
      lastError: connection.lastError,
      mappings: connection.accountMappings.map((mapping) => ({
        instagramAccountId: mapping.instagramAccountId,
        instagramUsername: mapping.instagramAccount.username,
        zernioAccountId: mapping.zernioAccountId,
        zernioUsername: mapping.zernioUsername,
      })),
      instagramAccounts,
      zernioAccounts: zernioAccounts.map((account) => ({
        id: account.id,
        username: account.username,
        displayName: account.displayName,
      })),
    },
  });
}

export async function POST(request: NextRequest) {
  if (!zernioIntegrationEnabled()) return disabledResponse();
  const context = await manageableContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = connectSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Enter a valid Zernio API key" }, { status: 400 });
  }

  try {
    const apiKey = parsed.data.apiKey.trim();
    const zernioAccounts = await listZernioInstagramAccounts(apiKey);
    const instagramAccounts = await prisma.instagramAccount.findMany({
      where: { workspaceId: context.workspaceId },
      select: { id: true, username: true },
    });
    const existing = await prisma.zernioConnection.findUnique({
      where: { workspaceId: context.workspaceId },
    });
    const webhookSecret = existing
      ? decryptToken(existing.encryptedWebhookSecret)
      : randomBytes(32).toString("hex");
    const connection = await prisma.zernioConnection.upsert({
      where: { workspaceId: context.workspaceId },
      create: {
        workspaceId: context.workspaceId,
        encryptedApiKey: encryptToken(apiKey),
        encryptedWebhookSecret: encryptToken(webhookSecret),
      },
      update: {
        encryptedApiKey: encryptToken(apiKey),
        enabled: true,
        lastError: null,
      },
    });

    const autoMappings = instagramAccounts.flatMap((instagramAccount) => {
      const username = normalizeZernioUsername(instagramAccount.username);
      const matches = zernioAccounts.filter(
        (account) => normalizeZernioUsername(account.username) === username
      );
      return matches.length === 1
        ? [{ instagramAccount, zernioAccount: matches[0] }]
        : [];
    });
    for (const item of autoMappings) {
      await prisma.zernioAccountMapping.upsert({
        where: { instagramAccountId: item.instagramAccount.id },
        create: {
          workspaceId: context.workspaceId,
          zernioConnectionId: connection.id,
          instagramAccountId: item.instagramAccount.id,
          zernioAccountId: item.zernioAccount.id,
          zernioUsername: item.zernioAccount.username ?? null,
        },
        update: {
          zernioConnectionId: connection.id,
          zernioAccountId: item.zernioAccount.id,
          zernioUsername: item.zernioAccount.username ?? null,
        },
      });
    }

    let webhookId = connection.webhookId;
    if (!webhookId) {
      webhookId = await createZernioWebhook(apiKey, {
        name: "OpenReply publishing lifecycle",
        url: `${getBaseUrl().replace(/\/$/, "")}/api/webhooks/zernio/${connection.id}`,
        secret: webhookSecret,
        events: [
          "post.scheduled",
          "post.platform.published",
          "post.platform.failed",
          "post.platform.deleted",
          "post.published",
          "post.failed",
          "post.partial",
          "post.cancelled",
        ],
      });
      await prisma.zernioConnection.update({
        where: { id: connection.id },
        data: { webhookId },
      });
    }

    const sync = await syncZernioConnection(connection.id);
    return NextResponse.json({
      success: true,
      data: {
        connectionId: connection.id,
        webhookId,
        mappedAccounts: autoMappings.length,
        availableAccounts: zernioAccounts.map((account) => ({
          id: account.id,
          username: account.username,
          displayName: account.displayName,
        })),
        sync,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not connect Zernio";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  if (!zernioIntegrationEnabled()) return disabledResponse();
  const context = await manageableContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const parsed = mappingSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Invalid account mapping" }, { status: 400 });
  }
  const connection = await prisma.zernioConnection.findUnique({
    where: { workspaceId: context.workspaceId },
  });
  if (!connection) {
    return NextResponse.json({ success: false, error: "Zernio is not connected" }, { status: 404 });
  }
  try {
    const zernioAccounts = await listZernioInstagramAccounts(
      decryptToken(connection.encryptedApiKey)
    );
    const byId = new Map(zernioAccounts.map((account) => [account.id, account]));
    for (const mapping of parsed.data.mappings) {
      const instagramAccount = await prisma.instagramAccount.findFirst({
        where: { id: mapping.instagramAccountId, workspaceId: context.workspaceId },
        select: { id: true },
      });
      const zernioAccount = byId.get(mapping.zernioAccountId);
      if (!instagramAccount || !zernioAccount) {
        return NextResponse.json({ success: false, error: "Account mapping is outside this workspace" }, { status: 400 });
      }
      await prisma.zernioAccountMapping.upsert({
        where: { instagramAccountId: instagramAccount.id },
        create: {
          workspaceId: context.workspaceId,
          zernioConnectionId: connection.id,
          instagramAccountId: instagramAccount.id,
          zernioAccountId: zernioAccount.id,
          zernioUsername: zernioAccount.username ?? null,
        },
        update: {
          zernioConnectionId: connection.id,
          zernioAccountId: zernioAccount.id,
          zernioUsername: zernioAccount.username ?? null,
        },
      });
    }
    const sync = await syncZernioConnection(connection.id);
    return NextResponse.json({ success: true, data: sync });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save account mappings";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function DELETE() {
  if (!zernioIntegrationEnabled()) return disabledResponse();
  const context = await manageableContext();
  if (!context) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const connection = await prisma.zernioConnection.findUnique({
    where: { workspaceId: context.workspaceId },
  });
  if (!connection) return NextResponse.json({ success: true });
  if (connection.webhookId) {
    await deleteZernioWebhook(
      decryptToken(connection.encryptedApiKey),
      connection.webhookId
    ).catch(() => {});
  }
  await prisma.zernioConnection.delete({ where: { id: connection.id } });
  return NextResponse.json({ success: true });
}
