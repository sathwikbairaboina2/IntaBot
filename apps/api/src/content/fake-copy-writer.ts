import { Injectable } from "@nestjs/common";
import {
  CopyWriterRefusalError,
  type CopyWriterPort,
  type DraftInput,
  type DraftOutput,
} from "./copy-writer.port";

@Injectable()
export class FakeCopyWriter implements CopyWriterPort {
  private refuseNext = false;
  private override: Partial<DraftOutput> | null = null;

  setNextRefusal(): void {
    this.refuseNext = true;
  }

  setNextOutput(output: Partial<DraftOutput>): void {
    this.override = output;
  }

  reset(): void {
    this.refuseNext = false;
    this.override = null;
  }

  async draft(input: DraftInput): Promise<DraftOutput> {
    if (this.refuseNext) {
      this.refuseNext = false;
      throw new CopyWriterRefusalError("fake refusal");
    }

    const base: DraftOutput = {
      caption: `A ${input.format.toLowerCase()} from the studio.`,
      hashtags: ["#studio", "#behindthescenes"],
      altText: `Placeholder alt text for a ${input.format.toLowerCase()}.`,
    };

    const output = { ...base, ...(this.override ?? {}) };
    this.override = null;
    return output;
  }
}
