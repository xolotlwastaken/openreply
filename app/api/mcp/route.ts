import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { prisma } from "@/lib/db/client";
import {
  authenticateMcpAccessToken,
  readBearerToken,
} from "@/lib/mcp/access-tokens";
import { checkMcpRateLimit } from "@/lib/mcp/rate-limit";
import { createOpenReplyMcpServer } from "@/mcp/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers":
    "MCP-Protocol-Version, MCP-Session-Id, RateLimit-Limit, RateLimit-Remaining",
};

type ToolCallAudit = {
  requestId: string | number | null;
  toolName: string;
};

function withHeaders(response: Response, extra: Record<string, string>) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonError(message: string, status: number, extra: Record<string, string> = {}) {
  return withHeaders(
    Response.json({ success: false, error: message }, { status }),
    extra
  );
}

async function readToolCalls(request: Request): Promise<ToolCallAudit[]> {
  if (request.method !== "POST") return [];
  const body = await request.clone().json().catch(() => null);
  const messages = Array.isArray(body) ? body : [body];
  return messages.flatMap((message) => {
    if (
      !message ||
      typeof message !== "object" ||
      message.method !== "tools/call" ||
      !message.params ||
      typeof message.params !== "object" ||
      typeof message.params.name !== "string"
    ) {
      return [];
    }
    return [{ requestId: message.id ?? null, toolName: message.params.name }];
  });
}

async function handleMcpRequest(request: Request) {
  const plaintextToken = readBearerToken(request);
  if (!plaintextToken) {
    return jsonError("Missing MCP bearer token", 401, {
      "WWW-Authenticate": 'Bearer realm="OpenReply MCP"',
    });
  }

  const authenticated = await authenticateMcpAccessToken(plaintextToken);
  if (!authenticated) {
    return jsonError("Invalid, expired, or revoked MCP bearer token", 401, {
      "WWW-Authenticate": 'Bearer realm="OpenReply MCP", error="invalid_token"',
    });
  }

  let rateLimit;
  try {
    rateLimit = await checkMcpRateLimit(authenticated.tokenId);
  } catch {
    return jsonError("MCP rate-limit service is unavailable", 503, {
      "Retry-After": "30",
    });
  }
  const rateHeaders = {
    "RateLimit-Limit": String(rateLimit.limit),
    "RateLimit-Remaining": String(rateLimit.remaining),
  };
  if (!rateLimit.allowed) {
    return jsonError("MCP request rate limit exceeded", 429, {
      ...rateHeaders,
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  const toolCalls = await readToolCalls(request);
  const server = createOpenReplyMcpServer({
    workspaceId: authenticated.workspaceId,
    userId: authenticated.userId,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);

  try {
    const response = await transport.handleRequest(request, {
      authInfo: {
        token: authenticated.tokenId,
        clientId: `openreply-token:${authenticated.tokenId}`,
        scopes: [`workspace:${authenticated.workspaceId}`, `role:${authenticated.role}`],
        extra: { userId: authenticated.userId, tokenName: authenticated.tokenName },
      },
    });

    if (toolCalls.length > 0) {
      await prisma.operationalEvent.createMany({
        data: toolCalls.map((call) => ({
          workspaceId: authenticated.workspaceId,
          source: "SYSTEM" as const,
          message: `Remote MCP tool called: ${call.toolName}`,
          payload: {
            tokenId: authenticated.tokenId,
            userId: authenticated.userId,
            requestId: call.requestId,
            toolName: call.toolName,
            responseStatus: response.status,
          },
        })),
      }).catch((error) => {
        console.error("[OpenReply MCP] Could not record tool audit event", error);
      });
    }

    return withHeaders(response, rateHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Remote MCP request failed";
    return jsonError(message, 500, rateHeaders);
  }
}

export function OPTIONS() {
  return withHeaders(new Response(null, { status: 204 }), {
    "Access-Control-Max-Age": "86400",
  });
}

export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
