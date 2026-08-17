export const OPENREPLY_REPOSITORY_URL =
  "https://github.com/xolotlwastaken/openreply";
export const OPENREPLY_APP_URL = "https://openreply-coral-six.vercel.app";
export const MCP_DOCS_URL = `${OPENREPLY_APP_URL}/docs/mcp`;
export const MCP_AGENT_DOCS_URL = `${MCP_DOCS_URL}/agent.md`;
export const MCP_REMOTE_URL = `${OPENREPLY_APP_URL}/api/mcp`;

export const MCP_INSTALL_PROMPT = `Read ${MCP_AGENT_DOCS_URL} and connect the remote OpenReply MCP server by following it exactly. The endpoint is ${MCP_REMOTE_URL}. Ask me to create a revocable MCP token in OpenReply Settings, keep it out of source control and chat logs, and verify the connection with openreply_health before making changes.`;

export const CODEX_CONFIG = `[mcp_servers.openreply]
url = "${MCP_REMOTE_URL}"
bearer_token_env_var = "OPENREPLY_MCP_TOKEN"
startup_timeout_sec = 30
tool_timeout_sec = 120`;

export const GENERIC_MCP_CONFIG = `{
  "mcpServers": {
    "openreply": {
      "url": "${MCP_REMOTE_URL}",
      "headers": {
        "Authorization": "Bearer \${OPENREPLY_MCP_TOKEN}"
      }
    }
  }
}`;

export const MCP_TOOL_GROUPS = [
  {
    title: "Health and reporting",
    description: "Check infrastructure, dashboards, analytics, logs, and operational events.",
    tools: [
      "openreply_health",
      "openreply_dashboard_summary",
      "openreply_dashboard_stats",
      "openreply_get_campaign_analytics",
      "openreply_list_dm_logs",
      "openreply_list_webhook_events",
      "openreply_list_operational_events",
    ],
  },
  {
    title: "Instagram accounts and media",
    description: "Connect accounts, inspect posts and insights, and manage webhook subscriptions.",
    tools: [
      "openreply_list_instagram_accounts",
      "openreply_get_instagram_connect_url",
      "openreply_get_instagram_account",
      "openreply_list_instagram_posts",
      "openreply_get_media_insights",
      "openreply_get_follower_history",
      "openreply_subscribe_instagram_webhooks",
      "openreply_disconnect_instagram_account",
    ],
  },
  {
    title: "Campaigns",
    description: "Create, review, import, update, and remove comment-to-DM automations.",
    tools: [
      "openreply_list_campaign_templates",
      "openreply_list_campaigns",
      "openreply_get_campaign",
      "openreply_create_campaign",
      "openreply_import_campaigns",
      "openreply_update_campaign",
      "openreply_delete_campaign",
    ],
  },
  {
    title: "Zernio scheduled posts",
    description: "Find future posts and attach an automation before Instagram publication.",
    tools: [
      "openreply_list_zernio_scheduled_posts",
      "openreply_sync_zernio_post",
    ],
  },
  {
    title: "Inbox and replies",
    description: "Read conversations and send explicit Instagram replies within Meta's rules.",
    tools: [
      "openreply_list_conversations",
      "openreply_get_conversation_messages",
      "openreply_send_instagram_message",
      "openreply_reply_to_comment",
    ],
  },
  {
    title: "Workspace access",
    description: "Inspect membership, accept invitations, and administer non-owner members.",
    tools: [
      "openreply_list_workspace_members",
      "openreply_accept_workspace_invitation",
      "openreply_invite_workspace_member",
      "openreply_update_workspace_member_role",
      "openreply_remove_workspace_member",
    ],
  },
] as const;

const toolDirectory = MCP_TOOL_GROUPS.map(
  (group) =>
    `### ${group.title}\n${group.description}\n\n${group.tools.map((tool) => `- \`${tool}\``).join("\n")}`,
).join("\n\n");

export const MCP_AGENT_MARKDOWN = `# OpenReply remote MCP installation and operating guide

Canonical human documentation: ${MCP_DOCS_URL}
Remote MCP endpoint: ${MCP_REMOTE_URL}
Repository: ${OPENREPLY_REPOSITORY_URL}

## Instructions for the AI agent

If a user gives you this document and asks you to install OpenReply MCP, connect their MCP client to the deployed Streamable HTTP endpoint at ${MCP_REMOTE_URL}. This documentation URL is not the transport URL.

Never commit, print, or persist the bearer token in source control or chat transcripts. Ask the user to create a token in OpenReply Settings and place it in the client environment or secret store. Explain any external or destructive action before requesting confirmation.

## What OpenReply MCP controls

OpenReply is a self-hosted Instagram comment-to-DM automation application. Its MCP server can inspect accounts, posts, campaigns, analytics, inbox conversations, delivery logs, worker health, workspace membership, and Zernio scheduled posts. It can also create or change live campaigns and send replies when the caller supplies the tool's explicit \`confirm: true\` argument.

## Prerequisites

- An OpenReply account with membership in the intended workspace.
- An MCP client that supports Streamable HTTP and bearer authentication.
- A revocable token created under OpenReply Settings → Remote MCP access. The plaintext token is shown once.

## Connect the server

1. Ask the user to sign in at ${OPENREPLY_APP_URL} and open Settings.
2. Under **Remote MCP access**, create a named token for this client.
3. Ask the user to store the token as \`OPENREPLY_MCP_TOKEN\` in the MCP client's environment or secret store. Do not ask them to commit it to a repository.
4. Configure the client with the endpoint and bearer-token environment variable.

### Codex config.toml

Codex reads MCP configuration from \`~/.codex/config.toml\` or a trusted project's \`.codex/config.toml\`.

\`\`\`toml
${CODEX_CONFIG}
\`\`\`

Restart Codex after changing configuration. Use \`codex mcp list\` or \`/mcp\` to confirm that the server connected.

### JSON-based MCP clients

\`\`\`json
${GENERIC_MCP_CONFIG}
\`\`\`

The exact format varies by client. If environment interpolation is unsupported, use the client's encrypted secret or credential store to send \`Authorization: Bearer <token>\`. Do not write the token into a tracked settings file.

## Verify before operating

1. Call \`openreply_health\`.
2. Require a successful database check, Redis \`PONG\`, queue counts, and a healthy worker heartbeat.
3. Call \`openreply_list_instagram_accounts\` and verify the intended account before creating a campaign.
4. Start with read tools. Do not infer permission for live writes from a request to inspect or explain.

## Safety contract

- Every token is bound to its issuing OpenReply user and workspace.
- A supplied \`workspaceId\` must match the token's workspace.
- Instagram access tokens are never returned by tools.
- Campaign and workspace writes require the token's user to remain an owner or admin.
- Destructive actions, live automation changes, public replies, and DMs require \`confirm: true\` in the tool call.
- Instagram OAuth is a browser handoff. Get the URL with \`openreply_get_instagram_connect_url\`; do not attempt to collect an Instagram password.
- Tokens are stored as SHA-256 hashes, can be revoked in Settings, and are rate-limited. Remote tool calls are audited without storing their arguments.

## Zernio pre-publication workflow

Use this sequence when the post is scheduled in Zernio but does not exist on Instagram yet:

1. Schedule the Instagram post through Zernio and retain the Zernio post ID.
2. Call \`openreply_sync_zernio_post\` with that provider post ID.
3. Read the returned OpenReply \`scheduledPostId\` and verify its Instagram account mapping and scheduled time.
4. Call \`openreply_create_campaign\` with \`scheduledPostId\`, the desired keywords and messages, and \`confirm: true\`.
5. The campaign remains waiting with no Instagram \`postId\` before publication.
6. After publication, a signed Zernio webhook—or the worker's reconciliation fallback—binds only that campaign to the exact native Instagram media ID.
7. Re-read the campaign and confirm that \`postId\` is populated. Existing campaigns are not modified by this binding flow.

## Tool directory

${toolDirectory}

Tool schemas are authoritative and are advertised by the running MCP server. Inspect a tool's schema before calling it rather than guessing optional fields.

## Troubleshooting

- HTTP 401: create a new token in OpenReply Settings, update \`OPENREPLY_MCP_TOKEN\`, and restart the client. The token may be invalid or revoked.
- HTTP 429: wait for the \`Retry-After\` interval before retrying.
- Workspace mismatch: do not pass a workspace ID from another workspace; the token's workspace is authoritative.
- Writes are rejected: verify the token owner still belongs to the workspace as an owner or admin.
- Worker is unhealthy: repair the always-on worker before expecting DMs or Zernio reconciliation.
- Scheduled posts are absent: confirm Zernio is connected in OpenReply Settings, the account mapping is exact, and \`ZERNIO_INTEGRATION_ENABLED=true\` on both web and worker.
`;

export const MCP_SERVER_INSTRUCTIONS =
  "OpenReply manages a single configured Instagram automation workspace. Start with openreply_health and read tools; verify the account and campaign before writes. Never request Instagram passwords or expose tokens. Live campaign changes, destructive actions, DMs, public replies, and access changes require the tool's confirm:true argument and appropriate user approval. For a future Zernio post: sync its provider ID, create the campaign with scheduledPostId, then let the signed webhook or worker bind the native Instagram postId after publication. Existing campaigns remain independent.";
