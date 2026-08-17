export const OPENREPLY_REPOSITORY_URL =
  "https://github.com/xolotlwastaken/openreply";
export const OPENREPLY_APP_URL = "https://openreply-coral-six.vercel.app";
export const MCP_DOCS_URL = `${OPENREPLY_APP_URL}/docs/mcp`;
export const MCP_AGENT_DOCS_URL = `${MCP_DOCS_URL}/agent.md`;

export const MCP_INSTALL_PROMPT = `Read ${MCP_AGENT_DOCS_URL} and install the OpenReply MCP server by following it exactly. Use the local stdio setup, keep credentials out of source control, ask me only for values you cannot discover safely, and verify the connection with openreply_health before making changes.`;

export const CODEX_CONFIG = `[mcp_servers.openreply]
command = "npm"
args = ["run", "mcp"]
cwd = "/ABSOLUTE/PATH/TO/openreply"
startup_timeout_sec = 30
tool_timeout_sec = 120

[mcp_servers.openreply.env]
OPENREPLY_MCP_WORKSPACE_ID = "YOUR_WORKSPACE_ID"
OPENREPLY_MCP_USER_ID = "YOUR_USER_ID"`;

export const GENERIC_MCP_CONFIG = `{
  "mcpServers": {
    "openreply": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/ABSOLUTE/PATH/TO/openreply",
      "env": {
        "OPENREPLY_MCP_WORKSPACE_ID": "YOUR_WORKSPACE_ID",
        "OPENREPLY_MCP_USER_ID": "YOUR_USER_ID"
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

export const MCP_AGENT_MARKDOWN = `# OpenReply MCP installation and operating guide

Canonical human documentation: ${MCP_DOCS_URL}
Repository: ${OPENREPLY_REPOSITORY_URL}

## Instructions for the AI agent

If a user gives you this document and asks you to install OpenReply MCP, perform the installation in their authorized local environment. Do not treat this documentation URL as the MCP transport URL. OpenReply MCP is a local stdio server: the agent client starts it with \`npm run mcp\` from a checked-out OpenReply repository.

Preserve any existing checkout changes. Never commit credentials. Ask the user for secrets or identifiers only when they cannot be discovered safely from the authorized environment. Explain any external or destructive action before requesting confirmation.

## What OpenReply MCP controls

OpenReply is a self-hosted Instagram comment-to-DM automation application. Its MCP server can inspect accounts, posts, campaigns, analytics, inbox conversations, delivery logs, worker health, workspace membership, and Zernio scheduled posts. It can also create or change live campaigns and send replies when the caller supplies the tool's explicit \`confirm: true\` argument.

## Prerequisites

- Node.js 22 or newer and npm.
- Git.
- Access to the user's OpenReply checkout or permission to clone it.
- The same \`DATABASE_URL\`, \`REDIS_URL\`, \`NEXTAUTH_URL\`, \`NEXTAUTH_SECRET\`, and \`ENCRYPTION_KEY\` used by the OpenReply application, stored in the checkout's untracked \`.env\` file.
- \`OPENREPLY_MCP_WORKSPACE_ID\` for the single workspace this MCP connection may access.
- \`OPENREPLY_MCP_USER_ID\` for the user whose permissions govern writes. Use an owner or admin ID for management tools.

## Install the server

1. Reuse an existing clean checkout when available. Otherwise clone the maintained fork:

   \`git clone ${OPENREPLY_REPOSITORY_URL}.git\`

2. Enter the checkout and install locked dependencies:

   \`npm ci\`

3. Create an untracked \`.env\` from \`.env.example\` and populate the deployment values. Do not place secrets in MCP config when they can remain in \`.env\`.

4. Identify the workspace and user IDs from the authorized OpenReply database. The \`Workspace.id\` is the workspace ID. Its \`ownerId\`, or the \`User.id\` of an admin member, is the MCP user ID.

5. Add the stdio server to the MCP client using one of the configurations below. Replace every placeholder and use an absolute checkout path.

### Codex config.toml

Codex reads MCP configuration from \`~/.codex/config.toml\` or a trusted project's \`.codex/config.toml\`.

\`\`\`toml
${CODEX_CONFIG}
\`\`\`

Restart the Codex client after changing configuration. Use \`codex mcp list\` or \`/mcp\` to confirm that the server connected.

### JSON-based MCP clients

\`\`\`json
${GENERIC_MCP_CONFIG}
\`\`\`

The exact settings file location varies by client. Preserve the command, arguments, absolute working directory, and the two scoping variables.

## Verify before operating

1. Call \`openreply_health\`.
2. Require a successful database check, Redis \`PONG\`, queue counts, and a healthy worker heartbeat.
3. Call \`openreply_list_instagram_accounts\` and verify the intended account before creating a campaign.
4. Start with read tools. Do not infer permission for live writes from a request to inspect or explain.

## Safety contract

- Every database operation is scoped to \`OPENREPLY_MCP_WORKSPACE_ID\`.
- A supplied \`workspaceId\` must match the configured workspace.
- Instagram access tokens are never returned by tools.
- Campaign and workspace writes require the configured MCP user to be an owner or admin.
- Destructive actions, live automation changes, public replies, and DMs require \`confirm: true\` in the tool call.
- Instagram OAuth is a browser handoff. Get the URL with \`openreply_get_instagram_connect_url\`; do not attempt to collect an Instagram password.
- The server is stdio-only. Do not expose it publicly or convert it to a remote transport without adding request-scoped authentication and authorization.

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

- Server does not start: run \`npm run mcp\` inside the checkout and inspect stderr. Confirm Node, dependencies, and \`.env\`.
- Workspace mismatch: verify \`OPENREPLY_MCP_WORKSPACE_ID\`; do not bypass the scope check.
- Writes are rejected: verify \`OPENREPLY_MCP_USER_ID\` belongs to the workspace as owner or admin.
- Database or Redis fails: use the same reachable URLs as the running OpenReply environment and check VPN/network access.
- Worker is unhealthy: repair the always-on worker before expecting DMs or Zernio reconciliation.
- Scheduled posts are absent: confirm Zernio is connected in OpenReply Settings, the account mapping is exact, and \`ZERNIO_INTEGRATION_ENABLED=true\` on both web and worker.
`;

export const MCP_SERVER_INSTRUCTIONS =
  "OpenReply manages a single configured Instagram automation workspace. Start with openreply_health and read tools; verify the account and campaign before writes. Never request Instagram passwords or expose tokens. Live campaign changes, destructive actions, DMs, public replies, and access changes require the tool's confirm:true argument and appropriate user approval. For a future Zernio post: sync its provider ID, create the campaign with scheduledPostId, then let the signed webhook or worker bind the native Instagram postId after publication. Existing campaigns remain independent.";
