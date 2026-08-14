import { beforeEach, describe, expect, it } from "vitest";
import { CopyWriterRefusalError } from "./copy-writer.port";
import { FakeCopyWriter } from "./fake-copy-writer";

const input = {
  accountVoice: "warm, plain",
  format: "IMAGE" as const,
  recentCaptions: ["Yesterday's light."],
  mediaMeta: { contentType: "image/jpeg" },
};

describe("FakeCopyWriter", () => {
  let writer: FakeCopyWriter;
  beforeEach(() => {
    writer = new FakeCopyWriter();
  });

  it("returns a deterministic draft", async () => {
    const a = await writer.draft(input);
    const b = await writer.draft(input);
    expect(a).toEqual(b);
    expect(a.caption.length).toBeGreaterThan(0);
    expect(a.altText.length).toBeGreaterThan(0);
  });

  it("returns hashtags without duplicates and each starting with #", async () => {
    const out = await writer.draft(input);
    expect(out.hashtags.every((h) => h.startsWith("#"))).toBe(true);
    expect(new Set(out.hashtags).size).toBe(out.hashtags.length);
  });

  it("varies the caption by format", async () => {
    const image = await writer.draft(input);
    const reel = await writer.draft({ ...input, format: "REEL" });
    expect(image.caption).not.toBe(reel.caption);
  });

  it("throws CopyWriterRefusalError when a refusal is queued", async () => {
    writer.setNextRefusal();
    await expect(writer.draft(input)).rejects.toBeInstanceOf(CopyWriterRefusalError);
  });

  it("only refuses once", async () => {
    writer.setNextRefusal();
    await expect(writer.draft(input)).rejects.toBeInstanceOf(CopyWriterRefusalError);
    await expect(writer.draft(input)).resolves.toBeTruthy();
  });

  it("honours a queued override", async () => {
    writer.setNextOutput({ caption: "Custom." });
    expect((await writer.draft(input)).caption).toBe("Custom.");
  });
});
