import { beforeEach, describe, expect, it } from "vitest";
import type { Account } from "@intabot/shared";
import { FakeInstagramAdapter } from "./fake-instagram.adapter";

const account = {
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
} satisfies Account;

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

  it("returns deterministic account insights for the requested range", async () => {
    const points = await adapter.getAccountInsights(account, ["reach"], {
      from: "2026-08-01",
      to: "2026-08-03",
    });
    expect(points.map((p) => p.date)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(points[0]?.metrics.reach).toBeTypeOf("number");
  });
});
