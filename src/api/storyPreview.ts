import { debugLog, debugWarn } from "../utils/debugLog";

export type StoryPreview = {
  imageUrl: string | null;
  description: string | null;
};

const previewCache = new Map<string, StoryPreview>();
const PREVIEW_KEY_PREFIX = "hn_story_preview_v1:";

function toStorageKey(url: string) {
  return `${PREVIEW_KEY_PREFIX}${encodeURIComponent(url)}`;
}

function readPreviewFromStorage(url: string): StoryPreview | null {
  try {
    const raw = localStorage.getItem(toStorageKey(url));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoryPreview;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("imageUrl" in parsed) ||
      !("description" in parsed)
    ) {
      return null;
    }
    return {
      imageUrl: parsed.imageUrl ?? null,
      description: parsed.description ?? null,
    };
  } catch {
    debugWarn("storyPreview", "storage-read-failed", { url });
    return null;
  }
}

function writePreviewToStorage(url: string, preview: StoryPreview) {
  try {
    localStorage.setItem(toStorageKey(url), JSON.stringify(preview));
  } catch {
    debugWarn("storyPreview", "storage-write-failed", { url });
    // Ignore storage failures.
  }
}

export function getCachedStoryPreview(url: string | null): StoryPreview | null {
  if (!url) return null;
  const memory = previewCache.get(url);
  if (memory) {
    debugLog("storyPreview", "cache-hit-memory", {
      url,
      hasImage: Boolean(memory.imageUrl),
      hasDescription: Boolean(memory.description),
    });
    return memory;
  }

  const persisted = readPreviewFromStorage(url);
  if (persisted) {
    previewCache.set(url, persisted);
    debugLog("storyPreview", "cache-hit-storage", {
      url,
      hasImage: Boolean(persisted.imageUrl),
      hasDescription: Boolean(persisted.description),
    });
    return persisted;
  }

  debugLog("storyPreview", "cache-miss", { url });
  return null;
}

export function getStoryPreviewFallback(host: string | null): StoryPreview {
  return { imageUrl: host ? `https://logo.clearbit.com/${host}` : null, description: null };
}

function normalizeJinaUrl(url: string) {
  return `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
}

function extractOgFromHtml(html: string): StoryPreview {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const ogImage =
    doc.querySelector('meta[property="og:image"]')?.getAttribute("content") ??
    doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content") ??
    null;

  const description =
    doc.querySelector('meta[property="og:description"]')?.getAttribute("content") ??
    doc.querySelector('meta[name="description"]')?.getAttribute("content") ??
    null;

  return {
    imageUrl: ogImage,
    description: description?.trim() || null,
  };
}

function extractFromJinaMarkdown(markdown: string): StoryPreview {
  const imageMatch = markdown.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i);
  const paragraphs = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 40 && !line.startsWith("Title:") && !line.startsWith("URL Source:"));

  return {
    imageUrl: imageMatch?.[1] ?? null,
    description: paragraphs[0] ?? null,
  };
}

export async function getStoryPreview(url: string, host: string | null): Promise<StoryPreview> {
  const cached = getCachedStoryPreview(url);
  if (cached?.imageUrl) {
    debugLog("storyPreview", "fetch-skip-cached-image", { url });
    return cached;
  }

  let preview: StoryPreview = cached ?? { imageUrl: null, description: null };
  debugLog("storyPreview", "fetch-start", { url, host, cached });

  try {
    const response = await fetch(url);
    if (response.ok) {
      const html = await response.text();
      preview = extractOgFromHtml(html);
      debugLog("storyPreview", "direct-fetch-success", {
        url,
        hasImage: Boolean(preview.imageUrl),
        hasDescription: Boolean(preview.description),
      });
    } else {
      debugWarn("storyPreview", "direct-fetch-non-ok", {
        url,
        status: response.status,
        statusText: response.statusText,
      });
    }
  } catch (error) {
    debugWarn("storyPreview", "direct-fetch-failed", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    // Intentionally ignored: most sites block browser CORS for direct OG scraping.
  }

  if (!preview.imageUrl || !preview.description) {
    try {
      const response = await fetch(normalizeJinaUrl(url));
      if (response.ok) {
        const markdown = await response.text();
        const fallback = extractFromJinaMarkdown(markdown);
        preview = {
          imageUrl: preview.imageUrl ?? fallback.imageUrl,
          description: preview.description ?? fallback.description,
        };
        debugLog("storyPreview", "jina-fetch-success", {
          url,
          hasImage: Boolean(preview.imageUrl),
          hasDescription: Boolean(preview.description),
        });
      } else {
        debugWarn("storyPreview", "jina-fetch-non-ok", {
          url,
          status: response.status,
          statusText: response.statusText,
        });
      }
    } catch (error) {
      debugWarn("storyPreview", "jina-fetch-failed", {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      // ignore
    }
  }

  if (!preview.imageUrl && host) {
    preview.imageUrl = `https://logo.clearbit.com/${host}`;
    debugLog("storyPreview", "fallback-logo-used", { url, host, imageUrl: preview.imageUrl });
  }

  previewCache.set(url, preview);
  writePreviewToStorage(url, preview);
  debugLog("storyPreview", "fetch-complete", {
    url,
    hasImage: Boolean(preview.imageUrl),
    hasDescription: Boolean(preview.description),
    imageUrl: preview.imageUrl,
  });
  return preview;
}
