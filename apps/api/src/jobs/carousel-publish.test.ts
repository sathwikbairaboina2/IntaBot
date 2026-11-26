import { beforeEach, describe, expect, it } from "vitest";
import type { Account } from "@intabot/shared";
import { FakeInstagramAdapter } from "../instagram/fake-instagram.adapter";
import { MemoryAccounts, MemoryPosts, makeAccount } from "../../test/memory-stubs";
import { PollContainerProcessor } from "./poll-container.processor";
import { PublishProcessor } from "./publish.processor";

interface QueuedJob {
  name: string;
  data: { accountId: string; postId: string; attempt: number };
  opts: { jobId: string; delay: number };
}

describe("carousel and reel publishing", () => {
  let posts: MemoryPosts;
  let ig: FakeInstagramAdapter;
  let queue: QueuedJob[];
  let refs: Map<string, { accountId: string; postId: string }>;
  let publisher: PublishProcessor;
  let poller: PollContainerProcessor;

  function build(account: Account) {
    posts = new MemoryPosts();
    ig = new FakeInstagramAdapter();
    queue = [];
    refs = new Map();
    const accounts = new MemoryAccounts([account]);
    const pollQueue = { add: async (name: string, data: unknown, opts: unknown) => void queue.push({ name, data, opts } as QueuedJob) };
    const assets = {
      get: async (_accountId: string, id: string) => ({ id, storageKey: `key/${id}` }),
    };
    const storage = { presignedUrl: async (key: string) => `https://media.test/${key}` };
    const igMediaRefs = {
      put: async (id: string, ref: { accountId: string; postId: string }) => void refs.set(id, ref),
    };
    publisher = new PublishProcessor(
      accounts as never,
      posts as never,
      assets as never,
      storage as never,
      ig,
      igMediaRefs as never,
      pollQueue as never,
    );
    poller = new PollContainerProcessor(
      accounts as never,
      posts as never,
      ig,
      igMediaRefs as never,
      pollQueue as never,
    );
  }

  const job = { accountId: "acct-1", postId: "p-1" };

  function seedCarousel(extra: Record<string, unknown> = {}) {
    return posts.seed({
      id: "p-1",
      format: "CAROUSEL",
      mediaAssetIds: ["a-1", "a-2", "a-3"],
      caption: "Five roles",
      hashtags: ["#hiring", "#jobs"],
      ...extra,
    });
  }

  /** Runs the queued poll jobs one by one until none are left. */
  async function drainPolls(limit = 30): Promise<string[]> {
    const outcomes: string[] = [];
    while (queue.length > 0 && outcomes.length < limit) {
      const next = queue.shift()!;
      outcomes.push(await poller.process(next.data));
    }
    return outcomes;
  }

  describe("live", () => {
    beforeEach(() => build(makeAccount({ dryRun: false })));

    it("creates one child per image, then the carousel, then publishes", async () => {
      seedCarousel();
      ig.setProcessingPolls(1);
      await publisher.process(job);

      let inputs = ig.getContainerInputs();
      expect(inputs).toHaveLength(3);
      expect(inputs.map((i) => i.mediaUrl)).toEqual([
        "https://media.test/key/a-1",
        "https://media.test/key/a-2",
        "https://media.test/key/a-3",
      ]);
      expect(inputs.every((i) => i.format === "IMAGE" && i.isCarouselItem === true)).toBe(true);
      const stored = posts.items.get("p-1")!;
      expect(stored.status).toBe("PUBLISHING");
      expect(stored.childContainerIds).toEqual(inputs.map((i) => i.containerId));
      expect(stored.containerId).toBeUndefined();
      expect(queue).toHaveLength(1);

      // First poll: children still processing. Second: all finished, carousel created.
      expect(await poller.process(queue.shift()!.data)).toBe("pending");
      expect(ig.getContainerInputs()).toHaveLength(3);
      expect(await poller.process(queue.shift()!.data)).toBe("pending");
      inputs = ig.getContainerInputs();
      expect(inputs).toHaveLength(4);
      expect(inputs[3]).toMatchObject({
        format: "CAROUSEL",
        caption: "Five roles\n\n#hiring #jobs",
        childContainerIds: inputs.slice(0, 3).map((i) => i.containerId),
      });
      expect(posts.items.get("p-1")!.containerId).toBe(inputs[3]!.containerId);

      // Carousel container polls through, then publishes once.
      const rest = await drainPolls();
      expect(rest.at(-1)).toBe("published");
      expect(ig.getPublished()).toHaveLength(1);
      expect(ig.getPublished()[0]!.containerId).toBe(inputs[3]!.containerId);
      const done = posts.items.get("p-1")!;
      expect(done).toMatchObject({ status: "PUBLISHED" });
      expect(done.igMediaId).toMatch(/^fake-media-/);
      expect(refs.get(done.igMediaId!)).toEqual({ accountId: "acct-1", postId: "p-1" });
    });

    it("fails the post with a message when a slide is rejected", async () => {
      seedCarousel();
      ig.failNextContainer("MEDIA_INVALID");
      await publisher.process(job);
      const outcomes = await drainPolls();
      expect(outcomes).toEqual(["failed"]);
      const failed = posts.items.get("p-1")!;
      expect(failed.status).toBe("FAILED");
      expect(failed.failureReason).toBe("instagram rejected carousel slide 1");
      expect(ig.getContainerInputs()).toHaveLength(3);
      expect(ig.getPublished()).toHaveLength(0);
    });

    it("names the rejected slide when a later child fails", async () => {
      seedCarousel({ mediaAssetIds: ["a-1", "a-2"] });
      await publisher.process(job);
      // Break the second child after creation.
      const [, second] = posts.items.get("p-1")!.childContainerIds!;
      const original = ig.getContainerStatus.bind(ig);
      ig.getContainerStatus = async (account, id) => (id === second ? "ERROR" : original(account, id));
      expect(await drainPolls()).toEqual(["failed"]);
      expect(posts.items.get("p-1")!.failureReason).toBe("instagram rejected carousel slide 2");
    });

    it("fails when the carousel container itself errors", async () => {
      seedCarousel({ mediaAssetIds: ["a-1", "a-2"] });
      ig.setProcessingPolls(0);
      await publisher.process(job);
      await poller.process(queue.shift()!.data); // children finished, carousel created
      ig.getContainerStatus = async () => "ERROR";
      expect(await drainPolls()).toEqual(["failed"]);
      expect(posts.items.get("p-1")).toMatchObject({
        status: "FAILED",
        failureReason: "instagram rejected the media container",
      });
    });

    it("gives up on children that never finish", async () => {
      seedCarousel({ mediaAssetIds: ["a-1", "a-2"] });
      ig.setProcessingPolls(1000);
      await publisher.process(job);
      const outcomes = await drainPolls(100);
      expect(outcomes.at(-1)).toBe("failed");
      expect(posts.items.get("p-1")).toMatchObject({ status: "FAILED", failureReason: "container timeout" });
    });

    it("never creates a second set of containers for a duplicated publish job", async () => {
      seedCarousel();
      await publisher.process(job);
      await publisher.process(job);
      expect(ig.getContainerInputs()).toHaveLength(3);
      expect(queue).toHaveLength(1);
    });

    it("publishes a reel as one container from its video", async () => {
      posts.seed({ id: "p-1", format: "REEL", mediaAssetIds: ["v-1"], caption: "Reel", hashtags: [] });
      ig.setProcessingPolls(0);
      await publisher.process(job);
      expect(ig.getContainerInputs()).toEqual([
        expect.objectContaining({ format: "REEL", mediaUrl: "https://media.test/key/v-1" }),
      ]);
      expect(await drainPolls()).toEqual(["published"]);
    });
  });

  describe("dry run", () => {
    beforeEach(() => build(makeAccount({ dryRun: true })));

    it("publishes a carousel with a dryrun id and no Instagram calls", async () => {
      seedCarousel();
      await publisher.process(job);
      expect(ig.getContainerInputs()).toHaveLength(0);
      expect(queue).toHaveLength(0);
      const done = posts.items.get("p-1")!;
      expect(done).toMatchObject({ status: "PUBLISHED", dryRun: true });
      expect(done.igMediaId).toMatch(/^dryrun-/);
    });
  });
});
