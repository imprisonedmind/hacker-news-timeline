export type HNItemType = "job" | "story" | "comment" | "poll" | "pollopt";

export type HNItem = {
  id: number;
  deleted?: boolean;
  type?: HNItemType;
  by?: string;
  time?: number;
  text?: string;
  dead?: boolean;
  parent?: number;
  poll?: number;
  kids?: number[];
  url?: string;
  score?: number;
  title?: string;
  parts?: number[];
  descendants?: number;
};

export type StoryEntity = {
  id: number;
  title: string;
  url: string | null;
  host: string | null;
  by: string;
  score: number;
  time: number;
  commentCount: number;
};

export type CommentEntity = {
  id: number;
  by: string;
  time: number;
  textHtml: string;
  parentId: number;
  storyId: number;
  storyTitle: string;
  depth: number;
};

export type FeedEntry =
  | {
      id: string;
      kind: "story";
      story: StoryEntity;
    }
  | {
      id: string;
      kind: "comment";
      comment: CommentEntity;
    };

export type StoryThread = {
  story: StoryEntity;
  comments: CommentEntity[];
};
