import { useEffect, useState } from "react";
import {
  getCachedStoryPreview,
  getStoryPreview,
  getStoryPreviewFallback,
  type StoryPreview,
} from "../api/storyPreview";
import { debugLog, debugWarn } from "../utils/debugLog";

function samePreview(a: StoryPreview, b: StoryPreview) {
  return a.imageUrl === b.imageUrl && a.description === b.description;
}

export function useStoryPreview(url: string | null, host: string | null, enabled = true) {
  const [preview, setPreview] = useState<StoryPreview>(
    () => getCachedStoryPreview(url) ?? getStoryPreviewFallback(host),
  );

  useEffect(() => {
    let active = true;
    if (!enabled) {
      debugLog("useStoryPreview", "disabled-skip", { url, host });
      return;
    }

    const cached = getCachedStoryPreview(url);
    const next = cached ?? getStoryPreviewFallback(host);
    setPreview((prev) => (samePreview(prev, next) ? prev : next));
    debugLog("useStoryPreview", "init", {
      url,
      host,
      hasCached: Boolean(cached),
      cachedHasImage: Boolean(cached?.imageUrl),
      cachedHasDescription: Boolean(cached?.description),
    });

    if (!url) {
      debugLog("useStoryPreview", "skip-no-url", { host });
      return;
    }

    // Only skip network if we already have a concrete image URL.
    if (cached?.imageUrl) {
      debugLog("useStoryPreview", "skip-network-cached-image", { url, imageUrl: cached.imageUrl });
      return;
    }

    getStoryPreview(url, host)
      .then((data) => {
        if (active) {
          setPreview((prev) => (samePreview(prev, data) ? prev : data));
          debugLog("useStoryPreview", "resolved", {
            url,
            hasImage: Boolean(data.imageUrl),
            hasDescription: Boolean(data.description),
            imageUrl: data.imageUrl,
          });
        }
      })
      .catch((error) => {
        if (active) {
          const fallback = getCachedStoryPreview(url) ?? getStoryPreviewFallback(host);
          setPreview((prev) => (samePreview(prev, fallback) ? prev : fallback));
          debugWarn("useStoryPreview", "fetch-error", {
            url,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      active = false;
      debugLog("useStoryPreview", "cleanup", { url });
    };
  }, [url, host, enabled]);

  return preview;
}
