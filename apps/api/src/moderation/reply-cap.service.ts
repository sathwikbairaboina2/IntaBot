import { Inject, Injectable } from "@nestjs/common";
import type IORedis from "ioredis";
import { REDIS_CONNECTION, queuePrefix } from "../jobs/queue.constants";

export interface CapState {
  postCapReached: boolean;
  accountCapReached: boolean;
}

export interface CapLimits {
  replyCapPerPostPerHour: number;
  replyCapPerAccountPerHour: number;
}

const HOUR_SECONDS = 3600;

/** UTC hour bucket, e.g. 2026-08-21T00. */
function hourBucket(): string {
  return new Date().toISOString().slice(0, 13);
}

/**
 * Hourly auto-reply counters in Redis. Incremented only after a successful
 * reply (or a dry-run reply decision), so escalations and ignores never
 * consume budget. Keys share the queue prefix for per-test-worker isolation.
 */
@Injectable()
export class ReplyCapService {
  constructor(@Inject(REDIS_CONNECTION) private readonly redis: IORedis) {}

  private postKey(postId: string): string {
    return `${queuePrefix()}:mod:cap:post:${postId}:${hourBucket()}`;
  }

  private accountKey(accountId: string): string {
    return `${queuePrefix()}:mod:cap:acct:${accountId}:${hourBucket()}`;
  }

  async check(accountId: string, postId: string, limits: CapLimits): Promise<CapState> {
    const [postCount, accountCount] = await Promise.all([
      this.redis.get(this.postKey(postId)),
      this.redis.get(this.accountKey(accountId)),
    ]);
    return {
      postCapReached: Number(postCount ?? 0) >= limits.replyCapPerPostPerHour,
      accountCapReached: Number(accountCount ?? 0) >= limits.replyCapPerAccountPerHour,
    };
  }

  async increment(accountId: string, postId: string): Promise<void> {
    await Promise.all([
      this.redis.multi().incr(this.postKey(postId)).expire(this.postKey(postId), HOUR_SECONDS).exec(),
      this.redis
        .multi()
        .incr(this.accountKey(accountId))
        .expire(this.accountKey(accountId), HOUR_SECONDS)
        .exec(),
    ]);
  }
}
