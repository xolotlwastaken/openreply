import { z } from "zod";
import {
  zernioAccountSchema,
  zernioPostSchema,
  type ZernioAccount,
  type ZernioPost,
} from "@/lib/zernio/types";

const DEFAULT_BASE_URL = "https://zernio.com/api/v1";

export class ZernioApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "ZernioApiError";
  }
}

function baseUrl() {
  return (process.env.ZERNIO_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

async function zernioRequest<T>(
  apiKey: string,
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl()}${path}`, {
        ...init,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
        signal: init?.signal ?? AbortSignal.timeout(15_000),
      });
      const raw = await response.text();
      let payload: unknown = {};
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = { error: raw.slice(0, 500) };
        }
      }
      if (!response.ok) {
        const body = payload as Record<string, unknown>;
        const message =
          typeof body.error === "string"
            ? body.error
            : `Zernio request failed with HTTP ${response.status}`;
        const error = new ZernioApiError(
          message,
          response.status,
          typeof body.code === "string" ? body.code : undefined
        );
        if ((response.status === 429 || response.status >= 500) && attempt === 0) {
          lastError = error;
          continue;
        }
        throw error;
      }
      return schema.parse(payload);
    } catch (error) {
      lastError = error;
      if (attempt > 0 || error instanceof ZernioApiError) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Zernio request failed");
}

const accountsResponseSchema = z.object({
  accounts: z.array(zernioAccountSchema),
});

const postsResponseSchema = z.object({
  posts: z.array(zernioPostSchema),
  pagination: z
    .object({ page: z.number(), pages: z.number() })
    .passthrough()
    .optional(),
});

const postResponseSchema = z.object({ post: zernioPostSchema });

const webhookResponseSchema = z.object({
  webhook: z
    .object({ _id: z.string().optional(), id: z.string().optional() })
    .passthrough(),
});

export async function listZernioInstagramAccounts(
  apiKey: string
): Promise<ZernioAccount[]> {
  const result = await zernioRequest(
    apiKey,
    "/accounts?platform=instagram&status=connected",
    accountsResponseSchema
  );
  return result.accounts;
}

export async function listZernioScheduledPosts(
  apiKey: string,
  accountId: string
): Promise<ZernioPost[]> {
  const posts: ZernioPost[] = [];
  let page = 1;
  do {
    const params = new URLSearchParams({
      status: "scheduled",
      platform: "instagram",
      accountId,
      page: String(page),
      limit: "100",
      sortBy: "scheduled-asc",
    });
    const result = await zernioRequest(
      apiKey,
      `/posts?${params}`,
      postsResponseSchema
    );
    posts.push(...result.posts);
    const pages = result.pagination?.pages ?? page;
    if (page >= pages) break;
    page += 1;
  } while (page <= 100);
  return posts;
}

export async function getZernioPost(
  apiKey: string,
  postId: string
): Promise<ZernioPost> {
  const result = await zernioRequest(
    apiKey,
    `/posts/${encodeURIComponent(postId)}`,
    postResponseSchema
  );
  return result.post;
}

export async function createZernioWebhook(
  apiKey: string,
  input: { name: string; url: string; secret: string; events: string[] }
): Promise<string> {
  const result = await zernioRequest(apiKey, "/webhooks/settings", webhookResponseSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
  const id = result.webhook._id ?? result.webhook.id;
  if (!id) throw new Error("Zernio created a webhook without returning its id");
  return id;
}

export async function deleteZernioWebhook(
  apiKey: string,
  webhookId: string
): Promise<void> {
  await zernioRequest(
    apiKey,
    `/webhooks/settings?id=${encodeURIComponent(webhookId)}`,
    z.unknown(),
    { method: "DELETE" }
  );
}
