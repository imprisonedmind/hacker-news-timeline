import { useCallback, useEffect, useRef, useState } from "react";
import { CommentCard, StoryCard } from "../components/FeedCard";
import { LoadingSpinner } from "../components/LoadingSpinner";
import type { CommentEntity, FeedEntry, StoryEntity } from "../domain/types";
import { clearHomeSessionState, getHomeSessionState, setHomeSessionState } from "../feed/homeSession";
import {
  getFeedCacheAgeMs,
  getNextFeedCommentBatch,
  getPersistedFeedSnapshot,
  getTopStoriesSnapshot,
  primeFeedCommentSession,
  updateFeedCacheComments,
} from "../feed/service";
import { debugLog, debugWarn } from "../utils/debugLog";

type LoadState = "loading" | "error" | "ready";

const INITIAL_FEED_ITEMS = 6;
const FEED_CACHE_FRESH_MS = 120_000;
const MIX_PATTERN: Array<"story" | "comment"> = [
  "story",
  "comment",
  "story",
  "story",
  "comment",
  "story",
  "comment",
  "story",
];

export function FeedPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [streamingComments, setStreamingComments] = useState(false);
  const [hasMoreComments, setHasMoreComments] = useState(false);
  const [error, setError] = useState<string>("");
  const loadRunRef = useRef(0);
  const streamRunRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const isHydratingRef = useRef(false);
  const feedTailRef = useRef<HTMLDivElement | null>(null);
  const entriesRef = useRef<FeedEntry[]>([]);
  const storyQueueRef = useRef<StoryEntity[]>([]);
  const commentQueueRef = useRef<CommentEntity[]>([]);
  const renderedStoryIdsRef = useRef<Set<number>>(new Set());
  const renderedCommentIdsRef = useRef<Set<number>>(new Set());
  const patternIndexRef = useRef(0);
  const attemptedEmptyRecoveryRef = useRef(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (state === "ready" && entries.length > 0) {
      setHomeSessionState(entries, window.scrollY);
    }
  }, [entries, state]);

  const mergeComments = (current: CommentEntity[], next: CommentEntity[]) => {
    const merged = [...current];
    const seen = new Set(current.map((comment) => comment.id));
    for (const comment of next) {
      if (!seen.has(comment.id)) {
        merged.push(comment);
        seen.add(comment.id);
      }
    }
    return merged;
  };

  const takeNextEntry = useCallback((): FeedEntry | null => {
    const preferred = MIX_PATTERN[patternIndexRef.current % MIX_PATTERN.length];
    patternIndexRef.current += 1;

    const takeStory = () => {
      while (storyQueueRef.current.length > 0) {
        const story = storyQueueRef.current.shift()!;
        if (renderedStoryIdsRef.current.has(story.id)) continue;
        renderedStoryIdsRef.current.add(story.id);
        return { id: `story-${story.id}`, kind: "story", story } as FeedEntry;
      }
      return null;
    };

    const takeComment = () => {
      while (commentQueueRef.current.length > 0) {
        const comment = commentQueueRef.current.shift()!;
        if (renderedCommentIdsRef.current.has(comment.id)) continue;
        renderedCommentIdsRef.current.add(comment.id);
        return { id: `comment-${comment.id}`, kind: "comment", comment } as FeedEntry;
      }
      return null;
    };

    if (preferred === "story") {
      return takeStory() ?? takeComment();
    }
    return takeComment() ?? takeStory();
  }, []);

  const appendEntries = useCallback(
    (count: number) => {
      if (count <= 0) return;
      const current = entriesRef.current;
      const next = [...current];
      for (let i = 0; i < count; i += 1) {
        const entry = takeNextEntry();
        if (!entry) break;
        next.push(entry);
      }
      entriesRef.current = next;
      setEntries(next);
      debugLog("feedPage", "append-entries", {
        requested: count,
        before: current.length,
        after: next.length,
        storyQueue: storyQueueRef.current.length,
        commentQueue: commentQueueRef.current.length,
      });
    },
    [takeNextEntry],
  );

  const initializeQueues = useCallback(
    (stories: StoryEntity[], comments: CommentEntity[], preserveExisting: boolean) => {
      storyQueueRef.current = [...stories];
      commentQueueRef.current = [...comments];

      if (!preserveExisting) {
        renderedStoryIdsRef.current = new Set();
        renderedCommentIdsRef.current = new Set();
        patternIndexRef.current = 0;
        entriesRef.current = [];
        setEntries([]);
        appendEntries(INITIAL_FEED_ITEMS);
        debugLog("feedPage", "initialize-queues-fresh", {
          storyCount: stories.length,
          commentCount: comments.length,
        });
        return;
      }

      const existing = entriesRef.current;
      renderedStoryIdsRef.current = new Set(
        existing
          .filter((entry): entry is Extract<FeedEntry, { kind: "story" }> => entry.kind === "story")
          .map((entry) => entry.story.id),
      );
      renderedCommentIdsRef.current = new Set(
        existing
          .filter((entry): entry is Extract<FeedEntry, { kind: "comment" }> => entry.kind === "comment")
          .map((entry) => entry.comment.id),
      );
      patternIndexRef.current = existing.length;
      debugLog("feedPage", "initialize-queues-preserve", {
        existingEntries: existing.length,
        storyCount: stories.length,
        commentCount: comments.length,
      });
    },
    [appendEntries],
  );

  const loadOneCommentBatch = async (runId: number) => {
    if (isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    const streamRunId = Date.now();
    streamRunRef.current = streamRunId;
    setStreamingComments(true);
    try {
      debugLog("feedPage", "stream-step-start", { runId });
      const { comments, hasMore } = await getNextFeedCommentBatch({
        batchSize: 10,
        concurrency: 6,
      });
      if (runId !== loadRunRef.current) return;

      if (comments.length > 0) {
        const novelComments = mergeComments([], comments);
        commentQueueRef.current.push(...novelComments);
        updateFeedCacheComments(novelComments);
        appendEntries(10);
      }
      setHasMoreComments(hasMore);
      debugLog("feedPage", "stream-step-done", {
        runId,
        receivedComments: comments.length,
        hasMore,
      });
    } finally {
      if (streamRunRef.current === streamRunId) {
        setStreamingComments(false);
      }
      isLoadingMoreRef.current = false;
    }
  };

  const primeVisibleCommentStreaming = async (stories: StoryEntity[], runId: number, reset = false) => {
    const initialStoryIds = entriesRef.current
      .filter((entry): entry is Extract<FeedEntry, { kind: "story" }> => entry.kind === "story")
      .slice(0, 3)
      .map((entry) => entry.story.id);

    await primeFeedCommentSession(stories, reset, {
      storyIds: initialStoryIds,
      storyLimit: 3,
    });

    setHasMoreComments(true);
    debugLog("feedPage", "prime-visible-streaming", {
      runId,
      storyIds: initialStoryIds,
      reset,
    });
  };

  const hydrateFeed = async (options?: { forceRefresh?: boolean; preserveUI?: boolean }) => {
    if (isHydratingRef.current) return;
    isHydratingRef.current = true;

    const forceRefresh = options?.forceRefresh ?? false;
    const preserveUI = options?.preserveUI ?? false;
    const runId = Date.now();
    loadRunRef.current = runId;
    streamRunRef.current = 0;
    isLoadingMoreRef.current = false;
    setStreamingComments(false);
    setHasMoreComments(false);

    if (!preserveUI) {
      setState("loading");
    }
    setError("");

    try {
      debugLog("feedPage", "hydrate-start", { forceRefresh, preserveUI, runId });
      const snapshot = await getTopStoriesSnapshot({
        storyLimit: 10,
        cacheMs: forceRefresh ? 0 : 120_000,
        forceRefresh,
      });
      if (runId !== loadRunRef.current) return;

      initializeQueues(snapshot.stories, snapshot.comments, preserveUI && entriesRef.current.length > 0);
      setState("ready");
      attemptedEmptyRecoveryRef.current = false;
      debugLog("feedPage", "hydrate-ready", {
        runId,
        stories: snapshot.stories.length,
        cachedComments: snapshot.comments.length,
      });

      await primeVisibleCommentStreaming(snapshot.stories, runId, forceRefresh);
      void loadOneCommentBatch(runId);
    } catch (err) {
      if (runId !== loadRunRef.current) return;
      setState("error");
      setError(err instanceof Error ? err.message : "Unknown error");
      setStreamingComments(false);
      setHasMoreComments(false);
      debugWarn("feedPage", "hydrate-error", {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      isHydratingRef.current = false;
    }
  };

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const sessionState = getHomeSessionState();
    if (sessionState && sessionState.entries.length > 0) {
      const runId = Date.now();
      loadRunRef.current = runId;
      streamRunRef.current = 0;
      isLoadingMoreRef.current = false;
      entriesRef.current = sessionState.entries;
      setEntries(sessionState.entries);
      setState("ready");
      requestAnimationFrame(() => {
        window.scrollTo({ top: sessionState.scrollY, left: 0, behavior: "auto" });
      });
      const visibleStories = sessionState.entries
        .filter((entry): entry is Extract<FeedEntry, { kind: "story" }> => entry.kind === "story")
        .map((entry) => entry.story);
      void primeVisibleCommentStreaming(visibleStories, runId);
      return;
    }

    const persisted = getPersistedFeedSnapshot();
    if (persisted) {
      const runId = Date.now();
      loadRunRef.current = runId;
      streamRunRef.current = 0;
      isLoadingMoreRef.current = false;
      initializeQueues(persisted.stories, persisted.comments, false);
      setState("ready");
      const cacheAgeMs = Date.now() - persisted.cachedAt;
      if (cacheAgeMs > FEED_CACHE_FRESH_MS) {
        void hydrateFeed({ preserveUI: true });
      } else {
        debugLog("feedPage", "mount-skip-hydrate-fresh-cache", { cacheAgeMs });
        void primeVisibleCommentStreaming(persisted.stories, runId);
      }
      return;
    }

    void hydrateFeed();
  }, [initializeQueues]);

  useEffect(() => {
    return () => {
      if (entriesRef.current.length > 0) {
        setHomeSessionState(entriesRef.current, window.scrollY);
      }
      loadRunRef.current = -1;
      streamRunRef.current = -1;
      isLoadingMoreRef.current = false;
    };
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const ageMs = getFeedCacheAgeMs();
      if (ageMs === null || ageMs > FEED_CACHE_FRESH_MS) {
        void hydrateFeed({ preserveUI: true });
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const target = feedTailRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entriesList) => {
        const entry = entriesList[0];
        if (!entry?.isIntersecting) return;
        if (state !== "ready" || !hasMoreComments) return;
        void loadOneCommentBatch(loadRunRef.current);
      },
      { rootMargin: "250px 0px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [state, hasMoreComments]);

  useEffect(() => {
    if (state !== "ready" || entries.length > 0 || attemptedEmptyRecoveryRef.current) return;
    attemptedEmptyRecoveryRef.current = true;
    clearHomeSessionState();
    void hydrateFeed({ forceRefresh: true, preserveUI: false });
  }, [state, entries.length]);

  const remix = () => {
    setEntries((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    });
  };

  return (
    <section className="pb-12">
      <header className="sticky top-0 z-10 border-b border-black/10 bg-hn-cream/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold text-hn-ink">HN Timeline</h1>
          <div className="flex items-center gap-3 text-xs">
            <button
              className="text-hn-orange"
              onClick={() => {
                clearHomeSessionState();
                void hydrateFeed({ forceRefresh: true, preserveUI: true });
              }}
            >
              Refresh
            </button>
            <button className="text-hn-orange" onClick={remix}>
              Remix
            </button>
          </div>
        </div>
      </header>

      {state === "loading" && entries.length === 0 && <LoadingSpinner />}

      {state === "error" && (
        <div className="px-4 py-8 text-center">
          <p className="mb-3 text-sm text-red-700">{error}</p>
          <button
            className="rounded-full bg-hn-orange px-4 py-2 text-sm text-white"
            onClick={() => {
              clearHomeSessionState();
              void hydrateFeed({ forceRefresh: true });
            }}
          >
            Try again
          </button>
        </div>
      )}

      {state === "ready" && entries.length === 0 && (
        <div className="px-4 py-8 text-sm text-hn-muted">No stories available right now.</div>
      )}

      {state === "ready" &&
        entries.map((item) =>
          item.kind === "story" ? (
            <StoryCard key={item.id} story={item.story} />
          ) : (
            <CommentCard key={item.id} comment={item.comment} />
          ),
        )}

      {state === "ready" && streamingComments && entries.length === 0 && (
        <LoadingSpinner variant="inline" />
      )}
      <div ref={feedTailRef} className="h-6" />
    </section>
  );
}
