import { useEffect, useRef, useState } from "react";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { Link, useParams } from "react-router-dom";
import { relativeTime } from "../domain/time";
import type { StoryThread } from "../domain/types";
import { getStoryThreadPage, getStoryThreadWarmCount } from "../feed/service";
import { sanitizeHtml } from "../utils/sanitizeHtml";

export function PostPage() {
  const params = useParams();
  const storyId = Number(params.id);
  const [thread, setThread] = useState<StoryThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [hasUserScrolled, setHasUserScrolled] = useState(false);
  const [error, setError] = useState("");
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const run = async () => {
      if (!Number.isFinite(storyId)) {
        setError("Invalid story ID");
        setLoading(false);
        return;
      }
      setLoading(true);
      setHasUserScrolled(false);
      setError("");
      try {
        const warmCount = getStoryThreadWarmCount(storyId);
        const shouldReset = warmCount === 0 || warmCount > 10;
        const data = await getStoryThreadPage(storyId, { batchSize: 10, reset: shouldReset });
        if (!data) {
          setError("Story not found");
          return;
        }
        const initialComments = data.comments.slice(0, 10);
        setThread({ story: data.story, comments: initialComments });
        setHasMore(data.hasMore || data.comments.length > 10);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [storyId]);

  useEffect(() => {
    const onScroll = () => {
      if (window.scrollY > 0) {
        setHasUserScrolled(true);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first.isIntersecting || loading || loadingMore || !hasMore || !hasUserScrolled) {
          return;
        }

        setLoadingMore(true);
        getStoryThreadPage(storyId, { batchSize: 10 })
          .then((nextPage) => {
            if (!nextPage) return;
            setThread({ story: nextPage.story, comments: nextPage.comments });
            setHasMore(nextPage.hasMore);
          })
          .finally(() => setLoadingMore(false));
      },
      { rootMargin: "0px 0px", threshold: 0.01 },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [storyId, loading, loadingMore, hasMore, hasUserScrolled]);

  return (
    <section className="pb-12">
      <header className="sticky top-0 z-10 border-b border-black/10 bg-hn-cream/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link className="text-sm font-semibold text-hn-orange" to="/">
            Back
          </Link>
          <h1 className="text-base font-bold text-hn-ink">Post</h1>
        </div>
      </header>

      {loading && <LoadingSpinner />}
      {error && !loading && <div className="px-4 py-6 text-sm text-red-700">{error}</div>}

      {thread && !loading && (
        <>
          <article className="border-b border-black/10 px-4 py-4">
            <p className="text-xs text-hn-muted">
              @{thread.story.by} · {relativeTime(thread.story.time)}
            </p>
            <h2 className="mt-1 text-[16px] font-bold leading-5">{thread.story.title}</h2>
            <div className="flex items-center gap-4 text-xs text-hn-muted">
              <span>{thread.story.score} points</span>
              <span>{thread.comments.length} comments loaded</span>
              {thread.story.url && (
                <a
                  className="text-hn-orange"
                  href={thread.story.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open link
                </a>
              )}
            </div>
          </article>

          {thread.comments.map((comment) => (
            <Link
              key={comment.id}
              to={`/comment/${comment.id}`}
              className="block border-b border-black/10 px-4 py-3"
            >
              <div className="flex gap-2">
                <div
                  className="mt-1 h-2 w-2 shrink-0 rounded-full bg-hn-orange/60"
                  style={{ marginLeft: `${Math.min(comment.depth * 12, 48)}px` }}
                />
                <div className="min-w-0">
                  <p className="mb-1 text-xs text-hn-muted">
                    @{comment.by} · {relativeTime(comment.time)}
                  </p>
                  <div
                    className="hn-html text-[14px] leading-5 text-hn-ink"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(comment.textHtml) }}
                  />
                </div>
              </div>
            </Link>
          ))}
          <div ref={sentinelRef} className="h-12" />
        </>
      )}
      {thread && !loading && loadingMore && <LoadingSpinner variant="inline" />}
    </section>
  );
}
