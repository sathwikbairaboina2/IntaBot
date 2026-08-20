import type { Classification } from "@intabot/shared";

export const REPLY_WRITER = Symbol("REPLY_WRITER");

export class ReplyRefusalError extends Error {
  constructor(readonly category: string) {
    super(`reply refused: ${category}`);
  }
}

export interface ReplyInput {
  commentText: string;
  classification: Classification;
  postCaption: string;
  accountVoice: string;
}

export interface ReplyWriterPort {
  draftReply(input: ReplyInput): Promise<{ text: string }>;
}
