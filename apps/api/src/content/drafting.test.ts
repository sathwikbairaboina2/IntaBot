import { describe, expect, it, vi } from "vitest";
import { FakeCopyWriter } from "./fake-copy-writer";
import { runDrafting, type DraftingDeps } from "./drafting";

function deps(overrides: Partial<DraftingDeps> = {}): DraftingDeps {
  return {
    copyWriter: new FakeCopyWriter(),
    loadAccount: vi.fn(async () => ({
      voice: "warm, plain",
      timezone: "UTC",
      postingWindows: ["09:00"],
    })),
    loadRecentCaptions: vi.fn(async () => ["Older caption."]),
    loadTakenSlots: vi.fn(async () => [] as string[]),
    now: () => new Date("2026-08-17T06:00:00.000Z"),
    ...overrides,
  };
}

const input = { accountId: "acct-1", assetId: "asset-1", format: "IMAGE" as const };

describe("runDrafting", () => {
  it("produces a caption, hashtags, alt text and a slot", async () => {
    const result = await runDrafting(deps(), input);
    expect(result.caption.length).toBeGreaterThan(0);
    expect(result.hashtags.length).toBeGreaterThan(0);
    expect(result.altText.length).toBeGreaterThan(0);
    expect(result.scheduledAt).toBe("2026-08-17T09:00:00.000Z");
    expect(result.needsAttention).toBe(false);
  });

  it("passes the account voice and recent captions to the copy writer", async () => {
    const copyWriter = new FakeCopyWriter();
    const spy = vi.spyOn(copyWriter, "draft");
    await runDrafting(deps({ copyWriter }), input);
    expect(spy.mock.calls[0]?.[0].accountVoice).toBe("warm, plain");
    expect(spy.mock.calls[0]?.[0].recentCaptions).toEqual(["Older caption."]);
  });

  it("still returns a slot when the copy writer refuses, flagged for attention", async () => {
    const copyWriter = new FakeCopyWriter();
    copyWriter.setNextRefusal();
    const result = await runDrafting(deps({ copyWriter }), input);
    expect(result.caption).toBe("");
    expect(result.hashtags).toEqual([]);
    expect(result.needsAttention).toBe(true);
    expect(result.scheduledAt).toBe("2026-08-17T09:00:00.000Z");
  });

  it("avoids a slot that is already taken", async () => {
    const result = await runDrafting(
      deps({
        loadAccount: vi.fn(async () => ({
          voice: "v",
          timezone: "UTC",
          postingWindows: ["09:00", "12:30"],
        })),
        loadTakenSlots: vi.fn(async () => ["2026-08-17T09:00:00.000Z"]),
      }),
      input,
    );
    expect(result.scheduledAt).toBe("2026-08-17T12:30:00.000Z");
  });

  it("propagates a non-refusal copy writer error", async () => {
    const copyWriter = new FakeCopyWriter();
    vi.spyOn(copyWriter, "draft").mockRejectedValue(new Error("network down"));
    await expect(runDrafting(deps({ copyWriter }), input)).rejects.toThrow("network down");
  });
});
