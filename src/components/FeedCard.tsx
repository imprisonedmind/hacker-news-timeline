import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { relativeTime } from "../domain/time";
import type { CommentEntity, StoryEntity } from "../domain/types";
import { prefetchCommentRoute, prefetchStoryRoute } from "../feed/service";
import { debugLog, debugWarn } from "../utils/debugLog";
import { sanitizeHtml } from "../utils/sanitizeHtml";
import { useInView } from "./useInView";
import { useStoryPreview } from "./useStoryPreview";

type StoryCardProps = {
  story: StoryEntity;
};

type CommentCardProps = {
  comment: CommentEntity;
};

export function StoryCard({ story }: StoryCardProps) {
  const { ref, inView } = useInView();
  const preview = useStoryPreview(story.url, story.host, inView);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (!inView) return;
    debugLog("storyCard", "entered-view", { storyId: story.id, url: story.url, host: story.host });
    prefetchStoryRoute(story.id);
  }, [inView, story.id]);

  return (
    <div ref={ref}>
      <Link to={`/post/${story.id}`} className="block select-none">
        <article className="border-b border-black/10 px-4 py-3">
          <header className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-semibold text-hn-ink">@{story.by}</span>
            <span className="text-hn-muted">{relativeTime(story.time)}</span>
            <span className="rounded-full bg-hn-orange/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-hn-orange">
              Story
            </span>
          </header>
          <h2 className="text-[15px] font-semibold leading-5 text-hn-ink">{story.title}</h2>
          {preview.description && (
            <p className="mt-1 line-clamp-2 text-[13px] text-hn-muted">{preview.description}</p>
          )}
          {story.url && (
            <div className="relative mt-3 h-40 overflow-hidden rounded-2xl border border-black/10 bg-black/5">
              {preview.imageUrl && !imageFailed ? (
                <img
                  src={preview.imageUrl}
                  alt={story.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onLoad={() =>
                    debugLog("storyCard", "image-loaded", {
                      storyId: story.id,
                      src: preview.imageUrl,
                    })
                  }
                  onError={() => {
                    setImageFailed(true);
                    debugWarn("storyCard", "image-error", {
                      storyId: story.id,
                      src: preview.imageUrl,
                    });
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-black/[0.07]">
                  <div className="text-center">
                    <p className="text-xs font-semibold uppercase tracking-wide text-hn-muted/80">
                      No preview image
                    </p>
                    {story.host && <p className="mt-1 text-[11px] text-hn-muted/70">{story.host}</p>}
                  </div>
                </div>
              )}
            </div>
          )}
          {story.host && <p className="mt-2 text-xs text-hn-muted">{story.host}</p>}
          <footer className="mt-3 flex items-center gap-4 text-xs text-hn-muted">
            <span>{story.score} points</span>
            <span>{story.commentCount} comments</span>
          </footer>
        </article>
      </Link>
    </div>
  );
}

export function CommentCard({ comment }: CommentCardProps) {
  const { ref, inView } = useInView();
  const commentPreview = sanitizeHtml(comment.textHtml);

  useEffect(() => {
    if (!inView) return;
    debugLog("commentCard", "entered-view", { commentId: comment.id, storyId: comment.storyId });
    prefetchCommentRoute(comment.id, comment.storyId);
  }, [inView, comment.id, comment.storyId]);

  return (
    <div ref={ref}>
      <Link to={`/comment/${comment.id}`} className="block select-none">
        <article className="border-b border-black/10 px-4 py-3">
          <header className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-semibold text-hn-ink">@{comment.by}</span>
            <span className="text-hn-muted">{relativeTime(comment.time)}</span>
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-hn-muted">
              Comment
            </span>
          </header>
        <div
          className="hn-html pointer-events-none line-clamp-4 text-[14px] leading-5 text-hn-ink"
          dangerouslySetInnerHTML={{ __html: commentPreview }}
        />
        <p className="mt-2 truncate text-xs text-hn-muted">in {comment.storyTitle}</p>
      </article>
    </Link>
  </div>
  );
}
