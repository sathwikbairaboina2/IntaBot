import IORedis from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ReplyCapService } from "./reply-cap.service";

const redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
const service = new ReplyCapService(redis);

const caps = { replyCapPerPostPerHour: 2, replyCapPerAccountPerHour: 3 };

describe("ReplyCapService", () => {
  beforeEach(async () => {
    const keys = await redis.keys("*mod:cap:*");
    if (keys.length) await redis.del(...keys);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("reports no caps reached before any replies", async () => {
    const state = await service.check("acct-1", "post-1", caps);
    expect(state).toEqual({ postCapReached: false, accountCapReached: false });
  });

  it("reaches the post cap after enough increments on one post", async () => {
    await service.increment("acct-1", "post-1");
    await service.increment("acct-1", "post-1");
    const state = await service.check("acct-1", "post-1", caps);
    expect(state.postCapReached).toBe(true);
    expect(state.accountCapReached).toBe(false);
  });

  it("reaches the account cap across posts", async () => {
    await service.increment("acct-1", "post-1");
    await service.increment("acct-1", "post-2");
    await service.increment("acct-1", "post-3");
    const state = await service.check("acct-1", "post-4", caps);
    expect(state.postCapReached).toBe(false);
    expect(state.accountCapReached).toBe(true);
  });

  it("sets an expiry on cap keys", async () => {
    await service.increment("acct-1", "post-1");
    const keys = await redis.keys("*mod:cap:*");
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(await redis.ttl(key)).toBeGreaterThan(0);
    }
  });
});
