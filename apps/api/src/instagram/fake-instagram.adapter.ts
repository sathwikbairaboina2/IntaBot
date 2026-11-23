import { Injectable } from "@nestjs/common";
import type { Account } from "@intabot/shared";
import type {
  ContainerInput,
  ContainerStatus,
  DateRange,
  InsightPoint,
  InstagramPort,
  PrivateReplyResult,
  PublishResult,
  ReplyResult,
} from "./instagram.port";

interface FakeContainer {
  id: string;
  accountId: string;
  input: ContainerInput;
  pollsRemaining: number;
  failed: boolean;
  published: boolean;
}

export interface PublishedRecord {
  accountId: string;
  containerId: string;
  igMediaId: string;
  caption: string;
}

export interface ReplyRecord {
  accountId: string;
  commentId: string;
  text: string;
  replyId: string;
}

export interface DmRecord {
  accountId: string;
  commentId: string;
  text: string;
  messageId: string;
}

@Injectable()
export class FakeInstagramAdapter implements InstagramPort {
  private containers = new Map<string, FakeContainer>();
  private published: PublishedRecord[] = [];
  private replies: ReplyRecord[] = [];
  private dms: DmRecord[] = [];
  private dmCounter = 0;
  private counter = 0;
  private processingPolls = 1;
  private nextContainerFails = false;

  /** How many getContainerStatus calls return IN_PROGRESS before FINISHED. */
  setProcessingPolls(n: number): void {
    this.processingPolls = n;
  }

  /** Makes the next created container report ERROR. */
  failNextContainer(_errorCode: string): void {
    this.nextContainerFails = true;
  }

  getPublished(): PublishedRecord[] {
    return [...this.published];
  }

  getReplies(): ReplyRecord[] {
    return [...this.replies];
  }

  getDms(): DmRecord[] {
    return [...this.dms];
  }

  /** Total containers ever created. Used to prove publishing is idempotent. */
  getContainerCount(): number {
    return this.containers.size;
  }

  reset(): void {
    this.containers.clear();
    this.published = [];
    this.replies = [];
    this.dms = [];
    this.dmCounter = 0;
    this.counter = 0;
    this.processingPolls = 1;
    this.nextContainerFails = false;
  }

  async createContainer(account: Account, input: ContainerInput): Promise<{ containerId: string }> {
    const containerId = `fake-container-${++this.counter}`;
    this.containers.set(containerId, {
      id: containerId,
      accountId: account.id,
      input,
      pollsRemaining: this.processingPolls,
      failed: this.nextContainerFails,
      published: false,
    });
    this.nextContainerFails = false;
    return { containerId };
  }

  async getContainerStatus(_account: Account, containerId: string): Promise<ContainerStatus> {
    const container = this.containers.get(containerId);
    if (!container) throw new Error(`unknown container: ${containerId}`);
    if (container.failed) return "ERROR";
    if (container.pollsRemaining > 0) {
      container.pollsRemaining -= 1;
      return "IN_PROGRESS";
    }
    return "FINISHED";
  }

  async publishContainer(account: Account, containerId: string): Promise<PublishResult> {
    const container = this.containers.get(containerId);
    if (!container) throw new Error(`unknown container: ${containerId}`);
    if (container.published) throw new Error(`container already published: ${containerId}`);
    if (container.failed || container.pollsRemaining > 0) {
      throw new Error(`container is not finished: ${containerId}`);
    }

    container.published = true;
    const igMediaId = `fake-media-${this.counter}`;
    this.published.push({
      accountId: account.id,
      containerId,
      igMediaId,
      caption: container.input.caption,
    });
    return { igMediaId, permalink: `https://instagram.test/p/${igMediaId}` };
  }

  async replyToComment(account: Account, commentId: string, text: string): Promise<ReplyResult> {
    const replyId = `fake-reply-${++this.counter}`;
    this.replies.push({ accountId: account.id, commentId, text, replyId });
    return { replyId };
  }

  async sendPrivateReply(
    account: Account,
    commentId: string,
    text: string,
  ): Promise<PrivateReplyResult> {
    const messageId = `fake-dm-${++this.dmCounter}`;
    this.dms.push({ accountId: account.id, commentId, text, messageId });
    return { messageId };
  }

  async getAccountInsights(
    _account: Account,
    metrics: string[],
    range: DateRange,
  ): Promise<InsightPoint[]> {
    return eachDate(range).map((date, index) => ({
      date,
      metrics: Object.fromEntries(metrics.map((m, mi) => [m, 100 + index * 10 + mi])),
    }));
  }

  async getMediaInsights(_account: Account, _igMediaId: string): Promise<InsightPoint[]> {
    const date = new Date().toISOString().slice(0, 10);
    return [{ date, metrics: { plays: 500, likes: 42, comments: 7, saves: 3, reach: 900 } }];
  }
}

function eachDate(range: DateRange): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${range.from}T00:00:00.000Z`);
  const end = new Date(`${range.to}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
