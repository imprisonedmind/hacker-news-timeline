import { useEffect, useMemo, useState } from "react";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { Link, useParams } from "react-router-dom";
import { relativeTime } from "../domain/time";
import type { CommentEntity } from "../domain/types";
import { getCommentContext } from "../feed/service";
import { sanitizeHtml } from "../utils/sanitizeHtml";

type ViewState = "loading" | "error" | "ready";

export function CommentPage() {
  const params = useParams();
  const commentId = Number(params.id);
  const [state, setState] = useState<ViewState>("loading");
  const [error, setError] = useState("");
  const [comments, setComments] = useState<CommentEntity[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [storyId, setStoryId] = useState<number | null>(null);
  const [storyTitle, setStoryTitle] = useState<string>("");

  useEffect(() => {
    const run = async () => {
      if (!Number.isFinite(commentId)) {
        setState("error");
        setError("Invalid comment ID");
        return;
      }

      setState("loading");
      setError("");

      try {
        const context = await getCommentContext(commentId);
        if (!context) {
          setState("error");
          setError("Comment thread not found");
          return;
        }
        setSelectedId(context.selectedId);
        setComments(context.thread.comments);
        setStoryId(context.thread.story.id);
        setStoryTitle(context.thread.story.title);
        setState("ready");
      } catch (err) {
        setState("error");
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    };

    run();
  }, [commentId]);

  const branch = useMemo(() => {
    if (!selectedId) return [];
    const selected = comments.find((comment) => comment.id === selectedId);
    if (!selected) return [];

    const byParent = new Map<number, CommentEntity[]>();
    for (const comment of comments) {
      const bucket = byParent.get(comment.parentId) ?? [];
      bucket.push(comment);
      byParent.set(comment.parentId, bucket);
    }

    const output: CommentEntity[] = [selected];
    const queue = [...(byParent.get(selected.id) ?? [])];
    while (queue.length) {
      const next = queue.shift()!;
      output.push(next);
      queue.push(...(byParent.get(next.id) ?? []));
    }
    return output;
  }, [comments, selectedId]);

  return (
    <section className="pb-12">
      <header className="sticky top-0 z-10 border-b border-black/10 bg-hn-cream/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <Link className="text-sm font-semibold text-hn-orange" to="/">
            Back
          </Link>
          {storyId && (
            <Link className="text-xs text-hn-orange" to={`/post/${storyId}`}>
              View post
            </Link>
          )}
        </div>
        {storyTitle && <p className="mt-2 truncate text-xs text-hn-muted">{storyTitle}</p>}
      </header>

      {state === "loading" && <LoadingSpinner />}
      {state === "error" && <div className="px-4 py-6 text-sm text-red-700">{error}</div>}

      {state === "ready" &&
        branch.map((comment, index) => (
          <article
            key={comment.id}
            className={`border-b border-black/10 px-4 py-3 ${index === 0 ? "bg-hn-orange/5" : ""}`}
          >
            <p className="mb-1 text-xs text-hn-muted">
              @{comment.by} · {relativeTime(comment.time)}
            </p>
            <div
              className="hn-html text-[14px] leading-5 text-hn-ink"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(comment.textHtml) }}
            />
          </article>
        ))}
    </section>
  );
}
