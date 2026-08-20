import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Classification } from "@intabot/shared";
import { AnthropicCommentClassifier } from "../src/moderation/anthropic-comment-classifier";
import Anthropic from "@anthropic-ai/sdk";

interface EvalCase {
  text: string;
  expected: Partial<Pick<Classification, "intent" | "isSpam" | "needsHuman">>;
}

const cases: EvalCase[] = JSON.parse(
  readFileSync(join(__dirname, "fixtures/comment-eval.json"), "utf8"),
);

/**
 * Prompt-regression guard: runs the REAL classifier against ~30 fixture
 * comments. Skipped without a key so the suite stays offline by default; the
 * alternative discovery path for a prompt regression is a client's live
 * account.
 */
describe.skipIf(!process.env.ANTHROPIC_API_KEY)("classifier eval", () => {
  it("matches expected classifications within tolerance", { timeout: 300_000 }, async () => {
    const classifier = new AnthropicCommentClassifier(
      new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
    );

    const results = await Promise.all(
      cases.map(async (c) => ({
        case: c,
        actual: await classifier.classify({
          commentText: c.text,
          postCaption: "New A2 print run from the studio.",
          accountVoice: "clear, friendly, specific",
        }),
      })),
    );

    let intentHits = 0;
    let intentTotal = 0;
    for (const { case: c, actual } of results) {
      if (c.expected.intent !== undefined) {
        intentTotal += 1;
        if (actual.intent === c.expected.intent) intentHits += 1;
      }
      // needsHuman on the legal/complaint subset is a hard requirement: a
      // missed escalation is the worst failure mode this system has.
      if (c.expected.needsHuman === true) {
        expect(actual.needsHuman, `needsHuman missed: "${c.text}"`).toBe(true);
      }
      if (c.expected.isSpam === true) {
        expect(actual.isSpam, `spam missed: "${c.text}"`).toBe(true);
      }
    }

    expect(intentHits / intentTotal).toBeGreaterThanOrEqual(0.8);
  });
});
