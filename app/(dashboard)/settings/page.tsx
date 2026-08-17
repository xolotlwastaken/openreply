"use client";

import { Suspense, useEffect, useState } from "react";
import type { AccountOption } from "@/components/account-select";
import { InstagramConnectNotice } from "@/components/instagram-connect-notice";

interface SettingsData {
  workspace: {
    name: string;
    dmsSentThisPeriod: number;
  };
  instagramAccount: {
    id: string;
    username: string;
    instagramId: string;
    tokenExpiresAt: string | null;
    webhookSubscribed: boolean;
  } | null;
  instagramAccounts: Array<
    AccountOption & {
      tokenExpiresAt: string | null;
      webhookSubscribed: boolean;
    }
  >;
}

interface WorkspaceMembersData {
  currentUserRole: "OWNER" | "ADMIN" | "MEMBER";
  members: Array<{
    id: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    createdAt: string;
    user: {
      id: string;
      email: string | null;
      name: string | null;
    };
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    inviteUrl: string;
    expiresAt: string;
  }>;
}

interface ZernioData {
  id: string;
  enabled: boolean;
  webhookReady: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  mappings: Array<{
    instagramAccountId: string;
    instagramUsername: string;
    zernioAccountId: string;
    zernioUsername: string | null;
  }>;
  instagramAccounts: Array<{ id: string; username: string }>;
  zernioAccounts: Array<{
    id: string;
    username: string | null;
    displayName: string | null;
  }>;
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [membersData, setMembersData] = useState<WorkspaceMembersData | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [zernioData, setZernioData] = useState<ZernioData | null>(null);
  const [zernioAvailable, setZernioAvailable] = useState(true);
  const [zernioApiKey, setZernioApiKey] = useState("");
  const [zernioError, setZernioError] = useState<string | null>(null);
  const [mappingDraft, setMappingDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/stats").then((res) => res.json()),
      fetch("/api/workspace/members").then((res) => res.json()),
      fetch("/api/integrations/zernio", { cache: "no-store" }).then(async (res) => ({
        status: res.status,
        payload: await res.json(),
      })),
    ])
      .then(([statsPayload, membersPayload, zernioResult]) => {
        if (statsPayload.success) setData(statsPayload.data);
        if (membersPayload.success) setMembersData(membersPayload.data);
        if (zernioResult.status === 404) setZernioAvailable(false);
        if (zernioResult.payload.success) {
          const next = zernioResult.payload.data as ZernioData | null;
          setZernioData(next);
          if (next) {
            setMappingDraft(
              Object.fromEntries(
                next.mappings.map((mapping) => [
                  mapping.instagramAccountId,
                  mapping.zernioAccountId,
                ])
              )
            );
          }
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function refreshMembers() {
    const res = await fetch("/api/workspace/members");
    const payload = await res.json();
    if (payload.success) setMembersData(payload.data);
  }

  async function disconnectInstagram(instagramAccountId: string) {
    if (!confirm("Disconnect Instagram? Campaigns for this account will stop sending DMs.")) {
      return;
    }

    setBusy(`disconnect:${instagramAccountId}`);
    await fetch("/api/instagram/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instagramAccountId }),
    });
    window.location.reload();
  }

  async function inviteMember(event: React.FormEvent) {
    event.preventDefault();
    setMemberError(null);
    setBusy("invite");
    const res = await fetch("/api/workspace/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    const payload = await res.json();
    if (payload.success) {
      setMembersData(payload.data);
      setInviteEmail("");
    } else {
      setMemberError(payload.error ?? "Could not invite member");
    }
    setBusy(null);
  }

  async function removeInvitation(invitationId: string) {
    setBusy(`invite:${invitationId}`);
    await fetch("/api/workspace/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invitationId }),
    });
    await refreshMembers();
    setBusy(null);
  }

  async function refreshZernio() {
    const response = await fetch("/api/integrations/zernio", { cache: "no-store" });
    const payload = await response.json();
    if (payload.success) {
      const next = payload.data as ZernioData | null;
      setZernioData(next);
      if (next) {
        setMappingDraft(
          Object.fromEntries(
            next.mappings.map((mapping) => [
              mapping.instagramAccountId,
              mapping.zernioAccountId,
            ])
          )
        );
      }
    }
  }

  async function connectZernio(event: React.FormEvent) {
    event.preventDefault();
    setBusy("zernio-connect");
    setZernioError(null);
    const response = await fetch("/api/integrations/zernio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: zernioApiKey }),
    });
    const payload = await response.json();
    if (payload.success) {
      setZernioApiKey("");
      await refreshZernio();
    } else {
      setZernioError(payload.error ?? "Could not connect Zernio");
    }
    setBusy(null);
  }

  async function saveZernioMappings() {
    setBusy("zernio-map");
    setZernioError(null);
    const mappings = Object.entries(mappingDraft)
      .filter(([, zernioAccountId]) => Boolean(zernioAccountId))
      .map(([instagramAccountId, zernioAccountId]) => ({
        instagramAccountId,
        zernioAccountId,
      }));
    const response = await fetch("/api/integrations/zernio", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappings }),
    });
    const payload = await response.json();
    if (payload.success) await refreshZernio();
    else setZernioError(payload.error ?? "Could not save Zernio mappings");
    setBusy(null);
  }

  async function syncZernio() {
    setBusy("zernio-sync");
    setZernioError(null);
    const response = await fetch("/api/integrations/zernio/sync", { method: "POST" });
    const payload = await response.json();
    if (payload.success) await refreshZernio();
    else setZernioError(payload.error ?? "Zernio sync failed");
    setBusy(null);
  }

  if (loading) {
    return <div className="panel rounded p-8 h-64" />;
  }

  const accounts = data?.instagramAccounts ?? [];
  const canManageMembers =
    membersData?.currentUserRole === "OWNER" ||
    membersData?.currentUserRole === "ADMIN";

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Surfaces the ?instagram= code the OAuth routes redirect back with.
          Needs a Suspense boundary: useSearchParams in a prerendered client
          page fails the production build without one. */}
      <Suspense fallback={null}>
        <InstagramConnectNotice />
      </Suspense>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="text-base font-semibold mb-6">Instagram Connection</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Status</p>
              <p className="text-xs text-muted mt-0.5">
                Comment webhooks and private replies depend on this connection.
              </p>
            </div>
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                accounts.length > 0
                  ? "bg-success/10 text-success"
                  : "bg-warning/10 text-warning"
              }`}
            >
              {accounts.length > 0 ? "Connected" : "Not connected"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 py-3 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Accounts</p>
              <p className="text-xs text-muted mt-0.5">
                {accounts.length} connected Instagram profile
                {accounts.length === 1 ? "" : "s"}
              </p>
            </div>
            <span className="text-sm text-muted">
              {accounts.length > 0 ? `${accounts.length} connected` : "None"}
            </span>
          </div>

          <div className="space-y-3 py-3">
            {accounts.length === 0 && (
              <p className="text-sm text-muted">
                Connect an Instagram professional account to launch campaigns.
              </p>
            )}
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    @{account.username}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Token expires{" "}
                    {account.tokenExpiresAt
                      ? new Date(account.tokenExpiresAt).toLocaleDateString()
                      : "not available"}{" "}
                    · {account.webhookSubscribed ? "Webhook ready" : "Webhook pending"}
                  </p>
                </div>
                <button
                  onClick={() => disconnectInstagram(account.id)}
                  disabled={busy === `disconnect:${account.id}`}
                  className="inline-flex items-center justify-center rounded border border-error/20 px-4 py-2 text-sm font-medium text-error transition-all hover:border-error/40 hover:bg-error/10 disabled:opacity-50"
                >
                  {busy === `disconnect:${account.id}`
                    ? "Disconnecting..."
                    : "Disconnect"}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-border flex gap-3">
          <a
            href="/api/instagram/connect"
            className="px-4 py-2 rounded text-sm font-medium transition-colors bg-accent text-white hover:bg-accent-hover"
          >
            {accounts.length > 0 ? "Connect another account" : "Connect Instagram"}
          </a>
        </div>
      </section>

      {zernioAvailable && (
        <section className="panel rounded p-4 sm:p-6">
          <h2 className="text-base font-semibold">Zernio Scheduled Posts</h2>
          <p className="mt-1 text-xs text-muted">
            Import future Instagram posts and bind waiting automations when Zernio publishes them.
          </p>

          {!zernioData ? (
            <form onSubmit={connectZernio} className="mt-5 space-y-3">
              <label className="block text-sm font-medium text-foreground" htmlFor="zernio-api-key">
                Zernio API key
              </label>
              <input
                id="zernio-api-key"
                type="password"
                autoComplete="off"
                value={zernioApiKey}
                onChange={(event) => setZernioApiKey(event.target.value)}
                placeholder="Paste your Zernio API key"
                className="w-full rounded border border-border bg-surface px-3 py-2 text-sm text-foreground"
                required
              />
              <button
                type="submit"
                disabled={busy === "zernio-connect"}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy === "zernio-connect" ? "Connecting..." : "Connect Zernio"}
              </button>
            </form>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface/70 p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {zernioData.webhookReady ? "Webhook ready" : "Webhook setup incomplete"}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Last synced {zernioData.lastSyncedAt
                      ? new Date(zernioData.lastSyncedAt).toLocaleString()
                      : "never"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={syncZernio}
                  disabled={busy === "zernio-sync"}
                  className="rounded border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50"
                >
                  {busy === "zernio-sync" ? "Syncing..." : "Sync now"}
                </button>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Account mapping
                </p>
                {zernioData.instagramAccounts.map((account) => (
                  <label key={account.id} className="grid gap-2 sm:grid-cols-2 sm:items-center">
                    <span className="text-sm text-foreground">@{account.username}</span>
                    <select
                      value={mappingDraft[account.id] ?? ""}
                      onChange={(event) =>
                        setMappingDraft((current) => ({
                          ...current,
                          [account.id]: event.target.value,
                        }))
                      }
                      className="rounded border border-border bg-surface px-3 py-2 text-sm text-foreground"
                    >
                      <option value="">Choose Zernio account</option>
                      {zernioData.zernioAccounts.map((zernioAccount) => (
                        <option key={zernioAccount.id} value={zernioAccount.id}>
                          {zernioAccount.username || zernioAccount.displayName || zernioAccount.id}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <button
                  type="button"
                  onClick={saveZernioMappings}
                  disabled={busy === "zernio-map"}
                  className="rounded border border-border px-4 py-2 text-sm font-medium text-foreground disabled:opacity-50"
                >
                  {busy === "zernio-map" ? "Saving..." : "Save mapping"}
                </button>
              </div>
            </div>
          )}
          {(zernioError || zernioData?.lastError) && (
            <p className="mt-4 rounded border border-error/20 bg-error/5 p-3 text-sm text-error">
              {zernioError ?? zernioData?.lastError}
            </p>
          )}
        </section>
      )}

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="text-base font-semibold mb-6">Team</h2>
        <div className="space-y-3">
          {membersData?.members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {member.user.name ?? member.user.email ?? "Unknown member"}
                </p>
                <p className="text-xs text-muted">{member.user.email}</p>
              </div>
              <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted">
                {member.role}
              </span>
            </div>
          ))}
        </div>

        {membersData?.invitations.length ? (
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Pending invites
            </p>
            <div className="space-y-3">
              {membersData.invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {invitation.email}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {invitation.role} · {invitation.inviteUrl}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void navigator.clipboard?.writeText(invitation.inviteUrl)
                      }
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => removeInvitation(invitation.id)}
                      disabled={busy === `invite:${invitation.id}`}
                      className="rounded-lg border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {canManageMembers && (
          <form
            onSubmit={inviteMember}
            className="mt-6 grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_140px_auto]"
          >
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@agency.com"
              className="rounded border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
              required
            />
            <select
              value={inviteRole}
              onChange={(event) =>
                setInviteRole(event.target.value as "ADMIN" | "MEMBER")
              }
              className="rounded border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40"
            >
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </select>
            <button
              type="submit"
              disabled={busy === "invite"}
              className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy === "invite" ? "Inviting..." : "Invite"}
            </button>
            {memberError && (
              <p className="sm:col-span-3 text-sm text-error">{memberError}</p>
            )}
          </form>
        )}
      </section>

      <section className="panel rounded p-4 sm:p-6">
        <h2 className="text-base font-semibold mb-6">Usage</h2>
        <div className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              DMs sent this month
            </p>
            <p className="text-xs text-muted mt-0.5">
              Self-hosted — no plan limits.
            </p>
          </div>
          <span className="text-sm font-semibold text-foreground">
            {data?.workspace.dmsSentThisPeriod ?? 0}
          </span>
        </div>
      </section>
    </div>
  );
}
