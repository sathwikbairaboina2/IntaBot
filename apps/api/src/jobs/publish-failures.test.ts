import { beforeEach, describe, expect, it } from "vitest";
import { FakeInstagramAdapter } from "../instagram/fake-instagram.adapter";
import { GraphError } from "../instagram/graph-responses";
import { MemoryAccounts, MemoryPosts, makeAccount } from "../../test/memory-stubs";
import { PollContainerProcessor } from "./poll-container.processor";
import { PublishProcessor } from "./publish.processor";

describe("publishing records Graph errors on the post", () => {
  let posts: MemoryPosts;
  let ig: FakeInstagramAdapter;
  let queued: unknown[];
  let publisher: PublishProcessor;
  let poller: PollContainerProcessor;

  beforeEach(() => {
    posts = new MemoryPosts();
    ig = new FakeInstagramAdapter();
    queued = [];
    const accounts = new MemoryAccounts([makeAccount({ dryRun: false })]);
    const pollQueue = { add: async (_n: string, data: unknown) => void queued.push(data) };
    const assets = { get: async (_a: string, id: string) => ({ id, storageKey: `key/${id}` }) };
    const storage = { presignedUrl: async (key: string) => `https://media.test/${key}` };
    const refs = { put: async () => undefined };
    publisher = new PublishProcessor(
      accounts as never,
      posts as never,
      assets as never,
      storage as never,
      ig,
      refs as never,
      pollQueue as never,
    );
    poller = new PollContainerProcessor(accounts as never, posts as never, ig, refs as never, pollQueue as never);
    posts.seed({ id: "p-1", status: "APPROVED" });
  });

  const job = { accountId: "acct-1", postId: "p-1" };

  it("fails the post with code and message when the container call is refused", async () => {
    ig.createContainer = async () => {
      throw new GraphError(190, "Error validating access token", { status: 400, type: "OAuthException" });
    };
    const result = await publisher.process(job);
    expect(result.containerId).toBeNull();
    expect(posts.items.get("p-1")).toMatchObject({
      status: "FAILED",
      failureReason: "graph 190: Error validating access token",
    });
    expect(queued).toHaveLength(0);
  });

  it("fails a carousel whose child container is refused", async () => {
    posts.seed({ id: "p-2", format: "CAROUSEL", mediaAssetIds: ["a-1", "a-2"] });
    ig.createContainer = async () => {
      throw new GraphError(9004, "The media could not be fetched", { status: 400 });
    };
    await publisher.process({ accountId: "acct-1", postId: "p-2" });
    expect(posts.items.get("p-2")).toMatchObject({
      status: "FAILED",
      failureReason: "graph 9004: The media could not be fetched",
    });
  });

  it("does not swallow an error that is not from Instagram", async () => {
    ig.createContainer = async () => {
      throw new Error("redis is down");
    };
    await expect(publisher.process(job)).rejects.toThrow("redis is down");
    expect(posts.items.get("p-1")?.status).toBe("PUBLISHING");
  });

  it("fails the post when the status poll is rate limited", async () => {
    await publisher.process(job);
    ig.getContainerStatus = async () => {
      throw new GraphError(4, "Application request limit reached", { status: 429 });
    };
    expect(await poller.process({ ...job, attempt: 1 })).toBe("failed");
    expect(posts.items.get("p-1")).toMatchObject({
      status: "FAILED",
      failureReason: "graph 4: Application request limit reached",
    });
  });

  it("fails the post when publishing is refused", async () => {
    ig.setProcessingPolls(0);
    await publisher.process(job);
    ig.publishContainer = async () => {
      throw new GraphError(-1, "An unknown error occurred", { status: 500 });
    };
    expect(await poller.process({ ...job, attempt: 1 })).toBe("failed");
    expect(posts.items.get("p-1")).toMatchObject({
      status: "FAILED",
      failureReason: "graph -1: An unknown error occurred",
    });
  });
});
