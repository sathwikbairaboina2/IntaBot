import { Injectable } from "@nestjs/common";
import type { ReplyInput, ReplyWriterPort } from "./reply-writer.port";
import { ReplyRefusalError } from "./reply-writer.port";

/** Deterministic reply writer — the DI default. */
@Injectable()
export class FakeReplyWriter implements ReplyWriterPort {
  private nextReply: string | null = null;
  private nextRefusal: string | null = null;

  setNextReply(text: string): void {
    this.nextReply = text;
  }

  setNextRefusal(category: string): void {
    this.nextRefusal = category;
  }

  reset(): void {
    this.nextReply = null;
    this.nextRefusal = null;
  }

  async draftReply(input: ReplyInput): Promise<{ text: string }> {
    if (this.nextRefusal) {
      const category = this.nextRefusal;
      this.nextRefusal = null;
      throw new ReplyRefusalError(category);
    }
    if (this.nextReply) {
      const text = this.nextReply;
      this.nextReply = null;
      return { text };
    }
    if (input.classification.intent === "question") {
      return { text: "Great question — the caption has details, and we'll follow up." };
    }
    return { text: "Thanks for the kind words — more from the studio soon." };
  }
}
