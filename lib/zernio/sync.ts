import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import {
  getZernioPost,
  listZernioScheduledPosts,
} from "@/lib/zernio/client";
import {
  accountReferenceId,
  instagramTarget,
  mediaPreviewUrl,
  targetPlatformPostUrl,
  type ZernioPlatformTarget,
  type ZernioPost,
} from "@/lib/zernio/types";

type ConnectionWithMappings = Prisma.ZernioConnectionGetPayload<{
  include: { accountMappings: true };
}>;

function dateOrNull(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function statusFor(post: ZernioPost, target?: ZernioPlatformTarget | null) {
  const status = (target?.status ?? post.status ?? "scheduled").toLowerCase();
  if (status === "published") return "PUBLISHED" as const;
  if (status === "publishing") return "PUBLISHING" as const;
  if (status === "failed") return "FAILED" as const;
  if (status === "partial") return "PARTIAL" as const;
  if (status === "cancelled" || status === "canceled") return "CANCELLED" as const;
  if (status === "deleted") return "DELETED" as const;
  return "SCHEDULED" as const;
}

function targetError(target?: ZernioPlatformTarget | null): string | null {
  if (!target?.error) return null;
  if (typeof target.error === "string") return target.error.slice(0, 2000);
  try {
    return JSON.stringify(target.error).slice(0, 2000);
  } catch {
    return "Zernio reported a platform publishing error";
  }
}

async function persistMappedPost(
  connection: ConnectionWithMappings,
  post: ZernioPost,
  providerAccountId: string
) {
  const mapping = connection.accountMappings.find(
    (item) => item.zernioAccountId === providerAccountId
  );
  if (!mapping) return null;

  const target = instagramTarget(post, providerAccountId);
  if (!target) return null;

  const status = statusFor(post, target);
  const platformPostUrl = targetPlatformPostUrl(target);
  const publishedAt =
    status === "PUBLISHED"
      ? dateOrNull(post.publishedAt) ?? dateOrNull(post.updatedAt) ?? new Date()
      : null;
  const record = await prisma.scheduledPost.upsert({
    where: {
      zernioConnectionId_providerPostId_providerAccountId: {
        zernioConnectionId: connection.id,
        providerPostId: post.id,
        providerAccountId,
      },
    },
    create: {
      workspaceId: connection.workspaceId,
      zernioConnectionId: connection.id,
      instagramAccountId: mapping.instagramAccountId,
      providerPostId: post.id,
      providerAccountId,
      title: post.title ?? null,
      content: post.content ?? null,
      scheduledFor: dateOrNull(post.scheduledFor),
      timezone: post.timezone ?? null,
      mediaPreviewUrl: mediaPreviewUrl(post),
      status,
      platformPostId: target.platformPostId ?? null,
      platformPostUrl,
      errorMessage: targetError(target),
      publishedAt,
    },
    update: {
      instagramAccountId: mapping.instagramAccountId,
      title: post.title ?? null,
      content: post.content ?? null,
      scheduledFor: dateOrNull(post.scheduledFor),
      timezone: post.timezone ?? null,
      mediaPreviewUrl: mediaPreviewUrl(post),
      status,
      ...(target.platformPostId
        ? { platformPostId: target.platformPostId }
        : {}),
      ...(platformPostUrl ? { platformPostUrl } : {}),
      errorMessage: targetError(target),
      ...(publishedAt ? { publishedAt } : {}),
      lastSyncedAt: new Date(),
    },
  });

  if (target.platformPostId) {
    await prisma.automation.updateMany({
      where: { scheduledPostId: record.id, postId: null },
      data: {
        postId: target.platformPostId,
        postUrl: platformPostUrl,
      },
    });
  }
  return record;
}

export async function syncZernioPostForWorkspace(
  workspaceId: string,
  providerPostId: string
) {
  const connection = await prisma.zernioConnection.findFirst({
    where: { workspaceId, enabled: true },
    include: { accountMappings: true },
  });
  if (!connection) throw new Error("Zernio is not connected for this workspace");

  const post = await getZernioPost(
    decryptToken(connection.encryptedApiKey),
    providerPostId
  );
  const records = [];
  for (const target of post.platforms) {
    if (target.platform.toLowerCase() !== "instagram") continue;
    const accountId = accountReferenceId(target.accountId);
    if (!accountId) continue;
    const record = await persistMappedPost(connection, post, accountId);
    if (record) records.push(record);
  }
  if (records.length === 0) {
    throw new Error(
      "The Zernio post has no Instagram target mapped to this OpenReply workspace"
    );
  }
  return records;
}

export async function syncZernioConnection(connectionId: string) {
  const connection = await prisma.zernioConnection.findUnique({
    where: { id: connectionId },
    include: { accountMappings: true },
  });
  if (!connection?.enabled) return { synced: 0, bound: 0 };

  const apiKey = decryptToken(connection.encryptedApiKey);
  let synced = 0;
  let bound = 0;
  try {
    for (const mapping of connection.accountMappings) {
      const posts = await listZernioScheduledPosts(apiKey, mapping.zernioAccountId);
      for (const post of posts) {
        const record = await persistMappedPost(
          connection,
          post,
          mapping.zernioAccountId
        );
        if (record) synced += 1;
      }
    }

    // Webhooks are primary. This narrow poll repairs a missed publication
    // event and also picks up reschedules, for which Zernio emits no event.
    const candidates = await prisma.scheduledPost.findMany({
      where: {
        zernioConnectionId: connection.id,
        status: { in: ["SCHEDULED", "PUBLISHING"] },
        OR: [
          { scheduledFor: null },
          { scheduledFor: { lte: new Date(Date.now() + 30 * 60_000) } },
        ],
      },
      take: 200,
    });
    const checked = new Set<string>();
    for (const candidate of candidates) {
      if (checked.has(candidate.providerPostId)) continue;
      checked.add(candidate.providerPostId);
      const post = await getZernioPost(apiKey, candidate.providerPostId);
      for (const target of post.platforms) {
        if (target.platform.toLowerCase() !== "instagram") continue;
        const accountId = accountReferenceId(target.accountId);
        if (!accountId) continue;
        const record = await persistMappedPost(connection, post, accountId);
        if (record?.platformPostId) bound += 1;
      }
    }

    await prisma.zernioConnection.update({
      where: { id: connection.id },
      data: { lastSyncedAt: new Date(), lastError: null },
    });
    return { synced, bound };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Zernio sync error";
    await prisma.zernioConnection
      .update({
        where: { id: connection.id },
        data: { lastError: message.slice(0, 2000) },
      })
      .catch(() => {});
    throw error;
  }
}

export async function reconcileAllZernioConnections() {
  const connections = await prisma.zernioConnection.findMany({
    where: { enabled: true },
    select: { id: true, workspaceId: true },
  });
  for (const connection of connections) {
    try {
      await syncZernioConnection(connection.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Zernio sync error";
      await prisma.operationalEvent
        .create({
          data: {
            workspaceId: connection.workspaceId,
            source: "SYSTEM",
            level: "WARNING",
            message: `Zernio scheduled-post sync failed: ${message}`,
          },
        })
        .catch(() => {});
    }
  }
}

export async function applyZernioWebhookPost(
  connectionId: string,
  post: ZernioPost,
  target: ZernioPlatformTarget,
  accountId: string
) {
  const connection = await prisma.zernioConnection.findUnique({
    where: { id: connectionId },
    include: { accountMappings: true },
  });
  if (!connection?.enabled) throw new Error("Zernio connection is disabled");
  return persistMappedPost(
    connection,
    {
      ...post,
      platforms: [{ ...target, accountId: target.accountId ?? accountId }],
    },
    accountId
  );
}
