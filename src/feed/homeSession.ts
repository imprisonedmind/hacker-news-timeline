import type { FeedEntry } from "../domain/types";

type HomeSessionState = {
  entries: FeedEntry[];
  scrollY: number;
  savedAt: number;
};

let sessionState: HomeSessionState | null = null;

export function getHomeSessionState(): HomeSessionState | null {
  return sessionState;
}

export function setHomeSessionState(entries: FeedEntry[], scrollY: number) {
  sessionState = {
    entries,
    scrollY,
    savedAt: Date.now(),
  };
}

export function clearHomeSessionState() {
  sessionState = null;
}
