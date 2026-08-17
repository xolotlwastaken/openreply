import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    zernioConnection: {
      findUnique: vi.fn(),
    },
    scheduledPost: {
      upsert: vi.fn(),
    },
    automation: {
      updateMany: vi.fn(),
    },
    zernioWebhookEvent: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import { applyZernioWebhookPost } from "@/lib/zernio/sync";
import {
  accountReferenceId,
  instagramTarget,
  mediaPreviewUrl,
  normalizeZernioUsername,
  zernioPostSchema,
} from "@/lib/zernio/types";
import { processZernioWebhook, verifyZernioSignature } from "@/lib/zernio/webhook";

const connection = {
  id: "connection_1",
  workspaceId: "workspace_1",
  enabled: true,
  accountMappings: [
    {
      instagramAccountId: "instagram_row_1",
      zernioAccountId: "zernio_account_1",
    },
  ],
};

const scheduledPost = zernioPostSchema.parse({
  _id: "zernio_post_1",
  content: "Comment LINK for the guide",
  status: "scheduled",
  scheduledFor: "2026-08-20T03:00:00.000Z",
  timezone: "Asia/Singapore",
  mediaUrls: ["https://cdn.example.com/reel.jpg"],
  platforms: [
    {
      platform: "instagram",
      accountId: {
        _id: "zernio_account_1",
        username: "@openreply",
      },
      status: "pending",
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.zernioConnection.findUnique.mockResolvedValue(connection);
  mockPrisma.scheduledPost.upsert.mockResolvedValue({
    id: "scheduled_row_1",
    platformPostId: null,
  });
  mockPrisma.automation.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.zernioWebhookEvent.findUnique.mockResolvedValue(null);
  mockPrisma.zernioWebhookEvent.create.mockResolvedValue({});
  mockPrisma.zernioWebhookEvent.update.mockResolvedValue({});
});

describe("Zernio identifiers", () => {
  it("normalizes usernames only for account mapping", () => {
    expect(normalizeZernioUsername(" @OpenReply ")).toBe("openreply");
  });

  it("resolves string and expanded account references", () => {
    expect(accountReferenceId("account_1")).toBe("account_1");
    expect(accountReferenceId({ _id: "account_2" })).toBe("account_2");
  });

  it("selects an Instagram target by its stable Zernio account id", () => {
    expect(instagramTarget(scheduledPost, "zernio_account_1")?.platform).toBe(
      "instagram"
    );
    expect(instagramTarget(scheduledPost, "another_account")).toBeNull();
    expect(mediaPreviewUrl(scheduledPost)).toBe(
      "https://cdn.example.com/reel.jpg"
    );
  });
});

describe("Zernio webhook signatures", () => {
  it("accepts an HMAC-SHA256 signature with or without the sha256 prefix", () => {
    const body = JSON.stringify({ id: "event_1" });
    const secret = "webhook_secret";
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyZernioSignature(body, signature, secret)).toBe(true);
    expect(verifyZernioSignature(body, `sha256=${signature}`, secret)).toBe(true);
  });

  it("rejects missing, forged, and body-mismatched signatures", () => {
    expect(verifyZernioSignature("{}", null, "secret")).toBe(false);
    expect(verifyZernioSignature("{}", "deadbeef", "secret")).toBe(false);
    const signature = createHmac("sha256", "secret").update("{}").digest("hex");
    expect(verifyZernioSignature('{"changed":true}', signature, "secret")).toBe(false);
  });
});

describe("scheduled-post binding", () => {
  it("stores a waiting post without touching any live automation", async () => {
    await applyZernioWebhookPost(
      connection.id,
      scheduledPost,
      scheduledPost.platforms[0],
      "zernio_account_1"
    );

    expect(mockPrisma.scheduledPost.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "SCHEDULED",
          platformPostId: null,
        }),
      })
    );
    expect(mockPrisma.automation.updateMany).not.toHaveBeenCalled();
  });

  it("binds only waiting automations linked to the exact scheduled-post row", async () => {
    const publishedTarget = {
      ...scheduledPost.platforms[0],
      status: "published",
      platformPostId: "instagram_media_987",
      platformPostUrl: "https://www.instagram.com/reel/ABC123/",
    };
    mockPrisma.scheduledPost.upsert.mockResolvedValue({
      id: "scheduled_row_1",
      platformPostId: "instagram_media_987",
    });

    await applyZernioWebhookPost(
      connection.id,
      scheduledPost,
      publishedTarget,
      "zernio_account_1"
    );

    expect(mockPrisma.automation.updateMany).toHaveBeenCalledWith({
      where: { scheduledPostId: "scheduled_row_1", postId: null },
      data: {
        postId: "instagram_media_987",
        postUrl: "https://www.instagram.com/reel/ABC123/",
      },
    });
  });

  it("records a failed publication without binding an Instagram media id", async () => {
    await applyZernioWebhookPost(
      connection.id,
      scheduledPost,
      {
        ...scheduledPost.platforms[0],
        status: "failed",
        error: { message: "Meta rejected the upload" },
      },
      "zernio_account_1"
    );

    expect(mockPrisma.scheduledPost.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: "FAILED",
          errorMessage: '{"message":"Meta rejected the upload"}',
        }),
      })
    );
    expect(mockPrisma.automation.updateMany).not.toHaveBeenCalled();
  });

  it("does not attach a post from an unmapped Zernio account", async () => {
    const result = await applyZernioWebhookPost(
      connection.id,
      scheduledPost,
      scheduledPost.platforms[0],
      "zernio_account_other"
    );
    expect(result).toBeNull();
    expect(mockPrisma.scheduledPost.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.automation.updateMany).not.toHaveBeenCalled();
  });
});

describe("Zernio webhook idempotency", () => {
  it("accepts Zernio's per-platform payload shape and binds the native id", async () => {
    mockPrisma.scheduledPost.upsert.mockResolvedValue({
      id: "scheduled_row_1",
      platformPostId: "instagram_media_987",
    });
    const result = await processZernioWebhook(connection.id, {
      id: "event_published_1",
      event: "post.platform.published",
      timestamp: "2026-08-20T03:00:03.000Z",
      post: scheduledPost,
      platform: {
        name: "instagram",
        status: "published",
        platformPostId: "instagram_media_987",
        publishedUrl: "https://www.instagram.com/reel/ABC123/",
      },
      account: {
        accountId: "zernio_account_1",
        platform: "instagram",
        username: "openreply",
      },
    });

    expect(result).toEqual({ duplicate: false, bound: true });
    expect(mockPrisma.automation.updateMany).toHaveBeenCalledWith({
      where: { scheduledPostId: "scheduled_row_1", postId: null },
      data: {
        postId: "instagram_media_987",
        postUrl: "https://www.instagram.com/reel/ABC123/",
      },
    });
    expect(mockPrisma.zernioWebhookEvent.update).toHaveBeenLastCalledWith({
      where: { eventId: "event_published_1" },
      data: {
        status: "PROCESSED",
        processedAt: expect.any(Date),
        errorMessage: null,
      },
    });
  });

  it("does not process an event that already completed", async () => {
    mockPrisma.zernioWebhookEvent.findUnique.mockResolvedValue({
      eventId: "event_1",
      status: "PROCESSED",
    });
    const result = await processZernioWebhook(connection.id, {
      id: "event_1",
      event: "post.scheduled",
      timestamp: "2026-08-17T00:00:00.000Z",
      post: scheduledPost,
    });
    expect(result).toEqual({ duplicate: true, bound: false });
    expect(mockPrisma.scheduledPost.upsert).not.toHaveBeenCalled();
  });
});
