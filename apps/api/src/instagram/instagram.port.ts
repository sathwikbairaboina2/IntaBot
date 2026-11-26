import type { Account, PostFormat } from "@intabot/shared";

export const INSTAGRAM_PORT = Symbol("INSTAGRAM_PORT");

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR";

export interface ContainerInput {
  format: PostFormat;
  /** Publicly reachable HTTPS URL. Instagram fetches the media from here. */
  mediaUrl: string;
  caption: string;
  /** Child container ids. Only used when format is CAROUSEL. */
  childContainerIds?: string[];
  isCarouselItem?: boolean;
}

export interface PublishResult {
  igMediaId: string;
  permalink: string;
}

export interface ReplyResult {
  replyId: string;
}

export interface PrivateReplyResult {
  messageId: string;
}

export interface RefreshedToken {
  accessToken: string;
  expiresInSeconds: number;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface InsightPoint {
  date: string;
  metrics: Record<string, number>;
}

export interface InstagramPort {
  createContainer(account: Account, input: ContainerInput): Promise<{ containerId: string }>;
  getContainerStatus(account: Account, containerId: string): Promise<ContainerStatus>;
  publishContainer(account: Account, containerId: string): Promise<PublishResult>;
  replyToComment(account: Account, commentId: string, text: string): Promise<ReplyResult>;
  /** Private reply (DM) to a comment, addressed by the comment id. */
  sendPrivateReply(
    account: Account,
    commentId: string,
    text: string,
  ): Promise<PrivateReplyResult>;
  /** Hides (or unhides) a comment on one of the account's posts. */
  hideComment(account: Account, commentId: string, hidden: boolean): Promise<void>;
  deleteComment(account: Account, commentId: string): Promise<void>;
  /** Exchanges a long-lived Instagram-Login token for a fresh one. Live mode only. */
  refreshAccessToken(account: Account): Promise<RefreshedToken>;
  getAccountInsights(
    account: Account,
    metrics: string[],
    range: DateRange,
  ): Promise<InsightPoint[]>;
  getMediaInsights(account: Account, igMediaId: string): Promise<InsightPoint[]>;
}
