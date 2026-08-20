import { Injectable } from "@nestjs/common";
import type { Classification } from "@intabot/shared";
import type { ClassifyInput, CommentClassifierPort } from "./comment-classifier.port";

const COMPLAINT_TERMS = ["refund", "lawyer", "broken", "complaint", "scam"];
const SPAM_TERMS = ["http://", "https://", "follow me"];

/**
 * Deterministic keyword classifier — the DI default, so the whole moderation
 * pipeline runs offline. Tests steer it with setNextClassification.
 */
@Injectable()
export class FakeCommentClassifier implements CommentClassifierPort {
  private next: Classification | null = null;
  private calls = 0;

  setNextClassification(classification: Classification): void {
    this.next = classification;
  }

  getCallCount(): number {
    return this.calls;
  }

  reset(): void {
    this.next = null;
    this.calls = 0;
  }

  async classify(input: ClassifyInput): Promise<Classification> {
    this.calls += 1;
    if (this.next) {
      const queued = this.next;
      this.next = null;
      return queued;
    }

    const text = input.commentText.toLowerCase();
    if (COMPLAINT_TERMS.some((t) => text.includes(t))) {
      return {
        sentiment: "negative",
        intent: "complaint",
        toxicity: 0.3,
        isSpam: false,
        needsHuman: true,
      };
    }
    if (SPAM_TERMS.some((t) => text.includes(t))) {
      return { sentiment: "neutral", intent: "spam", toxicity: 0.1, isSpam: true, needsHuman: false };
    }
    if (text.includes("?")) {
      return {
        sentiment: "neutral",
        intent: "question",
        toxicity: 0,
        isSpam: false,
        needsHuman: false,
      };
    }
    return { sentiment: "positive", intent: "praise", toxicity: 0, isSpam: false, needsHuman: false };
  }
}
