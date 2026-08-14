import { describe, expect, it, vi } from "vitest";
import { CopyWriterRefusalError } from "./copy-writer.port";
import { AnthropicCopyWriter, buildDraftPrompt } from "./anthropic-copy-writer";

const input = {
  accountVoice: "warm, plain",
  format: "REEL" as const,
  recentCaptions: ["Yesterday's light."],
  mediaMeta: { contentType: "video/mp4", durationSeconds: 12 },
};

describe("buildDraftPrompt", () => {
  it("includes the voice, the format and the recent captions", () => {
    const prompt = buildDraftPrompt(input);
    expect(prompt).toContain("warm, plain");
    expect(prompt).toContain("REEL");
    expect(prompt).toContain("Yesterday's light.");
  });

  it("tells the model not to repeat recent captions", () => {
    expect(buildDraftPrompt(input).toLowerCase()).toContain("do not repeat");
  });
});

describe("AnthropicCopyWriter", () => {
  function writerWith(create: ReturnType<typeof vi.fn>) {
    return new AnthropicCopyWriter({ messages: { create } } as never, "claude-opus-5");
  }

  it("returns the parsed structured output", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            caption: "Light through the window.",
            hashtags: ["#studio"],
            altText: "Sunlight across a workbench.",
          }),
        },
      ],
    });
    const out = await writerWith(create).draft(input);
    expect(out.caption).toBe("Light through the window.");
    expect(out.hashtags).toEqual(["#studio"]);
  });

  it("requests claude-opus-5 with a json schema output format", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        { type: "text", text: JSON.stringify({ caption: "a", hashtags: [], altText: "b" }) },
      ],
    });
    await writerWith(create).draft(input);
    const params = create.mock.calls[0]?.[0];
    expect(params.model).toBe("claude-opus-5");
    expect(params.output_config.format.type).toBe("json_schema");
  });

  it("throws CopyWriterRefusalError on a refusal stop reason", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "refusal",
      stop_details: { category: "other" },
      content: [],
    });
    await expect(writerWith(create).draft(input)).rejects.toBeInstanceOf(CopyWriterRefusalError);
  });

  it("throws when the response contains no text block", async () => {
    const create = vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [] });
    await expect(writerWith(create).draft(input)).rejects.toThrow(/no text/i);
  });

  it("throws when the payload does not match the schema", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ caption: 42 }) }],
    });
    await expect(writerWith(create).draft(input)).rejects.toThrow();
  });
});
