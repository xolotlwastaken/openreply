import type { Metadata } from "next";
import Link from "next/link";
import CopyButton from "@/components/copy-button";
import {
  CODEX_CONFIG,
  GENERIC_MCP_CONFIG,
  MCP_AGENT_DOCS_URL,
  MCP_DOCS_URL,
  MCP_INSTALL_PROMPT,
  MCP_REMOTE_URL,
  MCP_TOOL_GROUPS,
  OPENREPLY_REPOSITORY_URL,
} from "@/lib/mcp-docs";

export const metadata: Metadata = {
  title: "OpenReply MCP Server — Install and Agent Guide",
  description:
    "Connect OpenReply's authenticated remote MCP server to Codex, Claude, Cursor, or another MCP client and safely manage Instagram automations and Zernio scheduled posts.",
  alternates: {
    canonical: "/docs/mcp",
    types: {
      "text/markdown": "/docs/mcp/agent.md",
    },
  },
  openGraph: {
    title: "OpenReply MCP Server",
    description:
      "Agent-first installation and operating documentation for OpenReply MCP.",
    url: "/docs/mcp",
  },
};

const prerequisites = [
  "An OpenReply account with workspace access",
  "An MCP client with Streamable HTTP support",
  "A named access token created in OpenReply Settings",
  "A client environment or secret store for the token",
];

const verificationSteps = [
  ["1", "Check the system", "Call openreply_health and require database, Redis, queue, and worker checks to pass."],
  ["2", "Confirm the account", "Call openreply_list_instagram_accounts before creating or changing a campaign."],
  ["3", "Read before writing", "Inspect the relevant campaign or scheduled post, then present the intended change."],
  ["4", "Confirm live actions", "Supply confirm: true only after the user authorizes an external, destructive, or live automation action."],
] as const;

const zernioSteps = [
  "Schedule the Instagram post in Zernio and retain its provider post ID.",
  "Call openreply_sync_zernio_post with that ID.",
  "Use the returned scheduledPostId in openreply_create_campaign.",
  "Review the waiting campaign before the Instagram post exists.",
  "At publication, the signed webhook binds the exact Instagram media ID. The worker repairs missed events every five minutes.",
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto border border-zinc-800 bg-zinc-950 p-5 text-[13px] leading-6 text-zinc-200">
      <code>{children}</code>
    </pre>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-black tracking-tight text-zinc-950 sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-base leading-7 text-zinc-600">{description}</p>
    </div>
  );
}

export default function McpDocsPage() {
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-5">
            <Link href="/" className="text-lg font-black text-zinc-950">
              OpenReply
            </Link>
            <span className="hidden h-5 w-px bg-zinc-200 sm:block" />
            <span className="hidden text-sm font-semibold text-zinc-500 sm:block">
              MCP documentation
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/docs/mcp/agent.md"
              className="hidden border border-zinc-200 px-4 py-2 text-sm font-bold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 sm:inline-flex"
            >
              Raw Markdown
            </a>
            <a
              href={OPENREPLY_REPOSITORY_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex bg-zinc-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-zinc-800"
            >
              GitHub
            </a>
          </div>
        </div>
      </header>

      <section className="border-b border-zinc-200 bg-zinc-50">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-24">
          <div>
            <div className="inline-flex border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-orange-700">
              Built for AI agents
            </div>
            <h1 className="mt-6 max-w-4xl text-5xl font-black leading-[1.02] tracking-tight text-zinc-950 sm:text-6xl">
              Give your coding agent control of OpenReply
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-600">
              Connect the hosted MCP endpoint once, then let Codex, Claude,
              Cursor, or another MCP client inspect campaigns, schedule Zernio-backed
              automations, check delivery health, and manage Instagram workflows.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <CopyButton
                value={MCP_INSTALL_PROMPT}
                label="Copy agent install prompt"
                copiedLabel="Install prompt copied"
                className="inline-flex items-center justify-center bg-orange-500 px-6 py-3 text-sm font-bold text-white transition hover:bg-orange-600"
              />
              <a
                href="/docs/mcp/agent.md"
                className="inline-flex items-center justify-center border border-zinc-300 bg-white px-6 py-3 text-sm font-bold text-zinc-900 transition hover:bg-zinc-100"
              >
                Open agent-readable guide
              </a>
            </div>
          </div>

          <div className="border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                  Share this URL with an agent
                </p>
                <p className="mt-3 break-all font-mono text-sm leading-6 text-zinc-950">
                  {MCP_AGENT_DOCS_URL}
                </p>
              </div>
              <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
            </div>
            <CopyButton
              value={MCP_AGENT_DOCS_URL}
              label="Copy documentation URL"
              copiedLabel="URL copied"
              className="mt-5 w-full border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm font-bold text-zinc-800 transition hover:bg-zinc-100"
            />
            <div className="mt-6 border-l-2 border-amber-400 bg-amber-50 px-4 py-3">
              <p className="text-sm font-bold text-amber-950">Authenticated remote server</p>
              <p className="mt-1 text-sm leading-6 text-amber-900/75">
                The guide tells the agent how to connect. The transport endpoint is{" "}
                <span className="break-all font-mono">{MCP_REMOTE_URL}</span> and requires a revocable token.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid w-full max-w-7xl gap-12 px-5 py-16 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:px-8">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 border-l border-zinc-200 pl-5" aria-label="MCP documentation sections">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-400">
              On this page
            </p>
            <div className="mt-4 grid gap-3 text-sm font-semibold text-zinc-600">
              <a href="#install" className="hover:text-orange-600">Install</a>
              <a href="#configure" className="hover:text-orange-600">Configure</a>
              <a href="#verify" className="hover:text-orange-600">Verify</a>
              <a href="#tools" className="hover:text-orange-600">Tools</a>
              <a href="#zernio" className="hover:text-orange-600">Zernio workflow</a>
              <a href="#security" className="hover:text-orange-600">Security</a>
              <a href="#troubleshooting" className="hover:text-orange-600">Troubleshooting</a>
            </div>
          </nav>
        </aside>

        <div className="min-w-0 space-y-20">
          <section id="install" className="scroll-mt-24">
            <SectionHeading
              eyebrow="01 — Install"
              title="Create a revocable access token"
              description="Sign in to OpenReply, open Settings, and create a named token under Remote MCP access. The token is bound to your user and workspace and is displayed only once."
            />

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {prerequisites.map((item) => (
                <div key={item} className="border border-zinc-200 bg-zinc-50 p-4 text-sm font-semibold leading-6 text-zinc-700">
                  {item}
                </div>
              ))}
            </div>

            <div className="mt-8 border border-zinc-200 bg-zinc-50 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-zinc-950">Remote endpoint</p>
                  <p className="mt-2 break-all font-mono text-sm text-zinc-700">{MCP_REMOTE_URL}</p>
                </div>
                <CopyButton value={MCP_REMOTE_URL} label="Copy URL" className="shrink-0 text-sm font-bold text-orange-600 hover:text-orange-700" />
              </div>
              <p className="mt-4 text-sm leading-6 text-zinc-600">
                Store the one-time token as <code className="bg-white px-1.5 py-1 font-mono text-xs text-zinc-900">OPENREPLY_MCP_TOKEN</code> in your MCP client environment. Never commit it.
              </p>
            </div>
          </section>

          <section id="configure" className="scroll-mt-24">
            <SectionHeading
              eyebrow="02 — Configure"
              title="Connect with bearer authentication"
              description="The access token determines the user, workspace, and role automatically. No database credentials, user IDs, repository checkout, or local server process are required."
            />

            <div className="mt-8 border border-zinc-200">
              <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-5 py-4">
                <div>
                  <p className="font-bold text-zinc-950">Codex</p>
                  <p className="mt-1 text-sm text-zinc-500">~/.codex/config.toml or a trusted project config</p>
                </div>
                <CopyButton value={CODEX_CONFIG} label="Copy TOML" className="text-sm font-bold text-orange-600 hover:text-orange-700" />
              </div>
              <CodeBlock>{CODEX_CONFIG}</CodeBlock>
            </div>

            <div className="mt-6 border border-zinc-200">
              <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-5 py-4">
                <div>
                  <p className="font-bold text-zinc-950">Claude, Cursor, and JSON clients</p>
                  <p className="mt-1 text-sm text-zinc-500">Use the MCP settings file supported by the client</p>
                </div>
                <CopyButton value={GENERIC_MCP_CONFIG} label="Copy JSON" className="text-sm font-bold text-orange-600 hover:text-orange-700" />
              </div>
              <CodeBlock>{GENERIC_MCP_CONFIG}</CodeBlock>
            </div>

            <p className="mt-5 text-sm leading-6 text-zinc-600">
              Restart the MCP client after saving. In Codex, run{" "}
              <code className="bg-zinc-100 px-1.5 py-1 font-mono text-xs text-zinc-900">codex mcp list</code>{" "}
              or use <code className="bg-zinc-100 px-1.5 py-1 font-mono text-xs text-zinc-900">/mcp</code> to inspect the connection.
            </p>
          </section>

          <section id="verify" className="scroll-mt-24">
            <SectionHeading
              eyebrow="03 — Verify"
              title="Teach the agent a safe operating sequence"
              description="A successful MCP connection is not enough. The agent should verify infrastructure, account identity, and current campaign state before it changes anything live."
            />
            <ol className="mt-8 grid gap-px overflow-hidden border border-zinc-200 bg-zinc-200">
              {verificationSteps.map(([number, title, body]) => (
                <li key={number} className="grid gap-4 bg-white p-5 sm:grid-cols-[44px_180px_1fr] sm:items-start">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-100 text-sm font-black text-orange-700">
                    {number}
                  </span>
                  <p className="pt-1.5 font-bold text-zinc-950">{title}</p>
                  <p className="text-sm leading-6 text-zinc-600 sm:pt-1.5">{body}</p>
                </li>
              ))}
            </ol>
          </section>

          <section id="tools" className="scroll-mt-24">
            <SectionHeading
              eyebrow="04 — Tool directory"
              title="What an agent can do"
              description="The running server advertises authoritative input schemas for every tool. Agents should inspect those schemas instead of inventing arguments."
            />
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {MCP_TOOL_GROUPS.map((group) => (
                <article key={group.title} className="border border-zinc-200 p-5">
                  <h3 className="text-lg font-black text-zinc-950">{group.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">{group.description}</p>
                  <ul className="mt-4 space-y-2">
                    {group.tools.map((tool) => (
                      <li key={tool} className="break-all font-mono text-xs leading-5 text-zinc-700">
                        {tool}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section id="zernio" className="scroll-mt-24">
            <SectionHeading
              eyebrow="05 — Zernio"
              title="Build the automation before the post publishes"
              description="The scheduled-post record gives OpenReply a stable target before Instagram has assigned a media ID. Publication later fills that exact ID without changing unrelated campaigns."
            />
            <ol className="mt-8 border border-zinc-200 bg-zinc-50 p-6 sm:p-8">
              {zernioSteps.map((step, index) => (
                <li key={step} className="grid grid-cols-[32px_1fr] gap-3 border-b border-zinc-200 py-4 first:pt-0 last:border-0 last:pb-0">
                  <span className="font-mono text-sm font-bold text-orange-600">{String(index + 1).padStart(2, "0")}</span>
                  <p className="text-sm leading-6 text-zinc-700">{step}</p>
                </li>
              ))}
            </ol>
          </section>

          <section id="security" className="scroll-mt-24">
            <SectionHeading
              eyebrow="06 — Security"
              title="Revocable, role-aware access"
              description="Every request is authenticated to an OpenReply user and workspace. The server applies the same membership roles as the dashboard and adds rate limits and tool-call auditing."
            />
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {[
                ["Workspace isolation", "Every token is permanently scoped to the workspace that issued it."],
                ["Role-aware writes", "Campaign and access changes require the token owner to remain an owner or admin."],
                ["Explicit confirmation", "Live changes, destructive actions, DMs, and public replies require confirm: true."],
                ["Revocable credentials", "MCP tokens are stored as hashes, shown once, rate-limited, audited, and revocable in Settings."],
              ].map(([title, body]) => (
                <article key={title} className="border-l-2 border-emerald-500 bg-emerald-50 p-5">
                  <h3 className="font-black text-emerald-950">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-emerald-900/75">{body}</p>
                </article>
              ))}
            </div>
          </section>

          <section id="troubleshooting" className="scroll-mt-24">
            <SectionHeading
              eyebrow="07 — Troubleshooting"
              title="Fast checks when the client does not connect"
              description="The endpoint uses standard Streamable HTTP with bearer authentication. Connection failures usually come from a missing, revoked, or stale client token."
            />
            <div className="mt-8">
              <CodeBlock>{`curl -i ${MCP_REMOTE_URL}\
  -H "Authorization: Bearer $OPENREPLY_MCP_TOKEN"`}</CodeBlock>
            </div>
            <div className="mt-5 space-y-3 text-sm leading-6 text-zinc-600">
              <p><strong className="text-zinc-950">HTTP 401:</strong> create a new token in Settings, update the client secret, and restart the client.</p>
              <p><strong className="text-zinc-950">HTTP 429:</strong> wait for the Retry-After interval before reconnecting.</p>
              <p><strong className="text-zinc-950">Writes rejected:</strong> confirm the token owner is still an owner or admin member.</p>
              <p><strong className="text-zinc-950">Scheduled posts absent:</strong> verify the Zernio connection, exact account mapping, and feature flag on both web and worker.</p>
              <p><strong className="text-zinc-950">Worker unhealthy:</strong> repair the Railway worker before expecting DMs or publication reconciliation.</p>
            </div>
          </section>

          <section className="border border-orange-200 bg-orange-50 p-6 sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-700">
              Ready to hand off
            </p>
            <h2 className="mt-3 text-3xl font-black text-zinc-950">
              Give the agent one URL
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-700">
              The raw guide is self-contained. Copy the prompt below into a coding-agent task, then create a one-time token in OpenReply Settings when the agent asks for it.
            </p>
            <div className="mt-5 border border-orange-200 bg-white p-5 font-mono text-sm leading-6 text-zinc-700">
              {MCP_INSTALL_PROMPT}
            </div>
            <CopyButton
              value={MCP_INSTALL_PROMPT}
              label="Copy install prompt"
              copiedLabel="Prompt copied"
              className="mt-4 bg-zinc-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-zinc-800"
            />
          </section>
        </div>
      </div>

      <footer className="border-t border-zinc-200 bg-zinc-50 py-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-5 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span className="font-semibold text-zinc-700">OpenReply MCP</span>
          <div className="flex gap-5">
            <a href={MCP_DOCS_URL} className="hover:text-zinc-950">Canonical docs</a>
            <a href="/llms.txt" className="hover:text-zinc-950">llms.txt</a>
            <a href={OPENREPLY_REPOSITORY_URL} className="hover:text-zinc-950">Source</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
