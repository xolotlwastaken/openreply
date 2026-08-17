"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * Post Picker
 *
 * Grid of Instagram post thumbnails, selectable.
 * Fetches from /api/instagram/posts.
 */

import { useEffect, useState } from "react";
import { readCache, writeCache } from "@/lib/client-cache";

interface InstagramPost {
  id: string;
  caption?: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp: string;
}

interface ScheduledPost {
  id: string;
  providerPostId: string;
  title?: string | null;
  content?: string | null;
  scheduledFor?: string | null;
  timezone?: string | null;
  mediaPreviewUrl?: string | null;
  status: string;
}

interface PostPickerProps {
  selectedPostId: string | null;
  selectedScheduledPostId?: string | null;
  instagramAccountId?: string | null;
  /** postId -> name of the campaign already using it. Flagged in the grid. */
  usedPostIds?: Record<string, string>;
  onSelect: (
    postId: string,
    postUrl?: string,
    thumbUrl?: string,
    caption?: string,
    scheduledPostId?: string
  ) => void;
}

export default function PostPicker({
  selectedPostId,
  selectedScheduledPostId,
  instagramAccountId,
  usedPostIds,
  onSelect,
}: PostPickerProps) {
  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // The post currently hovered — its video (if it's a reel) plays a preview.
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (instagramAccountId) {
      params.set("instagramAccountId", instagramAccountId);
    }
    // Load the full library so older posts/reels are selectable, not just the
    // most recent page.
    params.set("all", "true");

    // Show the cached library instantly (stale-while-revalidate), then refresh.
    const cacheKey = `ig-posts:${instagramAccountId ?? "default"}`;
    const cached = readCache<InstagramPost[]>(cacheKey, 15 * 60 * 1000);
    // Hydrating state from cache is a legitimate effect use here.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (cached.data) {
      setPosts(cached.data);
      setLoading(false);
    }
    /* eslint-enable react-hooks/set-state-in-effect */

    fetch(`/api/instagram/posts${params.size ? `?${params}` : ""}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.success) {
          setPosts(data.data);
          writeCache(cacheKey, data.data);
        } else if (!cached.data) {
          setError(data.error ?? "Failed to load posts");
        }
      })
      .catch(() => {
        if (!cancelled && !cached.data) setError("Failed to load posts");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const scheduledParams = new URLSearchParams();
    if (instagramAccountId) {
      scheduledParams.set("instagramAccountId", instagramAccountId);
    }
    fetch(`/api/scheduled-posts${scheduledParams.size ? `?${scheduledParams}` : ""}`, {
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data.success) setScheduledPosts(data.data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [instagramAccountId]);

  if (loading) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="aspect-square rounded bg-surface" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted">{error}</p>
        <p className="text-xs text-zinc-500 mt-1">Connect your Instagram account first</p>
      </div>
    );
  }

  if (posts.length === 0 && scheduledPosts.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted">No posts found</p>
      </div>
    );
  }

  const visible = query.trim()
    ? posts.filter((p) =>
        (p.caption ?? "").toLowerCase().includes(query.trim().toLowerCase())
      )
    : posts;
  const visibleScheduled = query.trim()
    ? scheduledPosts.filter((post) =>
        `${post.title ?? ""} ${post.content ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      )
    : scheduledPosts;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your posts by caption…"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
        />
        <span className="shrink-0 text-xs text-muted">
          {posts.length + scheduledPosts.length}
        </span>
      </div>
      {visible.length === 0 && visibleScheduled.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          No posts match &ldquo;{query}&rdquo;
        </p>
      ) : (
        <>
          {visibleScheduled.length > 0 && (
            <div className="space-y-2">
              <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Scheduled via Zernio
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {visibleScheduled.map((post) => {
                  const selected = selectedScheduledPostId === post.id;
                  return (
                    <button
                      key={post.id}
                      type="button"
                      onClick={() =>
                        onSelect(
                          "",
                          undefined,
                          post.mediaPreviewUrl ?? undefined,
                          post.content ?? post.title ?? undefined,
                          post.id
                        )
                      }
                      className={`flex min-w-0 items-center gap-3 rounded border p-2 text-left transition-colors ${
                        selected
                          ? "border-accent bg-accent/5"
                          : "border-border hover:border-border-hover"
                      }`}
                    >
                      {post.mediaPreviewUrl ? (
                        <img
                          src={post.mediaPreviewUrl}
                          alt="Scheduled Instagram post"
                          className="h-12 w-12 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="grid h-12 w-12 shrink-0 place-items-center rounded bg-surface text-[10px] text-muted">
                          Scheduled
                        </div>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {post.title || post.content || "Scheduled Instagram post"}
                        </span>
                        <span className="mt-1 block text-[11px] text-muted">
                          {post.scheduledFor
                            ? new Date(post.scheduledFor).toLocaleString()
                            : "Waiting for schedule"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {usedPostIds && Object.keys(usedPostIds).length > 0 && (
            <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border border-warning/50" />
              Already used
            </p>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-64 overflow-y-auto p-1">
            {visible.map((post) => {
              const isSelected = selectedPostId === post.id;
              const usedByName = usedPostIds?.[post.id];
              const isUsed = Boolean(usedByName) && !isSelected;
              const thumb = post.thumbnail_url ?? post.media_url;
              const isVideo = post.media_type === "VIDEO";
              const showVideo =
                isVideo && hoveredId === post.id && Boolean(post.media_url);
              return (
          <button
            key={post.id}
            type="button"
            onClick={() => onSelect(post.id, post.permalink, thumb, post.caption)}
            onMouseEnter={() => setHoveredId(post.id)}
            onMouseLeave={() =>
              setHoveredId((cur) => (cur === post.id ? null : cur))
            }
            aria-pressed={isSelected}
            title={isUsed ? `Already used by "${usedByName}"` : undefined}
            className={`
              relative aspect-square rounded overflow-hidden border-2
              ${
                isSelected
                  ? "border-accent"
                  : isUsed
                    ? "border-warning/40 hover:border-warning/60"
                    : "border-border hover:border-border-hover"
              }
            `}
          >
            {thumb ? (
              <img
                src={thumb}
                alt={post.caption?.slice(0, 50) ?? "Instagram post"}
                className={`w-full h-full object-cover ${isUsed ? "opacity-75" : ""}`}
              />
            ) : (
              <div className="w-full h-full bg-surface flex items-center justify-center">
                <span className="text-xs text-muted">No image</span>
              </div>
            )}
            {showVideo && (
              <video
                src={post.media_url}
                poster={thumb}
                autoPlay
                muted
                loop
                playsInline
                preload="none"
                className={`absolute inset-0 h-full w-full object-cover ${
                  isUsed ? "opacity-60" : ""
                }`}
              />
            )}
            {isSelected && (
              <span className="absolute bottom-0 inset-x-0 bg-accent text-white text-xs py-1">
                Selected
              </span>
            )}
          </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
