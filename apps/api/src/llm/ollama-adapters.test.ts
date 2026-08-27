import { describe, expect, it, vi } from "vitest";
import type { Classification } from "@intabot/shared";
import { OllamaCopyWriter } from "../content/ollama-copy-writer";
import { CopyWriterRefusalError } from "../content/copy-writer.port";
import { REFUSAL_CLASSIFICATION } from "../moderation/anthropic-comment-classifier";
import { OllamaCommentClassifier } from "../moderation/ollama-comment-classifier";
import { OllamaReplyWriter } from "../moderation/ollama-reply-writer";
import { ReplyRefusalError } from "../moderation/reply-writer.port";
import { OllamaClient } from "./ollama.client";

const praise: Classification = {
  sentiment: "positive",
  intent: "praise",
  toxicity: 0,
  isSpam: false,
  needsHuman: false,
};

/** A fetch that always answers with the same Ollama chat body. */
function clientReturning(content: string) {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ message: { content } }),
  } as Response);
  return { client: new OllamaClient("http://ollama.test", fetchImpl as never), fetchImpl };
}

const draftInput = {
  accountVoice: "warm, plain",
  format: "IMAGE" as const,
  recentCaptions: ["Yesterday's light."],
  mediaMeta: { contentType: "image/jpeg" },
};

describe("OllamaCopyWriter", () => {
  it("returns the validated copy and asks the configured model", async () => {
    const { client, fetchImpl } = clientReturning(
      JSON.stringify({ caption: "Morning light.", hashtags: ["#studio"], altText: "A bench." }),
    );
    const out = await new OllamaCopyWriter(client, "qwen3.6:27b").draft(draftInput);

    expect(out.caption).toBe("Morning light.");
    expect(out.altText).toBe("A bench.");
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.model).toBe("qwen3.6:27b");
    expect(body.format.required).toContain("caption");
  });

  it("carries the brand voice in the system prompt", async () => {
    const { client, fetchImpl } = clientReturning(
      JSON.stringify({ caption: "a", hashtags: [], altText: "b" }),
    );
    await new OllamaCopyWriter(client).draft(draftInput);
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.messages[0].content).toContain("warm, plain");
  });

  it("turns unusable output into a refusal, not a job failure", async () => {
    const { client, fetchImpl } = clientReturning("I cannot help with that.");
    await expect(new OllamaCopyWriter(client).draft(draftInput)).rejects.toBeInstanceOf(
      CopyWriterRefusalError,
    );
    // One retry before giving up.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats a wrong-shaped object as unusable", async () => {
    const { client } = clientReturning(JSON.stringify({ caption: "", hashtags: [], altText: "" }));
    await expect(new OllamaCopyWriter(client).draft(draftInput)).rejects.toBeInstanceOf(
      CopyWriterRefusalError,
    );
  });
});

describe("OllamaCommentClassifier", () => {
  const input = { commentText: "love this", postCaption: "hi", accountVoice: "warm" };

  it("returns the parsed classification", async () => {
    const { client } = clientReturning(JSON.stringify(praise));
    const out = await new OllamaCommentClassifier(client).classify(input);
    expect(out).toEqual(praise);
  });

  it("classifies at temperature 0", async () => {
    const { client, fetchImpl } = clientReturning(JSON.stringify(praise));
    await new OllamaCommentClassifier(client).classify(input);
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.options.temperature).toBe(0);
  });

  it("falls back to needsHuman when the model produces nothing usable", async () => {
    const { client } = clientReturning("sorry, I won't classify that");
    const out = await new OllamaCommentClassifier(client).classify(input);
    expect(out).toEqual(REFUSAL_CLASSIFICATION);
    expect(out.needsHuman).toBe(true);
  });

  it("never invents a confident classification from a wrong shape", async () => {
    const { client } = clientReturning(JSON.stringify({ sentiment: "delighted" }));
    const out = await new OllamaCommentClassifier(client).classify(input);
    expect(out.needsHuman).toBe(true);
  });
});

describe("OllamaReplyWriter", () => {
  const input = {
    commentText: "do you ship to India?",
    classification: praise,
    postCaption: "new drop",
    accountVoice: "warm, plain",
  };

  it("returns the drafted reply", async () => {
    const { client } = clientReturning(JSON.stringify({ text: "We do — DM us!" }));
    const out = await new OllamaReplyWriter(client).draftReply(input);
    expect(out.text).toBe("We do — DM us!");
  });

  it("escalates rather than replying when output is unusable", async () => {
    const { client } = clientReturning("no");
    await expect(new OllamaReplyWriter(client).draftReply(input)).rejects.toBeInstanceOf(
      ReplyRefusalError,
    );
  });

  it("rejects an empty reply instead of posting it", async () => {
    const { client } = clientReturning(JSON.stringify({ text: "" }));
    await expect(new OllamaReplyWriter(client).draftReply(input)).rejects.toBeInstanceOf(
      ReplyRefusalError,
    );
  });
});
