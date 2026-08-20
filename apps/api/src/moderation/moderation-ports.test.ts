import { describe, expect, it } from "vitest";
import type { Classification } from "@intabot/shared";
import {
  AnthropicCommentClassifier,
  REFUSAL_CLASSIFICATION,
  buildClassifyPrompt,
} from "./anthropic-comment-classifier";
import { AnthropicReplyWriter, buildReplyPrompt } from "./anthropic-reply-writer";
import { FakeCommentClassifier } from "./fake-comment-classifier";
import { FakeReplyWriter } from "./fake-reply-writer";
import { ReplyRefusalError } from "./reply-writer.port";

const praise: Classification = {
  sentiment: "positive",
  intent: "praise",
  toxicity: 0,
  isSpam: false,
  needsHuman: false,
};

function stubClient(message: unknown) {
  return { messages: { create: async () => message } } as never;
}

describe("FakeCommentClassifier", () => {
  it("flags complaint terms as needsHuman", async () => {
    const fake = new FakeCommentClassifier();
    const result = await fake.classify({
      commentText: "I want a refund",
      postCaption: "",
      accountVoice: "",
    });
    expect(result.intent).toBe("complaint");
    expect(result.needsHuman).toBe(true);
  });

  it("flags links as spam and questions as questions", async () => {
    const fake = new FakeCommentClassifier();
    const spam = await fake.classify({
      commentText: "check https://x.test",
      postCaption: "",
      accountVoice: "",
    });
    expect(spam.isSpam).toBe(true);
    const q = await fake.classify({ commentText: "when?", postCaption: "", accountVoice: "" });
    expect(q.intent).toBe("question");
  });

  it("honours setNextClassification once and counts calls", async () => {
    const fake = new FakeCommentClassifier();
    fake.setNextClassification({ ...praise, intent: "other", needsHuman: true });
    const first = await fake.classify({ commentText: "hi", postCaption: "", accountVoice: "" });
    const second = await fake.classify({ commentText: "hi", postCaption: "", accountVoice: "" });
    expect(first.needsHuman).toBe(true);
    expect(second.intent).toBe("praise");
    expect(fake.getCallCount()).toBe(2);
  });
});

describe("FakeReplyWriter", () => {
  it("answers questions and praise differently, honours hooks", async () => {
    const fake = new FakeReplyWriter();
    const q = await fake.draftReply({
      commentText: "when?",
      classification: { ...praise, intent: "question" },
      postCaption: "",
      accountVoice: "",
    });
    expect(q.text).toMatch(/question/i);

    fake.setNextRefusal("policy");
    await expect(
      fake.draftReply({ commentText: "x", classification: praise, postCaption: "", accountVoice: "" }),
    ).rejects.toBeInstanceOf(ReplyRefusalError);
  });
});

describe("Anthropic moderation adapters", () => {
  it("maps a classifier refusal to the needsHuman classification", async () => {
    const classifier = new AnthropicCommentClassifier(
      stubClient({ stop_reason: "refusal", content: [] }),
    );
    const result = await classifier.classify({
      commentText: "x",
      postCaption: "",
      accountVoice: "",
    });
    expect(result).toEqual(REFUSAL_CLASSIFICATION);
  });

  it("parses a structured classification", async () => {
    const classifier = new AnthropicCommentClassifier(
      stubClient({
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify(praise) }],
      }),
    );
    expect(await classifier.classify({ commentText: "x", postCaption: "", accountVoice: "" })).toEqual(
      praise,
    );
  });

  it("throws ReplyRefusalError with the category on reply refusal", async () => {
    const writer = new AnthropicReplyWriter(
      stubClient({ stop_reason: "refusal", stop_details: { category: "hate" }, content: [] }),
    );
    await expect(
      writer.draftReply({ commentText: "x", classification: praise, postCaption: "", accountVoice: "" }),
    ).rejects.toMatchObject({ category: "hate" });
  });

  it("builds prompts carrying the comment, caption, and voice", () => {
    const cPrompt = buildClassifyPrompt({
      commentText: "Where to buy?",
      postCaption: "New print run.",
      accountVoice: "warm",
    });
    expect(cPrompt).toContain("Where to buy?");
    expect(cPrompt).toContain("New print run.");
    expect(cPrompt).toContain("warm");

    const rPrompt = buildReplyPrompt({
      commentText: "Where to buy?",
      classification: { ...praise, intent: "question" },
      postCaption: "New print run.",
      accountVoice: "warm",
    });
    expect(rPrompt).toContain("Where to buy?");
    expect(rPrompt).toContain("question");
  });
});
