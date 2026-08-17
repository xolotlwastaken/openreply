-- Additive Zernio scheduled-post integration. Existing Automation rows keep a
-- NULL scheduledPostId and continue to use postId/matchAnyPost/pendingNextReel.
CREATE TYPE "ScheduledPostStatus" AS ENUM ('SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'PARTIAL', 'CANCELLED', 'DELETED');

CREATE TABLE "ZernioConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "encryptedWebhookSecret" TEXT NOT NULL,
    "webhookId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ZernioConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ZernioAccountMapping" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "zernioConnectionId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "zernioAccountId" TEXT NOT NULL,
    "zernioUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ZernioAccountMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduledPost" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "zernioConnectionId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "providerPostId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "timezone" TEXT,
    "mediaPreviewUrl" TEXT,
    "status" "ScheduledPostStatus" NOT NULL DEFAULT 'SCHEDULED',
    "platformPostId" TEXT,
    "platformPostUrl" TEXT,
    "errorMessage" TEXT,
    "publishedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScheduledPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ZernioWebhookEvent" (
    "eventId" TEXT NOT NULL,
    "zernioConnectionId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "ZernioWebhookEvent_pkey" PRIMARY KEY ("eventId")
);

ALTER TABLE "Automation" ADD COLUMN "scheduledPostId" TEXT;

CREATE UNIQUE INDEX "ZernioConnection_workspaceId_key" ON "ZernioConnection"("workspaceId");
CREATE UNIQUE INDEX "ZernioAccountMapping_instagramAccountId_key" ON "ZernioAccountMapping"("instagramAccountId");
CREATE UNIQUE INDEX "ZernioAccountMapping_zernioConnectionId_zernioAccountId_key" ON "ZernioAccountMapping"("zernioConnectionId", "zernioAccountId");
CREATE INDEX "ZernioAccountMapping_workspaceId_idx" ON "ZernioAccountMapping"("workspaceId");
CREATE UNIQUE INDEX "ScheduledPost_zernioConnectionId_providerPostId_providerAccountId_key" ON "ScheduledPost"("zernioConnectionId", "providerPostId", "providerAccountId");
CREATE INDEX "ScheduledPost_workspaceId_idx" ON "ScheduledPost"("workspaceId");
CREATE INDEX "ScheduledPost_instagramAccountId_status_idx" ON "ScheduledPost"("instagramAccountId", "status");
CREATE INDEX "ScheduledPost_providerPostId_idx" ON "ScheduledPost"("providerPostId");
CREATE INDEX "ScheduledPost_platformPostId_idx" ON "ScheduledPost"("platformPostId");
CREATE INDEX "ZernioWebhookEvent_zernioConnectionId_idx" ON "ZernioWebhookEvent"("zernioConnectionId");
CREATE INDEX "ZernioWebhookEvent_event_idx" ON "ZernioWebhookEvent"("event");
CREATE INDEX "ZernioWebhookEvent_status_idx" ON "ZernioWebhookEvent"("status");
CREATE INDEX "Automation_scheduledPostId_idx" ON "Automation"("scheduledPostId");

ALTER TABLE "ZernioConnection" ADD CONSTRAINT "ZernioConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ZernioAccountMapping" ADD CONSTRAINT "ZernioAccountMapping_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ZernioAccountMapping" ADD CONSTRAINT "ZernioAccountMapping_zernioConnectionId_fkey" FOREIGN KEY ("zernioConnectionId") REFERENCES "ZernioConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ZernioAccountMapping" ADD CONSTRAINT "ZernioAccountMapping_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_zernioConnectionId_fkey" FOREIGN KEY ("zernioConnectionId") REFERENCES "ZernioConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ZernioWebhookEvent" ADD CONSTRAINT "ZernioWebhookEvent_zernioConnectionId_fkey" FOREIGN KEY ("zernioConnectionId") REFERENCES "ZernioConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_scheduledPostId_fkey" FOREIGN KEY ("scheduledPostId") REFERENCES "ScheduledPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
