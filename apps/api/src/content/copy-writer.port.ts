import type { PostFormat } from "@intabot/shared";

export const COPY_WRITER = Symbol("COPY_WRITER");

export interface DraftInput {
  accountVoice: string;
  format: PostFormat;
  recentCaptions: string[];
  mediaMeta: {
    contentType: string;
    widthPx?: number;
    heightPx?: number;
    durationSeconds?: number;
  };
}

export interface DraftOutput {
  caption: string;
  hashtags: string[];
  altText: string;
}

/** The model declined to produce copy. The post still reaches the queue. */
export class CopyWriterRefusalError extends Error {
  constructor(reason: string) {
    super(`copy writer refused: ${reason}`);
  }
}

export interface CopyWriterPort {
  draft(input: DraftInput): Promise<DraftOutput>;
}
