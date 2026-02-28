import type { CommentEntity, HNItem, StoryEntity } from "./types";

function parseHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function toStoryEntity(item: HNItem): StoryEntity | null {
  if (item.type !== "story" || !item.title || !item.by || !item.time) {
    return null;
  }

  return {
    id: item.id,
    title: item.title,
    url: item.url ?? null,
    host: item.url ? parseHost(item.url) : null,
    by: item.by,
    score: item.score ?? 0,
    time: item.time,
    commentCount: item.descendants ?? item.kids?.length ?? 0,
  };
}

export function toCommentEntity(
  item: HNItem,
  story: StoryEntity,
  depth: number,
): CommentEntity | null {
  if (
    item.type !== "comment" ||
    item.deleted ||
    item.dead ||
    !item.by ||
    !item.time ||
    !item.text ||
    !item.parent
  ) {
    return null;
  }

  return {
    id: item.id,
    by: item.by,
    time: item.time,
    textHtml: item.text,
    parentId: item.parent,
    storyId: story.id,
    storyTitle: story.title,
    depth,
  };
}
