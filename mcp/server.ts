import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { getDMQueue, getRedisConnection } from "@/lib/queue/client";
import { getWorkerAlerts, getWorkerHealth } from "@/lib/ops/worker-health";
import {
  getConversations,
  getConversationMessages,
  getFollowerCountSeries,
  getAllUserMedia,
  getMediaInsights,
  getUserInfo,
  getUserMedia,
  sendCommentReply,
  sendDirectMessage,
  subscribeInstagramAccountToWebhooks,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { buildInvitationUrl, generateInvitationToken, getInvitationExpiry, normalizeInvitationEmail } from "@/lib/workspace-invitations";
import { buildReportUrl, generateReportShareSlug } from "@/lib/reports/share";
import { calculateCtr, normalizeTopKeywords, summarizeDmStatuses } from "@/lib/tracking/analytics";
import { buildTrackedUrl } from "@/lib/tracking/message";
import { generateTrackedLinkSlug } from "@/lib/tracking/server";
import { CAMPAIGN_TEMPLATES } from "@/lib/templates/campaign-templates";
import { canManageWorkspace } from "@/lib/workspace-access";
import { syncZernioPostForWorkspace } from "@/lib/zernio/sync";
import { MCP_SERVER_INSTRUCTIONS } from "@/lib/mcp-docs";

/**
 * OpenReply's MCP server is intentionally stdio-only. A coding agent that can
 * start this process has local access to the configured OpenReply workspace,
 * so every tool is scoped to OPENREPLY_MCP_WORKSPACE_ID and never returns
 * encrypted Instagram tokens.
 */

const workspaceInput = {
  workspaceId: z.string().min(1).optional().describe("Must match the authenticated OpenReply workspace when provided"),
};

const accountInput = {
  ...workspaceInput,
  instagramAccountId: z.string().min(1).optional(),
};

const linkInput = z.object({
  destinationUrl: z.string().url(),
  label: z.string().max(64).optional(),
});

const campaignFields = {
  name: z.string().min(1).max(100),
  goal: z.string().max(120).nullable().optional(),
  instagramAccountId: z.string().min(1).optional(),
  postId: z.string().min(1).nullable().optional(),
  postUrl: z.string().url().nullable().optional(),
  scheduledPostId: z.string().min(1).nullable().optional(),
  pendingNextReel: z.boolean().default(false),
  matchAnyPost: z.boolean().default(false),
  keywords: z.array(z.string().min(1).max(50)).max(10).default([]),
  matchAnyWord: z.boolean().default(false),
  dmTriggerEnabled: z.boolean().default(false),
  dmMessage: z.string().min(1).max(1000),
  openingDmEnabled: z.boolean().default(false),
  openingDmMessage: z.string().max(1000).nullable().optional(),
  openingDmButtonLabel: z.string().max(64).nullable().optional(),
  linkButtonLabel: z.string().max(20).nullable().optional(),
  requireFollow: z.boolean().default(false),
  followPromptMessage: z.string().max(1000).nullable().optional(),
  followPromptButtonLabel: z.string().max(20).nullable().optional(),
  followUpEnabled: z.boolean().default(false),
  followUpMessage: z.string().max(1000).nullable().optional(),
  followUpDelayMinutes: z.number().int().min(0).max(1440).default(0),
  publicReplyEnabled: z.boolean().default(false),
  publicReplyMessages: z.array(z.string().max(1000)).max(10).default([]),
  isActive: z.boolean().default(true),
  wholeWordMatch: z.boolean().default(true),
  trackedLinks: z.array(linkInput).max(2).default([]),
};

const campaignUpdateFields = {
  name: campaignFields.name.optional(),
  goal: campaignFields.goal,
  postId: campaignFields.postId,
  postUrl: campaignFields.postUrl,
  scheduledPostId: campaignFields.scheduledPostId,
  pendingNextReel: z.boolean().optional(),
  matchAnyPost: z.boolean().optional(),
  keywords: campaignFields.keywords.optional(),
  matchAnyWord: z.boolean().optional(),
  dmTriggerEnabled: z.boolean().optional(),
  dmMessage: campaignFields.dmMessage.optional(),
  openingDmEnabled: z.boolean().optional(),
  openingDmMessage: campaignFields.openingDmMessage,
  openingDmButtonLabel: campaignFields.openingDmButtonLabel,
  linkButtonLabel: campaignFields.linkButtonLabel,
  requireFollow: z.boolean().optional(),
  followPromptMessage: campaignFields.followPromptMessage,
  followPromptButtonLabel: campaignFields.followPromptButtonLabel,
  followUpEnabled: z.boolean().optional(),
  followUpMessage: campaignFields.followUpMessage,
  followUpDelayMinutes: z.number().int().min(0).max(1440).optional(),
  publicReplyEnabled: z.boolean().optional(),
  publicReplyMessages: campaignFields.publicReplyMessages.optional(),
  isActive: z.boolean().optional(),
  wholeWordMatch: z.boolean().optional(),
  trackedLinks: z.array(linkInput).max(2).optional(),
};

type CampaignInput = z.infer<z.ZodObject<typeof campaignFields>>;
type CampaignUpdateInput = z.infer<z.ZodObject<typeof campaignUpdateFields>>;

const importCampaignFields = {
  postId: z.string().min(1),
  postUrl: z.string().nullable().optional(),
  keywords: z.array(z.string().min(1).max(50)).min(1).max(10),
  dmMessage: z.string().min(1).max(1000),
  name: z.string().max(100).nullable().optional(),
  goal: z.string().max(120).nullable().optional(),
  publicReplyMessage: z.string().max(1000).nullable().optional(),
  trackedUrl: z.string().url().nullable().optional(),
  wholeWordMatch: z.boolean().default(true),
  isActive: z.boolean().default(true),
};

function textResult(value: unknown, isError = false) {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown OpenReply error";
  return textResult({ success: false, error: message }, true);
}

export type OpenReplyMcpContext = {
  workspaceId?: string;
  userId?: string;
};

export function createOpenReplyMcpServer(context: OpenReplyMcpContext = {}) {
function configuredWorkspaceId(requested?: string) {
  const configured = context.workspaceId ?? process.env.OPENREPLY_MCP_WORKSPACE_ID;
  if (!configured) {
    throw new Error("OPENREPLY_MCP_WORKSPACE_ID is required");
  }
  if (requested && requested !== configured) {
    throw new Error("workspaceId does not match OPENREPLY_MCP_WORKSPACE_ID");
  }
  return configured;
}

async function getWorkspace(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, ownerId: true, createdAt: true, updatedAt: true },
  });
  if (!workspace) throw new Error("Workspace not found");
  return workspace;
}

async function getAccount(workspaceId: string, accountId?: string) {
  const account = await prisma.instagramAccount.findFirst({
    where: { workspaceId, ...(accountId ? { id: accountId } : {}) },
  });
  if (!account) throw new Error("Instagram account not found");
  return account;
}

function accountSummary(account: {
  id: string;
  instagramId: string;
  username: string;
  name: string | null;
  webhookSubscribed: boolean;
  connectedAt: Date;
  updatedAt: Date;
  tokenExpiresAt: Date | null;
}) {
  return {
    id: account.id,
    instagramId: account.instagramId,
    username: account.username,
    name: account.name,
    webhookSubscribed: account.webhookSubscribed,
    connectedAt: account.connectedAt,
    updatedAt: account.updatedAt,
    tokenExpiresAt: account.tokenExpiresAt,
  };
}

const campaignInclude = {
  instagramAccount: { select: { id: true, instagramId: true, username: true, name: true } },
  trackedLinks: { orderBy: { createdAt: "asc" as const }, include: { _count: { select: { clicks: true } } } },
  _count: { select: { dmLogs: true } },
} as const;

type CampaignWithRelations = Prisma.AutomationGetPayload<{ include: typeof campaignInclude }>;

function serializeCampaign(campaign: CampaignWithRelations) {
  return {
    ...campaign,
    instagramAccount: campaign.instagramAccount,
    trackedLinks: campaign.trackedLinks?.map((link) => ({
      id: link.id,
      slug: link.slug,
      label: link.label,
      destinationUrl: link.destinationUrl,
      trackedUrl: buildTrackedUrl(link.slug),
      clicks: link._count?.clicks ?? undefined,
    })),
    reportUrl: campaign.reportShareSlug ? buildReportUrl(campaign.reportShareSlug) : null,
    dmLogCount: campaign._count?.dmLogs ?? undefined,
  };
}

async function campaignById(workspaceId: string, id: string) {
  const campaign = await prisma.automation.findFirst({
    where: { id, workspaceId },
    include: campaignInclude,
  });
  if (!campaign) throw new Error("Campaign not found");
  return campaign;
}

function validateCampaignInput(input: {
  postId?: string | null;
  scheduledPostId?: string | null;
  matchAnyPost: boolean;
  pendingNextReel: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  openingDmEnabled: boolean;
  openingDmMessage?: string | null;
  openingDmButtonLabel?: string | null;
  requireFollow: boolean;
  followPromptMessage?: string | null;
  followPromptButtonLabel?: string | null;
  followUpEnabled: boolean;
  followUpMessage?: string | null;
}) {
  const scopes = [
    input.matchAnyPost,
    input.pendingNextReel,
    Boolean(input.postId),
    Boolean(input.scheduledPostId),
  ].filter(Boolean).length;
  if (scopes !== 1) {
    throw new Error("Choose a post, match any post, or target the next reel");
  }
  if (!input.matchAnyWord && input.keywords.length === 0) {
    throw new Error("Add at least one keyword, or enable matchAnyWord");
  }
  if (input.openingDmEnabled && (!input.openingDmMessage?.trim() || !input.openingDmButtonLabel?.trim())) {
    throw new Error("Opening DM requires a message and button label");
  }
  if (input.requireFollow && (!input.followPromptMessage?.trim() || !input.followPromptButtonLabel?.trim())) {
    throw new Error("Follow gate requires a prompt and button label");
  }
  if (input.followUpEnabled && !input.followUpMessage?.trim()) {
    throw new Error("Follow-up requires a message");
  }
}

function publicReplyValues(enabled: boolean, messages: string[]) {
  if (!enabled) return { publicReplyEnabled: false, publicReplyMessages: [], publicReplyMessage: null };
  const cleaned = messages.map((message) => message.trim()).filter(Boolean);
  return { publicReplyEnabled: cleaned.length > 0, publicReplyMessages: cleaned, publicReplyMessage: cleaned[0] ?? null };
}

async function createCampaign(workspaceId: string, input: CampaignInput) {
  validateCampaignInput(input);
  const account = await getAccount(workspaceId, input.instagramAccountId);
  const scheduledPost = input.scheduledPostId
    ? await prisma.scheduledPost.findFirst({
        where: {
          id: input.scheduledPostId,
          workspaceId,
          instagramAccountId: account.id,
        },
      })
    : null;
  if (input.scheduledPostId && !scheduledPost) {
    throw new Error("Scheduled post not found for this Instagram account");
  }
  const isSpecificPost = !input.pendingNextReel && !input.matchAnyPost && !scheduledPost;
  const reply = publicReplyValues(input.publicReplyEnabled, input.publicReplyMessages);
  const links = input.trackedLinks.map((link, index) => ({
    workspaceId,
    slug: generateTrackedLinkSlug(),
    label: link.label?.trim() || (index === 0 ? "Primary campaign link" : "Open link"),
    destinationUrl: link.destinationUrl,
  }));

  return prisma.automation.create({
    data: {
      name: input.name,
      goal: input.goal?.trim() || null,
      postId: scheduledPost?.platformPostId ?? (isSpecificPost ? input.postId ?? null : null),
      postUrl: scheduledPost?.platformPostUrl ?? (isSpecificPost ? input.postUrl ?? null : null),
      scheduledPostId: scheduledPost?.id ?? null,
      pendingNextReel: input.pendingNextReel,
      matchAnyPost: input.matchAnyPost,
      keywords: input.matchAnyWord ? [] : input.keywords,
      matchAnyWord: input.matchAnyWord,
      dmTriggerEnabled: input.dmTriggerEnabled,
      dmMessage: input.dmMessage,
      openingDmEnabled: input.openingDmEnabled,
      openingDmMessage: input.openingDmEnabled ? input.openingDmMessage?.trim() || null : null,
      openingDmButtonLabel: input.openingDmEnabled ? input.openingDmButtonLabel?.trim() || null : null,
      linkButtonLabel: input.linkButtonLabel?.trim() || null,
      requireFollow: input.requireFollow,
      followPromptMessage: input.requireFollow ? input.followPromptMessage?.trim() || null : null,
      followPromptButtonLabel: input.requireFollow ? input.followPromptButtonLabel?.trim() || null : null,
      followUpEnabled: input.followUpEnabled,
      followUpMessage: input.followUpEnabled ? input.followUpMessage?.trim() || null : null,
      followUpDelayMinutes: input.followUpEnabled ? input.followUpDelayMinutes : 0,
      ...reply,
      isActive: input.isActive,
      wholeWordMatch: input.wholeWordMatch,
      workspaceId,
      instagramAccountId: account.id,
      reportShareSlug: generateReportShareSlug(),
      ...(links.length ? { trackedLinks: { create: links } } : {}),
    },
    include: campaignInclude,
  });
}

async function updateCampaign(workspaceId: string, id: string, input: CampaignUpdateInput) {
  const existing = await campaignById(workspaceId, id);
  const data: Prisma.AutomationUpdateInput = {};
  const scalarFields = [
    "name", "goal", "postId", "postUrl", "pendingNextReel", "matchAnyPost", "keywords", "matchAnyWord",
    "dmTriggerEnabled", "dmMessage", "openingDmEnabled", "openingDmMessage", "openingDmButtonLabel", "linkButtonLabel",
    "requireFollow", "followPromptMessage", "followPromptButtonLabel", "followUpEnabled", "followUpMessage",
    "followUpDelayMinutes", "isActive", "wholeWordMatch",
  ] as const;
  for (const field of scalarFields) {
    const value = input[field];
    if (value !== undefined) (data as Record<string, unknown>)[field] = value;
  }
  if (input.matchAnyWord === true) data.keywords = [];
  if (input.openingDmEnabled === false) {
    data.openingDmMessage = null;
    data.openingDmButtonLabel = null;
  }
  if (input.requireFollow === false) {
    data.followPromptMessage = null;
    data.followPromptButtonLabel = null;
  }
  if (input.followUpEnabled === false) {
    data.followUpMessage = null;
    data.followUpDelayMinutes = 0;
  }
  if (input.matchAnyPost === true || input.pendingNextReel === true) {
    data.postId = null;
    data.postUrl = null;
    data.scheduledPost = { disconnect: true };
  } else if (input.scheduledPostId) {
    const scheduledPost = await prisma.scheduledPost.findFirst({
      where: {
        id: input.scheduledPostId,
        workspaceId,
        instagramAccountId: existing.instagramAccountId,
      },
    });
    if (!scheduledPost) throw new Error("Scheduled post not found for this Instagram account");
    data.scheduledPost = { connect: { id: scheduledPost.id } };
    data.postId = scheduledPost.platformPostId;
    data.postUrl = scheduledPost.platformPostUrl;
  } else if (input.postId) {
    data.scheduledPost = { disconnect: true };
  }
  if (input.publicReplyMessages !== undefined) {
    Object.assign(data, publicReplyValues(input.publicReplyMessages.length > 0, input.publicReplyMessages));
  }
  if (input.publicReplyEnabled === false) Object.assign(data, publicReplyValues(false, []));

  const updated = await prisma.automation.update({ where: { id: existing.id }, data, include: campaignInclude });
  if (input.trackedLinks !== undefined) {
    await prisma.trackedLink.deleteMany({ where: { automationId: existing.id } });
    if (input.trackedLinks.length) {
      await prisma.trackedLink.createMany({
        data: input.trackedLinks.map((link, index) => ({
          workspaceId,
          automationId: existing.id,
          slug: generateTrackedLinkSlug(),
          label: link.label?.trim() || (index === 0 ? "Primary campaign link" : "Open link"),
          destinationUrl: link.destinationUrl,
        })),
      });
    }
  }
  const refreshed = await prisma.automation.findUnique({ where: { id: updated.id }, include: campaignInclude });
  if (!refreshed) throw new Error("Campaign disappeared after update");
  return refreshed;
}

async function requireAdmin(workspaceId: string) {
  const userId = context.userId ?? process.env.OPENREPLY_MCP_USER_ID;
  if (!userId) {
    throw new Error("OPENREPLY_MCP_USER_ID is required for write operations");
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  if (!membership || !canManageWorkspace(membership.role)) {
    throw new Error("MCP user must be an owner or admin of the configured workspace");
  }
}

const server = new McpServer(
  { name: "openreply", version: "0.2.0" },
  { instructions: MCP_SERVER_INSTRUCTIONS },
);

server.registerTool("openreply_health", {
  description: "Check PostgreSQL, Redis, queue depth, and DM worker heartbeat.",
  inputSchema: workspaceInput,
}, async ({ workspaceId }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    await getWorkspace(resolved);
    const [queueCounts, workerHealth, workerAlerts] = await Promise.all([
      getDMQueue().getJobCounts("waiting", "active", "delayed", "failed"),
      getWorkerHealth(),
      getWorkerAlerts(10),
    ]);
    await prisma.$queryRaw`SELECT 1`;
    await getRedisConnection().ping();
    return textResult({ success: true, database: "ok", redis: "PONG", queueCounts, workerHealth, workerAlerts });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_dashboard_summary", {
  description: "Return the dashboard summary for campaigns, DMs, clicks, and connected accounts.",
  inputSchema: workspaceInput,
}, async ({ workspaceId }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    const [accounts, activeCampaigns, campaigns, sent, skipped, failed, clicks, recentLogs] = await Promise.all([
      prisma.instagramAccount.findMany({ where: { workspaceId: resolved }, select: { id: true, username: true, name: true, instagramId: true } }),
      prisma.automation.count({ where: { workspaceId: resolved, isActive: true } }),
      prisma.automation.count({ where: { workspaceId: resolved } }),
      prisma.dmLog.count({ where: { workspaceId: resolved, status: "SENT" } }),
      prisma.dmLog.count({ where: { workspaceId: resolved, status: { in: ["SKIPPED_DEDUP", "SKIPPED_RATE_LIMIT", "SKIPPED_PLAN_LIMIT", "SKIPPED_NO_MATCH"] } } }),
      prisma.dmLog.count({ where: { workspaceId: resolved, status: "FAILED" } }),
      prisma.linkClick.count({ where: { workspaceId: resolved } }),
      prisma.dmLog.findMany({ where: { workspaceId: resolved }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, status: true, commenterName: true, commentText: true, createdAt: true, automation: { select: { name: true } } } }),
    ]);
    return textResult({ success: true, accounts, campaigns, activeCampaigns, sent, skipped, failed, clicks, recentLogs });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_dashboard_stats", {
  description: "Return the dashboard's time-windowed DM, click, campaign, contact, and keyword statistics.",
  inputSchema: { ...workspaceInput, instagramAccountId: z.string().min(1).optional() },
}, async ({ workspaceId, instagramAccountId }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const accountFilter = instagramAccountId ? { instagramAccountId } : {};
    const [
      workspace,
      instagramAccount,
      instagramAccounts,
      totalAutomations,
      activeAutomations,
      dmsSentToday,
      dmsSentWeek,
      dmsSentMonth,
      totalDMs,
      dmStatusCountsThisMonth,
      clicksThisMonth,
      totalClicks,
      topKeywordRows,
      recentLogs,
      contactRows,
    ] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: resolved }, select: { name: true, dmsSentThisPeriod: true } }),
      prisma.instagramAccount.findFirst({ where: { workspaceId: resolved }, orderBy: { connectedAt: "desc" }, select: { id: true, username: true, instagramId: true, tokenExpiresAt: true, webhookSubscribed: true } }),
      prisma.instagramAccount.findMany({ where: { workspaceId: resolved }, orderBy: { connectedAt: "desc" }, select: { id: true, username: true, instagramId: true, name: true, tokenExpiresAt: true, webhookSubscribed: true } }),
      prisma.automation.count({ where: { workspaceId: resolved, ...accountFilter } }),
      prisma.automation.count({ where: { workspaceId: resolved, isActive: true, ...accountFilter } }),
      prisma.dmLog.count({ where: { workspaceId: resolved, status: "SENT", createdAt: { gte: todayStart }, ...accountFilter } }),
      prisma.dmLog.count({ where: { workspaceId: resolved, status: "SENT", createdAt: { gte: weekStart }, ...accountFilter } }),
      prisma.dmLog.count({ where: { workspaceId: resolved, status: "SENT", createdAt: { gte: monthStart }, ...accountFilter } }),
      prisma.dmLog.count({ where: { workspaceId: resolved, status: "SENT", ...accountFilter } }),
      prisma.dmLog.groupBy({ by: ["status"], where: { workspaceId: resolved, createdAt: { gte: monthStart }, ...accountFilter }, _count: { _all: true } }),
      prisma.linkClick.count({ where: { workspaceId: resolved, createdAt: { gte: monthStart }, ...accountFilter } }),
      prisma.linkClick.count({ where: { workspaceId: resolved, ...accountFilter } }),
      prisma.dmLog.groupBy({ by: ["matchedKeyword"], where: { workspaceId: resolved, matchedKeyword: { not: null }, ...accountFilter }, _count: { _all: true } }),
      prisma.dmLog.findMany({ where: { workspaceId: resolved, ...accountFilter }, orderBy: { createdAt: "desc" }, take: 10, include: { automation: { select: { name: true } }, instagramAccount: { select: { username: true } } } }),
      prisma.dmLog.findMany({ where: { workspaceId: resolved, ...accountFilter }, distinct: ["commenterId"], select: { commenterId: true } }),
    ]);

    const dailyDMs = await Promise.all(
      Array.from({ length: 7 }, async (_, index) => {
        const dayStart = new Date(todayStart);
        dayStart.setDate(dayStart.getDate() - (6 - index));
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
        return {
          date: dayStart.toLocaleDateString("en-US", { weekday: "short" }),
          count: await prisma.dmLog.count({ where: { workspaceId: resolved, status: "SENT", createdAt: { gte: dayStart, lt: dayEnd }, ...accountFilter } }),
        };
      }),
    );

    const monthlyStatusSummary = summarizeDmStatuses(dmStatusCountsThisMonth.map((row) => ({ status: row.status, _count: row._count._all })));
    const topKeywords = normalizeTopKeywords(topKeywordRows.map((row) => ({ matchedKeyword: row.matchedKeyword, _count: row._count._all })));
    return textResult({
      success: true,
      workspace,
      instagramAccount,
      instagramAccounts,
      selectedInstagramAccountId: instagramAccountId ?? null,
      contactsCount: contactRows.length,
      totalAutomations,
      activeAutomations,
      dmsSentToday,
      dmsSentWeek,
      dmsSentMonth,
      dmsSkippedMonth: monthlyStatusSummary.skipped,
      dmsFailedMonth: monthlyStatusSummary.failed,
      totalDMs,
      clicksThisMonth,
      totalClicks,
      ctrThisMonth: calculateCtr(clicksThisMonth, dmsSentMonth),
      topKeywords,
      dailyDMs,
      recentLogs,
    });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_list_instagram_accounts", {
  description: "List connected Instagram professional accounts without exposing access tokens.",
  inputSchema: workspaceInput,
}, async ({ workspaceId }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    const accounts = await prisma.instagramAccount.findMany({ where: { workspaceId: resolved }, orderBy: { connectedAt: "desc" } });
    return textResult({ success: true, accounts: accounts.map(accountSummary) });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_get_instagram_connect_url", {
  description: "Return the OpenReply URL that a signed-in user can open to start Instagram OAuth; Meta consent remains a browser action.",
  inputSchema: workspaceInput,
}, async ({ workspaceId }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    await getWorkspace(resolved);
    const baseUrl = process.env.NEXTAUTH_URL;
    if (!baseUrl) throw new Error("NEXTAUTH_URL is required");
    return textResult({ success: true, url: `${baseUrl.replace(/\/$/, "")}/api/instagram/connect`, note: "Open this URL in a browser where the OpenReply user is signed in, then approve Meta consent." });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_get_instagram_account", {
  description: "Get a connected account, its live Instagram profile, and webhook subscription status.",
  inputSchema: accountInput,
}, async ({ workspaceId, instagramAccountId }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    const account = await getAccount(resolved, instagramAccountId);
    const token = decryptToken(account.accessToken);
    const profile = await getUserInfo(token);
    return textResult({ success: true, account: accountSummary(account), profile: { id: profile.id, userId: profile.user_id, username: profile.username, name: profile.name ?? null, profilePictureUrl: profile.profile_picture_url ?? null, followersCount: profile.followers_count ?? null } });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_list_instagram_posts", {
  description: "List recent Instagram media for a connected account.",
  inputSchema: { ...accountInput, limit: z.number().int().min(1).max(300).default(25), all: z.boolean().default(false) },
}, async ({ workspaceId, instagramAccountId, limit, all }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    const account = await getAccount(resolved, instagramAccountId);
    const token = decryptToken(account.accessToken);
    const media = all ? await getAllUserMedia(token, 300) : await getUserMedia(token, Math.min(limit, 50));
    return textResult({ success: true, account: accountSummary(account), posts: media });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_list_zernio_scheduled_posts", {
  description: "List Zernio Instagram posts already synced into OpenReply, including their scheduled time and binding status.",
  inputSchema: accountInput,
}, async ({ workspaceId, instagramAccountId }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    const account = instagramAccountId
      ? await getAccount(resolved, instagramAccountId)
      : null;
    const posts = await prisma.scheduledPost.findMany({
      where: {
        workspaceId: resolved,
        ...(account ? { instagramAccountId: account.id } : {}),
      },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
    });
    return textResult({ success: true, posts });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_sync_zernio_post", {
  description: "Fetch one Zernio post by its Zernio post ID and create or refresh its OpenReply scheduled-post placeholder. Returns the scheduledPostId to pass to openreply_create_campaign.",
  inputSchema: {
    ...workspaceInput,
    zernioPostId: z.string().min(1),
    confirm: z.literal(true).describe("Required because this writes the scheduled-post record"),
  },
}, async ({ workspaceId, zernioPostId }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    await requireAdmin(resolved);
    const posts = await syncZernioPostForWorkspace(resolved, zernioPostId);
    return textResult({ success: true, posts });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_get_media_insights", {
  description: "Fetch live insights for one Instagram post or reel.",
  inputSchema: { ...accountInput, mediaId: z.string().min(1), metrics: z.array(z.string().min(1)).min(1).max(20) },
}, async ({ workspaceId, instagramAccountId, mediaId, metrics }) => {
  try {
    const account = await getAccount(configuredWorkspaceId(workspaceId), instagramAccountId);
    return textResult({ success: true, mediaId, insights: await getMediaInsights(decryptToken(account.accessToken), mediaId, metrics) });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_subscribe_instagram_webhooks", {
  description: "Subscribe a connected Instagram account to comments, messages, postbacks, and seen events.",
  inputSchema: { ...accountInput, confirm: z.literal(true).describe("Required because this changes the Meta subscription") },
}, async ({ workspaceId, instagramAccountId }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    await requireAdmin(resolved);
    const account = await getAccount(resolved, instagramAccountId);
    const result = await subscribeInstagramAccountToWebhooks(account.instagramId, decryptToken(account.accessToken));
    await prisma.instagramAccount.update({ where: { id: account.id }, data: { webhookSubscribed: result.success } });
    return textResult({ success: true, accountId: account.id, result });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_disconnect_instagram_account", {
  description: "Disconnect an Instagram account and cascade-delete its campaigns and logs.",
  inputSchema: { ...accountInput, confirm: z.literal(true).describe("Required because this is destructive") },
}, async ({ workspaceId, instagramAccountId }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    await requireAdmin(resolved);
    const account = await getAccount(resolved, instagramAccountId);
    await prisma.instagramAccount.delete({ where: { id: account.id } });
    return textResult({ success: true, disconnectedAccountId: account.id, username: account.username });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_list_campaign_templates", {
  description: "List the campaign templates available in the dashboard.",
  inputSchema: {},
}, async () => textResult({ success: true, templates: CAMPAIGN_TEMPLATES }));

server.registerTool("openreply_list_campaigns", {
  description: "List campaigns, trigger settings, tracked links, report URLs, and DM counts.",
  inputSchema: { ...workspaceInput, instagramAccountId: z.string().min(1).optional(), activeOnly: z.boolean().default(false) },
}, async ({ workspaceId, instagramAccountId, activeOnly }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    const campaigns = await prisma.automation.findMany({ where: { workspaceId: resolved, ...(instagramAccountId ? { instagramAccountId } : {}), ...(activeOnly ? { isActive: true } : {}) }, orderBy: { createdAt: "desc" }, include: campaignInclude });
    return textResult({ success: true, campaigns: campaigns.map(serializeCampaign) });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_get_campaign", {
  description: "Get one complete campaign configuration and its tracked links.",
  inputSchema: { ...workspaceInput, campaignId: z.string().min(1) },
}, async ({ workspaceId, campaignId }) => {
  try {
    const campaign = await campaignById(configuredWorkspaceId(workspaceId), campaignId);
    return textResult({ success: true, campaign: serializeCampaign(campaign) });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_create_campaign", {
  description: "Create a dashboard-equivalent comment/DM campaign, including follow gate and up to two tracked links.",
  inputSchema: { ...workspaceInput, confirm: z.literal(true).describe("Required because this creates live automation"), ...campaignFields },
}, async (input) => {
  try {
    const { workspaceId, confirm, ...campaignInput } = input;
    void confirm;
    const resolved = configuredWorkspaceId(workspaceId);
    await requireAdmin(resolved);
    const campaign = await createCampaign(resolved, campaignInput);
    return textResult({ success: true, campaign: serializeCampaign(campaign) });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_import_campaigns", {
  description: "Bulk import dashboard campaigns for distinct Instagram posts, skipping posts that already have a campaign.",
  inputSchema: {
    ...workspaceInput,
    instagramAccountId: z.string().min(1),
    campaigns: z.array(z.object(importCampaignFields)).min(1).max(200),
    confirm: z.literal(true).describe("Required because this creates multiple live campaigns"),
  },
}, async ({ workspaceId, instagramAccountId, campaigns }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    await requireAdmin(resolved);
    const account = await getAccount(resolved, instagramAccountId);
    const existing = await prisma.automation.findMany({
      where: { instagramAccountId: account.id },
      select: { postId: true },
    });
    const usedPostIds = new Set(existing.map((campaign) => campaign.postId));
    const created: { name: string; postId: string }[] = [];
    const skipped: { row: number; reason: string }[] = [];

    for (const [index, campaign] of campaigns.entries()) {
      const row = index + 1;
      if (usedPostIds.has(campaign.postId)) {
        skipped.push({ row, reason: "a campaign already exists for this post" });
        continue;
      }

      const name = campaign.name?.trim().slice(0, 100) || `Imported: ${campaign.keywords[0]}`;
      const publicReply = campaign.publicReplyMessage?.trim().slice(0, 1000) || null;
      await prisma.automation.create({
        data: {
          name,
          goal: campaign.goal?.trim().slice(0, 120) || null,
          postId: campaign.postId,
          postUrl: campaign.postUrl ?? null,
          keywords: campaign.keywords,
          dmMessage: campaign.dmMessage.slice(0, 1000),
          publicReplyEnabled: Boolean(publicReply),
          publicReplyMessage: publicReply,
          publicReplyMessages: publicReply ? [publicReply] : [],
          isActive: campaign.isActive,
          wholeWordMatch: campaign.wholeWordMatch,
          workspaceId: resolved,
          instagramAccountId: account.id,
          reportShareSlug: generateReportShareSlug(),
          ...(campaign.trackedUrl
            ? {
                trackedLinks: {
                  create: {
                    workspaceId: resolved,
                    slug: generateTrackedLinkSlug(),
                    label: "Primary campaign link",
                    destinationUrl: campaign.trackedUrl,
                  },
                },
              }
            : {}),
        },
      });
      usedPostIds.add(campaign.postId);
      created.push({ name, postId: campaign.postId });
    }

    return textResult({ success: true, created, skipped });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_update_campaign", {
  description: "Update a campaign configuration or replace its tracked links.",
  inputSchema: { ...workspaceInput, campaignId: z.string().min(1), confirm: z.literal(true).describe("Required because this changes live automation behavior"), ...campaignUpdateFields },
}, async (input) => {
  try {
    const updates = Object.fromEntries(
      Object.entries(input).filter(([key]) => !["workspaceId", "campaignId", "confirm"].includes(key))
    ) as CampaignUpdateInput;
    const resolved = configuredWorkspaceId(input.workspaceId);
    await requireAdmin(resolved);
    const campaign = await updateCampaign(resolved, input.campaignId, updates);
    return textResult({ success: true, campaign: serializeCampaign(campaign) });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_delete_campaign", {
  description: "Delete a campaign and its tracked links/logs.",
  inputSchema: { ...workspaceInput, campaignId: z.string().min(1), confirm: z.literal(true).describe("Required because this is destructive") },
}, async ({ workspaceId, campaignId }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    await requireAdmin(resolved);
    const campaign = await campaignById(resolved, campaignId);
    await prisma.automation.delete({ where: { id: campaign.id } });
    return textResult({ success: true, deletedCampaignId: campaign.id, name: campaign.name });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_get_campaign_analytics", {
  description: "Return sent, skipped, failed, click, CTR, and keyword analytics for a campaign.",
  inputSchema: { ...workspaceInput, campaignId: z.string().min(1) },
}, async ({ workspaceId, campaignId }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    await campaignById(resolved, campaignId);
    const [statusCounts, clickCount, keywordCounts] = await Promise.all([
      prisma.dmLog.groupBy({ by: ["status"], where: { workspaceId: resolved, automationId: campaignId }, _count: { _all: true } }),
      prisma.linkClick.count({ where: { workspaceId: resolved, automationId: campaignId } }),
      prisma.dmLog.groupBy({ by: ["matchedKeyword"], where: { workspaceId: resolved, automationId: campaignId, matchedKeyword: { not: null } }, _count: { _all: true } }),
    ]);
    const sent = statusCounts.find((row) => row.status === "SENT")?._count._all ?? 0;
    return textResult({ success: true, campaignId, statusCounts, clicks: clickCount, sent, ctr: sent ? clickCount / sent : 0, keywords: keywordCounts });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_list_dm_logs", {
  description: "Inspect DM logs with status, campaign, commenter, error, and pagination filters.",
  inputSchema: { ...workspaceInput, page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(50), status: z.enum(["PENDING", "SENT", "FAILED", "SKIPPED_DEDUP", "SKIPPED_RATE_LIMIT", "SKIPPED_PLAN_LIMIT", "SKIPPED_NO_MATCH"]).optional(), instagramAccountId: z.string().min(1).optional(), campaignId: z.string().min(1).optional() },
}, async ({ workspaceId, page, limit, status, instagramAccountId, campaignId }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    const where = { workspaceId: resolved, ...(status ? { status } : {}), ...(instagramAccountId ? { instagramAccountId } : {}), ...(campaignId ? { automationId: campaignId } : {}) };
    const [logs, total] = await Promise.all([
      prisma.dmLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit, include: { automation: { select: { id: true, name: true, keywords: true } }, instagramAccount: { select: { id: true, username: true } } } }),
      prisma.dmLog.count({ where }),
    ]);
    return textResult({ success: true, logs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_list_webhook_events", {
  description: "Inspect webhook delivery records for troubleshooting. Payloads are omitted unless explicitly requested.",
  inputSchema: { ...workspaceInput, limit: z.number().int().min(1).max(100).default(50), status: z.enum(["PENDING", "PROCESSED", "FAILED"]).optional(), includePayload: z.boolean().default(false) },
}, async ({ workspaceId, limit, status, includePayload }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    const events = await prisma.webhookEvent.findMany({ where: { workspaceId: resolved, ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, object: true, status: true, errorMessage: true, createdAt: true, processedAt: true, ...(includePayload ? { payload: true } : {}) } });
    return textResult({ success: true, events });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_list_operational_events", {
  description: "Inspect worker, token refresh, health, and system events.",
  inputSchema: { ...workspaceInput, limit: z.number().int().min(1).max(100).default(50), level: z.enum(["INFO", "WARNING", "ERROR"]).optional() },
}, async ({ workspaceId, limit, level }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    const events = await prisma.operationalEvent.findMany({ where: { OR: [{ workspaceId: resolved }, { workspaceId: null }], ...(level ? { level } : {}) }, orderBy: { createdAt: "desc" }, take: limit });
    return textResult({ success: true, events });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_list_conversations", {
  description: "List recent Instagram DM conversations for the connected account.",
  inputSchema: accountInput,
}, async ({ workspaceId, instagramAccountId }) => {
  try {
    const account = await getAccount(configuredWorkspaceId(workspaceId), instagramAccountId);
    const raw = await getConversations(decryptToken(account.accessToken), account.instagramId);
    return textResult({ success: true, account: accountSummary(account), conversations: raw });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_get_conversation_messages", {
  description: "Get the recent messages in an Instagram DM conversation.",
  inputSchema: { ...accountInput, conversationId: z.string().min(1) },
}, async ({ workspaceId, instagramAccountId, conversationId }) => {
  try {
    const account = await getAccount(configuredWorkspaceId(workspaceId), instagramAccountId);
    const messages = await getConversationMessages(decryptToken(account.accessToken), conversationId);
    return textResult({ success: true, conversationId, messages: messages.reverse() });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_send_instagram_message", {
  description: "Send an Instagram DM reply within Meta's allowed messaging window.",
  inputSchema: { ...accountInput, recipientId: z.string().min(1), text: z.string().min(1).max(1000), confirm: z.literal(true).describe("Required because this sends an external message") },
}, async ({ workspaceId, instagramAccountId, recipientId, text }) => {
  try {
    const account = await getAccount(configuredWorkspaceId(workspaceId), instagramAccountId);
    const result = await sendDirectMessage(decryptToken(account.accessToken), account.instagramId, recipientId, text);
    return textResult({ success: true, result });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_reply_to_comment", {
  description: "Post a public reply to an Instagram comment.",
  inputSchema: { ...accountInput, commentId: z.string().min(1), text: z.string().min(1).max(1000), confirm: z.literal(true).describe("Required because this posts publicly") },
}, async ({ workspaceId, instagramAccountId, commentId, text }) => {
  try {
    const account = await getAccount(configuredWorkspaceId(workspaceId), instagramAccountId);
    return textResult({ success: true, result: await sendCommentReply(decryptToken(account.accessToken), commentId, text) });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_get_follower_history", {
  description: "Fetch the account's recent follower-count insight deltas.",
  inputSchema: { ...accountInput, days: z.number().int().min(1).max(30).default(30) },
}, async ({ workspaceId, instagramAccountId, days }) => {
  try {
    const account = await getAccount(configuredWorkspaceId(workspaceId), instagramAccountId);
    return textResult({ success: true, accountId: account.id, history: await getFollowerCountSeries(decryptToken(account.accessToken), account.instagramId, days) });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_list_workspace_members", {
  description: "List workspace members and pending invitation metadata.",
  inputSchema: workspaceInput,
}, async ({ workspaceId }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    const [members, invitations] = await Promise.all([
      prisma.workspaceMember.findMany({ where: { workspaceId: resolved }, orderBy: [{ role: "asc" }, { createdAt: "asc" }], select: { id: true, role: true, createdAt: true, user: { select: { id: true, email: true, name: true } } } }),
      prisma.workspaceInvitation.findMany({ where: { workspaceId: resolved, status: "PENDING" }, orderBy: { createdAt: "desc" }, select: { id: true, email: true, role: true, token: true, expiresAt: true, createdAt: true } }),
    ]);
    return textResult({ success: true, members, invitations: invitations.map((invitation) => ({ ...invitation, inviteUrl: buildInvitationUrl(invitation.token) })) });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_accept_workspace_invitation", {
  description: "Accept a pending workspace invitation for the configured MCP user.",
  inputSchema: { ...workspaceInput, token: z.string().min(1), confirm: z.literal(true).describe("Required because this changes workspace access") },
}, async ({ workspaceId, token }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    const userId = process.env.OPENREPLY_MCP_USER_ID;
    if (!userId) throw new Error("OPENREPLY_MCP_USER_ID is required to accept an invitation");
    const [user, invitation] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } }),
      prisma.workspaceInvitation.findUnique({ where: { token }, include: { workspace: { select: { id: true, name: true } } } }),
    ]);
    if (!user?.email) throw new Error("MCP user not found");
    if (!invitation || invitation.workspace.id !== resolved || invitation.status !== "PENDING") {
      throw new Error("Invitation is no longer available for the configured workspace");
    }
    if (invitation.expiresAt <= new Date()) {
      await prisma.workspaceInvitation.update({ where: { id: invitation.id }, data: { status: "EXPIRED" } });
      throw new Error("Invitation has expired");
    }
    if (normalizeInvitationEmail(user.email) !== invitation.email) {
      throw new Error("Invitation email does not match OPENREPLY_MCP_USER_ID");
    }

    await prisma.$transaction([
      prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: resolved, userId } },
        create: { workspaceId: resolved, userId, role: invitation.role },
        update: { role: invitation.role },
      }),
      prisma.workspaceInvitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } }),
    ]);
    return textResult({ success: true, workspaceName: invitation.workspace.name, role: invitation.role });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_invite_workspace_member", {
  description: "Invite or add a workspace member, matching the dashboard behavior.",
  inputSchema: { ...workspaceInput, email: z.string().email(), role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"), confirm: z.literal(true).describe("Required because this changes workspace access") },
}, async ({ workspaceId, email, role }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    await requireAdmin(resolved);
    const normalizedEmail = normalizeInvitationEmail(email);
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
    if (existingUser) {
      await prisma.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: resolved, userId: existingUser.id } }, create: { workspaceId: resolved, userId: existingUser.id, role }, update: { role } });
      return textResult({ success: true, addedUserId: existingUser.id, role });
    }
    const invitation = await prisma.workspaceInvitation.upsert({ where: { workspaceId_email: { workspaceId: resolved, email: normalizedEmail } }, create: { workspaceId: resolved, email: normalizedEmail, role, token: generateInvitationToken(), expiresAt: getInvitationExpiry() }, update: { role, status: "PENDING", token: generateInvitationToken(), expiresAt: getInvitationExpiry() }, select: { id: true, email: true, role: true, token: true, expiresAt: true } });
    return textResult({ success: true, invitation: { ...invitation, inviteUrl: buildInvitationUrl(invitation.token) } });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_update_workspace_member_role", {
  description: "Change a non-owner workspace member's role.",
  inputSchema: { ...workspaceInput, memberId: z.string().min(1), role: z.enum(["ADMIN", "MEMBER"]), confirm: z.literal(true).describe("Required because this changes workspace access") },
}, async ({ workspaceId, memberId, role }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    await requireAdmin(resolved);
    const member = await prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId: resolved } });
    if (!member || member.role === "OWNER") throw new Error("Owner membership cannot be updated");
    const updated = await prisma.workspaceMember.update({ where: { id: member.id }, data: { role }, select: { id: true, role: true, user: { select: { id: true, email: true, name: true } } } });
    return textResult({ success: true, member: updated });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("openreply_remove_workspace_member", {
  description: "Remove a non-owner workspace member or revoke a pending invitation.",
  inputSchema: { ...workspaceInput, memberId: z.string().min(1).optional(), invitationId: z.string().min(1).optional(), confirm: z.literal(true).describe("Required because this changes workspace access") },
}, async ({ workspaceId, memberId, invitationId }) => {
  try {
    const resolved = configuredWorkspaceId(workspaceId);
    await requireAdmin(resolved);
    if (!memberId && !invitationId) throw new Error("Provide memberId or invitationId");
    if (memberId) {
      const member = await prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId: resolved } });
      const currentUserId = context.userId ?? process.env.OPENREPLY_MCP_USER_ID;
      if (!member || member.role === "OWNER" || member.userId === currentUserId) {
        throw new Error("Owner or current MCP user membership cannot be removed");
      }
      await prisma.workspaceMember.delete({ where: { id: member.id } });
    }
    if (invitationId) await prisma.workspaceInvitation.updateMany({ where: { id: invitationId, workspaceId: resolved, status: "PENDING" }, data: { status: "REVOKED" } });
    return textResult({ success: true });
  } catch (error) {
    return errorResult(error);
  }
});

  return server;
}
