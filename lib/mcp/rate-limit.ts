import { getRedisConnection } from "@/lib/queue/client";

const MCP_RATE_LIMIT = 120;
const MCP_RATE_WINDOW_SECONDS = 60;

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
return {count, ttl}
`;

export type McpRateLimit = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export async function checkMcpRateLimit(tokenId: string): Promise<McpRateLimit> {
  const result = await getRedisConnection().eval(
    RATE_LIMIT_SCRIPT,
    1,
    `rate:mcp:${tokenId}`,
    MCP_RATE_WINDOW_SECONDS
  );
  const values = Array.isArray(result) ? result : [];
  const count = Number(values[0] ?? 0);
  const ttl = Math.max(1, Number(values[1] ?? MCP_RATE_WINDOW_SECONDS));

  return {
    allowed: count <= MCP_RATE_LIMIT,
    limit: MCP_RATE_LIMIT,
    remaining: Math.max(0, MCP_RATE_LIMIT - count),
    retryAfterSeconds: ttl,
  };
}

export { MCP_RATE_LIMIT, MCP_RATE_WINDOW_SECONDS };
