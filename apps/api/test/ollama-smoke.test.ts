import { describe, expect, it } from "vitest";
import { OllamaCopyWriter } from "../src/content/ollama-copy-writer";
import { OllamaClient } from "../src/llm/ollama.client";
import { OllamaCommentClassifier } from "../src/moderation/ollama-comment-classifier";
import { OllamaReplyWriter } from "../src/moderation/ollama-reply-writer";

const BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3.6:27b";

/**
 * Runs the three adapters against a REAL local model. Skipped unless
 * OLLAMA_SMOKE is set, so the suite stays offline by default — the unit tests
 * cover the adapter logic; this covers the thing they cannot: that the model
 * actually honours the schema.
 *
 *   OLLAMA_SMOKE=1 pnpm test ollama-smoke
 */
describe.skipIf(!process.env.OLLAMA_SMOKE)("ollama smoke", () => {
  const client = new OllamaClient(BASE);

  it("drafts a caption that satisfies the schema", { timeout: 300_000 }, async () => {
    const out = await new OllamaCopyWriter(client, MODEL).draft({
      accountVoice: "warm, plain, no exclamation marks",
      format: "IMAGE",
      recentCaptions: ["Yesterday's light across the bench."],
      mediaMeta: { contentType: "image/jpeg" },
    });

    expect(out.caption.length).toBeGreaterThan(0);
    expect(out.altText.length).toBeGreaterThan(0);
    expect(Array.isArray(out.hashtags)).toBe(true);
    console.log(`caption: ${out.caption}\nhashtags: ${out.hashtags.join(" ")}\nalt: ${out.altText}`);
  });

  it("separates a question, a complaint and spam", { timeout: 300_000 }, async () => {
    const classifier = new OllamaCommentClassifier(client, MODEL);

    const question = await classifier.classify({
      commentText: "this is gorgeous, where can I buy it?",
      postCaption: "New pieces on the bench.",
      accountVoice: "warm",
    });
    const complaint = await classifier.classify({
      commentText: "I want a refund, this arrived broken and nobody replies",
      postCaption: "New pieces on the bench.",
      accountVoice: "warm",
    });
    const spam = await classifier.classify({
      commentText: "check out my page https://spam.example follow me",
      postCaption: "New pieces on the bench.",
      accountVoice: "warm",
    });

    console.log({ question, complaint, spam });
    // The judgement that actually gates behaviour: a refund complaint must
    // reach a human, and spam must not be answered.
    expect(complaint.needsHuman).toBe(true);
    expect(spam.isSpam).toBe(true);
    expect(question.needsHuman).toBe(false);
  });

  it("writes a short reply in the account voice", { timeout: 300_000 }, async () => {
    const out = await new OllamaReplyWriter(client, MODEL).draftReply({
      commentText: "this is gorgeous, where can I buy it?",
      classification: {
        sentiment: "positive",
        intent: "question",
        toxicity: 0,
        isSpam: false,
        needsHuman: false,
      },
      postCaption: "New pieces on the bench.",
      accountVoice: "warm, plain, no exclamation marks",
    });

    console.log(`reply: ${out.text}`);
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.text.split(/\s+/).length).toBeLessThan(80);
  });
});
