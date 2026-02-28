import type { CommentEntity, FeedEntry, StoryEntity } from "../domain/types";

function seeded(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function shuffle<T>(values: T[], random: () => number): T[] {
  const arr = [...values];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function mixFeed(
  stories: StoryEntity[],
  comments: CommentEntity[],
  seed: number,
  storyRatio = 0.6,
): FeedEntry[] {
  const random = seeded(seed);
  const storyPool = shuffle(stories, random);
  const commentPool = shuffle(comments, random);
  const output: FeedEntry[] = [];

  while (storyPool.length || commentPool.length) {
    const pickStory =
      (storyPool.length > 0 && random() < storyRatio) || commentPool.length === 0;
    if (pickStory && storyPool.length > 0) {
      output.push({ id: `story-${storyPool[0].id}`, kind: "story", story: storyPool.shift()! });
      continue;
    }
    if (commentPool.length > 0) {
      output.push({
        id: `comment-${commentPool[0].id}`,
        kind: "comment",
        comment: commentPool.shift()!,
      });
    }
  }

  return output;
}
