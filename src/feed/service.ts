import { fetchItem, fetchItemsConcurrently, fetchTopStoryIds } from "../api/hnClient";
import { toCommentEntity, toStoryEntity } from "../domain/mappers";
import type { CommentEntity, HNItem, StoryEntity, StoryThread } from "../domain/types";
import { mixFeed } from "./mixer";
import { debugLog, debugWarn } from "../utils/debugLog";

export type FeedSnapshot = {
  stories: StoryEntity[];
  comments: CommentEntity[];
  cachedAt: number;
};

let cache: FeedSnapshot | null = null;
const FEED_STORAGE_KEY = "hn_timeline_feed_snapshot_v1";
const MAX_PERSISTED_COMMENTS = 120;
const storyRootIdsByStoryId = new Map<number, number[]>();

type FeedCommentQueueItem = {
  storyId: number;
  commentId: number;
  depth: number;
};

type FeedCommentSession = {
  storyKey: string;
  storyById: Map<number, StoryEntity>;
  queue: FeedCommentQueueItem[];
  seenCommentIds: Set<number>;
  exhausted: boolean;
};

let feedCommentSession: FeedCommentSession | null = null;
const threadSessionByStoryId = new Map<number, StoryThreadSession>();

type StoryThreadSession = {
  story: StoryEntity;
  queue: number[];
  depthById: Map<number, number>;
  comments: CommentEntity[];
  hasMore: boolean;
};

export type StoryThreadPage = {
  story: StoryEntity;
  comments: CommentEntity[];
  hasMore: boolean;
};

function shouldUseCache(maxAgeMs: number): boolean {
  return Boolean(cache && cache.stories.length > 0 && Date.now() - cache.cachedAt < maxAgeMs);
}

function persistSnapshot(snapshot: FeedSnapshot) {
  try {
    localStorage.setItem(FEED_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage failures.
  }
}

function readPersistedSnapshot(): FeedSnapshot | null {
  try {
    const raw = localStorage.getItem(FEED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FeedSnapshot;
    if (!Array.isArray(parsed.stories) || !Array.isArray(parsed.comments)) return null;
    if (typeof parsed.cachedAt !== "number") return null;
    if (parsed.stories.length === 0) return null;
    return {
      ...parsed,
      stories: parsed.stories.slice(0, 10),
      comments: parsed.comments.slice(0, MAX_PERSISTED_COMMENTS),
    };
  } catch {
    return null;
  }
}

export function getPersistedFeedSnapshot(): FeedSnapshot | null {
  if (cache && cache.stories.length > 0) {
    if (cache.comments.length > MAX_PERSISTED_COMMENTS) {
      cache = {
        ...cache,
        comments: cache.comments.slice(0, MAX_PERSISTED_COMMENTS),
      };
    }
    return cache;
  }
  const persisted = readPersistedSnapshot();
  if (persisted) cache = persisted;
  return persisted;
}

export function getFeedCacheAgeMs(): number | null {
  const snapshot = getPersistedFeedSnapshot();
  if (!snapshot) return null;
  return Date.now() - snapshot.cachedAt;
}

async function fetchStoryComments(
  story: StoryEntity,
  rootCommentIds: number[],
  maxComments: number,
  concurrency = 8,
): Promise<CommentEntity[]> {
  const queue = [...rootCommentIds];
  const comments: CommentEntity[] = [];
  const depthById = new Map<number, number>(rootCommentIds.map((id) => [id, 0]));

  while (queue.length > 0 && comments.length < maxComments) {
    const batch = queue.splice(0, concurrency);
    const items = await Promise.all(batch.map((id) => fetchItem(id)));

    for (const item of items) {
      if (!item) continue;
      const depth = depthById.get(item.id) ?? 0;
      const mapped = toCommentEntity(item, story, depth);
      if (mapped) comments.push(mapped);

      if (item.kids?.length) {
        for (const kid of item.kids) {
          if (!depthById.has(kid)) {
            depthById.set(kid, depth + 1);
            queue.push(kid);
          }
        }
      }
      if (comments.length >= maxComments) break;
    }
  }

  return comments;
}

async function fetchTopStories(limit = 10): Promise<Array<{ story: StoryEntity; raw: HNItem }>> {
  const ids = (await fetchTopStoryIds()).slice(0, limit);
  const items = await fetchItemsConcurrently(ids, 10);
  const storiesWithRaw = items
    .map((item) => {
      const story = toStoryEntity(item);
      return story ? { story, raw: item } : null;
    })
    .filter((entry): entry is { story: StoryEntity; raw: HNItem } => entry !== null);

  storyRootIdsByStoryId.clear();
  for (const { story, raw } of storiesWithRaw) {
    storyRootIdsByStoryId.set(story.id, raw.kids ?? []);
  }

  return storiesWithRaw;
}

async function ensureStoryRootsForStoryIds(storyIds: number[]) {
  const missingStoryIds = storyIds.filter((storyId) => !storyRootIdsByStoryId.has(storyId));

  if (missingStoryIds.length === 0) {
    debugLog("feedService", "roots-ready", { storyCount: storyIds.length });
    return;
  }

  debugLog("feedService", "roots-hydration-start", { missingStoryIds });
  const items = await fetchItemsConcurrently(missingStoryIds, 4);
  for (const item of items) {
    storyRootIdsByStoryId.set(item.id, item.kids ?? []);
  }

  // Guarantee map coverage even for missing/null entries.
  for (const storyId of missingStoryIds) {
    if (!storyRootIdsByStoryId.has(storyId)) {
      storyRootIdsByStoryId.set(storyId, []);
    }
  }
  debugLog("feedService", "roots-hydration-done", {
    hydrated: missingStoryIds.length,
  });
}

export async function getTopStoriesSnapshot(options?: {
  storyLimit?: number;
  cacheMs?: number;
  forceRefresh?: boolean;
}): Promise<FeedSnapshot> {
  const storyLimit = options?.storyLimit ?? 10;
  const cacheMs = options?.cacheMs ?? 120_000;
  const forceRefresh = options?.forceRefresh ?? false;

  if (!forceRefresh && shouldUseCache(cacheMs)) {
    debugLog("feedService", "topstories-cache-hit", {
      storyCount: cache?.stories.length ?? 0,
      cacheAgeMs: cache ? Date.now() - cache.cachedAt : null,
    });
    return cache!;
  }

  const storiesWithRaw = await fetchTopStories(storyLimit);
  if (storiesWithRaw.length === 0) {
    throw new Error(
      "Hacker News returned an empty top stories payload. This can happen during upstream outages or rate limiting.",
    );
  }
  const storyIds = new Set(storiesWithRaw.map((entry) => entry.story.id));
  const reusableComments = forceRefresh
    ? []
    : (cache?.comments ?? []).filter((comment) => storyIds.has(comment.storyId));
  const nextSnapshot: FeedSnapshot = {
    stories: storiesWithRaw.map((entry) => entry.story),
    comments: reusableComments.slice(0, MAX_PERSISTED_COMMENTS),
    cachedAt: Date.now(),
  };
  cache = nextSnapshot;
  persistSnapshot(nextSnapshot);
  debugLog("feedService", "topstories-fetched", {
    storyCount: nextSnapshot.stories.length,
    reusableComments: nextSnapshot.comments.length,
  });
  return nextSnapshot;
}

function getFeedStoryKey(stories: StoryEntity[]) {
  return stories.map((story) => story.id).join(",");
}

export async function primeFeedCommentSession(
  stories: StoryEntity[],
  reset = false,
  options?: { storyIds?: number[]; storyLimit?: number },
) {
  const targetStoryIds =
    options?.storyIds && options.storyIds.length > 0
      ? options.storyIds
      : stories.slice(0, options?.storyLimit ?? 3).map((story) => story.id);
  await ensureStoryRootsForStoryIds(targetStoryIds);

  const storyKey = getFeedStoryKey(stories);
  if (!reset && feedCommentSession && feedCommentSession.storyKey === storyKey) return;

  const queue: FeedCommentQueueItem[] = [];
  const storyById = new Map<number, StoryEntity>(stories.map((story) => [story.id, story]));

  const targetStoryIdSet = new Set(targetStoryIds);
  for (const story of stories) {
    if (!targetStoryIdSet.has(story.id)) continue;
    const roots = storyRootIdsByStoryId.get(story.id) ?? [];
    for (const rootId of roots) {
      queue.push({ storyId: story.id, commentId: rootId, depth: 0 });
    }
  }

  feedCommentSession = {
    storyKey,
    storyById,
    queue,
    seenCommentIds: new Set<number>(),
    exhausted: queue.length === 0,
  };
  debugLog("feedService", "prime-feed-comment-session", {
    storyCount: stories.length,
    targetStoryCount: targetStoryIds.length,
    queueSize: queue.length,
    reset,
  });
}

export async function getNextFeedCommentBatch(options?: {
  batchSize?: number;
  concurrency?: number;
}): Promise<{ comments: CommentEntity[]; hasMore: boolean }> {
  if (!feedCommentSession) {
    debugWarn("feedService", "comment-batch-no-session");
    return { comments: [], hasMore: false };
  }

  const batchSize = options?.batchSize ?? 10;
  const concurrency = options?.concurrency ?? 6;
  const comments: CommentEntity[] = [];

  while (feedCommentSession.queue.length > 0 && comments.length < batchSize) {
    const queueBatch = feedCommentSession.queue.splice(0, concurrency);
    const items = await Promise.all(queueBatch.map((entry) => fetchItem(entry.commentId)));

    for (let i = 0; i < queueBatch.length; i += 1) {
      const queueEntry = queueBatch[i];
      const item = items[i];
      if (!item || feedCommentSession.seenCommentIds.has(queueEntry.commentId)) {
        continue;
      }

      feedCommentSession.seenCommentIds.add(queueEntry.commentId);
      const story = feedCommentSession.storyById.get(queueEntry.storyId);
      if (!story) continue;

      const mapped = toCommentEntity(item, story, queueEntry.depth);
      if (mapped) comments.push(mapped);

      if (item.kids?.length) {
        for (const kid of item.kids) {
          if (!feedCommentSession.seenCommentIds.has(kid)) {
            feedCommentSession.queue.push({
              storyId: queueEntry.storyId,
              commentId: kid,
              depth: queueEntry.depth + 1,
            });
          }
        }
      }

      if (comments.length >= batchSize) break;
    }
  }

  feedCommentSession.exhausted = feedCommentSession.queue.length === 0;
  debugLog("feedService", "comment-batch-result", {
    requestedBatchSize: batchSize,
    returnedComments: comments.length,
    remainingQueue: feedCommentSession.queue.length,
    hasMore: !feedCommentSession.exhausted,
  });
  return { comments, hasMore: !feedCommentSession.exhausted };
}

function mergeCommentsById(current: CommentEntity[], next: CommentEntity[]): CommentEntity[] {
  if (next.length === 0) return current;
  const seen = new Set(current.map((comment) => comment.id));
  const merged = [...current];
  for (const comment of next) {
    if (!seen.has(comment.id)) {
      merged.push(comment);
      seen.add(comment.id);
    }
  }
  return merged;
}

export async function getFeedSnapshot(options?: {
  storyLimit?: number;
  maxCommentsPerStory?: number;
  cacheMs?: number;
}): Promise<FeedSnapshot> {
  const storyLimit = options?.storyLimit ?? 10;
  const maxCommentsPerStory = options?.maxCommentsPerStory ?? 5;
  const cacheMs = options?.cacheMs ?? 60_000;

  const storiesSnapshot = await getTopStoriesSnapshot({
    storyLimit,
    cacheMs,
    forceRefresh: cacheMs === 0,
  });

  await primeFeedCommentSession(storiesSnapshot.stories, cacheMs === 0);

  // Keep this API compatible by loading a bounded comment sample immediately.
  const commentsByStory = await Promise.all(
    storiesSnapshot.stories.map((story) => {
      const roots = (storyRootIdsByStoryId.get(story.id) ?? []).slice(0, maxCommentsPerStory * 2);
      return fetchStoryComments(story, roots, maxCommentsPerStory);
    }),
  );

  const snapshot: FeedSnapshot = {
    stories: storiesSnapshot.stories,
    comments: mergeCommentsById(storiesSnapshot.comments, commentsByStory.flat()),
    cachedAt: Date.now(),
  };
  cache = snapshot;
  persistSnapshot(snapshot);
  return snapshot;
}

export async function getMixedFeed(seed: number) {
  const snapshot = await getFeedSnapshot();
  return mixFeed(snapshot.stories, snapshot.comments, seed);
}

export function updateFeedCacheComments(comments: CommentEntity[]) {
  const current = getPersistedFeedSnapshot();
  if (!current) return;
  const trimmedIncoming = comments.slice(0, MAX_PERSISTED_COMMENTS);
  const updated: FeedSnapshot = {
    ...current,
    comments: mergeCommentsById(current.comments, trimmedIncoming).slice(0, MAX_PERSISTED_COMMENTS),
    cachedAt: Date.now(),
  };
  cache = updated;
  persistSnapshot(updated);
}

const storyRoutePrefetching = new Set<number>();
const commentRoutePrefetching = new Set<number>();
const MAX_STORY_ROUTE_PREFETCHES = 4;
const MAX_COMMENT_ROUTE_PREFETCHES = 8;

export function prefetchStoryRoute(storyId: number) {
  if (storyRoutePrefetching.has(storyId)) {
    debugLog("prefetch", "story-skip-already-prefetched", { storyId });
    return;
  }
  if (storyRoutePrefetching.size >= MAX_STORY_ROUTE_PREFETCHES) {
    debugLog("prefetch", "story-skip-budget-exceeded", {
      storyId,
      budget: MAX_STORY_ROUTE_PREFETCHES,
    });
    return;
  }
  storyRoutePrefetching.add(storyId);
  debugLog("prefetch", "story-start", { storyId });
  void getStoryThreadPage(storyId, { batchSize: 10 })
    .then((result) => {
      debugLog("prefetch", "story-done", {
        storyId,
        hasResult: Boolean(result),
        commentCount: result?.comments.length ?? 0,
      });
    })
    .catch((error) => {
      debugWarn("prefetch", "story-failed", {
        storyId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export function getStoryThreadWarmCount(storyId: number): number {
  return threadSessionByStoryId.get(storyId)?.comments.length ?? 0;
}

export function prefetchCommentRoute(commentId: number, storyId: number) {
  if (commentRoutePrefetching.has(commentId)) {
    debugLog("prefetch", "comment-skip-already-prefetched", { commentId, storyId });
    return;
  }
  if (commentRoutePrefetching.size >= MAX_COMMENT_ROUTE_PREFETCHES) {
    debugLog("prefetch", "comment-skip-budget-exceeded", {
      commentId,
      storyId,
      budget: MAX_COMMENT_ROUTE_PREFETCHES,
    });
    return;
  }
  commentRoutePrefetching.add(commentId);
  debugLog("prefetch", "comment-start", { commentId, storyId });

  // Keep comment prefetch lightweight: warm only the comment item.
  void fetchItem(commentId)
    .then((item) => {
      debugLog("prefetch", "comment-item-done", { commentId, hasItem: Boolean(item) });
    })
    .catch((error) => {
      debugWarn("prefetch", "comment-item-failed", {
        commentId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

async function createStoryThreadSession(storyId: number): Promise<StoryThreadSession | null> {
  const storyItem = await fetchItem(storyId);
  if (!storyItem) return null;
  const story = toStoryEntity(storyItem);
  if (!story) return null;
  const rootIds = storyItem.kids ?? [];
  return {
    story,
    queue: [...rootIds],
    depthById: new Map(rootIds.map((id) => [id, 0])),
    comments: [],
    hasMore: rootIds.length > 0,
  };
}

export async function getStoryThreadPage(
  storyId: number,
  options?: { batchSize?: number; reset?: boolean; concurrency?: number },
): Promise<StoryThreadPage | null> {
  const batchSize = options?.batchSize ?? 20;
  const concurrency = options?.concurrency ?? 8;
  const reset = options?.reset ?? false;

  if (reset) {
    threadSessionByStoryId.delete(storyId);
  }

  let session = threadSessionByStoryId.get(storyId);
  if (!session) {
    const created = await createStoryThreadSession(storyId);
    if (!created) return null;
    session = created;
    threadSessionByStoryId.set(storyId, session);
  }

  let added = 0;
  while (session.queue.length > 0 && added < batchSize) {
    const batch = session.queue.splice(0, concurrency);
    const items = await Promise.all(batch.map((id) => fetchItem(id)));

    for (const item of items) {
      if (!item) continue;
      const depth = session.depthById.get(item.id) ?? 0;
      const mapped = toCommentEntity(item, session.story, depth);
      if (mapped) {
        session.comments.push(mapped);
        added += 1;
      }

      if (item.kids?.length) {
        for (const kid of item.kids) {
          if (!session.depthById.has(kid)) {
            session.depthById.set(kid, depth + 1);
            session.queue.push(kid);
          }
        }
      }

      if (added >= batchSize) break;
    }
  }

  session.hasMore = session.queue.length > 0;
  return {
    story: session.story,
    comments: [...session.comments],
    hasMore: session.hasMore,
  };
}

export async function getStoryThread(
  storyId: number,
  maxComments = 160,
): Promise<StoryThread | null> {
  let page = await getStoryThreadPage(storyId, { batchSize: Math.min(maxComments, 20), reset: true });
  if (!page) return null;

  while (page.hasMore && page.comments.length < maxComments) {
    page = await getStoryThreadPage(storyId, {
      batchSize: Math.min(20, maxComments - page.comments.length),
    });
    if (!page) break;
  }

  if (!page) return null;
  return { story: page.story, comments: page.comments.slice(0, maxComments) };
}

export async function getCommentContext(commentId: number) {
  const selected = await fetchItem(commentId);
  if (!selected || selected.type !== "comment") return null;

  let cursor = selected.parent;
  let guard = 0;
  let storyId: number | null = null;
  const parents: HNItem[] = [];

  while (cursor && guard < 40) {
    const parent = await fetchItem(cursor);
    if (!parent) break;
    parents.push(parent);
    if (parent.type === "story") {
      storyId = parent.id;
      break;
    }
    cursor = parent.parent;
    guard += 1;
  }

  if (!storyId) return null;
  const thread = await getStoryThread(storyId, 220);
  if (!thread) return null;
  return { selectedId: commentId, thread, parents };
}
