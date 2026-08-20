import type { Classification } from "@intabot/shared";

export const COMMENT_CLASSIFIER = Symbol("COMMENT_CLASSIFIER");

export interface ClassifyInput {
  commentText: string;
  postCaption: string;
  accountVoice: string;
}

export interface CommentClassifierPort {
  classify(input: ClassifyInput): Promise<Classification>;
}
