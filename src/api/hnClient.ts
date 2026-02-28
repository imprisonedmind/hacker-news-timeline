import type { HNItem } from "../domain/types";
import { debugLog, debugWarn } from "../utils/debugLog";

const API_BASE = "https://hacker-news.firebaseio.com/v0";
const itemPromiseCache = new Map<number, Promise<HNItem | null>>();

async function responseErrorMessage(response: Response, label: string) {
  let body = "";
  try {
    body = (await response.text()).trim();
  } catch {
    body = "";
  }
  const suffix = body ? `: ${body.slice(0, 180)}` : "";
  return `${label} (${response.status} ${response.statusText})${suffix}`;
}

export async function fetchTopStoryIds(): Promise<number[]> {
  debugLog("hnClient", "topstories-request");
  const response = await fetch(`${API_BASE}/topstories.json`);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "Unable to fetch top stories"));
  }
  const payload = (await response.json()) as number[];
  if (!Array.isArray(payload)) {
    throw new Error("Top stories response was not a valid array");
  }
  debugLog("hnClient", "topstories-response", { count: payload.length });
  return payload;
}

export async function fetchItem(id: number): Promise<HNItem | null> {
  const existing = itemPromiseCache.get(id);
  if (existing) {
    debugLog("hnClient", "item-cache-hit", { id });
    return existing;
  }

  const request = fetch(`${API_BASE}/item/${id}.json`)
    .then(async (response) => {
      if (!response.ok) {
        debugWarn("hnClient", "item-non-ok", {
          id,
          status: response.status,
          statusText: response.statusText,
        });
        return null;
      }
      const item = (await response.json()) as HNItem | null;
      debugLog("hnClient", "item-response", { id, hasItem: Boolean(item), type: item?.type ?? null });
      return item;
    })
    .catch((error) => {
      debugWarn("hnClient", "item-request-failed", {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });

  itemPromiseCache.set(id, request);
  debugLog("hnClient", "item-request", { id });
  return request;
}

export async function fetchItemsConcurrently(
  ids: number[],
  concurrency = 8,
): Promise<HNItem[]> {
  const output: HNItem[] = [];
  const queue = [...ids];

  while (queue.length > 0) {
    const batch = queue.splice(0, concurrency);
    const items = await Promise.all(batch.map((id) => fetchItem(id)));
    for (const item of items) {
      if (item) output.push(item);
    }
  }

  return output;
}
