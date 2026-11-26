import { beforeEach, describe, expect, it } from "vitest";
import { AccountSchema } from "@intabot/shared";
import { FakeInstagramAdapter } from "./fake-instagram.adapter";

// Parsed rather than asserted with `satisfies`, so schema defaults such as
// timezone and postingWindows are filled in and this fixture keeps compiling
// as the schema grows.
const account = AccountSchema.parse({
  id: "acct-1",
  name: "Studio Nord",
  igUserId: "17841400000000000",
  username: "studionord",
  status: "ACTIVE",
  accessTokenEncrypted: "v1:a:b:c",
  tokenExpiresAt: "2026-10-13T00:00:00.000Z",
  dryRun: false,
  moderationPaused: false,
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
});

describe("FakeInstagramAdapter", () => {
  let adapter: FakeInstagramAdapter;
  beforeEach(() => {
    adapter = new FakeInstagramAdapter();
  });

  it("creates a container and returns an id", async () => {
    const { containerId } = await adapter.createContainer(account, {
      format: "REEL",
      mediaUrl: "https://example.test/a.mp4",
      caption: "hi",
    });
    expect(containerId).toMatch(/^fake-container-/);
  });

  it("reports IN_PROGRESS for the configured number of polls, then FINISHED", async () => {
    adapter.setProcessingPolls(2);
    const { containerId } = await adapter.createContainer(account, {
      format: "REEL",
      mediaUrl: "https://example.test/a.mp4",
      caption: "hi",
    });
    expect(await adapter.getContainerStatus(account, containerId)).toBe("IN_PROGRESS");
    expect(await adapter.getContainerStatus(account, containerId)).toBe("IN_PROGRESS");
    expect(await adapter.getContainerStatus(account, containerId)).toBe("FINISHED");
  });

  it("reports ERROR when the container is configured to fail", async () => {
    adapter.failNextContainer("MEDIA_TOO_LARGE");
    const { containerId } = await adapter.createContainer(account, {
      format: "IMAGE",
      mediaUrl: "https://example.test/a.jpg",
      caption: "hi",
    });
    expect(await adapter.getContainerStatus(account, containerId)).toBe("ERROR");
  });

  it("publishes a finished container and records it", async () => {
    adapter.setProcessingPolls(0);
    const { containerId } = await adapter.createContainer(account, {
      format: "IMAGE",
      mediaUrl: "https://example.test/a.jpg",
      caption: "hi",
    });
    const result = await adapter.publishContainer(account, containerId);
    expect(result.permalink).toContain("instagram.test");
    expect(adapter.getPublished()).toHaveLength(1);
  });

  it("refuses to publish a container that is still processing", async () => {
    adapter.setProcessingPolls(5);
    const { containerId } = await adapter.createContainer(account, {
      format: "REEL",
      mediaUrl: "https://example.test/a.mp4",
      caption: "hi",
    });
    await expect(adapter.publishContainer(account, containerId)).rejects.toThrow(/not finished/i);
  });

  it("refuses to publish the same container twice", async () => {
    adapter.setProcessingPolls(0);
    const { containerId } = await adapter.createContainer(account, {
      format: "IMAGE",
      mediaUrl: "https://example.test/a.jpg",
      caption: "hi",
    });
    await adapter.publishContainer(account, containerId);
    await expect(adapter.publishContainer(account, containerId)).rejects.toThrow(
      /already published/i,
    );
  });

  it("records comment replies", async () => {
    const { replyId } = await adapter.replyToComment(account, "cmt-1", "Thank you!");
    expect(replyId).toMatch(/^fake-reply-/);
    expect(adapter.getReplies()[0]).toMatchObject({ commentId: "cmt-1", text: "Thank you!" });
  });

  it("records private replies and clears them on reset", async () => {
    const { messageId } = await adapter.sendPrivateReply(account, "cmt-1", "Here is the link");
    expect(messageId).toMatch(/^fake-dm-/);
    expect(adapter.getDms()).toEqual([
      { accountId: "acct-1", commentId: "cmt-1", text: "Here is the link", messageId },
    ]);
    const second = await adapter.sendPrivateReply(account, "cmt-2", "x");
    expect(second.messageId).not.toBe(messageId);
    adapter.reset();
    expect(adapter.getDms()).toEqual([]);
  });

  it("returns deterministic account insights for the requested range", async () => {
    const points = await adapter.getAccountInsights(account, ["reach"], {
      from: "2026-08-01",
      to: "2026-08-03",
    });
    expect(points.map((p) => p.date)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(points[0]?.metrics.reach).toBeTypeOf("number");
  });

  it("records hides and deletes", async () => {
    await adapter.hideComment(account, "c-1", true);
    await adapter.hideComment(account, "c-1", false);
    await adapter.deleteComment(account, "c-2");
    expect(adapter.getHides()).toEqual([
      { accountId: "acct-1", commentId: "c-1", hidden: true },
      { accountId: "acct-1", commentId: "c-1", hidden: false },
    ]);
    expect(adapter.getDeletes()).toEqual([{ accountId: "acct-1", commentId: "c-2" }]);
    adapter.reset();
    expect(adapter.getHides()).toEqual([]);
    expect(adapter.getDeletes()).toEqual([]);
  });

  it("keeps the input of every container, children included", async () => {
    const child = await adapter.createContainer(account, {
      format: "IMAGE",
      mediaUrl: "https://example.test/1.png",
      caption: "",
      isCarouselItem: true,
    });
    const parent = await adapter.createContainer(account, {
      format: "CAROUSEL",
      mediaUrl: "",
      caption: "hi",
      childContainerIds: [child.containerId],
    });
    const inputs = adapter.getContainerInputs();
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({ containerId: child.containerId, isCarouselItem: true });
    expect(inputs[1]).toMatchObject({
      containerId: parent.containerId,
      format: "CAROUSEL",
      childContainerIds: [child.containerId],
    });
  });
});
