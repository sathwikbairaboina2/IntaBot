import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryAccounts, MemoryAudit, MemoryPosts, makeAccount } from "../../test/memory-stubs";
import { PostsController } from "./posts.controller";

const OLD = "2020-01-01T00:00:00.000Z";

describe("PostsController", () => {
  let posts: MemoryPosts;
  let audit: MemoryAudit;
  let controller: PostsController;

  beforeEach(() => {
    posts = new MemoryPosts();
    audit = new MemoryAudit();
    controller = new PostsController(
      posts as never,
      new MemoryAccounts([makeAccount(), makeAccount({ id: "acct-2" })]) as never,
      audit as never,
    );
  });

  it("lists with the lifecycle fields the panel syncs", async () => {
    posts.seed({
      id: "p-1",
      status: "PUBLISHED",
      format: "CAROUSEL",
      keyword: "ZOHO",
      igMediaId: "m-1",
      permalink: "https://instagram.com/p/x",
      source: { app: "control-room", ref: "content-1" },
    });
    const [view] = await controller.list("acct-1", "PUBLISHED");
    expect(view).toMatchObject({
      id: "p-1",
      format: "CAROUSEL",
      keyword: "ZOHO",
      igMediaId: "m-1",
      permalink: "https://instagram.com/p/x",
      source: { app: "control-room", ref: "content-1" },
      error: null,
    });
    expect(view!.scheduledAt).toBeTypeOf("string");
    expect(view!.updatedAt).toBeTypeOf("string");
  });

  it("still requires accountId and a valid status", async () => {
    await expect(controller.list(undefined, "APPROVED")).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list("acct-1", "nope")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("gets one post, finding the account when none is named", async () => {
    posts.seed({ id: "p-2", accountId: "acct-2", status: "FAILED", failureReason: "boom" });
    expect(await controller.one("p-2", "acct-2")).toMatchObject({ id: "p-2", error: "boom" });
    expect(await controller.one("p-2")).toMatchObject({ id: "p-2", accountId: "acct-2" });
    await expect(controller.one("missing")).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.one("p-2", "acct-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  describe("retry", () => {
    it("re-queues a failed post as APPROVED for now, clearing the failure", async () => {
      posts.seed({
        id: "p-1",
        status: "FAILED",
        containerId: "c-1",
        childContainerIds: ["a", "b"],
        failureReason: "container timeout",
        scheduledAt: OLD,
      });
      const before = Date.now();
      const view = await controller.retry("p-1", undefined, { accountId: "acct-1" });
      expect(view).toMatchObject({ status: "APPROVED", error: null });
      expect(view.containerId).toBeUndefined();
      expect(view.childContainerIds).toBeUndefined();
      expect(new Date(view.scheduledAt).getTime()).toBeGreaterThanOrEqual(before);
      expect(audit.entries).toHaveLength(1);
      expect(audit.entries[0]).toMatchObject({
        accountId: "acct-1",
        actor: "human",
        action: "POST_RETRY",
        postId: "p-1",
      });
    });

    it("re-queues a publishing post stuck for more than 15 minutes", async () => {
      posts.seed({ id: "p-1", status: "PUBLISHING" });
      posts.items.set("p-1", { ...posts.items.get("p-1")!, updatedAt: OLD });
      expect(await controller.retry("p-1", "acct-1", undefined)).toMatchObject({ status: "APPROVED" });
    });

    it.each(["PUBLISHING", "APPROVED", "PUBLISHED", "PENDING_APPROVAL", "REJECTED", "DRAFT"] as const)(
      "answers 409 for a fresh %s post",
      async (status) => {
        posts.seed({ id: "p-1", status });
        await expect(controller.retry("p-1", "acct-1", undefined)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(audit.entries).toHaveLength(0);
      },
    );

    it("answers 404 for an unknown post", async () => {
      await expect(controller.retry("nope", "acct-1", undefined)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
