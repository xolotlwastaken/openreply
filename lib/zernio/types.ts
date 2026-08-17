import { z } from "zod";

export const zernioAccountSchema = z
  .object({
    _id: z.string().optional(),
    id: z.string().optional(),
    platform: z.string(),
    username: z.string().optional().nullable(),
    displayName: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .passthrough()
  .transform((account, ctx) => {
    const id = account._id ?? account.id;
    if (!id) {
      ctx.addIssue({ code: "custom", message: "Zernio account has no id" });
      return z.NEVER;
    }
    return { ...account, id };
  });

export type ZernioAccount = z.infer<typeof zernioAccountSchema>;

const accountReferenceSchema = z.union([
  z.string(),
  z
    .object({ _id: z.string().optional(), id: z.string().optional() })
    .passthrough(),
]);

export const zernioPlatformTargetSchema = z
  .object({
    platform: z.string().optional(),
    name: z.string().optional(),
    accountId: accountReferenceSchema.optional(),
    status: z.string().optional(),
    platformPostId: z.string().optional().nullable(),
    platformPostUrl: z.string().optional().nullable(),
    publishedUrl: z.string().optional().nullable(),
    error: z.unknown().optional(),
  })
  .passthrough()
  .transform((target, ctx) => {
    const platform = target.platform ?? target.name;
    if (!platform) {
      ctx.addIssue({ code: "custom", message: "Zernio platform target has no platform name" });
      return z.NEVER;
    }
    return { ...target, platform };
  });

export type ZernioPlatformTarget = z.infer<typeof zernioPlatformTargetSchema>;

export const zernioPostSchema = z
  .object({
    _id: z.string().optional(),
    id: z.string().optional(),
    title: z.string().optional().nullable(),
    content: z.string().optional().nullable(),
    status: z.string().optional(),
    scheduledFor: z.string().datetime().optional().nullable(),
    publishedAt: z.string().datetime().optional().nullable(),
    timezone: z.string().optional().nullable(),
    platforms: z.array(zernioPlatformTargetSchema).default([]),
    mediaUrls: z.array(z.string()).optional(),
    media: z.array(z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .passthrough()
  .transform((post, ctx) => {
    const id = post._id ?? post.id;
    if (!id) {
      ctx.addIssue({ code: "custom", message: "Zernio post has no id" });
      return z.NEVER;
    }
    return { ...post, id };
  });

export type ZernioPost = z.infer<typeof zernioPostSchema>;

export const zernioWebhookPayloadSchema = z
  .object({
    id: z.string().min(1),
    event: z.string().min(1),
    post: zernioPostSchema,
    platform: zernioPlatformTargetSchema.optional(),
    account: z
      .object({
        id: z.string().optional(),
        accountId: z.string().optional(),
        platform: z.string().optional(),
        username: z.string().optional().nullable(),
      })
      .passthrough()
      .optional(),
    timestamp: z.string().datetime().optional(),
  })
  .passthrough();

export type ZernioWebhookPayload = z.infer<typeof zernioWebhookPayloadSchema>;

export function accountReferenceId(
  value: ZernioPlatformTarget["accountId"]
): string | null {
  if (typeof value === "string") return value;
  return value?._id ?? value?.id ?? null;
}

export function normalizeZernioUsername(value?: string | null): string {
  return (value ?? "").trim().replace(/^@/, "").toLowerCase();
}

export function instagramTarget(
  post: ZernioPost,
  accountId?: string
): ZernioPlatformTarget | null {
  return (
    post.platforms.find(
      (target) =>
        target.platform.toLowerCase() === "instagram" &&
        (!accountId || accountReferenceId(target.accountId) === accountId)
    ) ?? null
  );
}

export function mediaPreviewUrl(post: ZernioPost): string | null {
  if (post.mediaUrls?.[0]) return post.mediaUrls[0];
  for (const item of post.media ?? []) {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    for (const key of ["thumbnailUrl", "thumbnail", "url", "mediaUrl"]) {
      if (typeof candidate[key] === "string") return candidate[key];
    }
  }
  return null;
}

export function targetPlatformPostUrl(
  target?: ZernioPlatformTarget | null
): string | null {
  return target?.platformPostUrl ?? target?.publishedUrl ?? null;
}
